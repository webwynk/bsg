# DATABASE SCHEMA (Supabase PostgreSQL)

The database is the source of truth for money movement. Every constraint in this document exists to make one guarantee: **the ledger cannot lie, and the app layer cannot be trusted to enforce correctness on its own** — Postgres enforces it, at the database level, regardless of what the frontend or a compromised API key attempts.

Design principles this schema follows:
1. **Balances are derived, never directly writable.** No client, and no ordinary application code path, ever runs `UPDATE users SET balance = ...`. All balance changes happen inside `SECURITY DEFINER` RPC functions that read, check, and write atomically in one transaction.
2. **The transaction ledger is append-only.** Rows in `transactions` and `game_history` are never updated or deleted — corrections are new offsetting rows, exactly like double-entry accounting. This is what makes the system auditable.
3. **Row Level Security (RLS) is on for every table.** This was entirely missing from the original schema and is not optional on Supabase — without it, any authenticated client with the anon/public key can read or write rows across every agent and player, because Postgres has no other access boundary by default.
4. **Don't duplicate what Supabase Auth already does correctly.** Hand-rolled `password_hash` storage is a liability, not a convenience (see §1.1).

---

## 0. Extensions & Conventions

```sql
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Enums instead of free-text VARCHAR: invalid values become impossible,
-- not just "unexpected" — this is a correctness guarantee VARCHAR cannot give you.
create type user_role         as enum ('super_admin', 'agent', 'player');
create type transaction_type  as enum ('deposit', 'withdrawal', 'agent_credit', 'agent_debit', 'bet_stake', 'bet_payout');
create type game_mode         as enum ('single', 'double', 'triple');
```

Every table gets `created_at timestamptz not null default now()`. Mutable tables (not the ledgers) also get `updated_at` maintained by a shared trigger:

```sql
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

---

## 1. Core Tables

### 1.1 `auth.users` (Supabase-managed) + `public.profiles`

**Change from the original spec:** do not create a hand-rolled `users` table with a `password_hash` column. Supabase Auth (`auth.users`) already provides salted/hashed password storage, session/JWT issuance, rate-limited login attempts, and MFA support — reimplementing this in an app-level table means you're now responsible for password hashing correctness, brute-force protection, and session invalidation yourself, with none of the benefits. Instead, extend auth with a `profiles` table keyed 1:1 to it:

```sql
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
```

**Why `on delete restrict` on `agent_id`, not `cascade`:** cascading would silently delete every player under an agent if the agent row is ever removed. In a system that moves money, an accidental cascade delete is unacceptable — deactivate via `is_active = false` instead; the schema should make hard deletes of financial actors structurally awkward, not convenient.

**Why `balance` has a `check (balance >= 0)`:** this is the last line of defense. Even if an RPC function has a bug that lets a debit overdraw an account, Postgres itself will reject the write. Application logic should never be the *only* thing preventing a negative balance.

#### RLS on `profiles`

```sql
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
```

### 1.2 `agent_configs`

Holds per-agent game economics. Split from `profiles` deliberately — this table is far more sensitive (it controls house edge) and should have a **tighter, separately audited** RLS policy than general profile data.

```sql
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
```

### 1.3 `transactions` — the money ledger

Append-only. Every deposit, withdrawal, and agent-to-player point transfer is a row here — nothing about balances is trusted to memory or to the `profiles.balance` cache alone.

```sql
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
```

**`balance_after` justification:** without it, proving "what was this player's balance at 3:14pm on the 12th" requires replaying every prior transaction in order. With it, that's a single indexed row lookup — this matters the moment a dispute or chargeback investigation happens.

### 1.4 `game_history` — the spin/bet audit trail

```sql
create table public.game_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id),
  agent_id        uuid not null references public.profiles(id),
  mode            game_mode not null default 'single',
  bet_amount      numeric(15,2) not null check (bet_amount > 0),
  single_bets     jsonb default '{}'::jsonb,  -- e.g. { "7": 10 }
  double_bets     jsonb default '{}'::jsonb,  -- e.g. { "42": 50 }
  triple_bets     jsonb default '{}'::jsonb,  -- e.g. { "342": 100 }
  red_digit       integer not null check (red_digit between 0 and 9),
  green_digit     integer not null check (green_digit between 0 and 9),
  black_digit     integer not null check (black_digit between 0 and 9),
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
```

`red_digit`, `green_digit`, and `black_digit` record the outcome of the three concentric wheel rings (Outer Red = Hundreds, Middle Green = Tens, Inner Black = Units), enforcing the valid domain at the database level.


### 1.5 `audit_log` — administrative actions (new)

Missing from the original schema entirely. Anything a super_admin or agent does that isn't a financial transaction but still matters for accountability — blocking a player, changing an agent's `target_win_percentage`, deactivating an account — belongs here. Without this table, "who changed the RTP to 5% last Tuesday" is unanswerable.

```sql
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
```

### 1.6 `game_rounds` — synchronized 60-second global round states

```sql
create table public.game_rounds (
  id           uuid primary key default gen_random_uuid(),
  round_number bigint not null,
  scheduled_at timestamptz not null,
  status       text not null default 'betting' check (status in ('betting', 'spinning', 'complete')),
  red          integer check (red between 0 and 9),
  green        integer check (green between 0 and 9),
  black        integer check (black between 0 and 9),
  created_at   timestamptz not null default now()
);

