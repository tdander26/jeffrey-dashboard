// ═══════════════════════════════════════════════════════════════════════════
// SimpleFIN Bridge → Google Sheet Sync
// Momentum Health Chiropractic — Profit First Dashboard
//
// Replaces the Plaid integration. SimpleFIN Bridge gives you live balances
// and transactions for a flat $1.50/mo (vs Plaid's per-API-call model and
// their friction around "personal use").
//
// SETUP — see SETUP.md. High level:
//   1. Sign up at bridge.simplefin.org and connect Chase + Ally there
//   2. Generate a Setup Token in their dashboard
//   3. Paste it into claimSimpleFinSetupToken() once, Run — it swaps the
//      one-time token for a long-lived Access URL and saves it to Script
//      Properties
//   4. Run fetchAll() to test, then setupTriggers() for automatic every-2h syncs
//
// Script Properties:
//   QBO_SHEET_ID            — Google Sheet ID (same one the dashboard reads)
//   SYNC_TOKEN              — (optional) shared secret for the doGet web app.
//                             Set to a random string to enable the dashboard's
//                             "Sync now" button. Unset = endpoint refuses.
//
// Auto-populated by the script (don't set these manually):
//   SIMPLEFIN_ACCESS_URL    — full URL with embedded basic-auth credentials,
//                             looks like https://user:pass@beta-bridge.simplefin.org/simplefin
//   LAST_SYNC_AT            — epoch millis of the last successful fetchAll,
//                             used for the web-app throttle + dashboard freshness
//   LAST_FAILURE_EMAIL_AT   — epoch millis of the last failure email (6h throttle)
// ═══════════════════════════════════════════════════════════════════════════

var SHEET_NAME     = 'Balances';
var TAX_SHEET_NAME = 'Tax Payments';
var TXN_SHEET_NAME = 'Transactions';

// How far back to pull transactions for tax-payment detection.
// SimpleFIN typically returns 90 days by default; we explicitly request more.
var TAX_LOOKBACK_DAYS = 400;

