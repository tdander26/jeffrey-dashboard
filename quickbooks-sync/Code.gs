// ═══════════════════════════════════════════════════════════════════════════
// QuickBooks Online → Google Sheet Sync
// Momentum Health Chiropractic — Profit First Dashboard
//
// SETUP REQUIRED — see SETUP.md for step-by-step instructions.
//
// OAuth2 library must be added before this script will work.
// Library Script ID: 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF
//
// Script Properties required (Project Settings → Script Properties):
//   QBO_CLIENT_ID      — from developer.intuit.com
//   QBO_CLIENT_SECRET  — from developer.intuit.com
//   QBO_REALM_ID       — your QuickBooks Company ID
//   QBO_ENVIRONMENT    — "production" or "sandbox"
//   QBO_SHEET_ID       — Google Sheet ID where balances & tax payments are written
//                        (from the sheet's URL: docs.google.com/spreadsheets/d/<THIS>/edit)
// ═══════════════════════════════════════════════════════════════════════════

var SHEET_NAME     = 'Balances';
var TAX_SHEET_NAME = 'Tax Payments';

// Payees matched when detecting tax payments (case-insensitive substring match)
var TAX_PAYEE_KEYWORDS = [
  'united states treasury', 'us treasury', 'treasury',
  'internal revenue', 'irs',
  'minnesota department of revenue', 'mn dept of revenue',
  'mn revenue', 'minnesota revenue', 'minnesota dept of revenue',
  'eftps', 'franchise tax'
];

// Account / category names that also identify tax payments
var TAX_ACCOUNT_KEYWORDS = [
  'tax', 'federal tax', 'state tax', 'mn care', 'income tax',
  'estimated tax', 'quarterly tax'
];

// How far back to look for tax transactions
var TAX_LOOKBACK_DAYS = 400;

/**
 * Returns the target Google Sheet. Uses QBO_SHEET_ID from Script Properties
 * so the script works whether it's standalone or container-bound.
 */
function getTargetSpreadsheet() {
  var sheetId = (PropertiesService.getScriptProperties().getProperty('QBO_SHEET_ID') || '').replace(/\s+/g, '');
  if (sheetId) {
    return SpreadsheetApp.openById(sheetId);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'No target spreadsheet. Set QBO_SHEET_ID in Script Properties ' +
      '(the long ID in your Google Sheet URL between /d/ and /edit).'
    );
  }
  return active;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEB APP ENTRY POINT
// Required for OAuth2 callback to work. Deploy this script as a Web App.
// ─────────────────────────────────────────────────────────────────────────────
function doGet(e) {
  // If Intuit redirected back with an auth code, handle it
  if (e.parameter && e.parameter.code) {
    return authCallback(e);
  }

  // Otherwise show the authorization link
  var service = getQBOService();
  if (service.hasAccess()) {
    return HtmlService.createHtmlOutput(
      '<h2 style="font-family:sans-serif;color:#34c759">✓ QuickBooks is connected!</h2>' +
      '<p style="font-family:sans-serif">You can close this tab. ' +
      'The script will automatically pull balances on the 10th and 25th of each month.</p>' +
      '<p style="font-family:sans-serif;color:#86868b;font-size:12px">To disconnect and re-authorize, run <code>resetAuth()</code> in the Apps Script editor.</p>'
    );
  }

  var authUrl = service.getAuthorizationUrl();
  return HtmlService.createHtmlOutput(
    '<h2 style="font-family:sans-serif">Connect QuickBooks Online</h2>' +
    '<p style="font-family:sans-serif">Click the button below to authorize access to your QuickBooks data.</p>' +
    '<a href="' + authUrl + '" style="display:inline-block;margin-top:16px;padding:12px 24px;' +
    'background:#007AFF;color:#fff;text-decoration:none;border-radius:8px;font-family:sans-serif;font-weight:600">' +
    'Connect QuickBooks →</a>'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH2 AUTHORIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a configured OAuth2 service for QuickBooks Online.
 * Tokens are stored in UserProperties under the key 'oauth2.QuickBooksOnline'.
 */
function getQBOService() {
  var props = PropertiesService.getScriptProperties();
  var env   = props.getProperty('QBO_ENVIRONMENT') || 'production';
  // Strip whitespace defensively — paste artifacts (spaces, line breaks) in
  // credentials are a common cause of invalid_client errors.
  var clientId     = (props.getProperty('QBO_CLIENT_ID')     || '').replace(/\s+/g, '');
  var clientSecret = (props.getProperty('QBO_CLIENT_SECRET') || '').replace(/\s+/g, '');

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET in Script Properties. ' +
      'See SETUP.md for instructions.'
    );
  }

  return OAuth2.createService('QuickBooksOnline')
    .setAuthorizationBaseUrl('https://appcenter.intuit.com/connect/oauth2')
    .setTokenUrl('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')
    .setClientId(clientId)
    .setClientSecret(clientSecret)
    .setCallbackFunction('authCallback')
    .setPropertyStore(PropertiesService.getUserProperties())
    .setScope('com.intuit.quickbooks.accounting')
    .setParam('response_type', 'code')
    .setTokenHeaders({
      Authorization: 'Basic ' + Utilities.base64Encode(clientId + ':' + clientSecret),
      Accept: 'application/json'
    })
    // Intuit rejects the token request if client_id/client_secret appear in
    // BOTH the Basic auth header AND the body — the default OAuth2 library
    // includes them in the body. Strip them here so only the Basic header
    // authenticates the client.
    .setTokenPayloadHandler(function(payload) {
      delete payload.client_id;
      delete payload.client_secret;
      return payload;
    });
}