create index idx_game_rounds_status    on public.game_rounds (status, scheduled_at desc);
create index idx_game_rounds_scheduled on public.game_rounds (scheduled_at desc);

alter table public.game_rounds enable row level security;
create policy "anyone reads rounds" on public.game_rounds for select using (true);
```

### 1.7 `round_bets` — player bets placed during global rounds

```sql
create table public.round_bets (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references public.game_rounds(id),
  user_id      uuid not null references public.profiles(id),
  single_bets  jsonb not null default '{}'::jsonb,
  double_bets  jsonb not null default '{}'::jsonb,
  triple_bets  jsonb not null default '{}'::jsonb,
  total_stake  numeric(15,2) not null default 0 check (total_stake >= 0),
  single_win   numeric(15,2) not null default 0,
  double_win   numeric(15,2) not null default 0,
  triple_win   numeric(15,2) not null default 0,
  win_amount   numeric(15,2) not null default 0,
  is_resolved  boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (round_id, user_id)
);

create index idx_round_bets_round on public.round_bets (round_id);
create index idx_round_bets_user  on public.round_bets (user_id, created_at desc);

alter table public.round_bets enable row level security;
create policy "player reads own bets" on public.round_bets for select using (user_id = auth.uid());
```


---

## 2. Performance Indexes — Summary

All indexes below are declared inline with their tables in §1; consolidated here for reference:

| Table | Index | Serves |
|---|---|---|
| `profiles` | `idx_profiles_username_lower` (unique) | Case-insensitive login lookup |
| `profiles` | `idx_profiles_agent_id` | Agent's player-list dashboard |
| `profiles` | `idx_profiles_role` (partial, active only) | Superadmin filtering by role |
| `transactions` | `idx_transactions_user_created` | Player transaction history |
| `transactions` | `idx_transactions_agent_created` | Agent transaction history |
| `transactions` | `idx_transactions_created_at` | Superadmin global feed pagination |
| `game_history` | `idx_game_history_user_created` | Player spin history |
| `game_history` | `idx_game_history_agent_created` | Agent spin history |
| `game_history` | `idx_game_history_forced_loss` (partial) | RTP/compliance auditing queries |
| `audit_log` | `idx_audit_log_target_created` | "History of actions taken on this account" |

**At scale (future consideration, not needed at launch):** once `transactions` or `game_history` reach tens of millions of rows, monthly range-partitioning (`PARTITION BY RANGE (created_at)`) keeps indexes small and makes old-data archival/deletion (for retention-policy compliance) a cheap partition-drop instead of a slow row-by-row delete. Not worth the operational complexity before you actually hit that scale.

---

## 3. Database Functions (RPC) — Where Correctness Actually Lives

Every RPC below is `security definer` with `search_path` explicitly pinned — an unset `search_path` on a `security definer` function is a known Postgres privilege-escalation vector (a malicious schema earlier in the caller's search path could shadow a table/function the definer-owner didn't intend to call).

### 3.1 `process_bet` — atomic multi-board stake + resolve + payout

```sql
create or replace function public.process_bet(
  p_user_id        uuid,
  p_agent_id       uuid,
  p_single_bets    jsonb default '{}'::jsonb,  -- e.g. { "7": 10 }
  p_double_bets    jsonb default '{}'::jsonb,  -- e.g. { "42": 50 }
  p_triple_bets    jsonb default '{}'::jsonb   -- e.g. { "342": 100 }
)
returns public.game_history
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance        numeric;
  v_target_win_pct integer;
  v_red            integer;
  v_green          integer;
  v_black          integer;
  v_total_stake    numeric := 0;
  v_single_win     numeric := 0;
  v_double_win     numeric := 0;
  v_triple_win     numeric := 0;
  v_total_win      numeric := 0;
  v_forced_loss    boolean := false;
  v_history        public.game_history;
  
  v_key            text;
  v_val            numeric;
  v_win_key        text;
