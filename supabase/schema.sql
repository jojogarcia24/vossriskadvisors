-- ============================================================
-- Voss Risk Advisors — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- ============================================================

-- ---------- QUOTE REQUESTS ----------
create table if not exists public.quote_requests (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  first_name    text not null,
  last_name     text not null,
  email         text not null,
  phone         text,
  coverage_type text,
  address       text,
  message       text,
  source        text default 'website',
  status        text not null default 'new'   -- new | contacted | quoted | closed
);

-- ---------- BLOG POSTS ----------
create table if not exists public.blog_posts (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  slug          text unique not null,
  title         text not null,
  category      text,
  excerpt       text,
  body_md       text not null,
  read          text default '4 min read',
  status        text not null default 'draft', -- draft | published | discarded
  published_at  timestamptz,
  generated_by  text default 'human',          -- human | ai
  token         text                           -- approval token for AI drafts
);

-- ---------- ROW LEVEL SECURITY ----------
alter table public.quote_requests enable row level security;
alter table public.blog_posts     enable row level security;

-- Quote requests: NO public access. Only the service role (used by the
-- Netlify function) can insert/read. The anon key cannot touch this table.
drop policy if exists "no_public_quote_access" on public.quote_requests;
-- (No policy = no access for anon/authenticated. Service role bypasses RLS.)

-- Blog posts: anyone may READ published posts (so the site can display them).
drop policy if exists "public_read_published" on public.blog_posts;
create policy "public_read_published"
  on public.blog_posts for select
  using (status = 'published');

-- Writes to blog_posts happen only via the service role (weekly function).

-- ---------- NEWSLETTER SUBSCRIBERS ----------
create table if not exists public.newsletter_subscribers (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  email        text unique not null,
  source       text default 'website',
  token        text,                                 -- per-person unsubscribe token
  unsubscribed boolean not null default false
);
-- No public access: only the service role (Netlify functions) can read/write.
alter table public.newsletter_subscribers enable row level security;

-- ---------- NEWSLETTER ISSUES (approve-before-send) ----------
create table if not exists public.newsletters (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  subject         text not null,
  body_html       text not null,
  status          text not null default 'draft',     -- draft | sent | discarded
  token           text not null,
  sent_at         timestamptz,
  recipient_count int
);
alter table public.newsletters enable row level security;

