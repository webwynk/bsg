-- Migration: 20260727000000_fix_profiles_rls_and_balance_trigger.sql
-- Description: Fixes RLS infinite recursion on public.profiles and adds real-time balance sync trigger from auth.users metadata.

-- 1. Fix RLS policy on public.profiles to prevent infinite recursion
DROP POLICY IF EXISTS "super admin reads all" ON public.profiles;
CREATE POLICY "super admin reads all" ON public.profiles FOR SELECT USING (
  (auth.jwt() ->> 'role' = 'service_role') OR 
  (auth.jwt() -> 'user_metadata' ->> 'role' = 'super_admin') OR
  (auth.uid() = id)
);

-- 2. Create Trigger to automatically sync auth.users metadata balance -> public.profiles.balance
CREATE OR REPLACE FUNCTION public.sync_user_metadata_balance_to_profiles()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'balance' IS NOT NULL THEN
    UPDATE public.profiles
    SET balance = (NEW.raw_user_meta_data->>'balance')::numeric,
        updated_at = NOW()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_user_metadata_balance ON auth.users;
CREATE TRIGGER trg_sync_user_metadata_balance
AFTER UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_metadata_balance_to_profiles();
