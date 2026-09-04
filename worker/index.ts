/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { setRuntimeBindings } from "@/db";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setRuntimeBindings(env as unknown as Record<string, unknown>);
    const url = new URL(request.url);

    const isManualWake = url.pathname === "/api/collector/wake" && request.method === "POST";
    const isPonsHeartbeat = url.pathname === "/api/collector/heartbeat" && request.method === "POST";
    const isHistoryHeartbeat = url.pathname === "/api/collector/history" && request.method === "POST";
    if (isManualWake || isPonsHeartbeat) {
      ctx.waitUntil(import("@/lib/ingestion/collector-cycle")
        .then(({ runPrimaryCollectorCycle }) => runPrimaryCollectorCycle(
          isManualWake ? "manual" : "request-watchdog",
          { force: isManualWake, includeEvidence: isManualWake },
        ))
        .catch((error) => {
          console.error("primary request collection failed", {
            trigger: isManualWake ? "manual" : "request-watchdog",
            message: error instanceof Error ? error.message : String(error),
          });
        }));
    }
    if (isHistoryHeartbeat) {
      const requested = url.searchParams.get("generation");
      const generationId = requested === "v1-legacy" ? "v1-legacy" : "v1-current";
      ctx.waitUntil(import("@/lib/ingestion/collector-cycle")
        .then(({ runHistoryCollectorCycle }) => runHistoryCollectorCycle("request-watchdog", generationId))
        .catch((error) => console.error("PONS history request collection failed", error)));
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, _env: Env, ctx: ExecutionContext): Promise<void> {
    setRuntimeBindings(_env as unknown as Record<string, unknown>);
    console.info("scheduled collector cycle dispatched", { scheduledTime: controller.scheduledTime });
    ctx.waitUntil(import("@/lib/ingestion/collector-cycle")
      .then(({ runScheduledCollectorCycle }) => runScheduledCollectorCycle(controller.scheduledTime))
      .catch((error) => console.error("scheduled collector cycle failed", error)));
  },
};

export default worker;
