-- 0039_plan_tier.sql — plan tier drives Creator Level access.
-- Tier N caps a user at N stars (1 = Street Punk … 6 = Kingpin).
-- Tiers are assigned manually via /api/admin/plan/set until real checkout exists.
-- Admins bypass the cap in the app layer (they always get 6 stars).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_tier INTEGER NOT NULL DEFAULT 1
  CONSTRAINT plan_tier_range CHECK (plan_tier >= 1 AND plan_tier <= 6);
