-- supabase/clients-schema.sql
-- Clients, their policies and documents, and the post-issue touch campaign
-- (drip). Used by the admin Clients page (netlify/functions/clients-admin.js),
-- the client portal (netlify/functions/portal.js) and the scheduled
-- drip-runner / monthly-report functions.
--
-- Security: RLS is ON with no policies, so only the service role (Netlify
-- functions) can read or write. The portal never queries these tables from the
-- browser; portal.js checks the visitor's Supabase login and returns only that
-- client's rows. Documents live in the private "client-docs" bucket and are
-- served through short-lived signed URLs.

create table if not exists public.clients (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  first_name           text not null,
  last_name            text not null default '',
  email                text not null unique,           -- stored lowercase
  phone                text,
  sms_opt_in           boolean not null default false, -- consented to texts
  lang                 text not null default 'en',     -- 'en' | 'es'
  quote_request_id     uuid references public.quote_requests(id) on delete set null,
  advisor_name         text default 'JoJo Garcia',
  notes                text,
  drip_paused          boolean not null default false,
  unsubscribed         boolean not null default false, -- marketing emails off
  unsub_token          text not null default encode(gen_random_bytes(16), 'hex'),
  portal_invited_at    timestamptz,
  last_portal_login_at timestamptz
);

create table if not exists public.policies (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  line            text not null,          -- Homeowners, Auto, Renters, ...
  carrier         text,
  policy_number   text,
  effective_date  date,
  renewal_date    date,
  annual_premium  numeric(12,2),
  status          text not null default 'active',  -- active | cancelled | renewed
  notes           text
);
create index if not exists policies_client_idx on public.policies(client_id);
create index if not exists policies_renewal_idx on public.policies(renewal_date);

create table if not exists public.policy_documents (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  policy_id     uuid references public.policies(id) on delete set null,
  title         text not null,
  storage_path  text not null,            -- path inside the client-docs bucket
  content_type  text,
  size_bytes    integer,
  uploaded_by   text
);
create index if not exists policy_documents_client_idx on public.policy_documents(client_id);

create table if not exists public.drip_messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  policy_id   uuid references public.policies(id) on delete cascade,
  step        text not null,              -- welcome | review | explainer | checkup | referral | renewal
  channel     text not null,              -- email | sms
  due_at      timestamptz not null,
  status      text not null default 'pending', -- pending | sent | agent | skipped | failed
  sent_at     timestamptz,
  error       text,
  unique (policy_id, step, channel)
);
create index if not exists drip_due_idx on public.drip_messages(status, due_at);

alter table public.clients          enable row level security;
alter table public.policies         enable row level security;
alter table public.policy_documents enable row level security;
alter table public.drip_messages    enable row level security;

-- Private bucket for policy documents (dec pages, ID cards, certificates).
insert into storage.buckets (id, name, public)
values ('client-docs', 'client-docs', false)
on conflict (id) do nothing;
