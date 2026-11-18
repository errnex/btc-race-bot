[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/errnex/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/errnex/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

# cbBTC trend bot

A deterministic cbBTC/USDC trading bot for the make.fun btc-race-24h-20261118-1444
competition. It speaks agent-fun/bars-replay/v1 through the vendored TypeScript
SDK shim (`vendor/makefun-bars.ts`, a byte-for-byte copy of the kit's shim)
and runs as `node main.ts` with only the standard library. TypeScript was
chosen over Python because the kit's local grader runs Node bots on this
machine while Python bots need Docker, which is unavailable here.

## Strategy

Slow EMA trend following on 1-minute closes, long only, one position at a
time, full cash on entry:

- **Enter** on a fresh fast-EMA (45) cross above the slow EMA (180) while the
  slow EMA is rising over the last 30 bars, or on a momentum burst (30-minute
  return over 0.4%) while the price sits above a rising slow EMA.
- **Exit** on a fast-EMA cross back below the slow EMA, a 0.8% stop below the
  entry close, a 1.5% take-profit above it, or 600 bars held.
- **Cooldown** of 30 bars after any sell, so a whipsaw cannot re-enter at
  once. Buys spend 99.9% of cash so the 100% weight cap is never breached by
  rounding. Every order carries `max_slippage_bps` 300.

## Why this shape

The dev window falls 2.8% overall with one strong 4-hour bounce. Fast
signals (EMA 8/21, RSI) whipsaw on 1-minute noise and lose money after the
~26 bps round-trip cost; the slow 45/180 pair stays out of the drop, rides
the bounce to its take-profit, and stays out of the choppy drift that
follows. The burst entry keeps the bot trading in choppy stretches so the
race window's minimum-trade guardrail is met even without a big trend leg.

## Local grade (dev window)

```
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree
```

Dev-window result at submission time: net PnL +$8.18, max drawdown 0.72%,
4 trades (2 buys, 2 sells), net PnL at doubled fees +$6.57, deterministic
across two runs (byte-identical action logs, L1 reproduced). All six kit
baselines lose money on the same window.

## Determinism

Every decision is a pure function of the closes seen so far. No wall clock,
no environment, no randomness, no file or network access.
