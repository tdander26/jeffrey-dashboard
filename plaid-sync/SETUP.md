# Plaid → Google Sheet Setup

The Plaid sync is what actually pulls **live bank balances and transactions** into the dashboard. (The QuickBooks sync we built earlier only returned book balances — this replaces that.)

Total setup time: **~10 minutes**. You only do this once.

---

## What you'll end up with

- Live Chase + Ally balances written to the **Balances** sheet twice a month (10th + 25th)
- Tax payments (IRS / Treasury / MN Revenue) detected from the live transaction feed and written to the **Tax Payments** sheet
- Same dashboard, same sheet — just a better data source

---

## Step 1 — Create a free Plaid developer account

1. Go to https://dashboard.plaid.com/signup
2. Sign up with your email (no credit card required)
3. Verify your email

When Plaid asks what you're building: pick **Personal finance** → **Budgeting tool** → purpose is "Personal use." You're not submitting for production approval — the **Development** environment we'll use is free and pre-approved for up to 100 bank connections.

---

## Step 2 — Get your API credentials

1. In Plaid dashboard → **Team settings** (bottom left) → **Keys**
2. You'll see three environments: Sandbox, **Development**, Production
3. Copy the `client_id` (same across all environments)
4. Copy the **Development** `secret` key (starts with `development_...`)

Leave this tab open — you'll paste these into Apps Script in a minute.

---

## Step 3 — Create a new Apps Script project

1. Go to https://script.google.com → **New project**
2. Rename it "Momentum Plaid Sync" (top left)
3. Delete the default `function myFunction() { ... }` block
4. Paste the entire contents of `Plaid.gs` from the repo into `Code.gs`
5. Click **+** next to "Files" → **HTML** → name it `Link` (not `Link.html` — the `.html` is automatic)
6. Paste the contents of `Link.html` into that new file
7. **Save** (Cmd+S)

---

## Step 4 — Set Script Properties

Project Settings (gear icon, left sidebar) → **Script Properties** → **Add script property** for each:

| Property | Value |
|---|---|
| `PLAID_CLIENT_ID` | (paste from Step 2) |
| `PLAID_SECRET` | (paste the **development** secret from Step 2) |
| `PLAID_ENVIRONMENT` | `development` |
| `QBO_SHEET_ID` | `1uCViOHMNMyT9VyI_ivyyszpv5S0eIDwMsEWpDdyi1_Q` |

**Save**.

(Yes — we reuse `QBO_SHEET_ID` so the Plaid sync writes to the same sheet the dashboard already reads. Naming is a legacy of the old setup; not worth renaming.)

---

## Step 5 — Deploy as a Web App

1. Top right → **Deploy** → **New deployment**
2. Gear icon → **Web app**
3. Fields:
   - **Description**: Plaid Link
   - **Execute as**: Me (`doc@drtoddanderson.com`)
   - **Who has access**: Only myself
4. Click **Deploy**
5. It'll ask for permission → Authorize → pick your Google account → "Advanced" → "Go to Momentum Plaid Sync (unsafe)" → Allow
6. **Copy the Web app URL** — looks like `https://script.google.com/macros/s/AKfyc.../exec`

---

## Step 6 — Connect your banks

1. Paste that Web app URL into your browser
2. You'll see a "Connect a Bank" page with a bank-name field
3. Type "Chase Business" (or whatever name helps you recognize it), click **Connect Bank →**
4. Plaid's modal opens → pick your bank → sign in with your online banking credentials
5. Plaid never shares your password with me or with QuickBooks — it returns an access token only
6. On success: "✓ Chase Business connected" appears
7. Repeat for Ally (change the bank name field, click Connect again)

Close the tab when you're done.

---

## Step 7 — Test the sync

Back in the Apps Script editor:

1. Function dropdown → select **`fetchPlaidBalances`** → **Run** ▶
2. View → Execution log → should see something like:
   ```
   Fetched 3 account(s) across 2 bank(s).
   ✓ Balances saved to sheet.
     [Chase Business] Chase Total Checking: $14250.00
     [Chase Business] Chase Business Savings: $8400.00
     [Ally Savings]   Ally Online Savings: $12700.00
   ```
3. Open your Google Sheet → **Balances** tab → new rows with today's date
4. Then run **`fetchPlaidTaxPayments`** → should see any tax payments from the last 400 days

If either fails, run **`checkPlaidStatus`** and share the log.

---

## Step 8 — Set up automatic monthly pulls

1. Function dropdown → **`setupTriggers`** → **Run** ▶
2. Run **`checkPlaidStatus`** to confirm `Active triggers: 2`

Done. The script will now run automatically on the 10th and 25th of each month at 8 AM, pull fresh balances and tax payments, and write them to the sheet.

---

## Troubleshooting

**"Missing PLAID_CLIENT_ID or PLAID_SECRET"** — re-check Script Properties. Make sure there are no stray spaces.

**"INVALID_CREDENTIALS" or "INVALID_API_KEYS"** — you might have pasted the Sandbox secret instead of Development. Go back to Step 2.

**"ITEM_LOGIN_REQUIRED"** — Plaid occasionally requires you to re-authenticate with your bank (every ~90 days for some banks). Re-open the Web App URL, click Disconnect on that bank, then Connect again.

**Tax payments sheet is empty but I know I've paid taxes recently** — the matcher looks for specific payee names (IRS, Treasury, MN Revenue, EFTPS). If your bank labels the transactions differently, tell me what the description looks like and I'll add it to `TAX_KEYWORDS` in `Plaid.gs`.

---

## Cost

**Zero** for this use case. Plaid's Development environment is free with:
- Up to 100 Items (bank connections) — you'll use 2
- Unlimited API calls
- Real bank data

Production pricing only matters if you ever open this to other users, which you aren't.
