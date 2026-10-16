// Edge after taker fees and slippage, from the real orderbook (spec §6).
// Fee formula: docs.polymarket.com/trading/fees -> shares * rate * (p * (1 - p))^exponent.

export function takerFee(shares, price, schedule) {
  if (!schedule || !schedule.rate) return 0;
  return shares * schedule.rate * Math.pow(price * (1 - price), schedule.exponent ?? 1);
}

export function walkAsks(asks, stakeUsd, schedule) {
  const levels = [...asks].sort((a, b) => a.price - b.price);
  let remaining = stakeUsd, shares = 0, cost = 0, fees = 0;
  for (const { price, size } of levels) {
    if (remaining <= 1e-9) break;
    const perShare = price + takerFee(1, price, schedule);
    const take = Math.min(size, remaining / perShare);
    shares += take;
    cost += take * price;
    fees += takerFee(take, price, schedule);
    remaining -= take * perShare;
  }
  return {
    shares,
    avgPrice: shares > 0 ? cost / shares : null,
    feeUsd: fees,
    spentUsd: stakeUsd - remaining,
    complete: remaining <= 1e-6,
  };
}

function bestOf(levels, pick) {
  return levels.length ? pick(...levels.map(l => l.price)) : null;
}

function fills(side, p, stakes, schedule) {
  return stakes.map(stake => {
    const f = walkAsks(side.asks, stake, schedule);
    return { stake, ...f, ev: f.spentUsd > 0 ? (f.shares * p) / f.spentUsd - 1 : null };
  });
}

export function evaluateCompany({ pYes, yes, no, lastPrice = null, schedule, stakes, threshold }) {
  const bid = bestOf(yes.bids, Math.max), ask = bestOf(yes.asks, Math.min);
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : (ask ?? bid ?? lastPrice);
  const yesFills = fills(yes, pYes, stakes, schedule);
  const noFills = fills(no, 1 - pYes, stakes, schedule);
  const diff = mid === null ? null : pYes - mid;
  let signal = null;
  if (diff !== null && diff >= threshold && yesFills[0].ev > 0) signal = 'yes';
  else if (diff !== null && -diff >= threshold && noFills[0].ev > 0) signal = 'no';
  return { pYes, mid, diff, bestBid: bid, bestAsk: ask, yes: yesFills, no: noFills, signal };
}
