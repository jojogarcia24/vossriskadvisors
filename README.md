# Voss Risk Advisors — Website + Lead System

A complete, deploy-ready package for the Voss Risk Advisors site:

- **Static site** (`public/index.html`) — the full multi-page site
- **Quote form → Supabase + Resend** — leads are stored in a database and emailed to you, with an auto-confirmation to the client
- **Weekly AI blog post** — a scheduled Netlify function drafts one Texas-focused article per week (with compliance guardrails)
- **4 starter articles** in `content/articles/`

Stack: **Netlify** (hosting + serverless functions) · **Supabase** (database) · **Resend** (email) · **Anthropic API** (weekly posts) · **GitHub** (source + auto-deploy).

---

## What you'll need (free tiers are fine to start)

- A **GitHub** account
- A **Netlify** account (connect it to GitHub)
- A **Supabase** project
- A **Resend** account **with your domain verified** (this is what keeps client emails out of spam)
- An **Anthropic API key** (only for the weekly blog generator)

---

## Step-by-step setup

### 1. Put this in a GitHub repo
Create a new repo and push these files to it. (Or drag the folder into GitHub's web uploader.)

### 2. Create the Supabase database
1. In Supabase, create a project.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and run it.
   This creates the `quote_requests` and `blog_posts` tables, sets security rules, and seeds your 4 articles.
3. In **Project Settings → API**, copy your **Project URL**, **anon key**, and **service_role key** (keep the service_role secret).

### 3. Set up Resend (email)
1. Create a Resend account and **add + verify your domain** (`vossriskadvisors.com`) by adding the DNS records they give you. This step is what makes emails deliver reliably.
2. Create an **API key**.
3. Pick your sending address, e.g. `quotes@vossriskadvisors.com`.

### 4. Deploy to Netlify
1. In Netlify, **Add new site → Import from GitHub**, pick your repo.
2. Build settings: publish directory `public`, functions directory `netlify/functions` (already set in `netlify.toml`).
3. Add **Environment variables** (Site settings → Environment) using `.env.example` as your checklist:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `SUPABASE_ANON_KEY`
   - `RESEND_API_KEY`, `FROM_EMAIL`, `AGENCY_EMAIL`
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `REVIEW_MODE`
4. Deploy. Your site is live at the Netlify URL; point your domain at it when ready.

### 5. Test the quote form
Submit a quote on the live site. You should see:
- a new row in Supabase `quote_requests`,
- a lead-alert email at `AGENCY_EMAIL`,
- a confirmation email at the address you entered.

### 6. Turn on the weekly blog
The schedule is already set in `netlify.toml` (Mondays, 9am CT). Control publishing with `REVIEW_MODE`:
- `draft` (recommended) — each AI post is saved as a **draft** for you to read and approve before it shows on the site.
- `auto` — posts publish themselves immediately (hands-off).

> **Recommendation:** start in `draft` for a few weeks. Read what it produces, confirm the tone and compliance are right, then switch to `auto` once you trust it. AI-written insurance content should be reviewed — the guardrails are strong, but you're the licensed professional whose name is on it.

---

## How the weekly guardrails work
The generator's instructions forbid specific rates, savings guarantees, legal advice, and any commercial-lines content (you're personal-lines only). Every post ends with a disclaimer, and a keyword blocklist forces anything suspicious into `draft` for review. Topics rotate across your licensed lines (home, auto, flood, landlord).

---

## ⚠️ Before you go live — important
- **Legal pages** (Privacy, Terms, Accessibility) are included as solid templates, but **have an attorney review them** — Texas insurance advertising and privacy have specific requirements, and this isn't legal advice.
- **Carrier logos and "file a claim / make a payment" links** — confirm each carrier's rules for displaying their brand once you're appointed, and drop in the real portal URLs.
- **Only advertise what you can quote.** The site currently shows Home, Auto, Landlord/Rental, and Flood. Add Commercial only when your General Lines license is in hand.
- The **"AI Chief of Staff" logo** should eventually be swapped for a proper "Risk Advisors" lockup.

---

## File map
```
public/index.html            The website (single self-contained file)
netlify/functions/
  submit-quote.js            Quote form -> Supabase + Resend emails
  weekly-post.js             Scheduled weekly AI article -> Supabase
supabase/schema.sql          Database tables, security, seed articles
content/articles/*.md        The 4 starter articles (source of truth)
netlify.toml                 Hosting + weekly schedule config
.env.example                 Environment variable checklist
```