// Merchant name / description patterns that mark a transaction as a tax payment.
// Checked case-insensitively as substrings of the SimpleFIN description / payee / memo.
var TAX_KEYWORDS = [
  'irs',
  'internal revenue',
  'us treasury',
  'united states treasury',
  'treasury',
  'eftps',
  'usataxpymt',
  'mn dept of revenue',
  'mn revenue',
  'minnesota revenue',
  'minnesota dept of revenue',
  'minnesota department of revenue',
  'franchise tax'
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns { baseUrl, authHeader } parsed from the stored Access URL.
 * Throws if the access URL hasn't been claimed yet.
 */
function simpleFinCreds_() {
  var raw = (PropertiesService.getScriptProperties().getProperty('SIMPLEFIN_ACCESS_URL') || '').trim();
  if (!raw) {
    throw new Error('Missing SIMPLEFIN_ACCESS_URL. Run claimSimpleFinSetupToken("<your token>") first. See SETUP.md.');
  }
  // Format: https://user:pass@host/path
  var m = raw.match(/^(https?:\/\/)([^:@\s]+):([^@\s]+)@(.+)$/);
  if (!m) {
    throw new Error('SIMPLEFIN_ACCESS_URL is malformed. Expected https://user:pass@host/path. Got: ' + raw.slice(0, 40) + '…');
  }
  var scheme = m[1], user = m[2], pass = m[3], rest = m[4];
  var creds = Utilities.base64Encode(user + ':' + pass);
  return {
    baseUrl: scheme + rest,
    authHeader: 'Basic ' + creds
  };
}

/** GET to a SimpleFIN path (relative). Returns parsed JSON. Throws on non-2xx. */
function simpleFinGet_(path, queryParams) {
  var creds = simpleFinCreds_();
  var qs = '';
  if (queryParams) {
    var parts = [];
    Object.keys(queryParams).forEach(function(k) {
      var v = queryParams[k];
      if (v == null) return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    if (parts.length) qs = '?' + parts.join('&');
  }
  var url = creds.baseUrl + path + qs;
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: creds.authHeader, Accept: 'application/json' },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('SimpleFIN ' + path + ' ' + code + ': ' + text.slice(0, 400));
  }
  try { return JSON.parse(text); }
  catch(e) { throw new Error('SimpleFIN ' + path + ': non-JSON response: ' + text.slice(0, 200)); }
}

/** Get the target Google Sheet. Reuses QBO_SHEET_ID for compat with existing dashboard. */
function getTargetSpreadsheet_() {
  var sheetId = (PropertiesService.getScriptProperties().getProperty('QBO_SHEET_ID') || '').replace(/\s+/g, '');
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('No target spreadsheet. Set QBO_SHEET_ID in Script Properties.');
  return active;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP TOKEN → ACCESS URL (run once)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-time bootstrap. The setup token from bridge.simplefin.org is a
 * base64-encoded URL. POST to that URL with no body to claim it; the
 * response body is the long-lived access URL with embedded credentials.
 *
 * Usage from Apps Script editor:
 *   1. Open SimpleFin.gs
 *   2. Paste your token below the function or call from a temp wrapper
 *   3. Run claimSimpleFinSetupToken('eyJ...')
 *   4. Check the log — should print "✓ Access URL saved."
 */
function claimSimpleFinSetupToken(setupToken) {
  if (!setupToken) {
    throw new Error('Pass the setup token from bridge.simplefin.org as the argument.');
  }
  var token = String(setupToken).trim();
  // The setup token is base64 of the claim URL.
  var claimUrl;
  try {
    claimUrl = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString().trim();
  } catch(e) {
    throw new Error('Setup token is not valid base64. Did you paste the right thing?');
  }
  if (!/^https?:\/\//.test(claimUrl)) {
    throw new Error('Decoded setup token does not look like a URL. Got: ' + claimUrl.slice(0, 80));
  }

  Logger.log('Claiming setup token at: ' + claimUrl.replace(/\/[^/]+$/, '/****'));
  var resp = UrlFetchApp.fetch(claimUrl, {
    method: 'post',
    payload: '',
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText().trim();
  if (code < 200 || code >= 300) {
    throw new Error('Claim failed (' + code + '): ' + body);
  }
  if (!/^https?:\/\/.+:.+@.+/.test(body)) {
    throw new Error('Claim returned an unexpected body. Expected a URL with user:pass@. Got: ' + body.slice(0, 200));
  }
  PropertiesService.getScriptProperties().setProperty('SIMPLEFIN_ACCESS_URL', body);
  Logger.log('✓ Access URL saved. You can delete the setup token from bridge.simplefin.org now.');
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SYNC — called automatically by the every-2h trigger
// ─────────────────────────────────────────────────────────────────────────────

function fetchAll() {
  try {
    var data = syncAllToSheets_();
    // Record a successful full sync so the web-app throttle and the dashboard's
    // "last synced" indicator can key off it. Epoch millis as a String — Script
    // Properties only store strings.
    PropertiesService.getScriptProperties()
      .setProperty('LAST_SYNC_AT', String(new Date().getTime()));
    return data;
  } catch(err) {
    Logger.log('✗ fetchAll failed: ' + err.message);
    notifyFailure_(err);   // best-effort, throttled, never masks the real error
    throw err;
  }
}

/**
 * Shared fetch+write path used by BOTH fetchAll() and the doGet web app.
 * Returns { accounts } so callers can build a response payload.
 *
 * A single SimpleFIN /accounts call returns BOTH balances and transactions —
 * we shape it three ways into the three sheets. The three writes are ISOLATED:
 * we write balances FIRST (the dashboard's most important data) and don't let a
 * tax/transaction write failure prevent balances from landing. Errors are
 * collected, logged individually, and rethrown as one combined error at the end
 * so trigger-failure notifications still fire.
 */
function syncAllToSheets_() {
  var data = fetchAccountsWithTransactions_(TAX_LOOKBACK_DAYS);
  var errs = [];
  try {
    writeBalances_(data.accounts);
  } catch(e) {
    Logger.log('✗ writeBalances_ failed: ' + e.message);
    errs.push('balances: ' + e.message);
  }
  try {
    writeTaxPayments_(extractTaxPayments_(data.accounts));
  } catch(e) {
    Logger.log('✗ writeTaxPayments_ failed: ' + e.message);
    errs.push('tax: ' + e.message);
  }
  try {
    writeAllTransactions_(data.accounts);
  } catch(e) {
    Logger.log('✗ writeAllTransactions_ failed: ' + e.message);
    errs.push('transactions: ' + e.message);
  }
  if (errs.length) {
    throw new Error('sync completed with ' + errs.length + ' write error(s): ' + errs.join(' ; '));
  }
  return data;
}

/**
 * Email the script owner when a sync fails. Throttled to at most 1 email per
 * 6 hours (via Script Property LAST_FAILURE_EMAIL_AT) so a stuck bank doesn't
 * inbox-bomb every 2h. Wrapped so an email failure can NEVER mask the original
 * sync error — the caller still rethrows that.
 */
function notifyFailure_(err) {
  try {
    var props = PropertiesService.getScriptProperties();
    var now = new Date().getTime();
    var lastStr = props.getProperty('LAST_FAILURE_EMAIL_AT');
    var last = lastStr ? Number(lastStr) : 0;
    var SIX_HOURS_MS = 6 * 60 * 60 * 1000;
    if (last && (now - last) < SIX_HOURS_MS) {
      Logger.log('⚠ Failure email throttled (last sent ' + Math.round((now - last) / 60000) + ' min ago).');
      return;
    }
    var to = Session.getEffectiveUser().getEmail();
    if (!to) { Logger.log('⚠ Cannot send failure email — no effective user email.'); return; }
    var when = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    MailApp.sendEmail(
      to,
      'SimpleFIN sync failed',
      'The SimpleFIN → Google Sheet sync failed.\n\n' +
      'When: ' + when + '\n' +
      'Error: ' + (err && err.message ? err.message : String(err)) + '\n\n' +
      'Check the Apps Script execution log for details.'
    );
    props.setProperty('LAST_FAILURE_EMAIL_AT', String(now));
    Logger.log('✓ Failure email sent to ' + to + '.');
  } catch(mailErr) {
    Logger.log('⚠ Failure email itself failed: ' + mailErr.message);
  }
}

/**
 * Standalone: just balances. Useful for quick spot checks. Hits the API with
 * balances-only=1 to avoid pulling transactions.
 */
function fetchSimpleFinBalances() {
  Logger.log('Starting SimpleFIN balance fetch — ' + new Date().toLocaleString());
  var data = simpleFinGet_('/accounts', { 'balances-only': 1 });
  var accounts = (data.accounts || []).map(shapeAccount_);
  Logger.log('Fetched ' + accounts.length + ' account(s).');
  if (!accounts.length) return;
  writeBalances_(accounts);
  accounts.forEach(function(a) {
    Logger.log('  [' + a.bankName + '] ' + a.name + ': $' + a.balance.toFixed(2));
  });
  if (data.errors && data.errors.length) {
    Logger.log('⚠ SimpleFIN reported errors:');
    data.errors.forEach(function(e) { Logger.log('  • ' + e); });
  }
}

/**
 * Standalone: just tax payments. Pulls transactions back TAX_LOOKBACK_DAYS,
 * filters by TAX_KEYWORDS + SimpleFIN tax-category hints, writes to sheet.
 */
function fetchSimpleFinTaxPayments() {
  Logger.log('Starting SimpleFIN tax payment scan — ' + new Date().toLocaleString());
  var data = fetchAccountsWithTransactions_(TAX_LOOKBACK_DAYS);
  var payments = extractTaxPayments_(data.accounts);
  Logger.log('Found ' + payments.length + ' tax payment(s).');
  writeTaxPayments_(payments);
  payments.forEach(function(r) {
    Logger.log('  ' + r.date + ' · ' + r.payee + ' · $' + r.amount.toFixed(2));
  });
}

/**
 * Standalone: all transactions across all accounts, written to the
 * Transactions tab. The dashboard's Spend view reads from here to compute
 * per-bucket burn, internal transfer detection, and early-transfer auto-tag.
 */
function fetchSimpleFinTransactions() {
  Logger.log('Starting SimpleFIN transaction sync — ' + new Date().toLocaleString());
  var data = fetchAccountsWithTransactions_(TAX_LOOKBACK_DAYS);
  writeAllTransactions_(data.accounts);
}

/** Pull /accounts with N days of transactions. */
function fetchAccountsWithTransactions_(lookbackDays) {
  var end   = new Date();
  var start = new Date(); start.setDate(start.getDate() - lookbackDays);
  // SimpleFIN expects unix timestamps in seconds for start-date / end-date.
  var startTs = Math.floor(start.getTime() / 1000);
  var endTs   = Math.floor(end.getTime()   / 1000);
  var raw = simpleFinGet_('/accounts', {
    'start-date': startTs,
    'end-date':   endTs,
    'pending':    1
  });
  var accounts = (raw.accounts || []).map(shapeAccount_);
  if (raw.errors && raw.errors.length) {
    Logger.log('⚠ SimpleFIN reported errors:');
    raw.errors.forEach(function(e) { Logger.log('  • ' + e); });
  }
  return { accounts: accounts };
}

/** Normalize a SimpleFIN account record into our internal shape. */
function shapeAccount_(a) {
  var balanceStr = a.balance != null ? a.balance : (a['available-balance'] != null ? a['available-balance'] : '0');
  var bal = parseFloat(balanceStr);
  if (isNaN(bal)) bal = 0;
  var bankName = (a.org && (a.org.name || a.org.domain)) || 'Unknown';
  // Friendly bank names: strip TLD off domain fallback (chase.com → chase)
  if (a.org && !a.org.name && a.org.domain) bankName = a.org.domain.replace(/\..*$/, '');
  // SimpleFIN ships 'balance-date' (unix seconds) = when the BANK last updated
  // this balance. That's the TRUE as-of date. Stamp it instead of the script's
  // run date, so a balance pulled on the 27th that the bank last posted on the
  // 25th is dated the 25th — never mislabeled as fresher than it really is.
  var asOfStr = '';
  var asOfTs = a['balance-date'];
  if (asOfTs != null && asOfTs !== '') {
    var bd = new Date(Number(asOfTs) * 1000);
    if (!isNaN(bd.getTime())) asOfStr = Utilities.formatDate(bd, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  // SimpleFIN's 'available-balance' is the bank's available (post-hold) figure.
  // Keep it raw and null when absent/unparseable — the dashboard treats a blank
  // Available Balance cell as "unknown" (see the shared column contract).
  var avail = null;
  if (a['available-balance'] != null && a['available-balance'] !== '') {
    var av = parseFloat(a['available-balance']);
    if (!isNaN(av)) avail = av;
  }
  var txns = (a.transactions || []).map(shapeTransaction_);
  // pendingTotal is the SIGNED sum of this account's pending transactions
  // (SimpleFIN convention: outflows negative). We must distinguish "no pending
  // transactions" (0) from "transactions weren't fetched at all" (null). The
  // balances-only path omits a.transactions entirely, so leave pendingTotal null
  // there; when transactions ARE present (fetchAccountsWithTransactions_), a
  // lack of pending ones legitimately means 0.
  var pendingTotal = null;
  if (a.transactions != null) {
    pendingTotal = 0;
    for (var pi = 0; pi < txns.length; pi++) {
      if (txns[pi].pending === true) pendingTotal += txns[pi].amount;
    }
  }
  return {
    id:               a.id || '',
    name:             a.name || 'Unknown',
    balance:          bal,
    balanceDate:      asOfStr,      // '' when SimpleFIN omits balance-date
    accountType:      'depository', // SimpleFIN doesn't expose a structured type field
    currency:         a.currency || 'USD',
    bankName:         bankName,
    availableBalance: avail,        // null when SimpleFIN omits available-balance
    pendingTotal:     pendingTotal, // null on the balances-only path, else signed sum (0 if none)
    transactions:     txns
  };
}

/** Normalize a SimpleFIN transaction record. */
function shapeTransaction_(t) {
  var amt = parseFloat(t.amount);
  if (isNaN(amt)) amt = 0;
  // SimpleFIN: posted is a unix timestamp (seconds). Use transacted_at if present.
  var ts = t.transacted_at || t.posted || 0;
  var dateStr = '';
  if (ts) {
    var d = new Date(Number(ts) * 1000);
    dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return {
    id:          t.id || '',
    date:        dateStr,
    amount:      amt,                   // SimpleFIN: outflows are NEGATIVE
    description: (t.description || '').toString(),
    payee:       (t.payee || '').toString(),
    memo:        (t.memo || '').toString(),
    pending:     !!t.pending
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHEET WRITES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Append (or upsert) a row per account to the Balances sheet.
 *
 * The "Date" column carries each account's TRUE as-of date (SimpleFIN's
 * balance-date), NOT the script's run date — so the dashboard never shows a
 * balance as fresher than the bank actually reported. A separate "Fetched At"
 * column records when this sync ran, so you can see both: what day the balance
 * is good for, and when we last checked. The dashboard parser keys on the
 * exact header 'Date', so that header text must stay 'Date'.
 *
 * Columns (shared contract — order and header text must not change):
 *   Date | Account Name | Balance | Account Type | Fetched At |
 *   Pending | Current Balance | Available Balance
 * Balance is SimpleFIN's cleared/ledger balance. Pending is the signed sum of
 * that account's pending transactions (blank when transactions weren't fetched).
 * Current Balance = Balance + Pending when Pending is known (blank otherwise).
 * Available Balance is SimpleFIN's raw 'available-balance' (blank when absent).
 *
 * At higher sync cadence (every 2h) a naive append bloats the sheet, so we
 * dedupe-upsert: if this account already has a recent row with the same Date,
 * Balance, and Pending, we just refresh its Fetched At / Current / Available
 * cells in place instead of appending a duplicate.
 */
function writeBalances_(accounts) {
  var ss = getTargetSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var headers = ['Date', 'Account Name', 'Balance', 'Account Type', 'Fetched At',
                 'Pending', 'Current Balance', 'Available Balance'];
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    var hdr = sheet.getRange(1, 1, 1, headers.length);
    hdr.setValues([headers]);
    hdr.setFontWeight('bold').setBackground('#f5f5f7');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 110);
    sheet.setColumnWidth(2, 240);
    sheet.setColumnWidth(3, 110);
    sheet.setColumnWidth(4, 120);
    sheet.setColumnWidth(5, 160);
    sheet.setColumnWidth(6, 110);
    sheet.setColumnWidth(7, 130);
    sheet.setColumnWidth(8, 140);
  } else {
    // Upgrade legacy sheets in place so the new columns are labeled. Older
    // sheets have 4 or 5 columns; check the newest column (Available Balance)
    // and re-stamp the full header row if it's missing.
    var existingHdr = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if ((existingHdr[7] || '') !== 'Available Balance' ||
        (existingHdr[4] || '') !== 'Fetched At') {
      sheet.getRange(1, 1, 1, headers.length)
        .setValues([headers])
        .setFontWeight('bold').setBackground('#f5f5f7');
    }
  }
  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var fetchedStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  // Pull the tail of the sheet once for dedupe lookups. Bound the scan so a
  // years-long sheet doesn't force us to read every row — the most recent row
  // for any account is always near the bottom.
  var lastRowBefore = sheet.getLastRow();
  var SCAN_LIMIT = 400;
  var scanStart = Math.max(2, lastRowBefore - SCAN_LIMIT + 1);
  var scanCount = (lastRowBefore >= 2) ? (lastRowBefore - scanStart + 1) : 0;
  var recent = scanCount > 0
    ? sheet.getRange(scanStart, 1, scanCount, headers.length).getValues()
    : [];

  accounts.forEach(function(a) {
    var displayName = a.bankName ? (a.bankName + ' · ' + a.name) : a.name;
    // Use the bank's as-of date; only fall back to today if SimpleFIN omitted it.
    var asOf = a.balanceDate || todayStr;
    var pending = a.pendingTotal;          // number or null
    var current = (pending != null) ? (a.balance + pending) : null;
    var avail   = a.availableBalance;      // number or null
    var pendingCell = (pending != null) ? pending : '';
    var currentCell = (current != null) ? current : '';
    var availCell   = (avail   != null) ? avail   : '';

    // Find this account's most recent existing row (bottom-up within the scan
    // window). If it matches Date + Balance + Pending, upsert instead of append.
    // Treat a blank Pending cell as null so a re-run of the balances-only path
    // (pending null) doesn't churn a row that legitimately had blank pending.
    var upsertRow = -1;
    for (var ri = recent.length - 1; ri >= 0; ri--) {
      if (String(recent[ri][1]) !== String(displayName)) continue;
      // Sheets coerces 'yyyy-MM-dd' strings into Date cells, so a stored Date
      // must be reformatted back to a bare date string before comparing.
      var rowDate = (Object.prototype.toString.call(recent[ri][0]) === '[object Date]')
        ? Utilities.formatDate(recent[ri][0], Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(recent[ri][0]);
      var rowBalance = parseFloat(recent[ri][2]);
      var rowPendingRaw = recent[ri][5];
      var rowPending = (rowPendingRaw === '' || rowPendingRaw == null) ? null : parseFloat(rowPendingRaw);
      var sameDate    = (rowDate === asOf);
      var sameBalance = (!isNaN(rowBalance) && Math.abs(rowBalance - a.balance) < 0.005);
      var samePending = (rowPending == null && pending == null) ||
                        (rowPending != null && pending != null && Math.abs(rowPending - pending) < 0.005);
      if (sameDate && sameBalance && samePending) {
        upsertRow = scanStart + ri; // absolute sheet row of the matched entry
      }
      break; // only the account's most-recent row matters
    }

    if (upsertRow > 0) {
      // Refresh Fetched At + Current + Available in place (Pending already matched).
      sheet.getRange(upsertRow, 5).setValue(fetchedStr);
      sheet.getRange(upsertRow, 7).setValue(currentCell);
      sheet.getRange(upsertRow, 8).setValue(availCell);
    } else {
      sheet.appendRow([asOf, displayName, a.balance, a.accountType, fetchedStr,
                       pendingCell, currentCell, availCell]);
    }
  });

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 3, lastRow - 1, 1).setNumberFormat('$#,##0.00');
    // Plain '0.00' (NOT currency) on Pending / Current / Available — Google's
    // CSV publish exports the FORMATTED string, and '$1,620.00' broke
    // parseFloat downstream (see the note in writeAllTransactions_).
    sheet.getRange(2, 6, lastRow - 1, 3).setNumberFormat('0.00');
  }
  Logger.log('✓ Balances saved (' + accounts.length + ' accounts). As-of dates from bank, fetched ' + fetchedStr + '.');
}

/** Pull all tax-flagged transactions out of every account. */
function extractTaxPayments_(accounts) {
  var results = [];
  accounts.forEach(function(a) {
    (a.transactions || []).forEach(function(t) {
      if (!isTaxTransaction_(t)) return;
      // SimpleFIN signs outflows NEGATIVE. We only want money leaving the account.
      if (t.amount == null || t.amount >= 0) return;
      results.push({
        date:     t.date,
        payee:    (t.payee || t.description || '').toString(),
        amount:   Math.abs(t.amount),
        memo:     (t.memo || t.description || '').toString(),
        category: '', // SimpleFIN doesn't ship a structured category in the public spec
        type:     a.bankName + (t.pending ? ' (pending)' : '')
      });
    });
  });
  // Sort newest first, de-dupe by (date + amount + payee)
  var seen = {};
  results = results
    .sort(function(a, b) { return b.date.localeCompare(a.date); })
    .filter(function(r) {
      var key = r.date + '|' + r.amount.toFixed(2) + '|' + r.payee.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true; return true;
    });
  return results;
}

function isTaxTransaction_(t) {
  var fields = [t.payee, t.description, t.memo].filter(Boolean).join(' | ').toLowerCase();
  if (!fields) return false;
  for (var i = 0; i < TAX_KEYWORDS.length; i++) {
    if (fields.indexOf(TAX_KEYWORDS[i]) >= 0) return true;
  }
  return false;
}

/**
 * Write every transaction across every account to the Transactions sheet.
 * Schema is wide on purpose — the dashboard classifier needs account ID
 * (stable across name changes), payee, description, and memo separately so
 * matching logic can pick the best signal.
 *
 * Outflows are stored as POSITIVE numbers (Math.abs) with a Direction column
 * so the dashboard doesn't have to remember SimpleFIN's negative convention.
 *
 * Sheet is fully rewritten each sync (clear + repopulate). The 400-day window
 * means we re-fetch the same window each time, so any dashboard-side overrides
 * (manual transfer linking, etc.) need to live in localStorage keyed by Txn ID.
 */
function writeAllTransactions_(accounts) {
  var ss = getTargetSpreadsheet_();
  var sheet = ss.getSheetByName(TXN_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TXN_SHEET_NAME);
    sheet.setColumnWidth(1, 100); // Date
    sheet.setColumnWidth(2, 220); // Account ID
    sheet.setColumnWidth(3, 200); // Account Name
    sheet.setColumnWidth(4,  90); // Amount
    sheet.setColumnWidth(5,  80); // Direction
    sheet.setColumnWidth(6, 220); // Payee
    sheet.setColumnWidth(7, 280); // Description
    sheet.setColumnWidth(8, 200); // Memo
    sheet.setColumnWidth(9,  80); // Pending
    sheet.setColumnWidth(10, 220); // Txn ID
  }
  sheet.clear();

  var headers = ['Date', 'Account ID', 'Account Name', 'Amount', 'Direction',
                 'Payee', 'Description', 'Memo', 'Pending', 'Txn ID'];
  var hdrRange = sheet.getRange(1, 1, 1, headers.length);
  hdrRange.setValues([headers]);
  hdrRange.setFontWeight('bold').setBackground('#f5f5f7');
  sheet.setFrozenRows(1);

  var rows = [];
  accounts.forEach(function(a) {
    var displayName = a.bankName ? (a.bankName + ' · ' + a.name) : a.name;
    (a.transactions || []).forEach(function(t) {
      var direction = (t.amount < 0) ? 'out' : 'in';
      rows.push([
        t.date,
        a.id,
        displayName,
        Math.abs(t.amount),
        direction,
        t.payee,
        t.description,
        t.memo,
        t.pending ? 'pending' : '',
        t.id
      ]);
    });
  });

  // Newest first
  rows.sort(function(a, b) { return String(b[0]).localeCompare(String(a[0])); });

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    // Plain number format on the Amount column. Currency formatting (e.g.
    // "$#,##0.00") causes Google's CSV publish to export the FORMATTED
    // string ("$1,620.00") instead of the raw number, which then breaks
    // parseFloat downstream in the dashboard.
    sheet.getRange(2, 4, rows.length, 1).setNumberFormat('0.00');
  }
  Logger.log('✓ Transactions saved (' + rows.length + ' rows across ' + accounts.length + ' accounts).');
}

function writeTaxPayments_(payments) {
  var ss = getTargetSpreadsheet_();
  var sheet = ss.getSheetByName(TAX_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TAX_SHEET_NAME);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 240);
    sheet.setColumnWidth(3, 110);
    sheet.setColumnWidth(4, 240);
    sheet.setColumnWidth(5, 200);
    sheet.setColumnWidth(6, 100);
  }
  sheet.clear();

  var headers = ['Date', 'Payee', 'Amount', 'Memo', 'Category', 'Type'];
  var hdrRange = sheet.getRange(1, 1, 1, headers.length);
  hdrRange.setValues([headers]);
  hdrRange.setFontWeight('bold').setBackground('#f5f5f7');
  sheet.setFrozenRows(1);

  if (payments.length) {
    var rows = payments.map(function(p) {
      return [p.date, p.payee, p.amount, p.memo, p.category, p.type];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sheet.getRange(2, 3, rows.length, 1).setNumberFormat('$#,##0.00');
  }
  Logger.log('✓ Tax payments saved (' + payments.length + ' rows).');
}

// ─────────────────────────────────────────────────────────────────────────────
// WEB APP — on-demand sync endpoint for the dashboard
//
// Lets the finance.html "Sync now" button trigger a fresh SimpleFIN pull without
// waiting for the every-2h trigger. Deployment:
//   Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
//   Then set Script Property SYNC_TOKEN to a random string.
//   The dashboard stores the full /exec?token=… URL in localStorage
//   ('gas_sync_endpoint') and calls it with &action=sync (or &action=status).
// The token is a shared secret — the endpoint refuses any request whose token
// doesn't match SYNC_TOKEN, and refuses entirely if SYNC_TOKEN is unset.
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    var expected = (PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN') || '').trim();
    if (!expected) {
      return jsonOut_({ ok: false, error: 'sync endpoint not configured' });
    }
    if ((params.token || '') !== expected) {
      return jsonOut_({ ok: false, error: 'unauthorized' });
    }

    var action = params.action || 'sync';
    var props = PropertiesService.getScriptProperties();

    if (action === 'status') {
      // Lightweight: just report when we last synced. No account data.
      var lastMs = props.getProperty('LAST_SYNC_AT');
      return jsonOut_({ ok: true, lastSyncAt: msToStamp_(lastMs) });
    }

    if (action === 'sync') {
      // Throttle: if a successful full sync ran < 10 min ago, don't re-hit
      // SimpleFIN (protects our ~24 requests/day budget). Return the throttle
      // flag so the dashboard can show a brief "just synced" message instead.
      var lastSyncStr = props.getProperty('LAST_SYNC_AT');
      var lastSync = lastSyncStr ? Number(lastSyncStr) : 0;
      var TEN_MIN_MS = 10 * 60 * 1000;
      if (lastSync && (new Date().getTime() - lastSync) < TEN_MIN_MS) {
        // Serve the timestamp under BOTH keys: the dashboard's throttle alert
        // reads lastSyncAt (matching action=status); syncedAt kept for symmetry
        // with the non-throttled response.
        var stamp = msToStamp_(lastSyncStr);
        return jsonOut_({ ok: true, throttled: true, lastSyncAt: stamp, syncedAt: stamp, accounts: [] });
      }
      // Same internal fetch+write path as fetchAll(), then stamp LAST_SYNC_AT.
      var data = syncAllToSheets_();
      props.setProperty('LAST_SYNC_AT', String(new Date().getTime()));
      var syncedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
      return jsonOut_({
        ok: true,
        throttled: false,
        syncedAt: syncedAt,
        accounts: buildAccountPayload_(data.accounts)
      });
    }

    return jsonOut_({ ok: false, error: 'unknown action: ' + action });
  } catch(err) {
    // Scrub any embedded user:pass@ credentials (a malformed
    // SIMPLEFIN_ACCESS_URL error quotes part of the URL) before the message
    // leaves the script — this response goes to an external HTTP client.
    var msg = (err && err.message) ? err.message : String(err);
    msg = msg.replace(/\/\/[^@\s]+@/g, '//****@');
    return jsonOut_({ ok: false, error: msg });
  }
}

/**
 * Shape the internal accounts into the web-app response array. name/bankName
 * join into 'bankName · name' exactly like writeBalances_ does. Numeric fields
 * are numbers or null (never blank strings) so the dashboard can test for null.
 */
function buildAccountPayload_(accounts) {
  return (accounts || []).map(function(a) {
    var displayName = a.bankName ? (a.bankName + ' · ' + a.name) : a.name;
    var pending = (a.pendingTotal != null) ? a.pendingTotal : null;
    var current = (pending != null) ? (a.balance + pending) : null;
    return {
      name:             displayName,
      bankName:         a.bankName,
      balance:          a.balance,
      pending:          pending,
      currentBalance:   current,
      availableBalance: (a.availableBalance != null) ? a.availableBalance : null,
      balanceDate:      a.balanceDate
    };
  });
}

/** Format an epoch-millis String (or null) as 'yyyy-MM-dd HH:mm', or null. */
function msToStamp_(ms) {
  if (!ms) return null;
  var n = Number(ms);
  if (isNaN(n) || n <= 0) return null;
  return Utilities.formatDate(new Date(n), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

/** Wrap an object as a JSON ContentService response. */
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGERS
// ─────────────────────────────────────────────────────────────────────────────

function setupTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'fetchAll'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  // Run EVERY 2 HOURS so balances and transactions stay fresh automatically —
  // no manual Refresh needed. SimpleFIN Bridge refreshes each bank's data only
  // ~once/day at unpredictable times and allows ~24 client requests/day. A
  // single every-2h trigger fires 12x/day, which catches that daily refresh
  // within ≤2h while leaving ~12 requests/day of headroom for manual Sync-now
  // calls from the dashboard. Because the Balances sheet is dated by each
  // account's true as-of date (not the run time) and upserts same-day rows,
  // repeated runs just refresh the existing row — no sheet bloat, no misleading
  // "newer" timestamps.
  ScriptApp.newTrigger('fetchAll').timeBased().everyHours(2).create();

  Logger.log('✓ One every-2h trigger created (12 runs/day). Balances now refresh automatically.');
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────

function checkSimpleFinStatus() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('=== SimpleFIN Sync Status ===');
  var url = props.getProperty('SIMPLEFIN_ACCESS_URL');
  Logger.log('Access URL: ' + (url ? '✓ set (' + url.replace(/\/\/[^@]+@/, '//****@').slice(0, 60) + '…)' : '✗ MISSING — run claimSimpleFinSetupToken'));
  Logger.log('Sheet ID:   ' + (props.getProperty('QBO_SHEET_ID') || '✗ MISSING'));
  var lastSync = props.getProperty('LAST_SYNC_AT');
  Logger.log('Last sync:  ' + (msToStamp_(lastSync) || '✗ never (no successful fetchAll yet)'));
  var syncToken = (props.getProperty('SYNC_TOKEN') || '').trim();
  Logger.log('Sync token: ' + (syncToken ? '✓ set (web-app Sync-now enabled)' : '✗ MISSING — set SYNC_TOKEN to enable the dashboard Sync-now button'));

  if (url) {
    try {
      var data = simpleFinGet_('/accounts', { 'balances-only': 1 });
      var accs = (data.accounts || []);
      Logger.log('Connected accounts: ' + accs.length);
      accs.forEach(function(a) {
        var bank = (a.org && (a.org.name || a.org.domain)) || 'Unknown';
        var bal  = parseFloat(a.balance != null ? a.balance : (a['available-balance'] || 0));
        Logger.log('  • [' + bank + '] ' + (a.name || 'Unknown') + ': $' + (isNaN(bal) ? '?' : bal.toFixed(2)));
      });
      if (data.errors && data.errors.length) {
        Logger.log('⚠ Errors:');
        data.errors.forEach(function(e) { Logger.log('  • ' + e); });
      }
    } catch(err) {
      Logger.log('✗ Live check failed: ' + err.message);
    }
  }

  var triggers = ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'fetchAll'; });
  Logger.log('Active triggers: ' + triggers.length + ' (should be 1 after setupTriggers())');
}

/** Clears the access URL and triggers. Does NOT cancel your bridge.simplefin.org subscription. */
function resetSimpleFin() {
  PropertiesService.getScriptProperties().deleteProperty('SIMPLEFIN_ACCESS_URL');
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'fetchAll'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log('✓ Access URL cleared and triggers removed.');
  Logger.log('  To reconnect: generate a new setup token at bridge.simplefin.org → run claimSimpleFinSetupToken("…").');
}
