/**
 * Voss Risk Advisors — Carrier Sheet two-way sync (Google Apps Script)
 * ============================================================================
 * Paste this into the Apps Script editor bound to your carrier Google Sheet
 * (Extensions -> Apps Script). It provides BOTH directions of the sync:
 *
 *   Voss  -> Google : doPost() receives carrier rows from the Voss admin portal
 *                     and upserts them into the sheet by slug (or name).
 *   Google -> Voss  : onEdit() fires when YOU edit a row in the sheet and posts
 *                     that row back to the Voss webhook.
 *
 * Because onEdit only fires on human edits (not on the setValues() that
 * doPost uses), the two directions never loop.
 *
 * SETUP — see google/README.md for the full walkthrough. In short:
 *   1. Set SECRET below to a strong random string.
 *   2. Set VOSS_WEBHOOK to your site's webhook URL.
 *   3. Deploy -> New deployment -> Web app -> Execute as: Me,
 *      Who has access: Anyone. Copy the /exec URL.
 *   4. In Netlify env: CARRIER_SYNC_SECRET = SECRET (same value),
 *      GOOGLE_SHEET_WEBAPP_URL = the /exec URL.
 *   5. Run setupTrigger() once (grant permissions) to install the onEdit trigger.
 * ============================================================================
 */

// ---- CONFIG (edit these two) ----
var SECRET = 'PUT-THE-SAME-SECRET-AS-NETLIFY-HERE';
var VOSS_WEBHOOK = 'https://www.vossriskadvisors.com/.netlify/functions/carriers-webhook';

// Columns written to the sheet, in order. Must match the Voss field names.
var COLS = [
  'id','name','slug','status','product_lines','states','best_for','website',
  'login_url','login_username','login_password','portal_notes',
  'appetite','requirements','do_not_submit','helpful_hints','sort_order','updated_at'
];
var SHEET_NAME = 'Carriers';

// ------------------------------------------------------------------
// Voss -> Google : receive a push from the admin portal.
// ------------------------------------------------------------------
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'bad json' }); }

  if (!body || body.secret !== SECRET) return json_({ ok: false, error: 'bad secret' });
  var rows = body.rows || [];

  var sheet = ensureSheet_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = sheet.getDataRange().getValues();
    var header = data[0];
    var slugCol = header.indexOf('slug');
    // Build slug -> rowIndex map (1-based sheet rows).
    var index = {};
    for (var r = 1; r < data.length; r++) {
      var s = data[r][slugCol];
      if (s) index[String(s)] = r + 1;
    }
    for (var i = 0; i < rows.length; i++) {
      var rowObj = rows[i];
      var values = COLS.map(function (c) { return rowObj[c] == null ? '' : rowObj[c]; });
      var slug = String(rowObj.slug || '');
      if (slug && index[slug]) {
        sheet.getRange(index[slug], 1, 1, COLS.length).setValues([values]);
      } else {
        sheet.appendRow(values);
        if (slug) index[slug] = sheet.getLastRow();
      }
    }
    return json_({ ok: true, count: rows.length });
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// Google -> Voss : an installable trigger calls this on every edit.
// ------------------------------------------------------------------
function onEditSync(e) {
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== SHEET_NAME) return;
  var row = e.range.getRow();
  if (row === 1) return; // header

  var header = sheet.getRange(1, 1, 1, COLS.length).getValues()[0];
  var values = sheet.getRange(row, 1, 1, COLS.length).getValues()[0];
  var obj = {};
  for (var i = 0; i < header.length; i++) {
    var key = header[i];
    if (key) obj[key] = values[i];
  }
  if (!obj.name && !obj.slug && !obj.id) return; // empty row

  var payload = { secret: SECRET, source: 'google', rows: [obj] };
  try {
    UrlFetchApp.fetch(VOSS_WEBHOOK, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    // Swallow — a transient network error shouldn't break editing.
  }
}

// ------------------------------------------------------------------
// One-time setup helpers.
// ------------------------------------------------------------------
function ensureSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COLS.length).setValues([COLS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLS.length).setFontWeight('bold');
  }
  return sheet;
}

// Run this ONCE from the editor to install the onEdit trigger + create headers.
function setupTrigger() {
  ensureSheet_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Remove any existing onEditSync triggers to avoid duplicates.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditSync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('onEditSync').forSpreadsheet(ss).onEdit().create();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
