// Sample data for the Darkroom variations (BRU-456). Every figure shown on screen is derived here.
// Monthly series: Jul–Oct 2026 are the prototype's exact table values; Nov 2025–Jun 2026 are read off the
// prototype's chart path (y → $), rounded to whole dollars. Replace with real data before anything ships.
window.AC = (() => {
  const months = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']; // Nov 2025 – Oct 2026
  const net = [393180, 400540, 397130, 411780, 427090, 433550, 446950, 458250, 463301, 479082, 496325, 513384];
  const october = { charges: 538420, refunds: 8130, fees: 16906, payouts: 513291 };
  october.net = october.charges - october.refunds - october.fees;
  console.assert(october.net === net[net.length - 1], 'October ledger must equal the last point of the series');

  const prev = net[net.length - 2];
  const change = (october.net - prev) / prev; // +3.44 % vs September
  const payoutGap = (october.net - october.payouts) / october.payouts; // 0.018 % → "within 0.02 %"
  console.assert(Math.abs(payoutGap) < 0.0002, 'payout gap must stay under 0.02 %');

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const fmt = {
    usd: (v) => usd.format(v),
    signedUsd: (v) => (v < 0 ? '−' : '+') + usd.format(Math.abs(v)),
    pct: (v, d = 1) => (v < 0 ? '−' : '+') + (Math.abs(v) * 100).toFixed(d) + '%',
    k: (v) => '$' + Math.round(v / 1000) + 'k',
  };

  const answers = [
    { q: 'Refund month', a: 'The month the refund happened', tech: 'refunds.created' },
    { q: 'Exchange rate', a: 'The rate Stripe paid you', tech: 'balance_transactions.exchange_rate' },
  ];
  const assumptions = [
    ['Only successful, live charges', "status = 'succeeded' and livemode"],
    ['Sales tax isn’t revenue', 'amount_captured − amount_tax'],
    ['Dispute fees count as payment fees', "bt.type in ('charge', 'adjustment')"],
    ['Months start at midnight UTC', "date_trunc('month', created)"],
  ];
  const orphans = { count: 3, total: 412 };
  const checks = [
    ['Matches Stripe payouts', `October within 0.02% of ${usd.format(october.payouts)} paid out`],
    ['No duplicate charges', '412,880 charges, 0 duplicates'],
    ['Every charge has a fee record', '100.0% joined'],
    ['All currencies converted', '14.2% non-USD, all at settlement rate'],
    ['Refunds placed by month issued', '1,284 refunds'],
    ['Test data excluded', '3,912 test-mode charges filtered'],
  ];
  const recent = [
    { name: 'Net revenue after fees', state: 'draft', value: october.net, href: 'review.html' },
    { name: 'Gross MRR', state: 'approved', version: 3, value: 486200 },
    { name: 'Active customers', state: 'approved', version: 1, value: 2184, count: true },
  ];
  const ideas = [
    { q: 'Net revenue after fees', from: 'Stripe charges, refunds and fees' },
    { q: 'Refund rate by month', from: 'Stripe refunds against charges' },
    { q: 'Active customers by plan', from: 'Stripe subscriptions' },
  ];
  return { months, net, october, change, payoutGap, fmt, answers, assumptions, orphans, checks, recent, ideas };
})();
