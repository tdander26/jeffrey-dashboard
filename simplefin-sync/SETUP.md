# SimpleFIN → Google Sheet Setup

This replaces the Plaid sync. Same dashboard, same sheet — just a friendlier
data source: flat **$1.50/month**, no PII questionnaire, no production-approval
hoops.

Total setup time: **~15 minutes** (most of it spent connecting your banks on
SimpleFIN's site).

---

## What you'll end up with

- Live Chase + Ally balances written to the **Balances** sheet on the 10th + 25th
- Tax payments (IRS / Treasury / MN Revenue) detected from the live transaction
  feed and written to the **Tax Payments** sheet
- Same Google Sheet, same dashboard — just `SimpleFin.gs` powering it instead of
  `Plaid.gs`

---

## Step 1 — Sign up at SimpleFIN Bridge

1. Go to https://beta-bridge.simplefin.org/info
2. Click **Get Started** → create an account
3. Pay the **$1.50/month** subscription. No tier above this — it's flat.

---

## Step 2 — Connect your banks (on bridge.simplefin.org)

This is the part Plaid made you host yourself. SimpleFIN does it on their site.

1. In the bridge dashboard → **My Connections** → **Add Connection**
2. Search for "Chase" (business or personal — whichever account holds the funds)
3. Sign in with your bank credentials in the modal that opens
4. When connected, repeat for "Ally"

If a bank doesn't appear in their search, SimpleFIN doesn't support it yet —
let me know and we'll figure out a fallback.

---

## Step 3 — Generate a Setup Token

Still in the bridge dashboard, on the **My Account** page:

1. Scroll to the **Apps** section (it's below Financial Institutions and above
   Access Log)
2. Click **New app connection**
3. The page will show a long base64 string — **that** is the setup token. Copy
   it.

The token is **one-time use** — once we claim it (next step), it's burned and
can't be re-used. That's fine; the resulting Access URL is what gets re-used
forever.

If you ever lose the Access URL (e.g. you reset Apps Script), come back here
and click **New app connection** again to mint a fresh setup token.

Note: the SimpleFIN docs and some third-party guides call this thing a "Setup
Token" — same thing. The UI just labels the button "New app connection".

---

## Step 4 — Create a new Apps Script project

1. Go to https://script.google.com → **New project**
2. Rename it "Momentum SimpleFIN Sync" (top left)
3. Delete the default `function myFunction() { ... }` block
4. Paste the entire contents of `SimpleFin.gs` from this repo into `Code.gs`
5. **Save** (Cmd+S)

(There's no `Link.html` to set up — SimpleFIN handles bank-link on their site,
not in our app. That's a big simplification vs Plaid.)

---

## Step 5 — Set Script Properties

Project Settings (gear icon, left sidebar) → **Script Properties** → **Add
script property**:

| Property | Value |
|---|---|
| `QBO_SHEET_ID` | `1uCViOHMNMyT9VyI_ivyyszpv5S0eIDwMsEWpDdyi1_Q` |

(`SIMPLEFIN_ACCESS_URL` is set automatically in the next step — leave it blank
for now. The legacy `QBO_SHEET_ID` name is reused so the existing dashboard
keeps reading from the same sheet.)

**Save**.

---

## Step 6 — Claim the Setup Token

In the Apps Script editor:

1. Open `Code.gs` and scroll to the top
2. Above `function claimSimpleFinSetupToken(setupToken)`, add a temporary
   wrapper so you can pick it from the function dropdown:
   ```js
   function _doClaim() {
     claimSimpleFinSetupToken('PASTE_YOUR_SETUP_TOKEN_HERE');
   }
   ```
3. Replace `PASTE_YOUR_SETUP_TOKEN_HERE` with the base64 string from Step 3
4. Function dropdown → select **`_doClaim`** → **Run** ▶
5. First run will ask for permission → Authorize → "Advanced" → "Go to Momentum
   SimpleFIN Sync (unsafe)" → Allow
6. View → Execution log → should print:
   ```
   Claiming setup token at: https://beta-bridge.simplefin.org/simplefin/claim/****
   ✓ Access URL saved. You can delete the setup token from bridge.simplefin.org now.
   ```

Now **delete the `_doClaim` wrapper** (and the setup token in it — it's already
been spent, but you don't want it lying around in source).

---

## Step 7 — Test the sync

1. Function dropdown → select **`fetchSimpleFinBalances`** → **Run** ▶
2. View → Execution log → should print something like:
   ```
   Starting SimpleFIN balance fetch — 4/27/2026, 10:14:33 AM
   Fetched 3 account(s).
   ✓ Balances saved (3 rows).
     [Chase] Total Checking: $14250.00
     [Chase] Business Savings: $8400.00
     [Ally]  Online Savings: $12700.00
   ```
3. Open your Google Sheet → **Balances** tab → new rows with today's date
4. Then run **`fetchSimpleFinTaxPayments`** → should see any tax payments from
   the last ~400 days

If either fails, run **`checkSimpleFinStatus`** and share the log.

---

## Step 8 — Set up automatic monthly pulls

1. Function dropdown → **`setupTriggers`** → **Run** ▶
2. Run **`checkSimpleFinStatus`** to confirm `Active triggers: 2`

Done. The script runs automatically on the 10th and 25th at 8 AM, hits a single
`/accounts` endpoint, and writes balances + tax payments to the sheet.

---

## Step 9 — Retire the Plaid script

Once the SimpleFIN side is working for a sync cycle or two, retire the old
Plaid project:

1. https://script.google.com → open "Momentum Plaid Sync"
2. Run `resetPlaid` (clears its triggers and stored tokens)
3. (Optional) **File → Move to trash** to remove the project entirely

You can also revoke each bank's connection on **dashboard.plaid.com** →
*Items* → click the item → *Disconnect*. Plaid stops billing for the Item the
moment it's removed.

The `plaid-sync/` folder in this repo can stay as a fallback for a few weeks,
or be deleted once you're confident SimpleFIN covers everything.

---

## Troubleshooting

**"Missing SIMPLEFIN_ACCESS_URL"** — `claimSimpleFinSetupToken` was never run,
or it failed silently. Re-generate a setup token (Step 3) and re-run Step 6.

**"Setup token is not valid base64"** — you pasted the wrong thing. The setup
token is a long single-line base64 string from bridge.simplefin.org — not your
account password, not the access URL.

**"SimpleFIN /accounts 401"** — your access URL is stale (rare; can happen if
someone revokes the connection on bridge.simplefin.org). Run `resetSimpleFin`,
generate a fresh setup token, run `claimSimpleFinSetupToken` again.

**A bank shows up in `data.errors` instead of `accounts`** — the bank is
asking you to re-authenticate. SimpleFIN handles this on their site: log into
bridge.simplefin.org → click the bank → re-enter credentials. No script change
needed.

**Tax payments sheet is empty but I know I've paid taxes recently** — the
matcher looks for specific payee names (IRS, Treasury, MN Revenue, EFTPS,
USATAXPYMT). If your bank labels the transaction differently, tell me what the
description looks like and I'll add it to `TAX_KEYWORDS` in `SimpleFin.gs`.

---

## Cost

**$1.50/month flat**, billed by SimpleFIN Bridge directly. No per-API-call
charges. Run the sync 100×/day or 2×/month — same price.
