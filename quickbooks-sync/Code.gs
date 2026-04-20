// ═══════════════════════════════════════════════════════════════════════════
// QuickBooks Online → Google Sheet Sync
// Momentum Health Chiropractic — Profit First Dashboard
//
// SETUP REQUIRED — see SETUP.md for step-by-step instructions.
//
// OAuth2 library must be added before this script will work.
// Library Script ID: 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMBbjqp
//
// Script Properties required (Project Settings → Script Properties):
//   QBO_CLIENT_ID      — from developer.intuit.com
//   QBO_CLIENT_SECRET  — from developer.intuit.com
//   QBO_REALM_ID       — your QuickBooks Company ID
//   QBO_ENVIRONMENT    — "production" or "sandbox"
// ═══════════════════════════════════════════════════════════════════════════

var SHEET_NAME = 'Balances';

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
  var clientId     = props.getProperty('QBO_CLIENT_ID');
  var clientSecret = props.getProperty('QBO_CLIENT_SECRET');

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
      Authorization: 'Basic ' + Utilities.base64Encode(clientId + ':' + clientSecret)
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
  var realmId = props.getProperty('QBO_REALM_ID');

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
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
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
  // Remove any existing triggers for this function
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'fetchAndSaveBalances'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  // 10th of every month at 8 AM
  ScriptApp.newTrigger('fetchAndSaveBalances')
    .timeBased()
    .onMonthDay(10)
    .atHour(8)
    .create();

  // 25th of every month at 8 AM
  ScriptApp.newTrigger('fetchAndSaveBalances')
    .timeBased()
    .onMonthDay(25)
    .atHour(8)
    .create();

  Logger.log('✓ Two triggers created: 10th and 25th of each month at 8 AM.');
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
    .filter(function(t) { return t.getHandlerFunction() === 'fetchAndSaveBalances'; })
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

  var triggers = ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'fetchAndSaveBalances'; });
  Logger.log('Active triggers: ' + triggers.length + ' (should be 2 after setupTriggers())');
}
