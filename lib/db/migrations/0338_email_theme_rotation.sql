-- 0338: email_theme_rotation — the durable home for the automatic
-- email theme rotation (join21, landing the email lane's named
-- trailing step).
--
-- WHY THIS FILE EXISTS: company law (owner, Nov 8, 2026) — the
-- site's automatic emails alternate theme BY CUSTOMER in a strict
-- rotation (dark, light, dark, light), and a theme is only "spent"
-- when a send is verified sent. The email lane
-- (stack1600/email-company-theme) built the rotation behind the
-- EmailThemeRotationStore seam in lib/email-theme-rotation.ts with
-- a process-local in-memory default: exact for the life of a
-- process, but a restart restarted a customer's sequence at dark.
-- This table is the durable store the seam was designed for — one
-- row per customer, keyed by normalized recipient address:
--
--   next_theme  the theme the customer's NEXT verified send carries
--   sent_count  verified sends recorded for the customer so far
--   updated_at  the last recorded flip
--
-- The DB-backed store is plugged in at boot via
-- setEmailThemeRotationStore() (lib/email-theme-rotation-db.ts);
-- no call site changes. Rotation bookkeeping is fail-open end to
-- end: if this table is missing (migration not yet applied) the
-- store reads as "no state" and writes no-op, so a lagging database
-- degrades to the in-memory behavior and can never break a send.
--
-- Fresh CREATE (no legacy table to reconcile): IF NOT EXISTS, safe
-- to re-run as a no-op. The DDL is the module header's proposed
-- table verbatim. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS email_theme_rotation (
  recipient_email text PRIMARY KEY,
  next_theme      text NOT NULL DEFAULT 'dark'
                    CHECK (next_theme IN ('dark','light')),
  sent_count      integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
