import type { PonsActivitySignal, PonsSignalConfidence } from "@/lib/pons/model";

export const PONS_SIGNAL_WINDOW_BLOCKS = 5_000;
export const PONS_STATE_WINDOWS = [25_000, 100_000, 500_000] as const;
export const DEFAULT_PONS_STATE_WINDOW = 100_000;

export function normalizePonsWindowBlocks(value: number | null | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_PONS_STATE_WINDOW;
  return PONS_STATE_WINDOWS.includes(value as (typeof PONS_STATE_WINDOWS)[number])
    ? value as (typeof PONS_STATE_WINDOWS)[number]
    : DEFAULT_PONS_STATE_WINDOW;
}

export function ponsMomentumPercent(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? null : 0;
  return Math.max(-999, Math.min(999, Math.round((current - previous) / previous * 100)));
}

export function classifyPonsSignal(input: {
  recent: number;
  previous: number;
  recentActors: number;
}): PonsActivitySignal {
  const momentum = ponsMomentumPercent(input.recent, input.previous);
  if (input.recent === 0 && input.previous === 0) return "quiet";
  if (input.previous === 0 && input.recent > 0) return "forming";
  if (input.recent >= 6 && (momentum ?? 0) >= 60 && input.recentActors >= 3) return "surging";
  if (input.recent >= 4 && input.recentActors >= 4 && input.recentActors / input.recent >= 0.45) return "broadening";
  if ((momentum ?? 0) <= -45) return "cooling";
  return "steady";
}

export function ponsSignalConfidence(recent: number, recentActors: number): PonsSignalConfidence {
  if (recent >= 12 && recentActors >= 6) return "high";
  if (recent >= 4 && recentActors >= 2) return "medium";
  return "early";
}

export function ponsSignalNote(input: {
  signal: PonsActivitySignal;
  recent: number;
  previous: number;
  recentActors: number;
  windowBlocks?: number;
}) {
  const blocks = input.windowBlocks ?? PONS_SIGNAL_WINDOW_BLOCKS;
  const momentum = ponsMomentumPercent(input.recent, input.previous);
  if (input.signal === "forming") return `${input.recent} first-window trades across ${input.recentActors} actors`;
  if (input.signal === "quiet") return `No curve trades in the latest ${blocks.toLocaleString("en-US")} blocks`;
  if (input.signal === "broadening") return `${input.recentActors} actors generated ${input.recent} recent trades`;
  if (momentum !== null) {
    const direction = momentum > 0 ? `+${momentum}%` : `${momentum}%`;
    return `${input.recent} recent trades · ${direction} versus the prior window`;
  }
  return `${input.recent} recent trades across ${input.recentActors} actors`;
}
