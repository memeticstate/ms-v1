import { XSearchApiResponseSchema, type XSearchApiResponse } from "./schemas";

export interface RateLimitMetadata {
  limit: number | null;
  remaining: number | null;
  reset: number | null;
}

export interface XClientOptions {
  bearerToken: string;
  baseUrl?: string;
  maxRetries?: number;
  maxBackoffMs?: number;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export interface XRecentSearchInput {
  query: string;
  nextToken?: string;
  sinceId?: string;
  startTime?: string;
  endTime?: string;
  maxResults?: number;
}

export interface FetchResult {
  response: XSearchApiResponse;
  rateLimits: RateLimitMetadata;
  fetchedAt: string;
}

export class XApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
    public readonly rateLimits: RateLimitMetadata = { limit: null, remaining: null, reset: null },
  ) {
    super(message);
    this.name = "XApiError";
  }
}

export class XIngestionClient {
  private readonly bearerToken: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly maxBackoffMs: number;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: XClientOptions) {
    if (!options.bearerToken.trim()) throw new Error("XIngestionClient requires a Bearer Token.");
    this.bearerToken = options.bearerToken;
    this.baseUrl = (options.baseUrl ?? "https://api.x.com/2").replace(/\/$/, "");
    this.maxRetries = Math.max(0, options.maxRetries ?? 3);
    this.maxBackoffMs = Math.max(0, options.maxBackoffMs ?? 30_000);
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  private extractRateLimits(headers: Headers): RateLimitMetadata {
    const integer = (name: string) => {
      const value = headers.get(name);
      if (value == null) return null;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      limit: integer("x-rate-limit-limit"),
      remaining: integer("x-rate-limit-remaining"),
      reset: integer("x-rate-limit-reset"),
    };
  }

  private retryDelay(attempt: number) {
    const base = Math.min(1_000 * 2 ** attempt, this.maxBackoffMs);
    return Math.min(base + Math.floor(this.random() * 750), this.maxBackoffMs);
  }

  private rateLimitDelay(response: Response, rateLimits: RateLimitMetadata) {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    }
    if (rateLimits.reset != null) {
      return Math.max(0, rateLimits.reset * 1_000 - this.now() + 250 + Math.floor(this.random() * 500));
    }
    return null;
  }

  async searchRecent(input: XRecentSearchInput): Promise<FetchResult> {
    const query = input.query.trim();
    if (!query) throw new Error("X recent search requires a non-empty query.");
    const maxResults = input.maxResults ?? 100;
    if (!Number.isInteger(maxResults) || maxResults < 10 || maxResults > 100) {
      throw new Error("X recent search maxResults must be an integer from 10 through 100.");
    }

    const params = new URLSearchParams({
      query,
      max_results: String(maxResults),
      "tweet.fields": "created_at,public_metrics,author_id",
      expansions: "author_id",
      "user.fields": "id,name,username,created_at,public_metrics",
    });
    if (input.nextToken) params.set("next_token", input.nextToken);
    if (input.sinceId) params.set("since_id", input.sinceId);
    if (input.startTime) params.set("start_time", input.startTime);
    if (input.endTime) params.set("end_time", input.endTime);

    const url = `${this.baseUrl}/tweets/search/recent?${params}`;
    let retry = 0;

    while (true) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.bearerToken}`, Accept: "application/json" },
          redirect: "error",
        });
      } catch (error) {
        if (retry >= this.maxRetries) {
          throw new XApiError(`X API network failure: ${error instanceof Error ? error.message : "unknown error"}`, null, true);
        }
        await this.sleep(this.retryDelay(retry++));
        continue;
      }

      const rateLimits = this.extractRateLimits(response.headers);

      if (response.status === 429) {
        const wait = this.rateLimitDelay(response, rateLimits);
        if (retry >= this.maxRetries || wait == null || wait > this.maxBackoffMs) {
          throw new XApiError("X API rate limit reached; defer this source until its reset time.", 429, true, rateLimits);
        }
        await this.sleep(wait);
        retry++;
        continue;
      }

      if (response.status >= 500 && response.status < 600) {
        if (retry >= this.maxRetries) {
          throw new XApiError(`X API remained unavailable with status ${response.status}.`, response.status, true, rateLimits);
        }
        await this.sleep(this.retryDelay(retry++));
        continue;
      }

      if (!response.ok) {
        const body = (await response.text()).slice(0, 1_500);
        throw new XApiError(`X API rejected recent search [${response.status}]: ${body}`, response.status, false, rateLimits);
      }

      // Schema failures are data-contract failures, not transient HTTP failures. Do not retry them blindly.
      const json: unknown = await response.json();
      const parsed = XSearchApiResponseSchema.parse(json);
      return { response: parsed, rateLimits, fetchedAt: new Date(this.now()).toISOString() };
    }
  }
}
