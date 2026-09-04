export const PONS_CHAIN_ID = 4663;
export const PONS_V2_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
export const PONS_V1_CURRENT_FACTORY = "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb";
export const PONS_V1_LEGACY_FACTORY = "0x0c37a24f5d23a486fa692d1500881d698b1f77a4";
export const PONS_V1_CURRENT_START_BLOCK = 8_991_118;
export const PONS_V1_LEGACY_START_BLOCK = 8_600_612;
export const PONS_V2_ROUTER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
export const PONS_V2_HOOK = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";
export const PONS_V2_DEPLOYMENT_FLOOR = 25_000_000;
export const PONS_FINALITY_BLOCKS = 64;

export type PonsV1GenerationId = "v1-current" | "v1-legacy";

export const PONS_V1_GENERATIONS: Record<PonsV1GenerationId, {
  id: PonsV1GenerationId;
  label: string;
  factory: string;
  startBlock: number;
}> = {
  "v1-current": {
    id: "v1-current",
    label: "V1 · Current",
    factory: PONS_V1_CURRENT_FACTORY,
    startBlock: PONS_V1_CURRENT_START_BLOCK,
  },
  "v1-legacy": {
    id: "v1-legacy",
    label: "V1 · Legacy",
    factory: PONS_V1_LEGACY_FACTORY,
    startBlock: PONS_V1_LEGACY_START_BLOCK,
  },
};

export const PONS_TOPICS = {
  v1Launch: "0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a",
  v3Swap: "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
  launch: "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607",
  swept: "0xcdb72f157fd3666758a6ce201387ffb52038c7562e4fff352828da1096c4b6b4",
  graduated: "0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259",
  permanentlyLocked: "0xa0a18f5bf205becee8b268d7cf69addab8548ae8ef361791464cf0e0e17c1361",
  curveBuy: "0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455",
  curveSell: "0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df",
} as const;

export type PonsPairDefinition = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  kind: "native" | "stable" | "stock";
  color: string;
};

export const PONS_PAIR_DEFINITIONS: PonsPairDefinition[] = [
  { symbol: "ETH", name: "Ether", address: "0x0000000000000000000000000000000000000000", decimals: 18, kind: "native", color: "#71858c" },
  { symbol: "USDG", name: "Global Dollar", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6, kind: "stable", color: "#b2a06a" },
  { symbol: "NVDA", name: "NVIDIA Stock Token", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", decimals: 18, kind: "stock", color: "#82965d" },
  { symbol: "SPCX", name: "SpaceX Stock Token", address: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea", decimals: 18, kind: "stock", color: "#909b94" },
  { symbol: "TSLA", name: "Tesla Stock Token", address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", decimals: 18, kind: "stock", color: "#b65c43" },
  { symbol: "RDDT", name: "Reddit Stock Token", address: "0x05b37fb53a299a1b874a619e1c4c404d52c36f4c", decimals: 18, kind: "stock", color: "#bd7845" },
  { symbol: "GME", name: "GameStop Stock Token", address: "0x1b0e319c6a659f002271b69db8a7df2f911c153e", decimals: 18, kind: "stock", color: "#9c665b" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF Token", address: "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", decimals: 18, kind: "stock", color: "#687c54" },
  { symbol: "AAPL", name: "Apple Stock Token", address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", decimals: 18, kind: "stock", color: "#7d827c" },
  { symbol: "PLTR", name: "Palantir Stock Token", address: "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a", decimals: 18, kind: "stock", color: "#9d7f48" },
];

export const PONS_PAIR_BY_ADDRESS = new Map(PONS_PAIR_DEFINITIONS.map((pair) => [pair.address, pair]));
export const PONS_PAIR_BY_SYMBOL = new Map(PONS_PAIR_DEFINITIONS.map((pair) => [pair.symbol, pair]));

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
