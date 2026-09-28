-- Store jackpot cheat-code sequences in plaintext for admin visibility.
-- The hash remains the source of truth for verification; this column
-- lets the site owner see the active code in the admin panel.
ALTER TABLE cheat_code_events
  ADD COLUMN IF NOT EXISTS code_sequence text;
