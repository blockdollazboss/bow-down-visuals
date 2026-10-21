-- Jewelry orders: carry the customer's avatar/character image URL so custom
-- pieces can reference it (engraving source, design reference). Idempotent.
ALTER TABLE jewelry_orders
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;
