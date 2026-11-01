-- 0305: Counter recompute repairs (stack1100 Lane X5 —
-- counter consistency, round 2).
--
-- Historic drift repair for the two denormalized counters whose row
-- truth is UNAMBIGUOUS and whose own doors define them by exactly
-- this recompute:
--
--   * challenges.entry_count — both entry doors (challenge-engine.ts
--     entry submit, shorts.ts entry submit) maintain it as
--     COUNT(challenge_entries) on every landed change. Drift is
--     residue from video deletes that cascaded entries away before
--     the publish delete door learned to recompute (fixed in the
--     same lane). entry_count orders the trending list, so stale
--     counts misrank live challenges.
--
--   * profile_videos.sound_use_count — shorts.ts
--     refreshSoundUseCount stamps COUNT(videos sharing the sound_id)
--     across every carrier whenever a short is created. The publish
--     delete door never refreshed it, so surviving carriers kept
--     counting uses by videos that no longer exist.
--
-- The statements are pure recomputes FROM the rows: they can only
-- move a counter TO its row truth, never invent a number, and the
-- WHERE guards make them no-ops where the counter already agrees —
-- idempotent by construction. (UPDATE … FROM with grouped derived
-- tables, no correlated subqueries: the statement shapes the lane's
-- pg-mem proof harness can execute, per the C3 precedent. The
-- entry_count repair needs two legs — challenges WITH entries take
-- the aggregate; challenges with none land on 0.)
--
-- Deliberately NOT repaired here: creator_profiles.follower_count
-- and playlists.follower_count. Their pre-row-era values accumulated
-- with no follow rows behind them and cannot be reconciled without
-- zeroing real historic followers (the L4/M3 settlement, migration
-- 0303) — from the row era onward their writers are landed-row
-- gated, so no NEW drift accrues.

UPDATE challenges
SET entry_count = agg.c
FROM (
  SELECT challenge_id, COUNT(*)::int AS c
  FROM challenge_entries
  GROUP BY challenge_id
) agg
WHERE agg.challenge_id = challenges.id
  AND challenges.entry_count <> agg.c;

UPDATE challenges
SET entry_count = 0
WHERE entry_count <> 0
  AND id NOT IN (SELECT challenge_id FROM challenge_entries);

UPDATE profile_videos
SET sound_use_count = agg.c
FROM (
  SELECT sound_id, COUNT(*)::int AS c
  FROM profile_videos
  WHERE sound_id IS NOT NULL
  GROUP BY sound_id
) agg
WHERE agg.sound_id = profile_videos.sound_id
  AND profile_videos.sound_use_count <> agg.c;
