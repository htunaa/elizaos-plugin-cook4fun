import {
  type Provider,
  type IAgentRuntime,
  type Memory,
  type State,
} from "@elizaos/core";
import { formatEther } from "viem";
import { getConfig } from "../chain";
import { LAUNCHPAD_ABI } from "../contracts";
import { fetchTokens } from "../utils";

const MAX_LISTED = 8;

/**
 * Feeds the agent live context about what's on cook4.fun right now: the newest
 * coins and rough market caps, plus the wallet address it trades from. This is
 * what lets the agent answer "what's new?" and pick coins to trade.
 */
export const marketProvider: Provider = {
  name: "COOK4FUN_MARKET",
  description: "Live list of the newest cook4.fun coins with market caps.",

  get: async (runtime: IAgentRuntime, _message: Memory, _state: State) => {
    try {
      const cfg = getConfig(runtime);
      const tokens = await fetchTokens(cfg);
      if (tokens.length === 0) {
        return {
          text: "cook4.fun currently has no coins listed.",
          data: { count: 0 },
          values: { cook4funCount: "0" },
        };
      }

      const newest = [...tokens]
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
        .slice(0, MAX_LISTED);

      // Fetch market caps for the shortlist (one read each, best-effort).
      const withMcap = await Promise.all(
        newest.map(async (t) => {
          let mcapEth = 0;
          try {
            const mcap = (await cfg.publicClient.readContract({
              address: cfg.launchpad,
              abi: LAUNCHPAD_ABI,
              functionName: "getMCAP",
              args: [t.token],
            })) as bigint;
            mcapEth = Number(formatEther(mcap));
          } catch {
            // ignore; pool may not be priced yet
          }
          return { ...t, mcapEth };
        }),
      );

      const lines = withMcap.map(
        (t) =>
          `- ${t.name} ($${t.symbol}): ${t.mcapEth.toFixed(4)} ETH mcap${
            t.distribute ? " [rewards]" : ""
          } (${t.token})`,
      );

      const text = [
        `cook4.fun has ${tokens.length} coins live. Trading wallet: ${cfg.account.address}.`,
        "Newest coins:",
        ...lines,
      ].join("\n");

      return {
        text,
        data: {
          count: tokens.length,
          wallet: cfg.account.address,
          newest: withMcap.map((t) => ({
            token: t.token,
            name: t.name,
            symbol: t.symbol,
            mcapEth: t.mcapEth,
          })),
        },
        values: { cook4funCount: String(tokens.length) },
      };
    } catch (err: any) {
      // Never throw from a provider; just contribute no context.
      return {
        text: "",
        data: { error: err?.message ?? String(err) },
      };
    }
  },
};
