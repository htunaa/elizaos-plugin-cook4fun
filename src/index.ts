import type { Plugin } from "@elizaos/core";
import { launchCoin } from "./actions/launchCoin";
import { buyCoin } from "./actions/buyCoin";
import { sellCoin } from "./actions/sellCoin";
import { claimRewards } from "./actions/claimRewards";
import { marketProvider } from "./providers/market";

export const cook4funPlugin: Plugin = {
  name: "cook4fun",
  description:
    "Launch and trade coins on cook4.fun (Robinhood chain). Gives an ElizaOS agent actions to create a token, buy, sell, and claim rewards, plus a live market provider.",
  actions: [launchCoin, buyCoin, sellCoin, claimRewards],
  providers: [marketProvider],
};

export default cook4funPlugin;

// Also export the pieces so downstream code can compose or test them.
export { launchCoin, buyCoin, sellCoin, claimRewards, marketProvider };
export * from "./contracts";
export { getConfig, type Cook4funConfig } from "./chain";
