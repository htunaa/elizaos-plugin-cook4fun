import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Account,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { IAgentRuntime } from "@elizaos/core";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_LAUNCHPAD_ADDRESS,
  DEFAULT_RPC_URL,
} from "./contracts";

export type Cook4funConfig = {
  account: Account;
  publicClient: PublicClient;
  walletClient: WalletClient;
  launchpad: Address;
  rpcUrl: string;
  slippageBps: bigint;
};

/**
 * Reads a setting from the agent runtime, falling back to process.env so the
 * plugin works both inside ElizaOS and in plain scripts/tests.
 */
function setting(runtime: IAgentRuntime, key: string): string | undefined {
  const fromRuntime = runtime?.getSetting?.(key);
  if (fromRuntime !== undefined && fromRuntime !== null && fromRuntime !== "") {
    return String(fromRuntime);
  }
  const fromEnv = process.env[key];
  return fromEnv && fromEnv !== "" ? fromEnv : undefined;
}

function normalizePrivateKey(pk: string): `0x${string}` {
  const trimmed = pk.trim();
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error(
      "COOK4FUN_PRIVATE_KEY is not a valid 32-byte hex private key.",
    );
  }
  return withPrefix as `0x${string}`;
}

/**
 * Builds the viem clients + resolved config for a given runtime. Throws a clear
 * error if the wallet key is missing so actions can surface a friendly message.
 */
export function getConfig(runtime: IAgentRuntime): Cook4funConfig {
  const pk = setting(runtime, "COOK4FUN_PRIVATE_KEY");
  if (!pk) {
    throw new Error(
      "COOK4FUN_PRIVATE_KEY is not set. Add the agent wallet's private key to the character secrets or environment.",
    );
  }

  const rpcUrl = setting(runtime, "COOK4FUN_RPC_URL") ?? DEFAULT_RPC_URL;
  const launchpad = (setting(runtime, "COOK4FUN_LAUNCHPAD_ADDRESS") ??
    DEFAULT_LAUNCHPAD_ADDRESS) as Address;

  const slippageRaw = setting(runtime, "COOK4FUN_SLIPPAGE_BPS");
  let slippageBps = 1000n; // 10% default
  if (slippageRaw) {
    const parsed = BigInt(Math.max(0, Math.min(9000, parseInt(slippageRaw, 10) || 0)));
    slippageBps = parsed;
  }

  const chain = defineChain({
    id: DEFAULT_CHAIN_ID,
    name: "Robinhood",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const account = privateKeyToAccount(normalizePrivateKey(pk));

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  return { account, publicClient, walletClient, launchpad, rpcUrl, slippageBps };
}
