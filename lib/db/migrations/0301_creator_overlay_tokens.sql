-- 0301: Per-creator stream-overlay tokens (stack900 lane C2 — owner
-- directive Oct 29, 2026: "We need widgets outside of our website").
--
-- Bow Down's stream widgets used to live only inside our own Go Live
-- studio (canvas widgets fed by GET /live/:id/widgets). Creators who
-- stream through OBS / Streamlabs had no way to put tip alerts, fan
-- alerts and the tip-goal bar on THEIR program output. Those tools
-- take a browser-source URL, and a browser source cannot carry the
-- creator's site session — so each creator gets one unguessable
-- overlay token (256-bit random, names no user id) that keys a
-- read-only public surface: overlay state + the alert socket.
--
-- One row per creator. Resetting rewrites the token in place, which
-- kills every overlay URL ever shared. The token can move no money
-- and change nothing; the worst a leaked token shows a stranger is
-- what the creator's own stream already shows publicly (tipper
-- display names, amounts, follower names) — and the creator can
-- reset it in one tap from the Stream Widgets desk.
CREATE TABLE IF NOT EXISTS creator_overlay_tokens (
  user_id uuid PRIMARY KEY,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
