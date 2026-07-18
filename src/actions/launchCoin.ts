import {
  type Action,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
  type ActionResult,
} from "@elizaos/core";
import { decodeEventLog, parseEther, type Address } from "viem";
import { getConfig } from "../chain";
import { LAUNCHPAD_ABI } from "../contracts";
import { explorerTx, fmtEth, findSymbol, pinMetadata } from "../utils";

// TokenCreated(uint256 indexed i, address indexed t, address indexed c, ...)
const TOKEN_CREATED_ABI = [
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { name: "i", type: "uint256", indexed: true },
      { name: "t", type: "address", indexed: true },
      { name: "c", type: "address", indexed: true },
      { name: "n", type: "string", indexed: false },
      { name: "s", type: "string", indexed: false },
      { name: "ts", type: "uint256", indexed: false },
      { name: "d", type: "bool", indexed: false },
    ],
  },
] as const;

function parseName(text: string): string | undefined {
  const kw = text.match(/\b(?:name|called|named)\s*[:=]?\s*["“]?([A-Za-z0-9 ]{2,40}?)["”]?(?:[.,]|\s+(?:with|ticker|symbol|and)\b|$)/i);
  if (kw) return kw[1].trim();
  const quoted = text.match(/["“]([A-Za-z0-9 ]{2,40})["”]/);
  if (quoted) return quoted[1].trim();
  return undefined;
}

export const launchCoin: Action = {
  name: "COOK4FUN_LAUNCH",
  similes: ["LAUNCH_COIN", "CREATE_TOKEN", "DEPLOY_COIN", "LAUNCH_ON_COOK4FUN", "MINT_COIN"],
  description:
    "Launch a brand new coin on cook4.fun. Deploys the token, opens its Uniswap V3 pool, and optionally makes a first buy. Needs a name and ticker; description, image, socials, and an initial buy are optional.",

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

      const name: string | undefined = options?.name ?? parseName(text);
      const symbol: string | undefined = (options?.symbol ?? findSymbol(text))?.toUpperCase();

      if (!name || !symbol) {
        const msg =
          'To launch I need a name and a ticker, e.g. `launch a coin named "Space Cat" ticker $SCAT`.';
        await say(msg);
        return { success: false, text: msg, error: "missing name/symbol" };
      }

      const description: string = options?.description ?? "";
      const image: string = options?.image ?? options?.imageUrl ?? "";
      const twitter: string = options?.twitter ?? "";
      const telegram: string = options?.telegram ?? "";
      const website: string = options?.website ?? "";
      const distribute: boolean = options?.distribute ?? false;

      // Pin the metadata JSON (ERC-7572) unless the caller supplied one.
      // Terminals read the coin's picture and socials from this; launching
      // without it leaves contractURI empty and the coin shows up with no
      // image anywhere. cook4.fun also copies the image onto IPFS here.
      let metadataUrl: string = options?.metadataUrl ?? options?.md ?? "";
      if (!metadataUrl) {
        metadataUrl = await pinMetadata(cfg.apiBase, {
          name, symbol, description, image, twitter, telegram, website,
        });
      }

      const firstBuyEth = options?.firstBuyEth ?? 0;
      const firstBuy = firstBuyEth ? parseEther(String(firstBuyEth)) : 0n;

      // msg.value must equal creationFee + firstBuy exactly.
      const creationFee = (await cfg.publicClient.readContract({
        address: cfg.launchpad,
        abi: LAUNCHPAD_ABI,
        functionName: "creationFee",
        args: [],
      })) as bigint;
      const value = creationFee + firstBuy;

      await say(
        `Launching "${name}" ($${symbol})… fee ${fmtEth(creationFee)}${
          firstBuy > 0n ? ` + first buy ${fmtEth(firstBuy)}` : ""
        }.`,
      );

      const hash = await cfg.walletClient.writeContract({
        address: cfg.launchpad,
        abi: LAUNCHPAD_ABI,
        functionName: "createToken",
        args: [
          name,
          symbol,
          description,
          image,
          twitter,
          telegram,
          website,
          distribute,
          firstBuy,
          metadataUrl,
        ],
        value,
        account: cfg.account,
        chain: cfg.walletClient.chain,
      });

      const receipt = await cfg.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        const msg = `The launch transaction reverted. ${explorerTx(hash)}`;
        await say(msg);
        return { success: false, text: msg, error: "reverted", data: { hash } };
      }

      // Pull the new token address out of the TokenCreated event.
      let tokenAddress: Address | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: TOKEN_CREATED_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "TokenCreated") {
            tokenAddress = (decoded.args as any).t as Address;
            break;
          }
        } catch {
          // not our event; keep scanning
        }
      }

      const link = tokenAddress ? `\nhttps://cook4.fun/token/${tokenAddress}` : "";
      const done = `🚀 Launched "${name}" ($${symbol})!${
        tokenAddress ? `\nToken: ${tokenAddress}` : ""
      }${link}\n${explorerTx(hash)}`;
      await say(done);
      return {
        success: true,
        text: done,
        data: { hash, token: tokenAddress, name, symbol },
      };
    } catch (err: any) {
      const reason = err?.shortMessage || err?.message || String(err);
      const msg = `Couldn't launch the coin: ${reason}`;
      await say(msg);
      return { success: false, text: msg, error: reason };
    }
  },

  examples: [
    [
      {
        name: "user",
        content: { text: 'launch a coin named "Space Cat" ticker $SCAT' },
      },
      {
        name: "assistant",
        content: {
          text: 'Launching "Space Cat" ($SCAT)…',
          actions: ["COOK4FUN_LAUNCH"],
        },
      },
    ],
  ],
};
