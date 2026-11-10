# Phase B — Build Plan (Life, Disability & Marketplace Health go live)

**Status: not started — gated.** Do NOT build any step below until JoJo confirms, for that line, that the **license, (for health) CMS registration, and at least one carrier appointment** are active. Phase A (announce + waitlist) is already live.

Each item below is one small PR JoJo can merge on its own, in roughly this order. A line can launch before the others — **Life and Disability can go first** (simpler, no CMS), while **Health** waits on CMS registration. If ACA open enrollment (closes **Jan 15, 2027**) is the priority, push Health as soon as its gates clear.

---

## Decisions JoJo makes (gather these during the licensing wait)

1. **Marketplace consent wording** — the exact text of the consent checkbox a consumer ticks before we help with a HealthCare.gov application. Must match CMS's current requirement; JoJo approves the final wording. *(Blocks PR B2.)*
2. **Consent retention period** — confirm the current CMS rule and how many years the record must be kept. *(Blocks PR B2's storage design.)*
3. **Carriers per line** — which life, disability, and ACA carriers (or FMO) we're appointed with, plus logins, so they go in the tracker. *(Blocks PR B4.)*
4. **Enrollment platform** — e.g. HealthSherpa: does the health flow hand the client off to it, or just collect the lead + consent and JoJo works it there? *(Shapes PR B2.)*
5. **Life/disability pages on launch** — keep the waitlist too, or switch fully to "Request a quote"?
6. **Go/no-go per line** — confirm which line is cleared to launch, and when.

---

## PR sequence

### PR B-1 — Life & Disability go live in the quote form  *(gate: life/disability license + ≥1 carrier)*
- Remove the "Soon" tags from the Life and Disability tiles, nav, menu and footer; make the tiles normal "Learn more" tiles.
- Add **Life** and **Disability** to the quote form's "What do you need covered?" select.
- Conditional fields (extend the existing `covChange()` toggle, like address/vehicle today):
  - **Life:** age, tobacco use (yes/no), coverage amount wanted, occupation.
  - **Disability:** age, tobacco use (yes/no), monthly income to protect, occupation.
- **No medical details collected online** — the agent asks those by phone. No guarantees, no "cheapest."
- These post through the existing `submit-quote` endpoint (no consent storage needed for life/disability). Replace each page's waitlist with a real quote CTA (or keep both — see decision #5).

### PR B-2 — Health (Marketplace) go live  *(gate: CMS registration + Marketplace training + ACA appointment/FMO + enrollment platform)*
- Remove the "Soon" tag; add **Health — Marketplace** to the quote select.
- Health fields: household size, ZIP + county, estimated yearly household income (for the tax credit), ages of people needing coverage, current coverage.
- **Consent checkbox** with JoJo-approved wording (decision #1), required to submit.
- **New Supabase table `marketplace_consents`** — append-only, no delete, RLS service-role only. Stores: who (name/email/phone), what (the exact consent text + a version tag), when (timestamp), from where (IP + user agent), and a link to the quote row. Kept for the CMS retention period (decision #2).
- A dedicated function (or a guarded branch of `submit-quote`) writes the consent record separately and **does not log form contents** (health data is sensitive).
- If we hand off to an enrollment platform (decision #4), add that link/flow after consent is captured.

### PR B-3 — Carrier system: add the new carriers  *(gate: appointments; needs decision #3)*
- Add the life, disability and ACA carriers (or the FMO) to the carrier tracker (`supabase/carriers-*.sql` data / live insert) with product lines like `Life (Term)`, `Life (Permanent)`, `Disability`, `Health (Marketplace)`.
- The AI analyzer already handles multiple line types (since the commercial change), so this is mainly new records; confirm `carrier-match.js` wording covers life/health and that `google/carriers-sync.gs` syncs them unchanged.

### PR B-4 — Admin: filter + waitlist view
- `public/admin.html`: filter quote requests by the new coverage types, and a **Waitlist view** (source = `waitlist`) so JoJo can call everyone who signed up the day a line launches.

### PR B-5 — "For real estate agents" section
- A page/section explaining life, disability and health for 1099 agents — this is where Elite Living's Benefits page links once it's live. **No discounts or rebates in any copy** (Texas rebating rule; buying never affects an agent's split).

### PR B-6 — Blog topics on
- Turn on life/health topics in the weekly AI post: term vs. whole life for new homeowners, disability insurance for self-employed Texans, how ACA tax credits work. **Keep the existing compliance guardrails** (no guarantees, no "cheapest," no medical or tax advice).

---

## Guardrails carried from the handoff
- Never handle credentials — new API keys get a placeholder in `.env.example`; JoJo sets the real value in Netlify.
- Never put client data (especially health data) in tests, commits, or logs.
- White Glove Property Management stays separate; don't connect to it.
- Can link to Elite Living, but don't share databases, keys, or inbound email with Back Boss.
- One small PR per step, in plain words: what JoJo will notice, how it was tested, what else it could affect.
- Check TDI and CMS pages for current rules before writing compliance copy; leave anything uncertain for JoJo.

## Phase C (later — don't build)
- Retirement plans / IRAs need securities licenses (Series 6/63 or 7/66) or a licensed investment partner.
- Fixed/indexed annuities come under the life license after the Texas annuity suitability training.
