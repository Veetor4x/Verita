create table if not exists checks (
  id text primary key,
  kind text not null,
  input text not null,
  input_norm text not null,
  verdict text not null,
  reasons jsonb not null default '[]',
  official jsonb,
  total_cost_usd numeric not null default 0,
  cached boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists checks_norm_idx on checks (kind, input_norm, created_at desc);

create table if not exists purchases (
  id bigserial primary key,
  check_id text,                 -- null for standalone test purchases
  intent text not null,
  miner_id text,
  cost_usd numeric not null default 0,
  signal_hash text,
  receipt_hash text,
  tx_hash text,
  field_status jsonb,
  response jsonb,
  round int not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists purchases_check_idx on purchases (check_id);
create index if not exists purchases_day_idx on purchases (created_at);

alter table checks add column if not exists result jsonb;

-- addresses seen per chat (public blockchain data only, no message text): for the look-alike address warning
create table if not exists seen_addresses (
  chat_id text not null,
  address text not null,
  first_seen timestamptz not null default now(),
  primary key (chat_id, address)
);
