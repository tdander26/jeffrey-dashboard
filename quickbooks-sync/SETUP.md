# QuickBooks Online Setup Guide
## Profit First Dashboard — Momentum Health Chiropractic

This guide connects your QuickBooks Online account to your Profit First dashboard so that real bank balances are automatically pulled on the 10th and 25th of each month.

**Time required:** About 30–45 minutes the first time.

---

## Overview of What You're Building

```
QuickBooks Online (your bank balances)
    ↓  automatically every 10th & 25th
Google Sheet (stores the balance history)
    ↓  published as a web link
Your Dashboard (finance.html) shows the live balances
```

Everything runs automatically after setup. No servers, no subscriptions, no extra cost.

---

## Step 1 — Create a QuickBooks Developer App

This gives your Google Sheet permission to read your QBO data.

1. Go to **[developer.intuit.com](https://developer.intuit.com)** and sign in with your Intuit/QuickBooks account (same login you use for QBO).

2. Click **"Create an app"** in the top right.

3. Select **"QuickBooks Online and Payments"** as the platform.

4. Fill in the app details:
   - **App name:** `Momentum Health Dashboard` (anything works)
   - **Scope:** Check ✓ **"Accounting"**
   - Click **Create app**

5. You're now on the app settings page. Click **"Keys & OAuth"** in the left sidebar.

6. Under **"Production"** tab, copy and save (in a safe place like Notes):
   - **Client ID** — long string starting with `AB...`
   - **Client Secret** — click "Show" to reveal it

   > ⚠️ Keep these secret — they're like a password for your QBO data.

7. **Leave this tab open** — you'll need to add a Redirect URI in Step 6.

---

## Step 2 — Find Your QuickBooks Company ID

1. Log into your **[QuickBooks Online](https://qbo.intuit.com)** account.
2. Click the **gear icon ⚙️** (top right) → **Account and Settings**.
3. Click the **Billing & Subscription** tab.
4. Scroll to the bottom — you'll see **"Company ID"** (a 10-digit number like `1234567890`).
5. Copy this number — you'll need it in Step 4.

---

## Step 3 — Create the Google Sheet and Apps Script

1. Go to **[sheets.google.com](https://sheets.google.com)** and create a new blank spreadsheet.
2. Name it **"QBO Balances"** (click the title "Untitled spreadsheet" to rename).
3. In the menu, click **Extensions → Apps Script**.
4. A new browser tab opens with the Apps Script editor.
5. **Delete all the code** in the `Code.gs` file (select all, delete).
6. Open the file **`Code.gs`** from this folder (`jeffrey-dashboard/quickbooks-sync/Code.gs`).
7. **Copy all the code** and paste it into the Apps Script editor.
8. Press **Ctrl+S** (or Cmd+S on Mac) to save. Name the project **"QBO Sync"** when prompted.

---

## Step 4 — Add the OAuth2 Library

The script needs a helper library to handle QuickBooks authentication.

1. In the Apps Script editor, look at the left sidebar.
2. Next to **"Libraries"**, click the **+** (plus) button.
3. In the "Add a library" dialog, paste this Script ID:
   ```
   1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMBbjqp
   ```
4. Click **"Look up"**.
5. It should find **"OAuth2"** — select the **highest version number** from the dropdown.
6. Make sure **Identifier** is set to `OAuth2` (it should be automatic).
7. Click **Add**.

---

## Step 5 — Store Your QuickBooks Credentials

1. In the Apps Script editor, click the **gear icon ⚙️** (Project Settings) in the left sidebar.
2. Scroll down to **"Script Properties"**.
3. Click **"Add script property"** and add each of these four properties:

   | Property name | Value |
   |---|---|
   | `QBO_CLIENT_ID` | Paste your Client ID from Step 1 |
   | `QBO_CLIENT_SECRET` | Paste your Client Secret from Step 1 |
   | `QBO_REALM_ID` | Paste your Company ID from Step 2 |
   | `QBO_ENVIRONMENT` | Type exactly: `production` |

4. Click **"Save script properties"**.

---

## Step 6 — Deploy the Script as a Web App

This creates a web address that QuickBooks uses to send authorization back to you.

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the **gear ⚙️** next to "Select type" → choose **"Web app"**.
3. Fill in the settings:
   - **Description:** `QBO Auth`
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
4. Click **Deploy**.
5. If asked to authorize, click **Authorize access** → choose your Google account → click **Allow**.
6. Copy the **Web app URL** — it ends in `/exec`. It looks like:
   ```
   https://script.google.com/macros/s/AKfy.../exec
   ```
   Save this URL — you'll use it in the next step AND paste it in your dashboard later.

---

## Step 7 — Add the Redirect URI to QuickBooks

QuickBooks needs to know where to send you back after you authorize.

1. Go back to the **[developer.intuit.com](https://developer.intuit.com)** tab from Step 1.
2. Under **"Keys & OAuth"** → **"Production"** tab, find **"Redirect URIs"**.
3. Click **"Add URI"** and paste the Web app URL you copied in Step 6.
4. Click **"Save"**.

---

## Step 8 — Authorize QuickBooks (First-Time Only)

1. Go back to the **Apps Script editor**.
2. From the **function dropdown** at the top (it may say "myFunction"), select **`authorize`**.
3. Click the **Run ▶ button**.
4. If you see a permissions dialog, click **Review permissions → Allow**.
5. After it runs, click **View → Execution log** at the top.
6. You'll see a long URL in the log. **Copy that entire URL**.
7. Paste it into a **new browser tab** and press Enter.
8. QuickBooks will ask you to sign in (if not already) and then ask **"Connect your app?"**
9. Click **Connect**.
10. You'll be redirected to a page saying **"✓ Authorization complete!"** — that's it!

---

## Step 9 — Test the Connection

1. Back in Apps Script, select **`fetchAndSaveBalances`** from the function dropdown.
2. Click **Run ▶**.
3. Open **View → Execution log** and look for:
   - `✓ Balances saved to sheet successfully.`
   - A list of your bank account names and balances
4. Switch back to your **Google Sheet** tab and look for a sheet tab named **"Balances"** — you should see rows with today's date and your account balances.

**Troubleshooting:**
- If you see `QBO API error 401`, run `resetAuth()` and repeat Step 8.
- If you see `Missing QBO_REALM_ID`, double-check Step 5.
- If no accounts appear, make sure your QBO accounts are type "Bank" and marked Active.

---

## Step 10 — Set Up Automatic Monthly Triggers

1. In Apps Script, select **`setupTriggers`** from the dropdown.
2. Click **Run ▶**.
3. Click the **clock icon 🕐** (Triggers) in the left sidebar.
4. You should see **two triggers** listed for `fetchAndSaveBalances` — one for the 10th, one for the 25th.

From now on, the script runs automatically. No action needed each month.

---

## Step 11 — Publish the Sheet to the Web

This creates a public link so your dashboard can read the balance data.

1. Go back to your **Google Sheet** ("QBO Balances").
2. Click **File → Share → Publish to web**.
3. In the first dropdown, select **"Balances"** (not "Entire Document").
4. In the second dropdown, select **"Comma-separated values (.csv)"**.
5. Click **Publish** → **OK** to confirm.
6. Copy the URL that appears. It looks like:
   ```
   https://docs.google.com/spreadsheets/d/YOUR_ID/gviz/tq?tqx=out:csv&sheet=Balances
   ```
7. Keep this URL — you'll paste it into your dashboard next.

---

## Step 12 — Connect the Dashboard

1. Open your **finance.html dashboard** (at your GitHub Pages URL or locally).
2. Click the **"Profit First"** tab if it's not already selected.
3. Find the **"Live QBO Balances"** panel and click it to expand.
4. Paste the CSV URL from Step 11 into the URL field.
5. Click **Refresh** — your bank account balances will appear!
6. Use the **"Assign to PF Bucket"** dropdown next to each account to map it:
   - Profit account → **Profit**
   - Tax savings account → **Tax**
   - Owner's compensation account → **OC**
   - Main operating account → **OPEX**
   - (Accounts can also be left unassigned)
7. The bucket totals and percentages update automatically as you assign accounts.

---

## Step 13 — Using Live Balances for a New Entry

On the 10th or 25th (after the script runs), open your dashboard and:

1. Expand the **"Live QBO Balances"** panel.
2. Click **Refresh** to load the latest data.
3. Click **"Use These Balances"** — the Add Entry modal opens pre-filled with:
   - Today's date
   - The total across all assigned accounts
   - Profit First percentages calculated from your real balances
4. Review the numbers, adjust if needed, then click **Add Entry**.

---

## Ongoing Maintenance

| Situation | What to do |
|---|---|
| QBO authorization expires (rare) | Run `authorize()` in Apps Script, repeat Step 8 |
| You change QBO credentials | Run `resetAuth()`, update Script Properties, repeat Steps 8–9 |
| You add a new bank account in QBO | It will appear automatically on the next sync |
| You want to sync now (not wait for the 10th/25th) | Run `fetchAndSaveBalances()` manually in Apps Script |
| Something looks wrong | Run `checkStatus()` in Apps Script for a diagnostic report |

---

## Quick Reference

| What | Where |
|---|---|
| Apps Script editor | Extensions → Apps Script (from your Google Sheet) |
| Script Properties | Apps Script → gear icon ⚙️ → Script Properties |
| Triggers | Apps Script → clock icon 🕐 |
| QBO Developer Console | developer.intuit.com |
| QBO Company ID | QBO → gear ⚙️ → Account and Settings → Billing & Subscription |
