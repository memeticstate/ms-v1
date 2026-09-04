import { normalizePairToken } from "@/lib/adapters/pair";
import type { AffinitySnapshot, Habitat } from "@/lib/affinity-model";

const habitats: Habitat[] = [
  { symbol: "SPY", name: "S&P 500", sector: "Broad market", color: "#e8c56a", x: 500, y: 282 },
  { symbol: "NVDA", name: "NVIDIA", sector: "Accelerated compute", color: "#6de0d2", x: 320, y: 144 },
  { symbol: "AMD", name: "AMD", sector: "Compute", color: "#7ca7ff", x: 132, y: 226 },
  { symbol: "INTC", name: "Intel", sector: "Legacy silicon", color: "#b99cff", x: 170, y: 436 },
  { symbol: "MU", name: "Micron", sector: "Memory", color: "#ff9d72", x: 360, y: 512 },
  { symbol: "AAPL", name: "Apple", sector: "Consumer systems", color: "#d8dde8", x: 705, y: 126 },
  { symbol: "MSFT", name: "Microsoft", sector: "Cloud systems", color: "#7ca7ff", x: 856, y: 238 },
  { symbol: "TSLA", name: "Tesla", sector: "Industrial myth", color: "#ff7a6f", x: 820, y: 442 },
  { symbol: "SPCX", name: "SpaceX", sector: "Private frontier", color: "#f1efe9", x: 662, y: 526 },
];

const pair = normalizePairToken(
  {
    address: "0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be", symbol: "PAIR", name: "PAIR", marketCapUsd: 2_671_204,
    volumeUsd: 1_301_798, priceChange24h: 78_101, graduated: true,
    markets: [{ symbol: "SPY", weightBps: 10_000 }],
  },
  {
    id: "pair", thesis: "The protocol becomes its own market organism.",
    interpretation: "A monoculture with enormous early metabolism: one broad-market habitat, one concentrated identity.",
    coherence: 96, vitality: 98, stress: 18, color: "#e8c56a", x: 500, y: 382,
  },
);

const chips = normalizePairToken(
  {
    address: "0xbcd09284dffe06f868a4650546233e3e9abe4d97", symbol: "CHIPS", name: "Chips Party Pack", marketCapUsd: 302_868,
    volumeUsd: 123_436, priceChange24h: 13.13, graduated: true,
    markets: [
      { symbol: "NVDA", weightBps: 2_500 }, { symbol: "AMD", weightBps: 2_500 },
      { symbol: "INTC", weightBps: 2_500 }, { symbol: "MU", weightBps: 2_500 },
    ],
  },
  {
    id: "chips", thesis: "The semiconductor stack as a single cultural organism.",
    interpretation: "Balanced silicon lineage. Four rival organs cooperate without one company swallowing the species.",
    coherence: 99, vitality: 84, stress: 22, color: "#6de0d2", x: 308, y: 330,
  },
);
chips.species.trades24h = 1_111;

const pear = normalizePairToken(
  {
    address: "0x3567c5d0ae5c5933920bbd6db982aa463a203bb2", symbol: "PEAR", name: "PEAR", marketCapUsd: 359_782,
    volumeUsd: 89_646, priceChange24h: 46.76, graduated: true,
    markets: [
      { symbol: "AAPL", weightBps: 3_334 }, { symbol: "MSFT", weightBps: 3_333 },
      { symbol: "NVDA", weightBps: 3_333 },
    ],
  },
  {
    id: "pear", thesis: "Megacap computing compressed into a synthetic fruit.",
    interpretation: "A stable triangle of interface, infrastructure and compute. Corporate power disguised as something edible.",
    coherence: 94, vitality: 78, stress: 31, color: "#b99cff", x: 620, y: 274,
  },
);

const xSpecies = normalizePairToken(
  {
    address: "0x3701b015260c6735c3861f248c70b878da097689", symbol: "X", name: "X Holdings", marketCapUsd: 16_822,
    volumeUsd: 4_672, priceChange24h: 16.22, graduated: true,
    markets: [{ symbol: "SPCX", weightBps: 5_000 }, { symbol: "TSLA", weightBps: 5_000 }],
  },
  {
    id: "x", thesis: "The Musk industrial myth split between earth and orbit.",
    interpretation: "A coherent but fragile binary. Its culture depends on two habitats controlled by the same public mythology.",
    coherence: 97, vitality: 46, stress: 57, color: "#ff7a6f", x: 712, y: 402,
  },
);

export const affinitySnapshot: AffinitySnapshot = {
  observedAt: "2026-08-29T23:00:00Z",
  chain: "Robinhood Chain",
  habitats,
  species: [chips.species, pear.species, xSpecies.species, pair.species],
  edges: [...chips.edges, ...pear.edges, ...xSpecies.edges, ...pair.edges],
  block: {
    number: 59,
    date: "29 AUG 2026",
    title: "The multipool Cambrian moment",
    signal: "Culture stopped orbiting ETH and began attaching itself directly to companies.",
    interpretation: "The first durable species are not random baskets. CHIPS, PEAR and X each compress a recognizable corporate mythology into a tradeable relationship. The new primitive is not the token alone—it is the weighted edge between a community and the institutions it chooses as habitat.",
    evidence: [
      { label: "PAIR volume", value: "$6.45M" }, { label: "Observed launches", value: "102" },
      { label: "Trades", value: "91.5K" }, { label: "Mapped species", value: "4" },
    ],
    speciesIds: ["chips", "pear", "x"],
  },
};
