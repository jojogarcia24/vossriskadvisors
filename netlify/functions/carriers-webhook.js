// netlify/functions/carriers-webhook.js
// Receives edits FROM the Google Sheet (via the bound Apps Script's onEdit
// trigger) and writes them into Supabase. This is the "Google -> Voss" half of
// the two-way sync. The "Voss -> Google" half lives in carriers-admin.js
// (pushToGoogle).
//
// Loop-safety: the Apps Script's onEdit only fires on HUMAN edits in the sheet,
// not on the programmatic setValues() the Voss push uses — so pushing to Google
// does not bounce back here.
//
// Auth: the request must carry the shared CARRIER_SYNC_SECRET.
//
// Body: { secret, rows: [ { slug|name, <field>: value, ... }, ... ] }
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE, CARRIER_SYNC_SECRET

const { ARRAY_FIELDS, VALID_STATUS, json, sbSelect, sbWrite, slugify } = require("./lib/carriers");

// Fields the sheet is allowed to write back (everything editable; not id/updated_at).
const WRITABLE = [
  "name", "status", "product_lines", "states", "best_for", "website",
  "login_url", "login_username", "login_password", "portal_notes",
  "appetite", "requirements", "do_not_submit", "helpful_hints", "sort_order",
];

const toArray = (v) =>
  Array.isArray(v) ? v : String(v == null ? "" : v).split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const secret = process.env.CARRIER_SYNC_SECRET;
  if (!secret) return json(503, { error: "Sync not configured." });

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  if (data.secret !== secret) return json(401, { error: "Bad secret." });

  const incoming = Array.isArray(data.rows) ? data.rows : (data.row ? [data.row] : []);
  if (incoming.length === 0) return json(200, { updated: 0 });

  let updated = 0, created = 0;
  const results = [];
  try {
    for (const raw of incoming) {
      const row = {};
      for (const f of WRITABLE) {
        if (!(f in raw)) continue;
        if (ARRAY_FIELDS.includes(f)) row[f] = toArray(raw[f]);
        else if (f === "sort_order") row[f] = Number(raw[f]) || 100;
        else if (f === "status") { if (VALID_STATUS.includes(raw[f])) row[f] = raw[f]; }
        else row[f] = raw[f] === "" ? null : raw[f];
      }
      if (Object.keys(row).length === 0) continue;

      // Match by id, then slug, then name.
      let existing = null;
      if (raw.id) {
        const r = await sbSelect(`carriers?id=eq.${encodeURIComponent(raw.id)}&select=id`);
        existing = r && r[0];
      }
      if (!existing) {
        const slug = slugify(raw.slug || raw.name || row.name || "");
        if (slug) {
          const r = await sbSelect(`carriers?slug=eq.${encodeURIComponent(slug)}&select=id`);
          existing = r && r[0];
          if (!existing && (row.name || raw.name)) row.slug = slug;
        }
      }

      if (existing) {
        await sbWrite("PATCH", `carriers?id=eq.${encodeURIComponent(existing.id)}`, row);
        updated++;
        results.push({ id: existing.id, action: "updated" });
      } else if (row.name) {
        if (!row.slug) row.slug = slugify(row.name);
        const saved = await sbWrite("POST", "carriers", row);
        created++;
        results.push({ id: Array.isArray(saved) ? saved[0] && saved[0].id : null, action: "created" });
      }
    }
    return json(200, { updated, created, results });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
};
