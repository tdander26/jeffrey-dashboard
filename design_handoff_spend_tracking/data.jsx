// Shared mock data + helpers for the Spend Tracking tab.
// Two windows per cycle:  10th -> 24th  and  25th -> 9th-of-next-month.

const BUCKETS = [
  { id: "opex",   label: "OpEx",         pct: 38, color: "#7BA89A", soft: "#E6EFEA", chip: "#E6EFEA", chipText: "#3F6757", account: "Chase \u00b7 OPEX (7712)" },
  { id: "oc",     label: "Owner's Pay",  pct: 41, color: "#9AB3CC", soft: "#E6ECF3", chip: "#E6ECF3", chipText: "#3F5878", account: "Chase \u00b7 Owners Comp (2120)" },
  { id: "tax",    label: "Tax",          pct: 20, color: "#D4A8A8", soft: "#F1E3E3", chip: "#F1E3E3", chipText: "#7C4848", account: "Ally \u00b7 Tax Savings (7648)" },
  { id: "profit", label: "Profit",       pct:  1, color: "#B7A4C9", soft: "#ECE4F1", chip: "#ECE4F1", chipText: "#5F4878", account: "Ally \u00b7 Profit Savings (4294)" },
];

// Mock historical windows (closed) + current window.
// Windows are ordered oldest -> newest; last entry is the *current* in-progress window.
const WINDOWS = [
  { id: "w-feb10",  start: "Feb 10",  end: "Feb 24",  monthLabel: "Feb 10 \u2013 24",  inflow: 14383.96, days: 15, status: "closed" },
  { id: "w-feb25",  start: "Feb 25",  end: "Mar 9",   monthLabel: "Feb 25 \u2013 Mar 9", inflow: 10223.00, days: 15, status: "closed" },
  { id: "w-mar10",  start: "Mar 10",  end: "Mar 24",  monthLabel: "Mar 10 \u2013 24",  inflow: 13300.00, days: 15, status: "closed" },
  { id: "w-mar25",  start: "Mar 25",  end: "Apr 9",   monthLabel: "Mar 25 \u2013 Apr 9", inflow: 16168.00, days: 15, status: "closed" },
  { id: "w-apr10",  start: "Apr 10",  end: "Apr 24",  monthLabel: "Apr 10 \u2013 24",  inflow: 11687.00, days: 15, status: "closed" },
  // Current window: Apr 25 -> May 9.  Today = Apr 28 (day 4 of 15).
  { id: "w-apr25",  start: "Apr 25",  end: "May 9",   monthLabel: "Apr 25 \u2013 May 9", inflow: 9420.00,  days: 15, status: "current", dayIndex: 4 },
];

// Spend per bucket per window.  Some are over-allocation (subtle warning);
// most are under.  Numbers are realistic given the ~38/41/20/1 split.
const SPEND = {
  "w-feb10": { opex: 5112.66, oc: 2747.02, tax: 2133.35, profit: 287.68, txns: 22 },
  "w-feb25": { opex: 3531.20, oc: 4187.43, tax: 1301.16, profit: 102.23, txns: 18 },
  "w-mar10": { opex: 4768.76, oc: 5446.44, tax: 1916.50, profit: 133.00, txns: 24 },
  "w-mar25": { opex: 6922.36, oc: 5490.56, tax: 2498.21, profit: 161.68, txns: 31 },
  "w-apr10": { opex: 6168.52, oc: 3205.41, tax:   73.96, profit: 135.87, txns: 27 },
  // current (in-progress, day 4 of 15)
  "w-apr25": { opex: 1880.00, oc:  720.00, tax:    0.00, profit:   0.00, txns:  9 },
};

// Sample transactions for current window expand-views.
const TXNS = {
  opex: [
    { date: "Apr 25", payee: "Stripe Payouts Fee",     memo: "Processing",          amount:   42.10 },
    { date: "Apr 25", payee: "Google Workspace",       memo: "Apr seats",           amount:  144.00 },
    { date: "Apr 26", payee: "AT&T Business",          memo: "Office line",         amount:   89.32 },
    { date: "Apr 26", payee: "Costco Wholesale",       memo: "Supplies",            amount:  312.84 },
    { date: "Apr 27", payee: "Adobe Creative Cloud",   memo: "Annual renewal",      amount:  599.88 },
    { date: "Apr 27", payee: "QuickBooks Online",      memo: "Plus tier",           amount:   90.00 },
    { date: "Apr 27", payee: "Office Lease \u2013 Suite 204", memo: "May rent",           amount:  435.00 },
    { date: "Apr 28", payee: "Square \u2013 supplies",      memo: "Front desk",         amount:  167.86 },
  ],
  oc: [
    { date: "Apr 25", payee: "Owner Draw \u2013 Anderson",  memo: "Bi-weekly transfer",  amount:  720.00 },
  ],
  tax: [],
  profit: [],
};

// Helpers
const fmtUSD = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtUSDc = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n) => Math.round(n) + "%";

// For a given window, compute allocation $ per bucket and pacing data.
function deriveWindow(win, allocPctOverride) {
  const pcts = allocPctOverride || Object.fromEntries(BUCKETS.map(b => [b.id, b.pct]));
  const spend = SPEND[win.id] || { opex: 0, oc: 0, tax: 0, profit: 0, txns: 0 };
  const buckets = BUCKETS.map(b => {
    const alloc = win.inflow * (pcts[b.id] / 100);
    const spent = spend[b.id] || 0;
    const pctConsumed = alloc > 0 ? (spent / alloc) * 100 : 0;
    // Expected pacing: % of window elapsed.
    const elapsedPct = win.status === "current"
      ? (win.dayIndex / win.days) * 100
      : 100;
    const pace = pctConsumed - elapsedPct; // +ve = ahead of pace (over), -ve = under
    return {
      ...b,
      alloc,
      spent,
      remaining: alloc - spent,
      pctConsumed,
      elapsedPct,
      pace,
      status: pctConsumed > 100 ? "over" : pctConsumed > elapsedPct + 8 ? "warn" : "on-pace",
    };
  });
  return { win, buckets, txnCount: spend.txns || 0 };
}

Object.assign(window, { BUCKETS, WINDOWS, SPEND, TXNS, fmtUSD, fmtUSDc, fmtPct, deriveWindow });
