// ═══════════════════════════════════════════════════════════════════════════
// Plaid → Google Sheet Sync
// Momentum Health Chiropractic — Profit First Dashboard
//
// Replaces the QuickBooks integration for balance + tax-payment sync.
// Plaid gives LIVE bank balances and transactions, not QBO's book balance.
//
// SETUP — see SETUP.md. High level:
//   1. Create a free Plaid developer account → dashboard.plaid.com
//   2. Copy CLIENT_ID and SECRET from the Keys page
//   3. Paste into Script Properties (see list below)
//   4. Deploy this script as a Web App ("Execute as: Me", "Anyone with link")
//   5. Open the Web App URL — click Connect for each bank
//   6. Run fetchAll() to test, then setupTriggers() for the 10th + 25th
//
// Script Properties required (Project Settings → Script Properties):
//   PLAID_CLIENT_ID        — from dashboard.plaid.com → Team settings → Keys
//   PLAID_SECRET           — from dashboard.plaid.com → Team settings → Keys
//   PLAID_ENVIRONMENT      — "sandbox", "development", or "production"
//                             For a personal tool, "development" is correct
//                             (free, real bank data, limited to 100 Items).
//   QBO_SHEET_ID           — Google Sheet ID (same one used by QuickBooks sync)
//
// Auto-populated by the Link flow (don't set manually):
//   PLAID_ACCESS_TOKENS    — JSON array of { bankName, accessToken, itemId }
// ═══════════════════════════════════════════════════════════════════════════

var SHEET_NAME     = 'Balances';
var TAX_SHEET_NAME = 'Tax Payments';

// How far back to pull transactions for tax-payment detection
var TAX_LOOKBACK_DAYS = 400;

// Merchant name / description patterns that mark a transaction as a tax payment.
// Checked case-insensitively as substrings of the Plaid `name` and `merchant_name`.
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

// Plaid product we need for each Item (must be requested at link-token creation)
var PLAID_PRODUCTS = ['transactions'];
var PLAID_COUNTRY_CODES = ['US'];
var PLAID_LINK_CLIENT_NAME = 'Momentum Health Dashboard';

// ─────────────────────────────────────────────────────────────────────────────
// WEB APP ENTRY POINT — serves the Link page
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Link')
    .setTitle('Connect a Bank — Momentum Health Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Base URL for Plaid's API, based on the current environment setting. */
function plaidBaseUrl_() {
  var env = (PropertiesService.getScriptProperties().getProperty('PLAID_ENVIRONMENT') || 'development')
    .toLowerCase().trim();
  if (env === 'production') return 'https://production.plaid.com';
  if (env === 'sandbox')    return 'https://sandbox.plaid.com';
  return 'https://development.plaid.com';
}

/** Returns { clientId, secret } from Script Properties, trimmed. */
function plaidCreds_() {
  var props = PropertiesService.getScriptProperties();
  var id  = (props.getProperty('PLAID_CLIENT_ID') || '').replace(/\s+/g, '');
  var sec = (props.getProperty('PLAID_SECRET')    || '').replace(/\s+/g, '');
  if (!id || !sec) {
    throw new Error('Missing PLAID_CLIENT_ID or PLAID_SECRET in Script Properties. See SETUP.md.');
  }
  return { clientId: id, secret: sec };
}

/** POST JSON to Plaid. Throws on non-2xx with the Plaid error message. */
function plaidPost_(path, body) {
  var url = plaidBaseUrl_() + path;
  var creds = plaidCreds_();
  var payload = Object.assign({}, body, {
    client_id: creds.clientId,
    secret:    creds.secret
  });
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  if (code < 200 || code >= 300) {
    var parsed; try { parsed = JSON.parse(text); } catch(e) {}
    var msg = parsed && parsed.error_message ? parsed.error_message : text;
    var tag = parsed && parsed.error_code    ? ' [' + parsed.error_code + ']' : '';
    throw new Error('Plaid ' + path + ' ' + code + tag + ': ' + msg);
  }
  return JSON.parse(text);
}

/** Load the stored bank list: [{ bankName, accessToken, itemId }, ...] */
function loadBanks_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PLAID_ACCESS_TOKENS') || '[]';
  try { return JSON.parse(raw); } catch(e) { return []; }
}

function saveBanks_(banks) {
  PropertiesService.getScriptProperties()
    .setProperty('PLAID_ACCESS_TOKENS', JSON.stringify(banks));
}

/** Get the target Google Sheet. Reuses QBO_SHEET_ID. */
function getTargetSpreadsheet_() {
  var sheetId = (PropertiesService.getScriptProperties().getProperty('QBO_SHEET_ID') || '').replace(/\s+/g, '');
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('No target spreadsheet. Set QBO_SHEET_ID in Script Properties.');
  return active;
}

