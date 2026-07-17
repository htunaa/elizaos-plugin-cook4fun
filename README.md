# elizaos-plugin-cook4fun

An [ElizaOS](https://elizaos.ai) plugin that lets an agent **launch and trade coins on [cook4.fun](https://cook4.fun)**, a Uniswap-V3-native launchpad on the Robinhood chain (chainId `4663`).

Give your agent a funded wallet and it can:

- 🚀 **Launch** a new coin (deploys the token + opens its V3 pool, optional first buy)
- 🟢 **Buy** any cook4.fun coin with ETH (slippage-protected)
- 🔴 **Sell** back to ETH (by amount, percentage, or "all"; auto-approves)
- 💰 **Claim** reward-sharing fees
- 📈 A **market provider** that feeds the agent live context (newest coins + market caps)

Trading routes through the launchpad contract, so it only works for coins launched on cook4.fun (the contract's `buy`/`sell` are scoped to its own registered tokens).

---

## Install

```bash
npm install elizaos-plugin-cook4fun
# or, straight from GitHub:
npm install github:htunaa/elizaos-plugin-cook4fun
```

`@elizaos/core` is a peer dependency; your agent already provides it.

## Configure

Set these as character secrets or environment variables:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `COOK4FUN_PRIVATE_KEY` | ✅ | none | Agent wallet private key (`0x…`, 32 bytes). **Needs ETH on chain 4663** for the launch fee, gas, and buys. |
| `COOK4FUN_RPC_URL` | no | `https://rpc.mainnet.chain.robinhood.com` | Custom RPC endpoint. |
| `COOK4FUN_LAUNCHPAD_ADDRESS` | no | `0xc12F…A352` (live V2) | Override the launchpad contract. |
| `COOK4FUN_SLIPPAGE_BPS` | no | `1000` (10%) | Default slippage tolerance for buys/sells, in basis points. |

> ⚠️ **Security:** the agent can spend everything in this wallet. Fund it with only what you're comfortable letting the agent trade, and treat the private key like any other secret.

## Wire it into your character

```ts
import { cook4funPlugin } from "elizaos-plugin-cook4fun";

export const character = {
  name: "DegenBot",
  plugins: [
    // ...your other plugins
    cook4funPlugin,
  ],
  settings: {
    secrets: {
      COOK4FUN_PRIVATE_KEY: process.env.COOK4FUN_PRIVATE_KEY,
    },
  },
};
```

Or, if you configure plugins by name in `character.json`:

```json
{
  "name": "DegenBot",
  "plugins": ["plugin-cook4fun"],
  "settings": {
    "secrets": { "COOK4FUN_PRIVATE_KEY": "0x…" }
  }
}
```

## Talk to it

Once loaded, the agent understands natural requests:

```
launch a coin named "Space Cat" ticker $SCAT
buy 0.05 eth of $SCAT
ape 0.1 ETH into 0x30bceEB14844bd21188d73Bb06C9C07f4e96b213
sell 50% of $SCAT
sell all my $SCAT
claim my rewards on $SCAT
what's new on cook4fun?
```

Coins can be referenced by **contract address** (`0x…`) or **$TICKER**. The plugin resolves tickers against the coins registered on the launchpad.

## Actions & options

Every action also accepts structured `options` (useful when driving the agent programmatically), which take priority over text parsing:

| Action | Text example | `options` fields |
|---|---|---|
| `COOK4FUN_LAUNCH` | `launch "Space Cat" $SCAT` | `name`, `symbol`, `description`, `image`, `twitter`, `telegram`, `website`, `metadataUrl`, `distribute`, `firstBuyEth` |
| `COOK4FUN_BUY` | `buy 0.05 eth of $SCAT` | `tokenAddress`, `ethAmount`, `slippageBps` |
| `COOK4FUN_SELL` | `sell all my $SCAT` | `tokenAddress`, `amountTokens`, `percent`, `slippageBps` |
| `COOK4FUN_CLAIM` | `claim rewards on $SCAT` | `tokenAddress` |

## How slippage is computed

The plugin reads the pool's on-chain price (`getPrice`, returned as ETH-per-token × 1e18), estimates the output, and sets `minOut` / `minEth` to `estimate × (1 − slippageBps/10000)`. On thin single-sided pools price impact can be large, so the default tolerance is a generous 10%. Tighten it with `COOK4FUN_SLIPPAGE_BPS` or per-call `slippageBps`.

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run build       # tsup → dist/ (ESM + .d.ts)
```

## License

MIT
