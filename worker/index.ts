/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { setRuntimeBindings } from "@/db";
import { withSecurityHeaders } from "@/lib/security/response-headers";
import { documentationRequest } from "@/lib/documentation-routing";
import { withRequestContext } from "@/lib/request-context";

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
    const docsRequest = documentationRequest(request);
    if (docsRequest) return withSecurityHeaders(await env.ASSETS.fetch(docsRequest));

    if (url.pathname === "/api/pons-state" && request.method === "GET") {
      return withSecurityHeaders(await import("@/app/api/pons-state/route").then(m => m.GET(request, task => ctx.waitUntil(task))));
    }

    if (url.pathname === "/api/premium/researcher" && ["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
      const response = await import("@/app/api/premium/researcher/route").then(m => m.GET(request));

      // Research execution is awaited on explicit POSTs.
      // GET is read-only and must not repeatedly dispatch the queue while the UI polls.
      if (response.ok && request.method === "POST") {
        try {
          await import("@/lib/researcher/runner")
            .then(m => m.processResearchQueue(
              env.DB,
              env as unknown as Record<string, unknown>
            ));
        } catch (error) {
          console.error("researcher queue unavailable", error);
        }
      }

      return withSecurityHeaders(response);
    }

    if (url.pathname === "/api/token-radar" && request.method === "GET") {
      // Landing visitors also keep the existing bounded collection watchdog alive.
      // Collection is background work and never holds the discovery response open.
      ctx.waitUntil(import("@/lib/ingestion/pons-factory").then(m => m.runFactoryCollection()).catch(() => undefined));
      ctx.waitUntil(import("@/lib/ingestion/pons-live").then(m => m.runRequestPonsCollection()).catch(() => undefined));
      const discovery = await import("@/lib/tokens/discovery");
      const refresh = discovery.loadTokenDiscovery({ background: task => ctx.waitUntil(task) });
      ctx.waitUntil(refresh.catch(() => console.error("token discovery refresh failed")));
      try {
        const cached = await discovery.loadCachedTokenDiscovery();
        // Cached data retains its original source timestamps. Refreshing it
        // continues after this response, without holding the landing page open.
        return withSecurityHeaders(Response.json(cached ?? await refresh, { headers: { "cache-control": "no-store" } }));
      } catch {
        return withSecurityHeaders(Response.json({ error: "Token discovery temporarily unavailable" }, { status: 503 }));
      }
    }

    const isManualWake = url.pathname === "/api/collector/wake" && request.method === "POST";
    const isPonsHeartbeat = url.pathname === "/api/collector/heartbeat" && request.method === "POST";
    const isHistoryHeartbeat = url.pathname === "/api/collector/history" && request.method === "POST";
    if (request.method === "POST" && url.pathname.startsWith("/api/collector/")) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return withSecurityHeaders(Response.json({ error: "origin_rejected" }, { status: 403 }));
    }
    if (isManualWake || isPonsHeartbeat) {
      const work = import("@/lib/ingestion/collector-cycle")
        .then(({ runPrimaryCollectorCycle }) => runPrimaryCollectorCycle(
          isManualWake ? "manual" : "request-watchdog",
          { force: isManualWake, includeEvidence: false, includeFactory: false },
        ));
      // A heartbeat is a dispatch signal, not a long-poll request. Keep the
      // bounded commit alive after the browser receives its acknowledgement.
      ctx.waitUntil(work.catch((error) => console.error("collector cycle failed", error)));
      return withSecurityHeaders(Response.json({
        accepted: true,
        settled: false,
        trigger: isManualWake ? "manual" : "request-watchdog",
      }, { status: 202, headers: { "cache-control": "no-store" } }));
    }
    if (url.pathname === "/api/collector/live" && request.method === "POST") {
      const work = import("@/lib/ingestion/pons-factory").then((m) => m.runFactoryCollection());
      ctx.waitUntil(work.catch((error) => console.error("factory live collection failed", error)));
      return withSecurityHeaders(Response.json({ accepted: true, settled: false, lane: "pons-factory-live" }, { status: 202, headers: { "cache-control": "no-store" } }));
    }
    if (request.method === "POST" && ["/api/collector/research", "/api/collector/metadata", "/api/collector/evidence"].includes(url.pathname)) {
      const lane = url.pathname.endsWith("/evidence") ? "robinhood-evidence"
        : url.pathname.endsWith("/metadata") ? "pons-metadata" : "pons-research";
      const work = url.pathname.endsWith("/evidence")
        ? import("@/lib/ingestion/pair-live").then((m) => m.runAffinityCollection("request-watchdog"))
        : url.pathname.endsWith("/metadata")
          ? import("@/lib/ingestion/pons-research").then((m) => m.runMetadataCollection())
          : import("@/lib/ingestion/pons-research").then((m) => m.runTokenResearch(url.searchParams.get("token") ?? undefined));
      ctx.waitUntil(work.catch((error) => console.error(`${lane} collection failed`, error)));
      return withSecurityHeaders(Response.json({ accepted: true, settled: false, lane }, { status: 202, headers: { "cache-control": "no-store" } }));
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
      const imageResponse = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(imageResponse);
    }

    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },

  async scheduled(controller: ScheduledController, _env: Env, ctx: ExecutionContext): Promise<void> {
    setRuntimeBindings(_env as unknown as Record<string, unknown>);
    console.info("scheduled collector cycle dispatched", { scheduledTime: controller.scheduledTime });
    ctx.waitUntil(import("@/lib/ingestion/collector-cycle")
      .then(({ runScheduledCollectorCycle }) => runScheduledCollectorCycle(controller.scheduledTime))
      .catch((error) => console.error("scheduled collector cycle failed", error)));
    ctx.waitUntil(import("@/lib/tokens/discovery").then(m => m.loadTokenDiscovery()).catch(() => undefined));
    ctx.waitUntil(import("@/db/token-discovery").then(m => m.pruneDiscoveryCache()).catch(() => undefined));
    ctx.waitUntil(import("@/lib/researcher/runner")
      .then(m => m.processResearchQueue(_env.DB, _env as unknown as Record<string, unknown>, true))
      .catch(() => console.error("scheduled researcher unavailable")));
  },
};

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return withRequestContext(() => worker.fetch(request, env, ctx));
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return withRequestContext(() => worker.scheduled(controller, env, ctx));
  },
};
