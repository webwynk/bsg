-- BSG Global Game Rounds Migration
-- Run in: Supabase Dashboard → SQL Editor → New Query

create extension if not exists pgcrypto;

do $$ begin create type user_role as enum ('super_admin', 'agent', 'player'); exception when duplicate_object then null; end $$;
do $$ begin create type transaction_type as enum ('deposit', 'withdrawal', 'agent_credit', 'agent_debit', 'bet_stake', 'bet_payout'); exception when duplicate_object then null; end $$;
do $$ begin create type game_mode as enum ('single', 'double', 'triple'); exception when duplicate_object then null; end $$;

create or replace function set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null,
  username varchar(32) not null,
  agent_id uuid references public.profiles(id) on delete restrict,
  balance numeric(15,2) not null default 0.00 check (balance >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_profiles_username_lower on public.profiles (lower(username));
create index if not exists idx_profiles_agent_id on public.profiles (agent_id);
alter table public.profiles enable row level security;
drop policy if exists "self read" on public.profiles;
create policy "self read" on public.profiles for select using (id = auth.uid());
drop policy if exists "agent reads own players" on public.profiles;
create policy "agent reads own players" on public.profiles for select using (agent_id = auth.uid());
drop policy if exists "super admin reads all" on public.profiles;
create policy "super admin reads all" on public.profiles for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

-- game_rounds: one row per global 60-second round
create table if not exists public.game_rounds (
  id uuid primary key default gen_random_uuid(),
  round_number bigint not null,
  scheduled_at timestamptz not null,
  status text not null default 'betting' check (status in ('betting', 'spinning', 'complete')),
  red int check (red between 0 and 9),
  green int check (green between 0 and 9),
  black int check (black between 0 and 9),
  created_at timestamptz not null default now()
);
create index if not exists idx_game_rounds_status on public.game_rounds (status, scheduled_at desc);
create index if not exists idx_game_rounds_scheduled on public.game_rounds (scheduled_at desc);
alter table public.game_rounds enable row level security;
drop policy if exists "anyone reads rounds" on public.game_rounds;
create policy "anyone reads rounds" on public.game_rounds for select using (true);

-- round_bets: each player's bets per round
create table if not exists public.round_bets (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.game_rounds(id),
  user_id uuid not null references public.profiles(id),
  single_bets jsonb not null default '{}',
  double_bets jsonb not null default '{}',
  triple_bets jsonb not null default '{}',
  total_stake numeric(15,2) not null default 0 check (total_stake >= 0),
  single_win numeric(15,2) not null default 0,
  double_win numeric(15,2) not null default 0,
  triple_win numeric(15,2) not null default 0,
  win_amount numeric(15,2) not null default 0,
  is_resolved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (round_id, user_id)
);
create index if not exists idx_round_bets_round on public.round_bets (round_id);
create index if not exists idx_round_bets_user on public.round_bets (user_id, created_at desc);
alter table public.round_bets enable row level security;
drop policy if exists "player reads own bets" on public.round_bets;
create policy "player reads own bets" on public.round_bets for select using (user_id = auth.uid());

-- get_current_round: Flutter calls this on game open
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

-- submit_round_bet: Flutter calls this when countdown hits 0
create or replace function public.submit_round_bet(p_round_id uuid, p_single_bets jsonb, p_double_bets jsonb, p_triple_bets jsonb, p_total_stake numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user_id uuid := auth.uid(); v_balance numeric; v_round public.game_rounds;
begin
  select * into v_round from public.game_rounds where id = p_round_id;
  if v_round is null then raise exception 'Round not found' using errcode='P0002'; end if;
  if v_round.status = 'complete' then raise exception 'Round already complete' using errcode='P0003'; end if;
  select balance into v_balance from public.profiles where id = v_user_id for update;
  if v_balance is null then raise exception 'Player not found' using errcode='P0004'; end if;
  if p_total_stake > 0 and v_balance < p_total_stake then raise exception 'Insufficient balance' using errcode='P0001'; end if;
  if p_total_stake > 0 then update public.profiles set balance = balance - p_total_stake where id = v_user_id; end if;
  insert into public.round_bets (round_id, user_id, single_bets, double_bets, triple_bets, total_stake)
    values (p_round_id, v_user_id, p_single_bets, p_double_bets, p_triple_bets, p_total_stake)
    on conflict (round_id, user_id) do update set single_bets=excluded.single_bets, double_bets=excluded.double_bets, triple_bets=excluded.triple_bets, total_stake=excluded.total_stake;
  return jsonb_build_object('success',true,'balance_after',(select balance from public.profiles where id = v_user_id));
end; $$;

-- resolve_round: Edge Function calls this after drawing result
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

-- create_next_round: Edge Function calls this to schedule the next round
create or replace function public.create_next_round()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_last bigint; v_id uuid;
begin
  select coalesce(max(round_number),0) into v_last from public.game_rounds;
  insert into public.game_rounds (round_number, scheduled_at, status)
    values (v_last+1, now()+interval '60 seconds', 'betting') returning id into v_id;
  return v_id;
end; $$;

-- Seed the first round
do $$
declare v_count int;
begin
  select count(*) into v_count from public.game_rounds where status in ('betting','spinning');
  if v_count = 0 then
    insert into public.game_rounds (round_number, scheduled_at, status) values (1, now()+interval '60 seconds', 'betting');
    raise notice 'First round seeded!';
  end if;
end; $$;

-- Verify
select id, round_number, status, scheduled_at from public.game_rounds order by created_at desc limit 5;