/**
 * Handles the OAuth2 redirect from Intuit after the user grants access.
 * Called automatically by doGet() when the redirect URL contains ?code=...
 */
function authCallback(e) {
  var service = getQBOService();
  var authorized = service.handleCallback(e);

  if (authorized) {
    return HtmlService.createHtmlOutput(
      '<h2 style="font-family:sans-serif;color:#34c759">✓ Authorization complete!</h2>' +
      '<p style="font-family:sans-serif">QuickBooks is now connected. You can close this tab.</p>' +
      '<p style="font-family:sans-serif">Next step: run <strong>fetchAndSaveBalances()</strong> in the ' +
      'Apps Script editor to test the connection, then run <strong>setupTriggers()</strong> to ' +
      'enable automatic monthly pulls.</p>'
    );
  } else {
    return HtmlService.createHtmlOutput(
      '<h2 style="font-family:sans-serif;color:#FF3B30">Authorization failed</h2>' +
      '<p style="font-family:sans-serif">Please try again by running <code>authorize()</code> in the Apps Script editor.</p>'
    );
  }
}

/**
 * Logs the authorization URL to the Apps Script execution log.
 * Run this function manually the FIRST TIME to connect QuickBooks.
 *
 * HOW TO USE:
 * 1. Select "authorize" from the function dropdown in the Apps Script editor
 * 2. Click the Run (▶) button
 * 3. Open View > Execution log
 * 4. Copy the URL printed there and paste it into your browser
 * 5. Sign in to QuickBooks and click Connect
 */