// ─────────────────────────────────────────────────────────────────────────────
// LINK FLOW (called from Link.html via google.script.run)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a one-time link_token that Plaid Link needs to open.
 * Called from Link.html when the user clicks a "Connect [Bank]" button.
 */
function createLinkToken(bankName) {
  var label = (bankName || 'Bank').toString().slice(0, 40);
  var data = plaidPost_('/link/token/create', {
    user: { client_user_id: 'momentum-' + Session.getActiveUser().getEmail() },
    client_name: PLAID_LINK_CLIENT_NAME,
    products: PLAID_PRODUCTS,
    country_codes: PLAID_COUNTRY_CODES,
    language: 'en'
  });
  return { linkToken: data.link_token, label: label };
}

/**
 * Exchanges the public_token Plaid Link returns for a long-lived access_token,
 * then stores it in Script Properties under PLAID_ACCESS_TOKENS.
 * Called from Link.html on Plaid Link success.
 */
function exchangePublicToken(publicToken, bankName) {
  if (!publicToken) throw new Error('Missing public_token from Plaid Link.');
  var data = plaidPost_('/item/public_token/exchange', {
    public_token: publicToken
  });

  var banks = loadBanks_();
  // If a previous connection with the same bankName exists, replace it.
  banks = banks.filter(function(b) { return b.bankName !== bankName; });
  banks.push({
    bankName: bankName || ('Bank #' + (banks.length + 1)),
    accessToken: data.access_token,
    itemId: data.item_id,
    connectedAt: new Date().toISOString()
  });
  saveBanks_(banks);

  return { ok: true, bankName: bankName, itemId: data.item_id, total: banks.length };
}

/** Called from Link.html to render the list of already-connected banks. */
function listConnectedBanks() {
  return loadBanks_().map(function(b) {
    return { bankName: b.bankName, itemId: b.itemId, connectedAt: b.connectedAt };
  });
}

/** Remove a bank connection (revokes the Item at Plaid, then drops from storage). */
function removeBank(bankName) {
  var banks = loadBanks_();
  var target = banks.filter(function(b) { return b.bankName === bankName; })[0];
  if (!target) return { ok: false, error: 'Bank not found.' };
  try {
    plaidPost_('/item/remove', { access_token: target.accessToken });
  } catch(e) {
    // Even if the remote remove fails, we still drop the local record
    Logger.log('Item remove failed (continuing): ' + e.message);
  }
  saveBanks_(banks.filter(function(b) { return b.bankName !== bankName; }));
  return { ok: true, bankName: bankName };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SYNC — called by triggers on 10th + 25th
// ─────────────────────────────────────────────────────────────────────────────

function fetchAll() {
  try { fetchPlaidBalances(); }     catch(err) { Logger.log('✗ fetchPlaidBalances failed: ' + err.message); }
  try { fetchPlaidTaxPayments(); }  catch(err) { Logger.log('✗ fetchPlaidTaxPayments failed: ' + err.message); }
}

/**
 * Pulls current balances for every connected bank and appends rows to the
 * "Balances" sheet (Date, Account Name, Balance, Account Type).
 */
function fetchPlaidBalances() {
  Logger.log('Starting Plaid balance fetch — ' + new Date().toLocaleString());
  var banks = loadBanks_();
  if (banks.length === 0) {
    Logger.log('WARNING: No banks connected. Open the Web App URL and click Connect.');
    return;
  }

  var allAccounts = [];
  banks.forEach(function(bank) {
    try {
      var data = plaidPost_('/accounts/balance/get', { access_token: bank.accessToken });
      (data.accounts || []).forEach(function(a) {
        // Plaid "available" is the real-time bank balance; fall back to "current" if unavailable.
        var bal = (a.balances && (a.balances.available != null ? a.balances.available : a.balances.current)) || 0;
        allAccounts.push({
          name:        a.name || a.official_name || 'Unknown',
          balance:     bal,
          accountType: (a.type || 'depository'),
          subType:     a.subtype || '',
          bankName:    bank.bankName
        });
      });
    } catch(err) {
      Logger.log('✗ Balance fetch failed for ' + bank.bankName + ': ' + err.message);
    }
  });

  Logger.log('Fetched ' + allAccounts.length + ' account(s) across ' + banks.length + ' bank(s).');
  if (!allAccounts.length) return;

  writeBalancesToSheet_(allAccounts);
  Logger.log('✓ Balances saved to sheet.');
  allAccounts.forEach(function(a) {
    Logger.log('  [' + a.bankName + '] ' + a.name + ': $' + a.balance.toFixed(2));
  });
}

/** Appends one row per account to the Balances sheet. */
function writeBalancesToSheet_(accounts) {
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
    // Prefix account name with bank so Chase Checking vs Ally Checking don't collide
    var displayName = a.bankName ? (a.bankName + ' · ' + a.name) : a.name;
    sheet.appendRow([dateStr, displayName, a.balance, a.accountType]);
  });

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 3, lastRow - 1, 1).setNumberFormat('$#,##0.00');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TAX PAYMENT DETECTION — scans recent transactions for tax keywords
// ─────────────────────────────────────────────────────────────────────────────

