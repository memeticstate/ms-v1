import { PONS_TOPICS } from "@/lib/pons/constants";

export type RpcLog = {
  address: string;
  blockHash: string;
  blockNumber: string;
  blockTimestamp?: string;
  data: string;
  logIndex: string;
  removed?: boolean;
  topics: string[];
  transactionHash: string;
};

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const HEX = /^0x[0-9a-f]*$/i;

export function validRpcLog(value: unknown): value is RpcLog {
  if (!value || typeof value !== "object") return false;
  const log = value as Partial<RpcLog>;
  return typeof log.address === "string" && ADDRESS.test(log.address)
    && typeof log.blockHash === "string" && HASH.test(log.blockHash)
    && typeof log.blockNumber === "string" && /^0x[0-9a-f]+$/i.test(log.blockNumber)
    && typeof log.data === "string" && HEX.test(log.data)
    && typeof log.logIndex === "string" && /^0x[0-9a-f]+$/i.test(log.logIndex)
    && Array.isArray(log.topics) && log.topics.every((topic) => HASH.test(topic))
    && typeof log.transactionHash === "string" && HASH.test(log.transactionHash);
}

export function hexInt(value: string) {
  return Number.parseInt(value.slice(2), 16);
}

export function topicAddress(value: string) {
  return `0x${value.slice(-40)}`.toLowerCase();
}

export function dataWords(data: string) {
  const payload = data.slice(2);
  if (payload.length % 64 !== 0) throw new Error("invalid_event_data");
  return Array.from({ length: payload.length / 64 }, (_, index) => payload.slice(index * 64, (index + 1) * 64));
}

function wordAddress(value: string) {
  return `0x${value.slice(-40)}`.toLowerCase();
}

function wordUint(value: string) {
  return BigInt(`0x${value}`).toString(10);
}

function wordInt(value: string) {
  const unsigned = BigInt(`0x${value}`);
  return (unsigned >= 1n << 255n ? unsigned - (1n << 256n) : unsigned).toString(10);
}

export function eventId(log: RpcLog) {
  return `${log.transactionHash.toLowerCase()}:${hexInt(log.logIndex)}`;
}

export function decodeFactoryLog(log: RpcLog) {
  const topic = log.topics[0]?.toLowerCase();
  const words = dataWords(log.data);
  if (topic === PONS_TOPICS.launch) {
    if (log.topics.length !== 4 || words.length < 3) throw new Error("invalid_launch_event");
    return {
      type: "launch" as const,
      tokenAddress: topicAddress(log.topics[1]),
      curveAddress: topicAddress(log.topics[2]),
      deployerAddress: topicAddress(log.topics[3]),
      pairTokenAddress: wordAddress(words[0]),
      launchConfigId: Number(BigInt(`0x${words[1]}`)),
      graduationThresholdRaw: wordUint(words[2]),
    };
  }
  if (topic === PONS_TOPICS.graduated) {
    if (log.topics.length < 2 || words.length < 3) throw new Error("invalid_graduation_event");
    return {
      type: "graduation" as const,
      tokenAddress: topicAddress(log.topics[1]),
      positionId: wordUint(words[0]),
      tokenAmountRaw: wordUint(words[1]),
      pairAmountRaw: wordUint(words[2]),
    };
  }
  if (topic === PONS_TOPICS.swept) {
    if (log.topics.length < 2 || words.length < 2) throw new Error("invalid_sweep_event");
    return {
      type: "sweep" as const,
      tokenAddress: topicAddress(log.topics[1]),
      quoteOutRaw: wordUint(words[0]),
      tokenOutRaw: wordUint(words[1]),
    };
  }
  if (topic === PONS_TOPICS.permanentlyLocked) {
    if (log.topics.length < 2 || words.length < 1) throw new Error("invalid_lock_event");
    return {
      type: "permanent-lock" as const,
      tokenAddress: topicAddress(log.topics[1]),
      amountRaw: wordUint(words[0]),
    };
  }
  return null;
}

export function decodeCurveTrade(log: RpcLog) {
  const topic = log.topics[0]?.toLowerCase();
  if (topic !== PONS_TOPICS.curveBuy && topic !== PONS_TOPICS.curveSell) return null;
  const words = dataWords(log.data);
  if (log.topics.length < 3 || words.length < 4) throw new Error("invalid_curve_trade");
  const buy = topic === PONS_TOPICS.curveBuy;
  return {
    side: buy ? "buy" as const : "sell" as const,
    curveAddress: log.address.toLowerCase(),
    actorAddress: topicAddress(log.topics[1]),
    recipientAddress: topicAddress(log.topics[2]),
    quoteAmountRaw: wordUint(words[buy ? 0 : 1]),
    tokenAmountRaw: wordUint(words[buy ? 1 : 0]),
    feeRaw: wordUint(words[2]),
    taxRaw: wordUint(words[3]),
  };
}

export function decodeV1Launch(log: RpcLog) {
  if (log.topics[0]?.toLowerCase() !== PONS_TOPICS.v1Launch) return null;
  const words = dataWords(log.data);
  if (log.topics.length !== 4 || words.length < 7) throw new Error("invalid_v1_launch_event");
  return {
    tokenAddress: topicAddress(log.topics[1]),
    deployerAddress: topicAddress(log.topics[2]),
    dexFactoryAddress: topicAddress(log.topics[3]),
    pairTokenAddress: wordAddress(words[0]),
    poolAddress: wordAddress(words[1]),
    dexId: wordUint(words[2]),
    launchConfigId: wordUint(words[3]),
    positionId: wordUint(words[4]),
    restrictionsEndBlock: wordUint(words[5]),
    initialBuyAmountRaw: wordUint(words[6]),
  };
}

export function decodeV3Swap(log: RpcLog) {
  if (log.topics[0]?.toLowerCase() !== PONS_TOPICS.v3Swap) return null;
  const words = dataWords(log.data);
  if (log.topics.length < 3 || words.length < 5) throw new Error("invalid_v3_swap_event");
  return {
    poolAddress: log.address.toLowerCase(),
    senderAddress: topicAddress(log.topics[1]),
    recipientAddress: topicAddress(log.topics[2]),
    amount0Raw: wordInt(words[0]),
    amount1Raw: wordInt(words[1]),
    sqrtPriceX96: wordUint(words[2]),
    liquidityRaw: wordUint(words[3]),
    tick: Number(wordInt(words[4])),
  };
}

export function decodeAbiString(encoded?: string) {
  if (!encoded || !HEX.test(encoded) || encoded === "0x") return null;
  try {
    const bytes = Uint8Array.from(encoded.slice(2).match(/.{1,2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
    if (bytes.length === 32) {
      return new TextDecoder().decode(bytes).replace(/\0+$/g, "").trim() || null;
    }
    if (bytes.length < 64) return null;
    const view = (start: number, length: number) => BigInt(`0x${[...bytes.slice(start, start + length)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`);
    const offset = Number(view(0, 32));
    const length = Number(view(offset, 32));
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset + 32 + length > bytes.length) return null;
    return new TextDecoder().decode(bytes.slice(offset + 32, offset + 32 + length)).trim() || null;
  } catch {
    return null;
  }
}
