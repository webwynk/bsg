create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Enums instead of free-text VARCHAR: invalid values become impossible,
-- not just "unexpected" — this is a correctness guarantee VARCHAR cannot give you.
create type user_role         as enum ('super_admin', 'agent', 'player');
create type transaction_type  as enum ('deposit', 'withdrawal', 'agent_credit', 'agent_debit', 'bet_stake', 'bet_payout');
create type game_mode         as enum ('single', 'double', 'triple');

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  role             user_role not null,
  username         varchar(32) not null,
  agent_id         uuid references public.profiles(id) on delete restrict, -- null for super_admin & top-level agents
  balance          numeric(15,2) not null default 0.00 check (balance >= 0),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Case-insensitive uniqueness: "Agent01" and "agent01" must not both be creatable.
create unique index idx_profiles_username_lower on public.profiles (lower(username));
create index idx_profiles_agent_id on public.profiles (agent_id);
create index idx_profiles_role on public.profiles (role) where is_active;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function set_updated_at();

alter table public.profiles enable row level security;

-- Everyone can read their own row.
create policy "self read" on public.profiles
  for select using (id = auth.uid());

-- Agents can read (only) their own players.
create policy "agent reads own players" on public.profiles
  for select using (agent_id = auth.uid());

-- Super admins can read everything.
create policy "super admin reads all" on public.profiles
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

-- No direct client-side INSERT/UPDATE/DELETE policies on balance-bearing rows —
-- all writes to profiles happen through SECURITY DEFINER RPCs (§4), which bypass
-- RLS deliberately and safely because *they*, not the client, decide what's allowed.

create table public.agent_configs (
  agent_id              uuid primary key references public.profiles(id) on delete cascade,
  target_win_percentage integer not null default 20 check (target_win_percentage between 0 and 100),
  updated_at            timestamptz not null default now()
);

alter table public.agent_configs enable row level security;

create policy "super admin manages configs" on public.agent_configs
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

create policy "agent reads own config" on public.agent_configs
  for select using (agent_id = auth.uid());
-- Note: agents can READ their own RTP config (for transparency) but only
-- super_admin can write it — enforced by having no update/insert policy for agents at all.

create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id),   -- the player affected
  agent_id       uuid not null references public.profiles(id),   -- who processed it
  type           transaction_type not null,
  amount         numeric(15,2) not null check (amount <> 0),      -- negative = debit, positive = credit
  balance_after  numeric(15,2) not null,                          -- snapshot for audit trail, avoids replaying history to reconcile
  created_at     timestamptz not null default now()
);

create index idx_transactions_user_created    on public.transactions (user_id, created_at desc);
create index idx_transactions_agent_created   on public.transactions (agent_id, created_at desc);
create index idx_transactions_created_at      on public.transactions (created_at desc); -- global feed / superadmin pagination

alter table public.transactions enable row level security;

create policy "agent reads own transactions" on public.transactions
  for select using (agent_id = auth.uid());

create policy "player reads own transactions" on public.transactions
  for select using (user_id = auth.uid());

create policy "super admin reads all transactions" on public.transactions
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

-- Deliberately no UPDATE or DELETE policy for anyone, including super_admin, at the RLS layer.
-- Corrections are new offsetting rows. If a row is ever wrong, the fix is auditable, not silent.
revoke update, delete on public.transactions from authenticated, anon;

create table public.game_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id),
  agent_id        uuid not null references public.profiles(id),
  mode            game_mode not null,
  bet_amount      numeric(15,2) not null check (bet_amount > 0),
  numbers_picked  jsonb not null,
  result_number   integer not null check (result_number between 0 and 999),
  win_amount      numeric(15,2) not null default 0 check (win_amount >= 0),
  is_forced_loss  boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_game_history_user_created  on public.game_history (user_id, created_at desc);
create index idx_game_history_agent_created on public.game_history (agent_id, created_at desc);
-- Supports RTP auditing queries ("show me every forced loss for agent X this week").
create index idx_game_history_forced_loss   on public.game_history (agent_id, created_at desc) where is_forced_loss;

alter table public.game_history enable row level security;
-- Same read-policy shape as transactions (self / own-agent / super_admin) — omitted here for brevity, mirror §1.3.
revoke update, delete on public.game_history from authenticated, anon;

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid not null references public.profiles(id),
  action       varchar(64) not null,        -- e.g. 'block_player', 'update_rtp', 'create_agent'
  target_id    uuid references public.profiles(id),
  metadata     jsonb,                        -- e.g. { "old_rtp": 20, "new_rtp": 15 }
  created_at   timestamptz not null default now()
);

