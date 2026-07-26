-- Migration: Fix Foreign Key Constraints on game_history and transactions to reference auth.users(id)

-- 1. Fix public.game_history foreign keys
ALTER TABLE public.game_history DROP CONSTRAINT IF EXISTS game_history_user_id_fkey;
ALTER TABLE public.game_history DROP CONSTRAINT IF EXISTS game_history_agent_id_fkey;

ALTER TABLE public.game_history 
  ADD CONSTRAINT game_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT game_history_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Fix public.transactions foreign keys
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_user_id_fkey;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_agent_id_fkey;

ALTER TABLE public.transactions 
  ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD CONSTRAINT transactions_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. Ensure Row-Level Security Policies allow INSERT and SELECT
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

-- 4. Ensure transactions RLS Policies
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
