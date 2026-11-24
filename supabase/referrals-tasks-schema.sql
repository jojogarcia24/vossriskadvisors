-- supabase/referrals-tasks-schema.sql
-- Realtor referrals (stored on quote_requests) and renewal re-shop tasks.
-- Applied to the Voss Risk Advisors project; kept here for reference.

alter table public.quote_requests
  add column if not exists referred_by_name      text,
  add column if not exists referred_by_email     text,
  add column if not exists referred_by_phone     text,
  add column if not exists referred_by_brokerage text,
  add column if not exists closing_date          date,
  add column if not exists share_status          boolean not null default false; -- client OK'd status updates to the agent

-- Renewal re-shop tasks: created by drip-runner ~50 days before a renewal,
-- worked from Admin -> Clients & Leads -> Tasks.
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  type          text not null default 'renewal_reshop',
  client_id     uuid references public.clients(id) on delete cascade,
  policy_id     uuid references public.policies(id) on delete cascade,
  renewal_date  date,
  title         text not null,
  due_date      date not null,
  status        text not null default 'open',   -- open | done
  outcome       text,                           -- renewed_same | moved_carrier | lost
  notes         text,
  done_at       timestamptz,
  done_by       text,
  unique (policy_id, type, renewal_date)
);
create index if not exists tasks_open_idx on public.tasks(status, due_date);
alter table public.tasks enable row level security;
