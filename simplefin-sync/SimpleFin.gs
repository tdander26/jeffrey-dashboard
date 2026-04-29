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
//   4. Run fetchAll() to test, then setupTriggers() for the 10th + 25th
//
// Script Properties:
//   QBO_SHEET_ID            — Google Sheet ID (same one the dashboard reads)
//
// Auto-populated by claimSimpleFinSetupToken (don't set manually):
//   SIMPLEFIN_ACCESS_URL    — full URL with embedded basic-auth credentials,
//                             looks like https://user:pass@beta-bridge.simplefin.org/simplefin
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
// MAIN SYNC — called by triggers on 10th + 25th
// ─────────────────────────────────────────────────────────────────────────────

function fetchAll() {
  // Single SimpleFIN /accounts call returns BOTH balances and transactions —
  // we just shape it three different ways into the three sheets.
  try {
    var data = fetchAccountsWithTransactions_(TAX_LOOKBACK_DAYS);
    writeBalances_(data.accounts);
    writeTaxPayments_(extractTaxPayments_(data.accounts));
    writeAllTransactions_(data.accounts);
  } catch(err) {
    Logger.log('✗ fetchAll failed: ' + err.message);
    throw err;
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
  return {
    id:          a.id || '',
    name:        a.name || 'Unknown',
    balance:     bal,
    accountType: 'depository', // SimpleFIN doesn't expose a structured type field
    currency:    a.currency || 'USD',
    bankName:    bankName,
    transactions: (a.transactions || []).map(shapeTransaction_)
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

/** Append a row per account to the Balances sheet. */
function writeBalances_(accounts) {
  var ss = getTargetSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    var hdr = sheet.getRange(1, 1, 1, 4);
    hdr.setValues([['Date', 'Account Name', 'Balance', 'Account Type']]);
    hdr.setFontWeight('bold').setBackground('#f5f5f7');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 110);
    sheet.setColumnWidth(2, 240);
    sheet.setColumnWidth(3, 110);
    sheet.setColumnWidth(4, 120);
  }
  var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  accounts.forEach(function(a) {
    var displayName = a.bankName ? (a.bankName + ' · ' + a.name) : a.name;
    sheet.appendRow([dateStr, displayName, a.balance, a.accountType]);
  });
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 3, lastRow - 1, 1).setNumberFormat('$#,##0.00');
  }
  Logger.log('✓ Balances saved (' + accounts.length + ' rows).');
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
// TRIGGERS
// ─────────────────────────────────────────────────────────────────────────────

function setupTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'fetchAll'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('fetchAll').timeBased().onMonthDay(10).atHour(8).create();
  ScriptApp.newTrigger('fetchAll').timeBased().onMonthDay(25).atHour(8).create();

  Logger.log('✓ Two triggers created: 10th and 25th of each month at 8 AM.');
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
  Logger.log('Active triggers: ' + triggers.length + ' (should be 2 after setupTriggers())');
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
