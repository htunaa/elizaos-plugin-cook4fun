import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { parseUnits } from "viem";
import { getConfig } from "../chain";
import { ERC20_ABI, LAUNCHPAD_ABI } from "../contracts";
import {
  applySlippage,
  explorerTx,
  fmtEth,
  findEthAmount,
  findPercent,
  resolveToken,
  wantsSellAll,
} from "../utils";

export const sellCoin: Action = {
  name: "COOK4FUN_SELL",
  similes: ["SELL_COIN", "SELL_TOKEN", "DUMP", "EXIT_POSITION", "SELL_ON_COOK4FUN"],
  description:
    "Sell a cook4.fun coin back to ETH. Accepts an explicit token amount, a percentage of the wallet's balance, or 'all'. Approves the launchpad if needed and guards the swap with slippage.",

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

      // How many base-unit tokens to sell.
      const balance = (await cfg.publicClient.readContract({
        address: resolved.address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [cfg.account.address],
      })) as bigint;

      if (balance <= 0n) {
        const msg = `The wallet holds no ${resolved.label} to sell.`;
        await say(msg);
        return { success: false, text: msg, error: "no balance" };
      }

      let amount: bigint;
      const percent = options?.percent ?? findPercent(text);
      if (options?.amountTokens !== undefined) {
        amount = parseUnits(String(options.amountTokens), 18);
      } else if (wantsSellAll(text) || percent === 100) {
        amount = balance;
      } else if (percent) {
        amount = (balance * BigInt(Math.round(percent * 100))) / 10000n;
      } else {
        // A bare number with no % and no "eth" unit is treated as a token count.
        const asTokens = findEthAmount(text); // reused numeric extractor
        if (!asTokens) {
          const msg = `How much ${resolved.label} should I sell? Say a token amount, a percentage, or "all".`;
          await say(msg);
          return { success: false, text: msg, error: "missing amount" };
        }
        amount = parseUnits(String(asTokens), 18);
      }

      if (amount > balance) amount = balance;
      if (amount <= 0n) {
        const msg = "That comes out to zero tokens, nothing to sell.";
        await say(msg);
        return { success: false, text: msg, error: "zero amount" };
      }

      // Approve the launchpad to pull the tokens, if the allowance is short.
      const allowance = (await cfg.publicClient.readContract({
        address: resolved.address,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [cfg.account.address, cfg.launchpad],
      })) as bigint;

      if (allowance < amount) {
        await say(`Approving the launchpad to sell ${resolved.label}…`);
        const approveHash = await cfg.walletClient.writeContract({
          address: resolved.address,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [cfg.launchpad, amount],
          account: cfg.account,
          chain: cfg.walletClient.chain,
        });
        await cfg.publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // Estimate ETH out from price, then guard with slippage.
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

      // ethOut(wei) = amount(base units) * price / 1e18
      const expectedEth = (amount * price) / 10n ** 18n;
      const minEth = applySlippage(expectedEth, slippageBps);

      await say(
        `Selling ${(Number(amount) / 1e18).toLocaleString()} ${resolved.label} (expect ~${fmtEth(expectedEth)})…`,
      );

      const hash = await cfg.walletClient.writeContract({
        address: cfg.launchpad,
        abi: LAUNCHPAD_ABI,
        functionName: "sell",
        args: [resolved.address, amount, minEth],
        account: cfg.account,
        chain: cfg.walletClient.chain,
      });

      const receipt = await cfg.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        const msg = `The sell transaction reverted. ${explorerTx(hash)}`;
        await say(msg);
        return { success: false, text: msg, error: "reverted", data: { hash } };
      }

      const done = `✅ Sold ${resolved.label} (~${fmtEth(expectedEth)}).\n${explorerTx(hash)}`;
      await say(done);
      return {
        success: true,
        text: done,
        data: { hash, token: resolved.address, amount: amount.toString() },
      };
    } catch (err: any) {
      const reason = err?.shortMessage || err?.message || String(err);
      const msg = `Couldn't complete the sell: ${reason}`;
      await say(msg);
      return { success: false, text: msg, error: reason };
    }
  },

  examples: [
    [
      { name: "user", content: { text: "sell all my $PEPE" } },
      {
        name: "assistant",
        content: { text: "Selling your entire PEPE balance…", actions: ["COOK4FUN_SELL"] },
      },
    ],
    [
      { name: "user", content: { text: "dump 50% of 0xabc0000000000000000000000000000000000abc" } },
      {
        name: "assistant",
        content: { text: "Selling half your position.", actions: ["COOK4FUN_SELL"] },
      },
    ],
  ],
};
