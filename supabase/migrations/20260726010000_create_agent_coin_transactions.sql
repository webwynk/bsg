-- Migration: Create public.agent_coin_transactions table for Super Admin <-> Agent coin ledger tracking

CREATE TABLE IF NOT EXISTS public.agent_coin_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    agent_name TEXT NOT NULL,
    agent_username TEXT NOT NULL,
    admin_id UUID,
    type TEXT NOT NULL CHECK (type IN ('deposit', 'withdraw')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast filtered queries by date and agent
CREATE INDEX IF NOT EXISTS idx_agent_coin_txns_created_at ON public.agent_coin_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_coin_txns_agent_id ON public.agent_coin_transactions (agent_id);

-- Enable RLS
ALTER TABLE public.agent_coin_transactions ENABLE ROW LEVEL SECURITY;

-- Super admin access policy
CREATE POLICY "super admin full access on agent_coin_transactions"
ON public.agent_coin_transactions
FOR ALL
USING (true);