function fetchPlaidTaxPayments() {
  Logger.log('Starting Plaid tax payment scan — ' + new Date().toLocaleString());
  var banks = loadBanks_();
  if (!banks.length) { Logger.log('No banks connected.'); return; }

  var end   = new Date();
  var start = new Date();  start.setDate(start.getDate() - TAX_LOOKBACK_DAYS);
  var endStr   = Utilities.formatDate(end,   Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var startStr = Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  var results = [];
  banks.forEach(function(bank) {
    try {
      var all = fetchAllTransactions_(bank.accessToken, startStr, endStr);
      all.forEach(function(t) {
        if (!isTaxTransaction_(t)) return;
        // Plaid signs outflows positive; only count money leaving the account
        if (t.amount == null || t.amount <= 0) return;
        results.push({
          date:     t.date,
          payee:    (t.merchant_name || t.name || '').toString(),
          amount:   Math.abs(t.amount),
          memo:     (t.original_description || t.name || '').toString(),
          category: (t.personal_finance_category && t.personal_finance_category.primary) ||
                    (t.category && t.category.join(' / ')) || '',
          type:     t.payment_channel || 'bank'
        });
      });
    } catch(err) {
      Logger.log('✗ Transactions fetch failed for ' + bank.bankName + ': ' + err.message);
    }
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

  Logger.log('Found ' + results.length + ' tax payment(s).');
  writeTaxPaymentsToSheet_(results);
  results.forEach(function(r) {
    Logger.log('  ' + r.date + ' · ' + r.payee + ' · $' + r.amount.toFixed(2));
  });
}

/** Paginated /transactions/get — handles Plaid's 500-per-call cap. */
function fetchAllTransactions_(accessToken, startStr, endStr) {
  var all = [];
  var offset = 0;
  var pageSize = 500;
  var total = Infinity;
  while (offset < total) {
    var data = plaidPost_('/transactions/get', {
      access_token: accessToken,
      start_date: startStr,
      end_date: endStr,
      options: { count: pageSize, offset: offset }
    });
    total = data.total_transactions;
    (data.transactions || []).forEach(function(t) { all.push(t); });
    if (!data.transactions || data.transactions.length === 0) break;
    offset += data.transactions.length;
    if (offset > 10000) break; // defensive cap — no one has this many tax payments
  }
  return all;
}

function isTaxTransaction_(t) {
  var fields = [
    t.name, t.merchant_name, t.original_description
  ].filter(Boolean).join(' | ').toLowerCase();
  if (!fields) return false;
  for (var i = 0; i < TAX_KEYWORDS.length; i++) {
    if (fields.indexOf(TAX_KEYWORDS[i]) >= 0) return true;
  }
  // Also match Plaid's built-in GOVERNMENT_AND_NON_PROFIT > TAX_PAYMENT category
  var pfc = t.personal_finance_category;
  if (pfc && pfc.detailed && pfc.detailed.toUpperCase().indexOf('TAX_PAYMENT') >= 0) return true;
  return false;
}

function writeTaxPaymentsToSheet_(payments) {
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

function checkPlaidStatus() {
  var props = PropertiesService.getScriptProperties();
  var banks = loadBanks_();

  Logger.log('=== Plaid Sync Status ===');
  Logger.log('Environment: ' + (props.getProperty('PLAID_ENVIRONMENT') || 'development (default)'));
  Logger.log('Client ID: '   + (props.getProperty('PLAID_CLIENT_ID') ? '✓ set' : '✗ MISSING'));
  Logger.log('Secret: '      + (props.getProperty('PLAID_SECRET')    ? '✓ set' : '✗ MISSING'));
  Logger.log('Sheet ID: '    + (props.getProperty('QBO_SHEET_ID')    || '✗ MISSING'));
  Logger.log('Connected banks: ' + banks.length);
  banks.forEach(function(b) {
    Logger.log('  • ' + b.bankName + ' (' + b.itemId + ')  connected ' + (b.connectedAt || 'unknown'));
  });

  var triggers = ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'fetchAll'; });
  Logger.log('Active triggers: ' + triggers.length + ' (should be 2 after setupTriggers())');
}

/** Clears all banks AND the stored link_token state. Does NOT revoke remotely. */
function resetPlaid() {
  PropertiesService.getScriptProperties().deleteProperty('PLAID_ACCESS_TOKENS');
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'fetchAll'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  Logger.log('✓ All stored banks cleared and triggers removed.');
  Logger.log('  Re-open the Web App URL to reconnect.');
}