create index idx_audit_log_target_created on public.audit_log (target_id, created_at desc);
alter table public.audit_log enable row level security;

create policy "super admin reads audit log" on public.audit_log
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
  );

create or replace function public.process_bet(
  p_user_id        uuid,
  p_agent_id       uuid,
  p_mode           game_mode,
  p_bet_amount     numeric,
  p_numbers_picked jsonb
)
returns public.game_history
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance        numeric;
  v_target_win_pct integer;
  v_result_number  integer;
  v_win_amount     numeric := 0;
  v_forced_loss    boolean := false;
  v_history        public.game_history;
  
  v_win_key        text;
  v_multiplier     numeric;
  v_matched_stake  numeric := 0;
begin
  -- Lock the player row for the duration of this transaction — this is what
  -- actually prevents double-spend if two bets fire concurrently, not app-level checks.
  select balance into v_balance
    from public.profiles
    where id = p_user_id
    for update;

  if v_balance is null then
    raise exception 'Player not found';
  end if;

  if v_balance < p_bet_amount then
    raise exception 'Insufficient balance' using errcode = 'P0001';
  end if;

  select target_win_percentage into v_target_win_pct
    from public.agent_configs where agent_id = p_agent_id;

  -- Generate winning number and key based on mode
  if p_mode = 'single' then
    v_result_number := floor(random() * 10)::int;
    v_win_key       := v_result_number::text;
    v_multiplier    := 9;
  elsif p_mode = 'double' then
    v_result_number := floor(random() * 100)::int;
    v_win_key       := lpad(v_result_number::text, 2, '0');
    v_multiplier    := 90;
  elsif p_mode = 'triple' then
    v_result_number := floor(random() * 1000)::int;
    v_win_key       := lpad(v_result_number::text, 3, '0');
    v_multiplier    := 900;
  end if;

  -- Extract stake on the winning number
  if p_numbers_picked ? v_win_key then
    v_matched_stake := coalesce((p_numbers_picked->>v_win_key)::numeric, 0);
  end if;

  v_forced_loss := (random() * 100) > coalesce(v_target_win_pct, 20);

  if not v_forced_loss and v_matched_stake > 0 then
    v_win_amount := v_matched_stake * v_multiplier;
  end if;

  -- Debit the stake, credit any win, in the same locked transaction.
  update public.profiles
    set balance = balance - p_bet_amount + v_win_amount
    where id = p_user_id;

  insert into public.transactions (user_id, agent_id, type, amount, balance_after)
    values (p_user_id, p_agent_id, 'bet_stake', -p_bet_amount, v_balance - p_bet_amount);

  if v_win_amount > 0 then
    insert into public.transactions (user_id, agent_id, type, amount, balance_after)
      values (p_user_id, p_agent_id, 'bet_payout', v_win_amount, v_balance - p_bet_amount + v_win_amount);
  end if;

  insert into public.game_history (
    user_id, agent_id, mode, bet_amount, numbers_picked, result_number, win_amount, is_forced_loss
  ) values (
    p_user_id, p_agent_id, p_mode, p_bet_amount, p_numbers_picked, v_result_number, v_win_amount, v_forced_loss
  ) returning * into v_history;

  return v_history;
end;
$$;

create or replace function public.transfer_points(
  p_agent_id  uuid,
  p_player_id uuid,
  p_amount    numeric  -- positive = credit to player, negative = debit
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_balance numeric;
  v_txn           public.transactions;
begin
  if p_amount = 0 then
    raise exception 'Amount must be non-zero';
  end if;


  if p_amount < 0 then
    -- Debiting a player: lock and verify they can cover it.
    perform 1 from public.profiles where id = p_player_id and balance >= abs(p_amount) for update;
    if not found then raise exception 'Insufficient player balance'; end if;
  else
    -- Crediting a player: lock and verify the agent can cover it.
    select balance into v_agent_balance from public.profiles where id = p_agent_id for update;
    if v_agent_balance < p_amount then raise exception 'Insufficient agent balance'; end if;
    update public.profiles set balance = balance - p_amount where id = p_agent_id;
  end if;

  update public.profiles set balance = balance + p_amount where id = p_player_id;

  insert into public.transactions (user_id, agent_id, type, amount, balance_after)
    values (
      p_player_id, p_agent_id,
      case when p_amount > 0 then 'agent_credit' else 'agent_debit' end,
      p_amount,
      (select balance from public.profiles where id = p_player_id)
    ) returning * into v_txn;

  return v_txn;
end;
$$;

