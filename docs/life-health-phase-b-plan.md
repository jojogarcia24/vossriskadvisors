# Phase B — Build Plan (Life, Disability & Marketplace Health go live)

**Status: not started — gated.** Do NOT build any step below until JoJo confirms, for that line, that the **license, (for health) CMS registration, and at least one carrier appointment** are active. Phase A (announce + waitlist) is already live.

Each item below is one small PR JoJo can merge on its own, in roughly this order. A line can launch before the others — **Life and Disability can go first** (simpler, no CMS), while **Health** waits on CMS registration. If ACA open enrollment (closes **Jan 15, 2027**) is the priority, push Health as soon as its gates clear.

---

## Operating model — how selling ACA marketplace health actually works

The "find the tax credit you qualify for" opportunity = **ACA marketplace (HealthCare.gov) plans**, which is what most 1099 agents buy. In Texas the license is **General Lines – Life, Accident & Health**, and it covers life, health and disability together. The commission opportunity: once licensed + marketplace-registered + appointed, Voss's insurance division can sell agents (and the public) their actual health plans and earn the carrier commissions. What it takes:

1. **CMS / HealthCare.gov agent registration** — Texas uses the federally-facilitated marketplace. Each plan year: a CMS Enterprise Portal account, the annual Marketplace agent/broker training + exams, signed FFM agreements, and your NPN on file. This is what lets you be credited (and paid) for enrollments.
2. **Carrier appointments = the commission source** — registration lets you *use* HealthCare.gov; the commissions come from the **carriers** (BCBS of TX, Ambetter/Superior, Oscar, UnitedHealthcare, Aetna, Molina — whoever is on-exchange + appointing in our DFW counties). Most agents do this through an **FMO/GA** (field marketing org / general agency) rather than one-by-one — the FMO handles appointments, training support, and often overrides. **This is the key practical step for "earn commissions."**
3. **Enrollment platform** — HealthSherpa (EDE). Quote, calculate the premium tax credit (APTC), and enroll without bouncing clients to HealthCare.gov. Free for agents; ties to CMS registration + carrier appointments so enrollments credit to you (agent of record).
4. **Concierge pairing (value-add)** — a healthcare-concierge/advocacy partner (e.g. TouchCare — which Compass uses — Health Advocate, Rightway) handles doctor-finding, bills, and EOB help. Refer or white-label so agents get it bundled; some have agent/affinity programs. This differentiates us from buying direct.
5. **How you get paid** — ACA commissions are typically per-member-per-month (or a %), paid by the carrier while the member keeps the plan and names you agent of record. Renewals auto-credit each year you stay AOR, so the book compounds.

Why 1099 real-estate agents are the ideal target: no employer plan, variable income (often subsidy-eligible). Enroll during open enrollment (Nov 1 – Jan 15) or a Special Enrollment Period, stay AOR, earn renewals. *(Research reminder set for 2026-12-01.)*

## Decisions JoJo makes (gather these during the licensing wait)

Status as of 2026-11-10: 1, 2, 4, 5 decided; 3 pending (reminder set for 2026-12-01); 6 is per-launch.

1. **Marketplace consent wording** — ✅ **Approved in principle** (2026-11-10). Proposed DRAFT below; the exact text must still be checked against CMS's current agent/broker guidance right before PR B-2 ships, and against whatever HealthSherpa captures, so we don't conflict or duplicate.
   > **Draft consent checkbox text:** "I authorize Voss Risk Advisors and its licensed agent to help me apply for and enroll in a Health Insurance Marketplace plan, including reviewing my eligibility for financial assistance such as premium tax credits. I understand my information will be kept confidential and used only to assist with my Marketplace enrollment, that my consent is voluntary and not a condition of buying anything, and that I may revoke it at any time by contacting Voss Risk Advisors. The information I provide is accurate to the best of my knowledge."

   Store with the record: the exact text shown, a version tag, the consumer's name, and the timestamp. Note: HealthSherpa captures the **formal CMS application consent** during its own enrollment flow; our site's consent is the initial **consent to contact and assist** that lets us help and reach out.
2. **Consent retention period** — ✅ **5 years** (JoJo, 2026-11-10). **Flag:** CMS may require a longer minimum (various CMS documentation-retention rules have been cited at up to ~10 years). Before PR B-2 ships, confirm CMS's current minimum and retain for **the greater of 5 years or that minimum** — never less than CMS requires.
3. **Carriers per line** — ⏳ **Pending.** Not known yet; reminder set for **2026-12-01** to collect which life, disability, and ACA carriers (or FMO) we're appointed with, plus logins. *(Blocks PR B-3.)*
4. **Enrollment platform** — ✅ **Collect on our site, then enroll in HealthSherpa** (JoJo deferred to recommendation, 2026-11-10). Our site collects the lead + the contact/assist consent; the actual plan comparison, subsidy calculation, and formal application/enrollment happen in **HealthSherpa** (free for agents, ties to CMS registration). We do **not** rebuild a quoting/enrollment engine. Rationale: HealthSherpa already handles the compliance-heavy enrollment + its own CMS consent; duplicating it on-site adds risk for no gain.
5. **Life/disability pages on launch** — ✅ **Keep the waitlist** (JoJo, 2026-11-10). On launch, the Life and Disability pages keep their waitlist form **and** add a "Request a quote" path; the waitlist stays for anyone not ready to quote.
6. **Go/no-go per line** — confirm which line is cleared to launch, and when (per-launch, at build time).

---

## PR sequence

### PR B-1 — Life & Disability go live in the quote form  *(gate: life/disability license + ≥1 carrier)*
- Remove the "Soon" tags from the Life and Disability tiles, nav, menu and footer; make the tiles normal "Learn more" tiles.
- Add **Life** and **Disability** to the quote form's "What do you need covered?" select.
- Conditional fields (extend the existing `covChange()` toggle, like address/vehicle today):
  - **Life:** age, tobacco use (yes/no), coverage amount wanted, occupation.
  - **Disability:** age, tobacco use (yes/no), monthly income to protect, occupation.
- **No medical details collected online** — the agent asks those by phone. No guarantees, no "cheapest."
- These post through the existing `submit-quote` endpoint (no consent storage needed for life/disability). **Keep the waitlist form on each page** and add a "Request a quote" path alongside it (decision #5).

### PR B-2 — Health (Marketplace) go live  *(gate: CMS registration + Marketplace training + ACA appointment/FMO + enrollment platform)*
- Remove the "Soon" tag; add **Health — Marketplace** to the quote select.
- Health fields: household size, ZIP + county, estimated yearly household income (for the tax credit), ages of people needing coverage, current coverage.
- **Consent checkbox** with JoJo-approved wording (decision #1), required to submit.
- **New Supabase table `marketplace_consents`** — append-only, no delete, RLS service-role only. Stores: who (name/email/phone), what (the exact consent text + a version tag), when (timestamp), from where (IP + user agent), and a link to the quote row. Kept for the CMS retention period (decision #2).
- A dedicated function (or a guarded branch of `submit-quote`) writes the consent record separately and **does not log form contents** (health data is sensitive). Retain per decision #2 (5 years or CMS's current minimum, whichever is greater).
- **Hand off to HealthSherpa** (decision #4): after the lead + consent are captured on our site, the client is routed to / worked in HealthSherpa for plan comparison, subsidy calc, and formal enrollment (which captures its own CMS application consent). We do not build quoting/enrollment on-site.

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
