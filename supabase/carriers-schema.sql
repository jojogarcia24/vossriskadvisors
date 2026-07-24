-- ============================================================
-- Voss Risk Advisors — Carrier Appointments schema
-- Run this in the Supabase SQL Editor AFTER supabase/schema.sql.
-- Safe to re-run: uses "if not exists" / "on conflict do nothing".
-- This is ADDITIVE — it does not touch quote_requests / blog_posts.
-- ============================================================

-- ---------- CARRIERS (appointment tracker) ----------
create table if not exists public.carriers (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  name           text not null,
  slug           text unique not null,

  -- Appointment status: approved | pending | not_started | declined
  status         text not null default 'not_started',

  -- Login / portal details
  website        text,             -- public/marketing site (optional)
  login_url      text,             -- where you log in to quote/bind
  login_username text,
  login_password text,             -- server-side only; never exposed to anon key
  portal_notes   text,             -- free-form notes (agent code, 2FA, contacts…)

  -- What they're good for
  product_lines  text[] not null default '{}',  -- e.g. {Home,Auto,Condo,Renters}
  states         text[] not null default '{}',  -- e.g. {TX,CA,FL}
  best_for       text,             -- one-line summary of their sweet spot

  -- The four appetite blocks (verbatim from the carrier one-sheets)
  appetite       text,
  requirements   text,
  do_not_submit  text,
  helpful_hints  text,

  sort_order     int not null default 100
);

create index if not exists carriers_status_idx on public.carriers (status);

-- Keep updated_at fresh on every write.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists carriers_touch on public.carriers;
create trigger carriers_touch before update on public.carriers
  for each row execute function public.touch_updated_at();

-- ---------- CARRIER CHANGE PROPOSALS (Claude doc-review) ----------
-- When you paste/upload a carrier bulletin, Claude reads it and stores a
-- proposal of ONLY the fields that should change. You approve it in the admin
-- portal, which then merges just those fields into the carrier row.
create table if not exists public.carrier_change_proposals (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  carrier_id    uuid references public.carriers(id) on delete cascade,
  carrier_name  text,                                   -- for display / new carriers
  status        text not null default 'proposed',       -- proposed | applied | discarded
  summary       text,                                   -- Claude's plain-English "what changed"
  changes       jsonb not null default '{}'::jsonb,     -- { field: newValue, ... }
  source_excerpt text                                    -- the pasted/uploaded text
);

create index if not exists proposals_carrier_idx on public.carrier_change_proposals (carrier_id);
create index if not exists proposals_status_idx  on public.carrier_change_proposals (status);

-- ---------- ROW LEVEL SECURITY ----------
-- No public access at all. Only the service role (used by the Netlify admin
-- function, behind the admin password) can read/write. The anon key that ships
-- in index.html cannot see carrier logins or passwords.
alter table public.carriers                  enable row level security;
alter table public.carrier_change_proposals  enable row level security;
-- (No policies for anon/authenticated = no access. Service role bypasses RLS.)
