-- 0228: Fan segments (Stack-100 #3, fan-graph phase 2 — numbered at
-- the join): a creator's saved audience definitions over the One Fan
-- Graph. The row stores ONLY the definition (name + rule set as JSON
-- text, the email_segments.criteria pattern); membership is computed
-- live from the graph on every read and every send, so a saved
-- segment can never drift from the fan data it describes. user_id is
-- the OWNING creator — every store query filters by it, and
-- evaluation runs over loadFanGraph(user_id) only, so a segment can
-- only ever contain the owner's own fans.
CREATE TABLE IF NOT EXISTS fan_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  rules text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fan_segments_user_idx ON fan_segments (user_id, created_at DESC);
