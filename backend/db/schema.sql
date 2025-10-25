
create table if not exists kyc_verifications(
  email text primary key,
  status text not null check (status in ('pending','approved','rejected')),
  updated_at timestamptz default now()
);
create table if not exists receipts(
  id bigserial primary key,
  email text not null,
  amount_usd numeric not null,
  status text not null check (status in ('paid','refunded')),
  stripe_session_id text,
  created_at timestamptz default now()
);
create table if not exists mints(
  id bigserial primary key,
  email text not null,
  wallet_address text,
  amount_usd numeric not null,
  status text not null check (status in ('queued','minted','failed','needs_attention')),
  tx_hash text,
  note text,
  created_at timestamptz default now()
);
