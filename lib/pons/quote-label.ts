// Legacy unresolved quote symbols use PAIR-xxxx. Keep their stored identifiers
// intact for filtering, but distinguish the display label from the PAIR venue.
export function quoteAssetLabel(symbol: string): string {
  return /^PAIR-[0-9a-f]{4}$/i.test(symbol) ? symbol.replace(/^PAIR-/i, "QUOTE-") : symbol;
}
