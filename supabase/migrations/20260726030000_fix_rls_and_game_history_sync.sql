-- Migration: Add INSERT & SELECT RLS Policies for game_history and transactions to allow Flutter App & Web Dashboard full synchronization

-- 1. game_history RLS Policies
ALTER TABLE public.game_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "player inserts own game_history" ON public.game_history;
CREATE POLICY "player inserts own game_history" ON public.game_history
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "player reads own game_history" ON public.game_history;
CREATE POLICY "player reads own game_history" ON public.game_history
    FOR SELECT USING (user_id = auth.uid() OR agent_id = auth.uid());

DROP POLICY IF EXISTS "agent reads own game_history" ON public.game_history;
CREATE POLICY "agent reads own game_history" ON public.game_history
    FOR SELECT USING (agent_id = auth.uid());

DROP POLICY IF EXISTS "super admin reads all game_history" ON public.game_history;
CREATE POLICY "super admin reads all game_history" ON public.game_history
    FOR SELECT USING (true);

-- 2. transactions RLS Policies
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone inserts transactions" ON public.transactions;
CREATE POLICY "anyone inserts transactions" ON public.transactions
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "agent reads own transactions" ON public.transactions;
CREATE POLICY "agent reads own transactions" ON public.transactions
    FOR SELECT USING (agent_id = auth.uid() OR user_id = auth.uid());

DROP POLICY IF EXISTS "super admin reads all transactions" ON public.transactions;
CREATE POLICY "super admin reads all transactions" ON public.transactions
    FOR SELECT USING (true);
