-- Migration: Ensure public.transactions and public.game_history tables exist for agent cashier and game play tracking

CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    user_name TEXT,
    user_username TEXT,
    type TEXT NOT NULL CHECK (type IN ('agent_credit', 'agent_debit', 'bet', 'win')),
    amount NUMERIC(15,2) NOT NULL,
    balance_after NUMERIC(15,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure columns user_name and user_username exist if table already exists
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS user_username TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON public.transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_agent_created ON public.transactions (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions (created_at DESC);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent reads own transactions" ON public.transactions;
CREATE POLICY "agent reads own transactions" ON public.transactions
    FOR SELECT USING (agent_id = auth.uid());

DROP POLICY IF EXISTS "super admin reads all transactions" ON public.transactions;
CREATE POLICY "super admin reads all transactions" ON public.transactions
    FOR SELECT USING (true);

-- Ensure public.game_history table
CREATE TABLE IF NOT EXISTS public.game_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    agent_id UUID NOT NULL,
    user_name TEXT,
    user_username TEXT,
    game_name TEXT NOT NULL DEFAULT 'Triple Chance',
    mode TEXT NOT NULL,
    bet_amount NUMERIC(15,2) NOT NULL CHECK (bet_amount > 0),
    numbers_picked JSONB NOT NULL,
    result_number INTEGER NOT NULL,
    win_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (win_amount >= 0),
    status TEXT NOT NULL CHECK (status IN ('WON', 'LOST')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure columns user_name and user_username exist if table already exists
ALTER TABLE public.game_history ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE public.game_history ADD COLUMN IF NOT EXISTS user_username TEXT;
ALTER TABLE public.game_history ADD COLUMN IF NOT EXISTS game_name TEXT DEFAULT 'Triple Chance';
ALTER TABLE public.game_history ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'LOST';

CREATE INDEX IF NOT EXISTS idx_game_history_user_created ON public.game_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_history_agent_created ON public.game_history (agent_id, created_at DESC);

ALTER TABLE public.game_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent reads own game_history" ON public.game_history;
CREATE POLICY "agent reads own game_history" ON public.game_history
    FOR SELECT USING (agent_id = auth.uid());

DROP POLICY IF EXISTS "super admin reads all game_history" ON public.game_history;
CREATE POLICY "super admin reads all game_history" ON public.game_history
    FOR SELECT USING (true);
