// Deterministic cbBTC/USDC trend bot for agent-fun/bars-replay/v1.
//
// Strategy: slow EMA trend following on 1-minute closes, long only.
//   - Enter on a fresh fast-EMA (45) cross above the slow EMA (180) while the
//     slow EMA is rising over the last 30 bars, or on a momentum burst
//     (30-minute return over 0.4%) while the price sits above a rising slow
//     EMA. Full cash, one position at a time.
//   - Exit on a fast-EMA cross back below the slow EMA, a 0.8% stop below the
//     entry fill price, a 1.5% take-profit above it, or 600 bars held. The
//     stop and take-profit anchor to the fill price reported on the batch
//     after the buy, not the close the buy was decided on.
//   - Cooldown of 30 bars after any sell, so a whipsaw cannot re-enter at
//     once. Buys spend 99.9% of cash so the 100% weight cap is never breached
//     by rounding. Every order carries max_slippage_bps 300.
//
// Determinism: every decision is a pure function of the closes seen so far.
// No wall clock, no environment, no randomness, no file or network access.
// EMAs run in float64 on + - * / alone; money and thresholds are exact
// BigInt comparisons, so two runs produce byte-identical replies.

import { runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const FAST_SPAN = 45;
const SLOW_SPAN = 180;
const TREND_LOOKBACK = 30;
const STOP_BPS = 80n;
const TAKE_PROFIT_BPS = 150n;
const BURST_BPS = 40n;
const BURST_BARS = 30;
const COOLDOWN_BARS = 30;
const MAX_HOLD_BARS = 600;
const MAX_SLIPPAGE_BPS = 300;
const BPS = 10000n;

/** One EMA: the closes it has seen until it starts, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

function stepEma(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) {
    e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
  }
}

const closes: bigint[] = [];
const slowHist: number[] = [];
const fast: Ema = { span: FAST_SPAN, warm: [], value: null };
const slow: Ema = { span: SLOW_SPAN, warm: [], value: null };
let gap: number | null = null;
let now: number | null = null;
let entryClose: bigint | null = null;
let pendingBuy = false;
let heldBars = 0;
let cooldown = 0;

function trendUp(): boolean {
  if (slowHist.length <= TREND_LOOKBACK) return false;
  return slowHist[slowHist.length - 1]! > slowHist[slowHist.length - 1 - TREND_LOOKBACK]!;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    let fresh = false;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      fresh = true;
      const c = Number(bar.c);
      closes.push(BigInt(bar.c));
      stepEma(fast, c);
      stepEma(slow, c);
      gap = now;
      now = fast.value !== null && slow.value !== null ? fast.value - slow.value : null;
      slowHist.push(slow.value ?? NaN);
    }
    if (state.warmingUp) return [];
    if (!fresh) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    // A buy decided on the previous batch fills here: anchor the stop and
    // take-profit to the price actually paid, not the close it was decided on.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.side !== 'buy' || !pendingBuy) continue;
      if (fill.status === 'filled') entryClose = BigInt(fill.price);
      else entryClose = null;
      pendingBuy = false;
    }
    if (cooldown > 0) cooldown -= 1;
    const held = state.positions.get(SYMBOL);
    if (held !== undefined && held.qty > 0n) {
      heldBars += 1;
      const crossDown = now !== null && gap !== null && now < 0 && gap >= 0;
      const stopHit = entryClose !== null && close * BPS <= entryClose * (BPS - STOP_BPS);
      const takeProfitHit = entryClose !== null && close * BPS >= entryClose * (BPS + TAKE_PROFIT_BPS);
      const heldTooLong = heldBars >= MAX_HOLD_BARS;
      if (crossDown || stopHit || takeProfitHit || heldTooLong) {
        entryClose = null;
        heldBars = 0;
        cooldown = COOLDOWN_BARS;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }
    if (slow.value === null || fast.value === null) return [];
    if (cooldown > 0) return [];
    if (!trendUp()) return [];
    const crossUp = now !== null && gap !== null && now > 0 && gap <= 0;
    let burst = false;
    if (closes.length > BURST_BARS && Number(close) > slow.value) {
      const oldClose = closes[closes.length - 1 - BURST_BARS]!;
      burst = close * BPS > oldClose * (BPS + BURST_BPS);
    }
    if (!crossUp && !burst) return [];
    const notional = (state.cash * 999n) / 1000n;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    entryClose = close;
    pendingBuy = true;
    heldBars = 0;
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
