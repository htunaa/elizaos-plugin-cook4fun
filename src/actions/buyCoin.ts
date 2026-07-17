import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { parseEther } from "viem";
import { getConfig } from "../chain";
import { LAUNCHPAD_ABI } from "../contracts";
import {
  applySlippage,
  explorerTx,
  fmtEth,
  findEthAmount,
  resolveToken,
} from "../utils";

export const buyCoin: Action = {
  name: "COOK4FUN_BUY",
  similes: ["BUY_COIN", "BUY_TOKEN", "APE_IN", "BUY_ON_COOK4FUN"],
  description:
    "Buy a cook4.fun coin by spending a given amount of ETH. Resolves the coin by its 0x address or $TICKER and protects the swap with slippage.",

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

      const ethAmount = options?.ethAmount ?? findEthAmount(text);
      if (!ethAmount || Number(ethAmount) <= 0) {
        const msg =
          "How much ETH should I spend? e.g. \"buy 0.05 ETH of " +
          resolved.label +
          "\".";
        await say(msg);
        return { success: false, text: msg, error: "missing amount" };
      }

      const value = parseEther(String(ethAmount));

      // Estimate tokens out from the on-chain price, then guard with slippage.
      const price = (await cfg.publicClient.readContract({
        address: cfg.launchpad,
        abi: LAUNCHPAD_ABI,
        functionName: "getPrice",
        args: [resolved.address],
      })) as bigint;

      const slippageBps =
        options?.slippageBps !== undefined
          ? BigInt(options.slippageBps)
          : cfg.slippageBps;

      // price = (ETH per whole token) * 1e18  =>  tokensOut(base units) = value * 1e18 / price
      const expectedOut = price > 0n ? (value * 10n ** 18n) / price : 0n;
      const minOut = applySlippage(expectedOut, slippageBps);

      await say(
        `Buying ${resolved.label} with ${fmtEth(value)} (min out ${
          expectedOut > 0n ? "~" + (Number(minOut) / 1e18).toLocaleString() + " tokens" : "unset"
        })…`,
      );

      const hash = await cfg.walletClient.writeContract({
        address: cfg.launchpad,
        abi: LAUNCHPAD_ABI,
        functionName: "buy",
        args: [resolved.address, minOut],
        value,
        account: cfg.account,
        chain: cfg.walletClient.chain,
      });

      const receipt = await cfg.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        const msg = `The buy transaction reverted. ${explorerTx(hash)}`;
        await say(msg);
        return { success: false, text: msg, error: "reverted", data: { hash } };
      }

      const done = `✅ Bought ${resolved.label} for ${fmtEth(value)}.\n${explorerTx(hash)}`;
      await say(done);
      return {
        success: true,
        text: done,
        data: { hash, token: resolved.address, ethSpent: value.toString() },
      };
    } catch (err: any) {
      const reason = err?.shortMessage || err?.message || String(err);
      const msg = `Couldn't complete the buy: ${reason}`;
      await say(msg);
      return { success: false, text: msg, error: reason };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "buy 0.05 eth of $PEPE" } },
      {
        name: "assistant",
        content: { text: "Buying PEPE with 0.05 ETH…", actions: ["COOK4FUN_BUY"] },
      },
    ],
    [
      {
        name: "user",
        content: { text: "ape 0.1 ETH into 0xabc0000000000000000000000000000000000abc" },
      },
      {
        name: "assistant",
        content: { text: "On it, buying with 0.1 ETH.", actions: ["COOK4FUN_BUY"] },
      },
    ],
  ],
};
