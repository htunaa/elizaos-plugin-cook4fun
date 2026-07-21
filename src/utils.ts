import {
  concat,
  encodeAbiParameters,
  formatEther,
  getContractAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import type { Cook4funConfig } from "./chain";
import { LAUNCHPAD_ABI } from "./contracts";

// A coin is an EIP-1167 clone, so its address is decided by a salt we pick before
// sending the launch. The clone's init code is constant, so the launchpad mixes
// the sender in (keccak256(sender, salt)) — that is why the same salt lands on a
// different address for a different caller and nobody can front-run a ground one.
const PROXY_PREFIX = "0x3d602d80600a3d3981f3363d3d373d3d3d363d73" as const;
const PROXY_SUFFIX = "0x5af43d82803e903d91602b57fd5bf3" as const;

/**
 * Grinds a salt so the launched coin's address ends in `c00c`, the cook4.fun
 * signature every coin carries. Falls back to any salt after `budgetMs` so a
 * launch is never blocked just because the pretty address was slow.
 */
export function grindSalt(
  creator: Address,
  launchpad: Address,
  implementation: Address,
  budgetMs = 6000,
): Hex {
  const bytecodeHash = keccak256(concat([PROXY_PREFIX, implementation, PROXY_SUFFIX]));
  const started = Date.now();
  let i = Math.floor(Math.random() * 1e9) + 1;
  let salt = `0x${i.toString(16).padStart(64, "0")}` as Hex;
  while (Date.now() - started < budgetMs) {
    salt = `0x${i.toString(16).padStart(64, "0")}` as Hex;
    const derived = keccak256(
      encodeAbiParameters(parseAbiParameters("address, bytes32"), [creator, salt]),
    );
    const address = getContractAddress({ opcode: "CREATE2", from: launchpad, salt: derived, bytecodeHash });
    if (address.toLowerCase().endsWith("c00c")) return salt;
    i++;
  }
  return salt; // ordinary address, launch anyway
}

/** Pull the first 0x… 20-byte address out of a blob of text, if any. */
export function findAddress(text: string): Address | undefined {
  const m = text.match(/0x[0-9a-fA-F]{40}/);
  if (m && isAddress(m[0])) return m[0] as Address;
  return undefined;
}

/**
 * Find an ETH amount in free text, e.g. "buy 0.05 eth of ...", "spend 1 ETH".
 * Addresses are stripped first so their digits don't get parsed as an amount.
 */
export function findEthAmount(text: string): number | undefined {
  const cleaned = text.replace(/0x[0-9a-fA-F]{40}/g, " ");
  // Prefer a number explicitly followed by an eth unit.
  const withUnit = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:eth|ether|ξ)\b/i);
  if (withUnit) return parseFloat(withUnit[1]);
  // Otherwise the first standalone decimal number.
  const bare = cleaned.match(/(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/);
  if (bare) return parseFloat(bare[1]);
  return undefined;
}

/** Detect "all" / "everything" / "100%" style sell-all requests. */
export function wantsSellAll(text: string): boolean {
  return /\ball\b|\beverything\b|\b100\s*%/i.test(text);
}

/** Detect a percentage like "sell 50%". Returns 1..100 or undefined. */
export function findPercent(text: string): number | undefined {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return undefined;
  const p = parseFloat(m[1]);
  if (p > 0 && p <= 100) return p;
  return undefined;
}

/** Extract a $TICKER symbol like "$PEPE" or "ticker PEPE". */
export function findSymbol(text: string): string | undefined {
  const dollar = text.match(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/);
  if (dollar) return dollar[1].toUpperCase();
  const kw = text.match(/\b(?:ticker|symbol)\s*[:=]?\s*([A-Za-z][A-Za-z0-9]{1,9})\b/i);
  if (kw) return kw[1].toUpperCase();
  return undefined;
}

export type LaunchpadToken = {
  token: Address;
  name: string;
  symbol: string;
  imageUrl: string;
  createdAt: bigint;
  poolId: Hex;
  distribute: boolean;
};

/** Fetch up to `limit` tokens registered on the launchpad. */
export async function fetchTokens(
  cfg: Cook4funConfig,
  limit = 500n,
): Promise<LaunchpadToken[]> {
  const res = (await cfg.publicClient.readContract({
    address: cfg.launchpad,
    abi: LAUNCHPAD_ABI,
    functionName: "getTokens",
    args: [0n, limit],
  })) as readonly [readonly any[], bigint];
  const rows = res[0] ?? [];
  return rows.map((t: any) => ({
    token: t.token as Address,
    name: t.name as string,
    symbol: t.symbol as string,
    imageUrl: t.imageUrl as string,
    createdAt: t.createdAt as bigint,
    poolId: t.poolId as Hex,
    distribute: t.distribute as boolean,
  }));
}

/**
 * Resolve a user's token reference to an address. Accepts a raw 0x address, or
 * a $SYMBOL / name that we look up against the launchpad's registered tokens.
 */
export async function resolveToken(
  cfg: Cook4funConfig,
  text: string,
  explicit?: string,
): Promise<{ address: Address; label: string } | { error: string }> {
  const direct = explicit && isAddress(explicit) ? (explicit as Address) : findAddress(text);
  if (direct) {
    return { address: direct, label: direct };
  }

  const symbol = (explicit && !isAddress(explicit) ? explicit : undefined) ?? findSymbol(text);
  if (!symbol) {
    return {
      error:
        "I couldn't find which coin you mean. Give me its contract address (0x…) or its $TICKER.",
    };
  }

  const tokens = await fetchTokens(cfg);
  const wanted = symbol.replace(/^\$/, "").toLowerCase();
  const bySymbol = tokens.filter((t) => t.symbol.toLowerCase() === wanted);
  const match =
    bySymbol[0] ??
    tokens.find((t) => t.name.toLowerCase() === wanted) ??
    tokens.find((t) => t.symbol.toLowerCase().includes(wanted));

  if (!match) {
    return { error: `No coin matching "${symbol}" is registered on cook4.fun.` };
  }
  return { address: match.token, label: `${match.name} ($${match.symbol})` };
}

/** Apply a slippage tolerance (in bps) to an expected output amount. */
export function applySlippage(expected: bigint, slippageBps: bigint): bigint {
  if (expected <= 0n) return 0n;
  return (expected * (10000n - slippageBps)) / 10000n;
}

/** Round wei to a short human string, e.g. "0.0123 ETH". */
export function fmtEth(wei: bigint, digits = 5): string {
  const n = Number(formatEther(wei));
  return `${n.toFixed(digits).replace(/\.?0+$/, "")} ETH`;
}

export type TokenMetadata = {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
};

/**
 * Pin the coin's metadata JSON (ERC-7572) via cook4.fun and return the URL to
 * store on-chain as `md`. Terminals read the coin's picture and socials from
 * this, NOT from the launchpad's imageUrl field, so a launch without it shows
 * up with no image anywhere. cook4.fun also copies a remotely hosted image onto
 * IPFS here, so the picture outlives whatever host the caller used.
 *
 * Returns "" on any failure: a missing picture should never block a launch.
 */
export async function pinMetadata(apiBase: string, meta: TokenMetadata): Promise<string> {
  try {
    const res = await fetch(`${apiBase}/api/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(meta),
    });
    if (!res.ok) return "";
    const json: any = await res.json();
    return typeof json?.uri === "string" ? json.uri : "";
  } catch {
    return "";
  }
}

/** Blockscout tx link for the Robinhood chain. */
export function explorerTx(hash: string): string {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}
