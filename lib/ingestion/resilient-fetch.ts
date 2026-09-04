export type FetchTelemetry = {
  url: string;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
  attempts: number;
  status: number;
  recordCount?: number;
};

export class UpstreamError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly attempts: number;

  constructor(code: string, message: string, attempts: number, status?: number) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
    this.status = status;
    this.attempts = attempts;
  }
}

type FetchPolicy = {
  timeoutMs?: number;
  attempts?: number;
  headers?: Record<string, string>;
};

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function errorCode(error: unknown) {
  if (error instanceof UpstreamError) return error.code;
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && /abort|timeout/i.test(error.message)) return "timeout";
  return "network_error";
}

function shortDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 120 * attempt));
}

export async function fetchJsonWithPolicy<T>(url: string, policy: FetchPolicy = {}): Promise<{ data: T; telemetry: FetchTelemetry }> {
  const startedAt = Date.now();
  const maxAttempts = Math.max(1, Math.min(3, policy.attempts ?? 2));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "Memetic-State/0.3 (+https://memetic-state.z3c4.chatgpt.site)",
          ...policy.headers,
        },
        signal: AbortSignal.timeout(policy.timeoutMs ?? 15_000),
      });
      if (!response.ok) {
        const code = `http_${response.status}`;
        if (attempt < maxAttempts && retryableStatus(response.status)) {
          lastError = new UpstreamError(code, `upstream returned ${response.status}`, attempt, response.status);
          await shortDelay(attempt);
          continue;
        }
        throw new UpstreamError(code, `upstream returned ${response.status}`, attempt, response.status);
      }
      const data = await response.json() as T;
      const completedAt = Date.now();
      return {
        data,
        telemetry: {
          url,
          startedAt,
          completedAt,
          latencyMs: completedAt - startedAt,
          attempts: attempt,
          status: response.status,
        },
      };
    } catch (error) {
      lastError = error;
      if (error instanceof UpstreamError && !retryableStatus(error.status ?? 0)) throw error;
      if (attempt < maxAttempts) {
        await shortDelay(attempt);
        continue;
      }
    }
  }

  const code = errorCode(lastError);
  throw lastError instanceof UpstreamError
    ? lastError
    : new UpstreamError(code, lastError instanceof Error ? lastError.message : "upstream request failed", maxAttempts);
}

export function upstreamErrorCode(error: unknown) {
  return errorCode(error);
}