-- ---------- SEED THE 4 STARTER ARTICLES ----------
-- (Full bodies live in /content/articles/*.md. These seed rows let the site
--  render them from the database on day one. Re-run safely: on conflict do nothing.)
insert into public.blog_posts (slug,title,category,excerpt,body_md,read,status,published_at,generated_by) values
('do-texas-homeowners-need-flood-insurance','Do Texas Homeowners Really Need Flood Insurance?','Flood','Most Texas flood damage happens outside high-risk zones — and a standard homeowners policy won''t cover a dime of it. Here''s what Dallas-area homeowners should know.','If you own a home in the Dallas–Fort Worth area, there''s a good chance you''ve assumed flood insurance is something only for people who live near the coast or right on a river. It''s one of the most common — and most expensive — misunderstandings in Texas home insurance.

## Your homeowners policy does not cover flood

This surprises a lot of people, so it''s worth saying plainly: a standard homeowners insurance policy excludes flood damage. Wind-driven rain that comes through a damaged roof may be covered, but rising water — the kind you get from a flash flood, an overwhelmed storm drain, or a creek that jumps its banks — is not. To be protected against that, you need a separate flood policy.

## Texas floods where you least expect it

North Texas is flash-flood country. Our mix of clay soil, rapid development, and intense spring and fall storms means water often has nowhere to go but sideways. According to federal flood data, a large share of flood claims come from properties outside the high-risk zones shown on FEMA maps — areas where homeowners were never required to carry coverage and assumed they didn''t need it.

In other words: the fact that your mortgage lender didn''t require flood insurance does not mean your home can''t flood. It just means the map says your risk is lower — not zero.

## What flood insurance actually covers

A flood policy generally protects two things: the structure of your home (foundation, walls, electrical and plumbing systems, built-in appliances) and your contents (furniture, electronics, belongings). Coverage limits and waiting periods apply, and there''s typically a 30-day waiting period before a new policy takes effect — which is exactly why buying it before a storm is on the radar matters.

## How to think about the decision

A useful way to frame it: flood insurance isn''t about whether you''re required to have it. It''s about whether you could comfortably absorb the cost of gutting and rebuilding the first few feet of your home out of pocket. For most families, the answer is no — and that''s the gap flood insurance is designed to close.

As an independent agency, we can look at your property''s specific flood risk and place coverage through the options that fit — whether that''s a standard program or a private flood market. If you''re not sure where your home stands, that''s a five-minute conversation worth having.

---

*This article is general information, not insurance, legal, or financial advice. Coverage availability, terms, and pricing vary by carrier and by your specific situation. Talk to a licensed advisor about your own needs.*','5 min read','published',now(),'human'),
('independent-agent-vs-buying-direct-texas','Independent Agent vs. Buying Direct: What Texas Homeowners Should Know','Home','Buying insurance straight from a big-name company feels simple — but it quietly limits your options. Here''s the difference an independent agent makes.','When you buy insurance directly from a national brand — the ones with the talking mascots and the endless ads — you''re buying exactly one company''s product. That''s fine if that one company happens to be the best fit for you. The problem is you have no way of knowing whether it is, because you only ever see the one quote.

## What ''independent'' actually means

An independent insurance agency isn''t owned by or tied to a single carrier. Instead, it''s appointed with many carriers and shops your coverage across all of them. You bring your needs once; the agency compares options and brings back the one that fits best on price and protection.

Think of it like a mortgage broker versus walking into a single bank. The bank can only offer you the bank''s rates. The broker can compare many. Independent agents work the same way for insurance.

## Why it matters more over time

The real value shows up when life changes. You buy a rental property. You add a teenage driver. Your home value jumps and your coverage needs to keep up. With a captive, single-company setup, your options are limited to what that one carrier offers. With an independent agent, you can be moved to a different carrier that fits your new situation — without starting over from scratch with a new agent who doesn''t know you.

## The service difference

There''s also the human side. Buying direct usually means a call center and a different representative every time. An independent agent is a single point of contact who knows your name, your policies, and your history — and who advocates for you at claim time instead of for the company.

## When buying direct makes sense

To be fair: if you have a very simple situation, are extremely price-driven, and enjoy managing it all yourself online, buying direct can work. But for most homeowners — especially those with a home, a couple of cars, and anything unusual about their situation — having someone shop the market on your behalf tends to save both money and headaches.

---

*This article is general information, not insurance, legal, or financial advice. Coverage availability, terms, and pricing vary by carrier and by your specific situation. Talk to a licensed advisor about your own needs.*','4 min read','published',now(),'human'),
('bundling-home-and-auto-insurance-texas','How Bundling Home and Auto Insurance Works in Texas (and When It Saves You Money)','Auto','Bundling your home and auto policies is one of the easiest ways to cut your insurance bill — but it isn''t always the cheaper option. Here''s the real math.','“Bundle and save” is one of the most repeated phrases in insurance advertising, and for good reason: combining your home and auto policies with the same carrier often does lower your total cost. But “often” isn''t “always,” and it''s worth understanding when bundling actually helps.

## Why carriers reward bundling

Insurance companies like customers who hold more than one policy. Multi-policy households tend to stay longer and are less expensive for the carrier to keep, so the company passes some of that savings back as a multi-policy discount. Those discounts can be meaningful — often a percentage off both policies.

## When bundling wins

Bundling tends to make the most sense when your home and auto risk profiles are both attractive to the same carrier — a well-maintained home, a clean driving record, no unusual exposures. In that case one carrier is happy to write both, and the combined discount beats what you''d get shopping them separately.

## When splitting can be cheaper

Here''s the part the ads leave out: sometimes the carrier with the best home rate is not the carrier with the best auto rate. If you have, say, a newer home but a teen driver or a couple of tickets, the math can flip — and two separate policies with two different carriers can beat one bundled quote, even after the discount.

## This is exactly where an independent agent helps

Because we''re independent, we can quote your home and auto both ways — bundled with a single carrier, and split across two — and simply show you which one costs less. You don''t have to guess or run the quotes yourself. That''s the advantage of having someone who can see the whole market instead of one company''s offer.

If it''s been a couple of years since anyone re-shopped your home and auto together, it''s worth a look. Rates and discounts change, and the combination that was best three years ago may not be best today.

---

*This article is general information, not insurance, legal, or financial advice. Coverage availability, terms, and pricing vary by carrier and by your specific situation. Talk to a licensed advisor about your own needs.*','4 min read','published',now(),'human'),
('texas-landlord-rental-property-insurance-guide','A Texas Landlord''s Guide to Rental Property Insurance','Landlord','Renting out a property? A homeowners policy won''t protect it. Here''s what Texas landlords need to know about dwelling coverage, loss of rent, and liability.','Whether you''ve bought your first rental or you''re building a portfolio, one thing trips up a lot of new Texas landlords: the homeowners policy that covered the property when you lived in it does not cover it once you rent it out. Renting changes the risk, and it needs a different kind of policy.

## Why a homeowners policy doesn''t work

Homeowners insurance is built around an owner-occupant. Once tenants move in, the carrier''s assumptions change — who''s in the home, how it''s maintained, and how it''s used. If you have a claim on a rented property under a standard homeowners policy, the carrier can deny it. That''s why rentals need a landlord or dwelling policy instead.

## What landlord coverage protects

A landlord policy is designed around three core things:

- The dwelling itself — the structure, against covered perils like fire, wind, and hail
- Loss of rent — income replacement if a covered loss makes the unit unlivable while it''s repaired
- Landlord liability — protection if someone is injured on the property and you''re held responsible

It generally does not cover your tenant''s personal belongings — that''s what renters insurance is for, and many landlords now require tenants to carry it.

## One property or a portfolio

If you own several rentals, you don''t necessarily need a separate, unrelated policy for each. Depending on the carrier, properties can sometimes be scheduled together, which simplifies management and renewals. As your portfolio grows, having an agent who works with investor-friendly carriers becomes a real time-saver.

## Speed matters for investors

Real estate investors often need coverage bound quickly — sometimes to close a purchase. Some carriers are built for exactly that, with fast quoting and binding designed for the way investors actually operate. Placing your rentals with those carriers, rather than forcing them through a standard homeowners process, makes the whole thing smoother.

If you''re buying rental property in the Dallas area, it''s worth lining up coverage before you close rather than scrambling after. A quick conversation up front usually saves a headache later.

---

*This article is general information, not insurance, legal, or financial advice. Coverage availability, terms, and pricing vary by carrier and by your specific situation. Talk to a licensed advisor about your own needs.*','5 min read','published',now(),'human')
on conflict (slug) do nothing;
