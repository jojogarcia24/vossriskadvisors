# Life, Disability & Marketplace (ACA) Health — Launch Checklist

Tracking doc for adding three new lines to Voss Risk Advisors: **Life**, **Disability income**, and **Marketplace (ACA) health**.

**Rule:** don't turn on quoting or applications for a line until its license and appointments are active. Until then the website only announces the line and collects a waitlist (Phase A, already built).

---

## JoJo's to-do (licensing, registration, carriers)

- [ ] **Texas license** — General Lines: Life, Accident & Health (Texas Dept. of Insurance). *In progress — expected within a few weeks.*
- [ ] **Agency license line** — confirm with TDI whether the agency license itself needs the Life/Health line added (separate from the individual license).
- [ ] **Federal Marketplace registration** (Texas uses HealthCare.gov):
  - [ ] Create a CMS Enterprise Portal account
  - [ ] Complete the annual Marketplace agent/broker training + agreements (CMS learning system — free, repeats every plan year)
  - [ ] National Producer Number (NPN) on file
- [ ] **Carrier appointments:**
  - [ ] Marketplace health — ACA carriers in Dallas-area counties (e.g. BCBS of Texas, Ambetter, Oscar, UnitedHealthcare — check each; some have paused new ACA agents). Many agents appoint through an FMO rather than one-by-one.
  - [ ] Life — term & permanent life carriers
  - [ ] Disability — individual DI carriers that write self-employed / 1099 people (real estate agents especially)
- [ ] **Enrollment platform** — an agent enrollment tool (e.g. HealthSherpa) connected to the CMS registration
- [ ] **E&O insurance** — confirm the agency's errors & omissions policy covers life and health once those lines are added
- [ ] **Annuity training** — Texas annuity suitability course (only needed before selling annuities — a later phase)

## Standing rules JoJo set

- **No discounts or rebates** for Elite Living agents — they buy at the same price as anyone (Texas forbids rebating commissions). Buying from us never affects an agent's split.
- **Consent records** — CMS requires documenting the consumer's consent before helping with a Marketplace application, and keeping the record for the required retention period. Confirm the current rule + retention period on CMS's agent/broker pages before Phase B builds the consent storage.

## Key dates

- **Marketplace open enrollment (2027 coverage):** Nov 1, 2026 – Jan 15, 2027. If licensing + registration + appointments are active in time, we can enroll people this season; otherwise it's a 2027 launch.

---

## Build status

### Phase A — live now (announce + waitlist only)
- [x] Life, Disability, Health "Coming soon" pages (no quote form)
- [x] Join-the-waitlist form on each page → stored as `life_waitlist` / `disability_waitlist` / `health_waitlist` in `quote_requests`, agency emailed
- [x] Added to coverage grid, nav dropdown, mobile menu, and footer (labeled "Coming soon")
- [x] FAQ entry ("Do you offer life or health insurance?")
- [x] Pages added to `sitemap.xml`
- [ ] Blog: life/health topics stay OFF until Phase B (weekly post keeps its P&C compliance guardrails)

### Phase B — when JoJo confirms license + CMS registration + appointments are active
- [ ] Remove "Coming soon"; add Life / Disability / Health to the quote form's coverage options
- [ ] Health quote fields (household size, ZIP/county, est. income for the tax credit, ages, current coverage) + **consent checkbox** with JoJo-approved wording, stored in its own no-delete table for the CMS retention period
- [ ] Life/disability quote fields (age, tobacco, coverage amount / monthly income to protect, occupation) — no medical details on the website
- [ ] Add the new carriers to the carrier system (`supabase/carriers-*.sql`, `carrier-match.js`, `google/carriers-sync.gs`) with their lines
- [ ] Admin: filter quote requests by the new lines; show waitlist signups
- [ ] "For real estate agents" section (no discounts in any copy) — Elite Living's Benefits page links here
- [ ] Blog topics: term vs. whole life, DI for self-employed Texans, how ACA tax credits work (keep compliance guardrails)

### Phase C — later (needs a partner or more licenses — don't build yet)
- [ ] Retirement plans / IRAs — need securities licenses (Series 6/63 or 7/66) or a licensed investment partner
- [ ] Fixed / indexed annuities — under the life license after the Texas annuity training
