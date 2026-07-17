import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { getConfig } from "../chain";
import { LAUNCHPAD_ABI } from "../contracts";
import { explorerTx, fmtEth, resolveToken } from "../utils";

export const claimRewards: Action = {
  name: "COOK4FUN_CLAIM",
  similes: ["CLAIM_REWARDS", "CLAIM_FEES", "COLLECT_REWARDS"],
  description:
    "Claim the wallet's share of a reward-sharing cook4.fun coin's accrued fees.",

  validate: async (runtime: IAgentRuntime) => {
    return !!(
      runtime.getSetting?.("COOK4FUN_PRIVATE_KEY") ||
      process.env.COOK4FUN_PRIVATE_KEY
    );
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State | undefined,
    options: any,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    const say = async (text: string) => {
      if (callback) await callback({ text, source: "cook4fun" });
    };

    try {
      const cfg = getConfig(runtime);
      const text = message?.content?.text ?? "";

      const resolved = await resolveToken(cfg, text, options?.tokenAddress);
      if ("error" in resolved) {
        await say(resolved.error);
        return { success: false, text: resolved.error, error: resolved.error };
      }

      const claimable = (await cfg.publicClient.readContract({
        address: cfg.launchpad,
        abi: LAUNCHPAD_ABI,
        functionName: "getClaimable",
        args: [resolved.address, cfg.account.address],
      })) as bigint;

      if (claimable <= 0n) {
        const msg = `Nothing to claim on ${resolved.label} right now.`;
        await say(msg);
        return { success: false, text: msg, error: "nothing claimable" };
      }

      await say(`Claiming ~${fmtEth(claimable)} of rewards from ${resolved.label}…`);

      const hash = await cfg.walletClient.writeContract({
        address: cfg.launchpad,
        abi: LAUNCHPAD_ABI,
        functionName: "claimRewards",
        args: [resolved.address],
        account: cfg.account,
        chain: cfg.walletClient.chain,
      });

      const receipt = await cfg.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        const msg = `The claim transaction reverted. ${explorerTx(hash)}`;
        await say(msg);
        return { success: false, text: msg, error: "reverted", data: { hash } };
      }

      const done = `✅ Claimed ~${fmtEth(claimable)} from ${resolved.label}.\n${explorerTx(hash)}`;
      await say(done);
      return { success: true, text: done, data: { hash, token: resolved.address } };
    } catch (err: any) {
      const reason = err?.shortMessage || err?.message || String(err);
      const msg = `Couldn't claim rewards: ${reason}`;
      await say(msg);
      return { success: false, text: msg, error: reason };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "claim my rewards on $SCAT" } },
      {
        name: "assistant",
        content: { text: "Claiming your SCAT rewards…", actions: ["COOK4FUN_CLAIM"] },
      },
    ],
  ],
};
