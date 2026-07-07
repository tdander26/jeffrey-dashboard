# Jeffrey Dashboard

Static single-file HTML dashboards, no build step. The main app is `finance.html` — a Profit First cash-flow dashboard.

## Profit First domain rules (finance.html)

- "Salary" = **NET** pay, not gross.
- Payroll is **held in the Income account**; Gusto debits it from there. Do not model it as a transfer out to a payroll account.
- Live data = localStorage synced to Firestore. Clearing browser storage without a sync is data loss — be careful when testing.

## Deploy

- Deploy target is not recorded in-repo (GitHub remote: tdander26/jeffrey-dashboard). Confirm with Todd before deploying anywhere.
