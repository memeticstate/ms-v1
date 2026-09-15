import type { PonsActivitySignal, PonsLaunchView, PonsStateResponse, PonsTokenStateTransition } from './model';
import { currentPonsEvidence, evidenceIsFresh } from './research';

export type StateChangeRecord = {
  tokenAddress: string; name: string; symbol: string; pairSymbol: string;
  transition: PonsTokenStateTransition;
};
export type TokenHistoryRecord = {
  observedAt: string; signal: PonsActivitySignal; label: string; phase: string; changeKinds: string[];
};

// Presentation selects from canonical readings; no second scoring model.
export function nowLaunches(state: PonsStateResponse, now = Date.now()) {
  if (!currentPonsEvidence(state, now)) return [];
  return state.launches.filter(launch => launch.research?.eligible || launch.signal === 'stressed');
}

export function meaningfulHolderCount(launch: PonsLaunchView, now = Date.now()) {
  const evidence = launch.currentEvidence;
  return evidence && evidence.status !== 'unavailable' && evidenceIsFresh(evidence, now)
    ? evidence.meaningfulHolders : null;
}

export function stateTone(signal: PonsActivitySignal) {
  return ['steady', 'broadening', 'surging'].includes(signal) ? 'verified'
    : signal === 'stressed' ? 'stress' : 'unresolved';
}

export function transitionCopy(transition: PonsTokenStateTransition) {
  // Preserve the distinction even if an older stored label used loose language.
  return transition.from === 'stressed' && transition.to === 'unverified'
    ? 'Stress no longer confirmed' : transition.label;
}

export function relativeTime(value: string | null | undefined, now = Date.now()) {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return 'Time unavailable';
  if (time > now + 30_000) return 'Timestamp ahead';
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function tradeChange(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value > 0 ? '+' : ''}${Math.round(value)}%` : '—';
}

export function quoteFlowDirection(raw: number | null | undefined) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return '—';
  return raw > 0 ? 'Net inflow' : raw < 0 ? 'Net outflow' : 'Balanced';
}