function authorize() {
  var service = getQBOService();
  if (service.hasAccess()) {
    Logger.log('✓ Already authorized. QuickBooks is connected.');
    return;
  }
  var authUrl = service.getAuthorizationUrl();
  Logger.log('Open this URL in your browser to authorize QuickBooks:\n\n' + authUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SYNC FUNCTION (called by scheduled triggers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches all active Bank accounts from QuickBooks Online and saves their
 * current balances to the "Balances" sheet in this Google Sheet.
 *
 * This function is called automatically by the time-based triggers on the
 * 10th and 25th of each month. You can also run it manually to test.
 */
function fetchAndSaveBalances() {
  Logger.log('Starting QBO balance fetch — ' + new Date().toLocaleString());

  var accounts = getQBOAccounts();
  Logger.log('Found ' + accounts.length + ' bank account(s) in QuickBooks.');

  if (accounts.length === 0) {
    Logger.log('WARNING: No accounts returned. Check QBO_REALM_ID and that Bank accounts exist in QBO.');
    return;
  }

  writeToSheet(accounts);
  Logger.log('✓ Balances saved to sheet successfully.');

  // Log a summary
  accounts.forEach(function(a) {
    Logger.log('  ' + a.name + ': $' + a.balance.toFixed(2));
  });
}

/**
 * Orchestrator — runs both balance sync AND tax payment sync.
 * This is the function the scheduled triggers point at.
 */
function fetchAll() {
  try {
    fetchAndSaveBalances();
  } catch(err) {
    Logger.log('✗ fetchAndSaveBalances failed: ' + err.message);
  }
  try {
    fetchAndSaveTaxPayments();
  } catch(err) {
    Logger.log('✗ fetchAndSaveTaxPayments failed: ' + err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TAX PAYMENT SYNC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queries QBO for recent transactions that look like tax payments
 * (matched by payee name OR expense account name) and overwrites the
 * "Tax Payments" sheet with the results.
 */
function fetchAndSaveTaxPayments() {
  Logger.log('Starting QBO tax payment fetch — ' + new Date().toLocaleString());

  var payments = getQBOTaxPayments();
  Logger.log('Found ' + payments.length + ' tax payment(s).');

  writeTaxPaymentsToSheet(payments);
  Logger.log('✓ Tax payments saved to sheet successfully.');

  payments.forEach(function(p) {
    Logger.log('  ' + p.date + ' · ' + p.payee + ' · $' + p.amount.toFixed(2));
  });
}

/**
 * Queries QBO Purchase transactions in the lookback window and filters
 * for tax-related payments.
 *
 * @returns {Array<{date, payee, amount, memo, category, type}>}
 */
function getQBOTaxPayments() {
  var service = getQBOService();
  if (!service.hasAccess()) {
    throw new Error('Not authorized. Run authorize() first.');
  }

  var props   = PropertiesService.getScriptProperties();
  var env     = props.getProperty('QBO_ENVIRONMENT') || 'production';
  var realmId = (props.getProperty('QBO_REALM_ID') || '').replace(/\s+/g, '');
  if (!realmId) throw new Error('Missing QBO_REALM_ID in Script Properties.');

  var baseUrl = (env === 'sandbox')
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

  // Build the date window
  var sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - TAX_LOOKBACK_DAYS);
  var sinceStr = Utilities.formatDate(sinceDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Pull all Purchases since the window. QBO's query language doesn't
  // support OR across different fields, so we filter client-side.
  var query = "SELECT * FROM Purchase WHERE TxnDate >= '" + sinceStr + "' MAXRESULTS 1000";
  var url   = baseUrl + '/v3/company/' + realmId +
              '/query?query=' + encodeURIComponent(query) + '&minorversion=65';

  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + service.getAccessToken(),
      Accept:        'application/json'
    },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('QBO Purchase query failed: ' + resp.getResponseCode() + ' ' + resp.getContentText());
  }

  var data      = JSON.parse(resp.getContentText());
  var purchases = (data.QueryResponse && data.QueryResponse.Purchase) || [];

  var results = [];
  purchases.forEach(function(p) {
    var payee = (p.EntityRef && p.EntityRef.name) || '';
    var memo  = p.PrivateNote || '';

    // Collect all expense account names from the lines
    var accountNames = [];
    (p.Line || []).forEach(function(line) {
      if (line.AccountBasedExpenseLineDetail &&
          line.AccountBasedExpenseLineDetail.AccountRef) {
        accountNames.push(line.AccountBasedExpenseLineDetail.AccountRef.name || '');
      }
    });

    if (!isTaxTransaction(payee, memo, accountNames)) return;

    results.push({
      date:     p.TxnDate || '',
      payee:    payee,
      amount:   p.TotalAmt || 0,
      memo:     memo,
      category: accountNames.join(' / '),
      type:     p.PaymentType || 'Purchase'
    });
  });

  // Sort newest first
  results.sort(function(a, b) { return b.date.localeCompare(a.date); });
  return results;
}

/**
 * Returns true if the payee, memo, or any account name matches a tax keyword.
 */
function isTaxTransaction(payee, memo, accountNames) {
  var payeeLc = (payee || '').toLowerCase();
  var memoLc  = (memo  || '').toLowerCase();

  var payeeMatch = TAX_PAYEE_KEYWORDS.some(function(kw) {
    return payeeLc.indexOf(kw) >= 0 || memoLc.indexOf(kw) >= 0;
  });
  if (payeeMatch) return true;

  var acctMatch = (accountNames || []).some(function(n) {
    var lc = (n || '').toLowerCase();
    return TAX_ACCOUNT_KEYWORDS.some(function(kw) { return lc.indexOf(kw) >= 0; });
  });
  return acctMatch;
}

/**
 * Overwrites the "Tax Payments" sheet with the given list of payments.
 * Always replaces all data rows (we want the latest picture, not history).
 */
function writeTaxPaymentsToSheet(payments) {
  var ss    = getTargetSpreadsheet();
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

  // Clear everything except column headers
  sheet.clear();

  var headers = ['Date', 'Payee', 'Amount', 'Memo', 'Category', 'Type'];
  var header  = sheet.getRange(1, 1, 1, headers.length);
  header.setValues([headers]);
  header.setFontWeight('bold');
  header.setBackground('#f5f5f7');
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
// QUICKBOOKS API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Queries QuickBooks Online for all active Bank accounts and returns their
 * current balances.
 *
 * @returns {Array<{name: string, balance: number, accountType: string, subType: string}>}
 */
function getQBOAccounts() {
  var service = getQBOService();

  if (!service.hasAccess()) {
    throw new Error(
      'Not authorized. Run authorize() first, then re-authorize in your browser.'
    );
  }

  var props   = PropertiesService.getScriptProperties();
  var env     = props.getProperty('QBO_ENVIRONMENT') || 'production';
  var realmId = (props.getProperty('QBO_REALM_ID') || '').replace(/\s+/g, '');

  if (!realmId) {
    throw new Error('Missing QBO_REALM_ID in Script Properties. See SETUP.md.');
  }

  var baseUrl = (env === 'sandbox')
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

  // Query all active Bank accounts
  var query = "SELECT * FROM Account WHERE AccountType = 'Bank' AND Active = true";
  var url   = baseUrl + '/v3/company/' + realmId +
              '/query?query=' + encodeURIComponent(query) + '&minorversion=65';

  var options = {
    method:            'get',
    headers: {
      Authorization: 'Bearer ' + service.getAccessToken(),
      Accept:        'application/json'
    },
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code     = response.getResponseCode();

  if (code === 401) {
    // Token might be expired — the OAuth2 library should auto-refresh,
    // but if this happens log a clear message
    throw new Error(
      'QuickBooks returned 401 Unauthorized. Try running resetAuth() and re-authorizing.'
    );
  }

  if (code !== 200) {
    throw new Error('QBO API error ' + code + ': ' + response.getContentText());
  }

  var data     = JSON.parse(response.getContentText());
  var rawAccts = (data.QueryResponse && data.QueryResponse.Account) || [];

  return rawAccts.map(function(a) {
    return {
      name:        a.Name            || 'Unknown Account',
      balance:     a.CurrentBalance  || 0,
      accountType: a.AccountType     || 'Bank',
      subType:     a.AccountSubType  || ''
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE SHEET WRITER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Appends one row per account to the "Balances" sheet.
 * Creates the sheet with headers if it doesn't exist yet.
 *
 * @param {Array<{name: string, balance: number, accountType: string, subType: string}>} accounts
 */
function writeToSheet(accounts) {
  var ss    = getTargetSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  // Create the sheet with headers if this is the first run
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    var headerRange = sheet.getRange(1, 1, 1, 4);
    headerRange.setValues([['Date', 'Account Name', 'Balance', 'Account Type']]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f5f5f7');
    sheet.setFrozenRows(1);

    // Set column widths
    sheet.setColumnWidth(1, 110);
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(3, 110);
    sheet.setColumnWidth(4, 120);

    Logger.log('Created new "' + SHEET_NAME + '" sheet with headers.');
  }

  var dateStr = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  // Append one row per account
  accounts.forEach(function(a) {
    sheet.appendRow([dateStr, a.name, a.balance, a.accountType]);
  });

  // Format the Balance column as currency (column C = column 3)
  var lastRow   = sheet.getLastRow();
  var firstData = 2; // row 1 is headers
  if (lastRow >= firstData) {
    sheet.getRange(firstData, 3, lastRow - firstData + 1, 1)
         .setNumberFormat('$#,##0.00');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER SETUP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates two time-based triggers: one on the 10th and one on the 25th of
 * each month at 8 AM (in the script timezone).
 *
 * Safe to call multiple times — removes any existing fetchAndSaveBalances
 * triggers before creating new ones.
 *
 * HOW TO USE: Select "setupTriggers" and click Run (▶) in the Apps Script editor.
 */
function setupTriggers() {
  // Remove any existing triggers for fetchAll AND legacy fetchAndSaveBalances
  ScriptApp.getProjectTriggers()
    .filter(function(t) {
      var fn = t.getHandlerFunction();
      return fn === 'fetchAll' || fn === 'fetchAndSaveBalances';
    })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  // 10th of every month at 8 AM — runs balances + tax payments
  ScriptApp.newTrigger('fetchAll')
    .timeBased()
    .onMonthDay(10)
    .atHour(8)
    .create();

  // 25th of every month at 8 AM
  ScriptApp.newTrigger('fetchAll')
    .timeBased()
    .onMonthDay(25)
    .atHour(8)
    .create();

  Logger.log('✓ Two triggers created: 10th and 25th of each month at 8 AM.');
  Logger.log('  Both triggers call fetchAll() which runs balances + tax payments.');
  Logger.log('  Go to the Triggers panel (clock icon) to confirm.');
}

// ─────────────────────────────────────────────────────────────────────────────
// RESET / TROUBLESHOOTING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clears stored OAuth2 tokens and removes all fetchAndSaveBalances triggers.
 * Run this if you need to re-authorize (e.g., after changing credentials).
 * After running this, run authorize() again and repeat the auth flow.
 */
function resetAuth() {
  getQBOService().reset();

  // Also clear all triggers so they can be re-created cleanly
  ScriptApp.getProjectTriggers()
    .filter(function(t) {
      var fn = t.getHandlerFunction();
      return fn === 'fetchAll' || fn === 'fetchAndSaveBalances' || fn === 'fetchAndSaveTaxPayments';
    })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  Logger.log('✓ Auth tokens cleared and triggers removed.');
  Logger.log('  Run authorize() to start a fresh authorization.');
}

/**
 * Utility: check current authorization status.
 * Run this if you are unsure whether QBO is connected.
 */
function checkStatus() {
  var service = getQBOService();
  var props   = PropertiesService.getScriptProperties();

  Logger.log('=== QuickBooks Sync Status ===');
  Logger.log('Authorized: ' + service.hasAccess());
  Logger.log('Environment: ' + (props.getProperty('QBO_ENVIRONMENT') || 'not set'));
  Logger.log('Realm ID: ' + (props.getProperty('QBO_REALM_ID') || 'not set'));
  Logger.log('Client ID: ' + (props.getProperty('QBO_CLIENT_ID') ? '✓ set' : '✗ MISSING'));
  Logger.log('Client Secret: ' + (props.getProperty('QBO_CLIENT_SECRET') ? '✓ set' : '✗ MISSING'));
  Logger.log('Sheet ID: ' + (props.getProperty('QBO_SHEET_ID') || '✗ MISSING'));

  var triggers = ScriptApp.getProjectTriggers()
    .filter(function(t) {
      var fn = t.getHandlerFunction();
      return fn === 'fetchAll' || fn === 'fetchAndSaveBalances';
    });
  Logger.log('Active triggers: ' + triggers.length + ' (should be 2 after setupTriggers())');
}