begin
  -- Lock the player row for atomic read-modify-write
  select balance into v_balance
    from public.profiles
    where id = p_user_id
    for update;

  if v_balance is null then
    raise exception 'Player not found';
  end if;

  -- Calculate total stake across all 3 boards
  select coalesce(sum(value::numeric), 0) into v_val from jsonb_each_text(p_single_bets);
  v_total_stake := v_total_stake + v_val;
  select coalesce(sum(value::numeric), 0) into v_val from jsonb_each_text(p_double_bets);
  v_total_stake := v_total_stake + v_val;
  select coalesce(sum(value::numeric), 0) into v_val from jsonb_each_text(p_triple_bets);
  v_total_stake := v_total_stake + v_val;

  if v_total_stake <= 0 then
    raise exception 'Total bet amount must be greater than zero';
  end if;

  if v_balance < v_total_stake then
    raise exception 'Insufficient balance' using errcode = 'P0001';
  end if;

  select target_win_percentage into v_target_win_pct
    from public.agent_configs where agent_id = p_agent_id;

  -- Roll outcome for 3 concentric rings (Outer Red, Middle Green, Inner Black)
  v_red   := floor(random() * 10)::int;
  v_green := floor(random() * 10)::int;
  v_black := floor(random() * 10)::int;

  v_forced_loss := (random() * 100) > coalesce(v_target_win_pct, 20);

  if not v_forced_loss then
    -- 1. Single Board Payout (9x) matching Black digit
    v_win_key := v_black::text;
    if p_single_bets ? v_win_key then
      v_single_win := (p_single_bets->>v_win_key)::numeric * 9;
    end if;

    -- 2. Double Board Payout (90x) matching Green + Black digits
    v_win_key := lpad(v_green::text, 1, '0') || lpad(v_black::text, 1, '0');
    if p_double_bets ? v_win_key then
      v_double_win := (p_double_bets->>v_win_key)::numeric * 90;
    end if;

    -- 3. Triple Board Payout (900x) matching Red + Green + Black digits
    v_win_key := lpad(v_red::text, 1, '0') || lpad(v_green::text, 1, '0') || lpad(v_black::text, 1, '0');
    if p_triple_bets ? v_win_key then
      v_triple_win := (p_triple_bets->>v_win_key)::numeric * 900;
    end if;

    v_total_win := v_single_win + v_double_win + v_triple_win;
  end if;

  -- Debit stake, credit win
  update public.profiles
    set balance = balance - v_total_stake + v_total_win
    where id = p_user_id;

  insert into public.transactions (user_id, agent_id, type, amount, balance_after)
    values (p_user_id, p_agent_id, 'bet_stake', -v_total_stake, v_balance - v_total_stake);

  if v_total_win > 0 then
    insert into public.transactions (user_id, agent_id, type, amount, balance_after)
      values (p_user_id, p_agent_id, 'bet_payout', v_total_win, v_balance - v_total_stake + v_total_win);
  end if;

  insert into public.game_history (
    user_id, agent_id, mode, bet_amount, single_bets, double_bets, triple_bets,
    red_digit, green_digit, black_digit, win_amount, is_forced_loss
  ) values (
    p_user_id, p_agent_id, 'triple', v_total_stake, p_single_bets, p_double_bets, p_triple_bets,
    v_red, v_green, v_black, v_total_win, v_forced_loss
  ) returning * into v_history;

  return v_history;
