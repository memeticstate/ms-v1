import { tokenAddress } from "./tokens/model";
import { DEFAULT_PONS_STATE_WINDOW, PONS_STATE_WINDOWS } from "./pons/signals";

export const OBSERVATORY_VIEWS = ["signals", "atlas", "watchlist", "tape", "history", "evidence", "network", "premium"] as const;
export type ObservatoryView = (typeof OBSERVATORY_VIEWS)[number];
export type ObservatoryExperience = "observe" | "research" | "saved";

/** Resolve navigation intent independently of the availability or rank of a token. */
export function parseObservatoryLocation(search: string, experience: ObservatoryExperience = "observe") {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const requestedWindow = Number(params.get("window"));
  const token = tokenAddress(params.get("token") ?? "");
  return {
    token,
    view: experience === "research" ? "premium" as const : experience === "saved" ? "watchlist" as const
      : OBSERVATORY_VIEWS.includes(view as ObservatoryView) ? view as ObservatoryView : "signals" as const,
    pair: params.get("pair")?.trim().toUpperCase() || "ALL",
    windowBlocks: PONS_STATE_WINDOWS.includes(requestedWindow as (typeof PONS_STATE_WINDOWS)[number]) ? requestedWindow : DEFAULT_PONS_STATE_WINDOW,
    openDossier: experience === "observe" && Boolean(token),
  };
}

export function appTokenHref(destination: "observe" | "research" | "brief", address: string) {
  const token = tokenAddress(address);
  if (!token) return destination === "brief" ? "/app" : `/app/${destination}`;
  return destination === "brief" ? `/app/token/${token}` : `/app/${destination}?token=${token}`;
}

/** Upgrade links made before /app became the Simple experience. */
export function legacyAppDestination(search: string): string | null {
  const params = new URLSearchParams(search);
  // A Simple mode is deliberate navigation, including when it carries context.
  if (params.has("mode")) return null;
  const view = params.get("view");
  const token = tokenAddress(params.get("token") ?? "");
  let destination: string;
  if (OBSERVATORY_VIEWS.includes(view as ObservatoryView)) {
    destination = view === "premium" ? "/app/research" : view === "watchlist" ? "/app/saved" : "/app/observe";
    if (view === "premium" || view === "watchlist") params.delete("view");
  } else if (!view && token) {
    destination = `/app/token/${token}`;
    params.delete("token");
  } else if (!view && (params.has("pair") || params.has("window"))) {
    destination = "/app/observe";
  } else {
    return null;
  }
  if (params.has("token")) {
    if (token) params.set("token", token);
    else params.delete("token");
  }
  params.delete("inspect");
  const query = params.toString();
  return `${destination}${query ? `?${query}` : ""}`;
}
