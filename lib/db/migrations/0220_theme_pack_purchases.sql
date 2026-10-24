-- 0220: Theme pack purchases (Stack-100 #3 tonight layer; owner pricing
-- ruling 2026-10-24). Premium theme packs sell for 1,000 VB one-time,
-- owned forever. One row per (user, pack): the PRIMARY KEY is the
-- exactly-once anchor — a second purchase attempt finds the row and
-- never charges again. Creator Elite includes every pack while the
-- subscription is active (checked live against creator_subscriptions);
-- a lapsed Elite member keeps only the packs with a row here.
CREATE TABLE IF NOT EXISTS theme_pack_purchases (
  user_id text NOT NULL,
  pack_id text NOT NULL,
  price_vb integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pack_id)
);