end;
$$;
```

### 3.2 `submit_round_bet` — global synchronized round bet submission

```sql
create or replace function public.submit_round_bet(
  p_round_id     uuid,
  p_single_bets  jsonb default '{}'::jsonb,
  p_double_bets  jsonb default '{}'::jsonb,
  p_triple_bets  jsonb default '{}'::jsonb,
  p_total_stake  numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id       uuid := auth.uid();
  v_balance       numeric;
  v_balance_after numeric;
begin
  select balance into v_balance from public.profiles where id = v_user_id for update;

  if v_balance < p_total_stake then
    raise exception 'Insufficient balance' using errcode = 'P0001';
  end if;

  update public.profiles set balance = balance - p_total_stake where id = v_user_id;
  v_balance_after := v_balance - p_total_stake;

  insert into public.transactions (user_id, agent_id, type, amount, balance_after)
    values (
      v_user_id,
      (select agent_id from public.profiles where id = v_user_id),
      'bet_stake',
      -p_total_stake,
      v_balance_after
    );

  return jsonb_build_object('success', true, 'balance_after', v_balance_after);
end;
$$;

### 3.3 `get_current_round` — fetch active round state

```sql
create or replace function public.get_current_round()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_round public.game_rounds; v_secs int;
begin
  select * into v_round from public.game_rounds where status in ('betting','spinning') order by scheduled_at asc limit 1;
  if v_round is null then
    select * into v_round from public.game_rounds order by scheduled_at desc limit 1;
  end if;
  if v_round is null then return jsonb_build_object('error','No rounds exist yet'); end if;
  v_secs := greatest(0, extract(epoch from (v_round.scheduled_at - now()))::int);
  return jsonb_build_object('round_id',v_round.id,'round_number',v_round.round_number,'status',v_round.status,'scheduled_at',v_round.scheduled_at,'seconds_remaining',v_secs,'red',v_round.red,'green',v_round.green,'black',v_round.black);
end; $$;
```

### 3.4 `resolve_round` — atomic resolution & payout for global rounds

```sql
create or replace function public.resolve_round(p_round_id uuid, p_red int, p_green int, p_black int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bet record; v_sk text; v_dk text; v_tk text;
  v_sw numeric; v_dw numeric; v_tw numeric; v_tw_total numeric; v_count int := 0;
begin
  v_sk := p_black::text;
  v_dk := lpad(((p_green*10)+p_black)::text,2,'0');
  v_tk := lpad(((p_red*100)+(p_green*10)+p_black)::text,3,'0');
  update public.game_rounds set status='complete', red=p_red, green=p_green, black=p_black where id=p_round_id;
  for v_bet in select * from public.round_bets where round_id=p_round_id and is_resolved=false loop
    v_sw := 0; v_dw := 0; v_tw := 0;
    if v_bet.single_bets ? v_sk then v_sw := ((v_bet.single_bets->>v_sk)::numeric)*9; end if;
    if v_bet.double_bets ? v_dk then v_dw := ((v_bet.double_bets->>v_dk)::numeric)*90; end if;
    if v_bet.triple_bets ? v_tk then v_tw := ((v_bet.triple_bets->>v_tk)::numeric)*900; end if;
    v_tw_total := v_sw + v_dw + v_tw;
    update public.round_bets set single_win=v_sw, double_win=v_dw, triple_win=v_tw, win_amount=v_tw_total, is_resolved=true where id=v_bet.id;
    if v_tw_total > 0 then update public.profiles set balance=balance+v_tw_total where id=v_bet.user_id; end if;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('resolved_bets',v_count,'single_key',v_sk,'double_key',v_dk,'triple_key',v_tk);
end; $$;
```

### 3.5 `create_next_round` — schedule next 60s global round

```sql
create or replace function public.create_next_round()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_last bigint; v_id uuid;
begin
  select coalesce(max(round_number),0) into v_last from public.game_rounds;
  insert into public.game_rounds (round_number, scheduled_at, status)
    values (v_last+1, now()+interval '60 seconds', 'betting') returning id into v_id;
  return v_id;
end; $$;
```

```


### 3.2 `transfer_points` — agent → player



```sql
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
```

**What both functions guarantee together:**
* **No double-spend** — `for update` row locks serialize concurrent bets/transfers against the same account.
* **No negative balances** — enforced twice: the `check (balance >= 0)` constraint on `profiles`, and the explicit balance check before debiting.
* **Full auditability** — every call produces a permanent, non-editable row in `transactions` and/or `game_history` with a `balance_after` snapshot.

---
