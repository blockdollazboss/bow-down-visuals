-- 0230: Lip-sync provider result metadata (Stack-200, LatentSync route).
-- The default lip-sync route is now LatentSync via WaveSpeed (owner's
-- verdict, 2026-10-24: clean against timed lyrics; the direct Sync.so
-- route stays as the premium upsell behind LIP_SYNC_PROVIDER). LatentSync
-- is known to return a SMALLER frame than the clip it was given (clean
-- 5s test: 672x1344 in, 432x880 out). That fact must live on the job
-- record itself — never silent: result_meta carries the provider, the
-- model, the input dimensions the poller probed at submit time, the
-- output dimensions probed at completion, and resolution_reduced
-- (true / false / NULL when a probe could not answer — unknown is
-- stated as unknown, never hidden).
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE lip_sync_jobs ADD COLUMN IF NOT EXISTS result_meta jsonb;
