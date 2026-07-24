# Two-way Google Sheets sync for the Carrier tracker

This connects your **Carrier Appointments** admin portal to a Google Sheet so
that a change in *either* place updates the other — edit a login or a password
in Voss and it appears in Google; edit it in Google and it flows back to Voss.

You do **not** need a Google service account or any JSON key. Everything runs
through one small Apps Script that lives inside your sheet.

> Sync is **optional**. If you skip this, the admin portal and the one-click
> **Export CSV** button still work perfectly — you just won't have the live
> Google mirror.

---

## What you'll set up

- A Google Sheet with a tab named **Carriers**
- An **Apps Script** (the file `carriers-sync.gs`) bound to that sheet
- Two Netlify environment variables so Voss can talk to the sheet

---

## Step-by-step (about 5 minutes)

### 1. Create the sheet
1. Go to <https://sheets.new> and name it e.g. **"Voss Carrier Appointments"**.
2. Rename the first tab to **Carriers** (double-click the tab name).

### 2. Add the script
1. In the sheet: **Extensions → Apps Script**.
2. Delete whatever is there, paste the entire contents of
   [`carriers-sync.gs`](./carriers-sync.gs), and **Save**.
3. Near the top of the script, set the two config lines:
   - `SECRET` — make up a strong random string (e.g. a password-manager value).
   - `VOSS_WEBHOOK` — leave as
     `https://www.vossriskadvisors.com/.netlify/functions/carriers-webhook`
     (change the domain only if your site lives elsewhere).

### 3. Install the trigger + headers
1. In the Apps Script toolbar, pick the function **`setupTrigger`** and click **Run**.
2. Google will ask you to authorize — approve it (it's your own script).
   This creates the **Carriers** header row and installs the "on edit" trigger
   that sends your edits back to Voss.

### 4. Deploy the Web App (this is the Voss → Google direction)
1. **Deploy → New deployment**.
2. Gear icon → **Web app**.
3. **Execute as: Me** · **Who has access: Anyone**.
4. **Deploy**, then **copy the Web app URL** — it ends in `/exec`.

### 5. Tell Netlify about it
In Netlify → **Site settings → Environment variables**, add:

| Variable | Value |
|---|---|
| `GOOGLE_SHEET_WEBAPP_URL` | the `/exec` URL from step 4 |
| `CARRIER_SYNC_SECRET` | the **same** `SECRET` string from step 2 |

Redeploy the site (or trigger a deploy) so the new variables take effect.

### 6. First fill of the sheet
Open the admin portal at **/admin**, sign in, and click **⟳ Sync to Google**.
All carriers are pushed into the sheet. From then on:

- Saving a carrier (or approving a Claude bulletin update) in Voss updates the
  matching row in Google automatically.
- Editing a cell in the Google sheet sends that row back to Voss.

---

## How the loop is prevented

`onEditSync` (Google → Voss) only fires on **human** edits in the sheet.
The Voss → Google push writes with `setValues()`, which does **not** trigger
`onEditSync`. So updates never bounce back and forth.

## Notes & tips

- **Match on `slug`.** Rows are matched by the `slug` column. Don't edit the
  `slug` or `id` columns by hand — change other columns freely.
- **Arrays** (`product_lines`, `states`) are stored as `A; B; C` text in the
  sheet. Keep that format when editing.
- **Status** must be one of `approved`, `pending`, `not_started`, `declined`.
- To add a brand-new carrier from the sheet, add a row with at least a `name`
  (leave `id`/`slug` blank — Voss will create it and fill them in on the next
  Voss → Google sync).
- If something looks off, click **⟳ Sync to Google** in the portal to re-push
  the source-of-truth values from Voss.
