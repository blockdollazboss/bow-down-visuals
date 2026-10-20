-- 0174: Member content reports (Stack-4 #3).
-- Until this table existed there was NO way for a member to report a
-- post, a comment, or a profile: no store, no endpoint, no UI (the
-- Stack-3 #29 moderation survey proved the absence end to end). The
-- DMCA queue (0088 dmca_reports) is a public copyright intake with a
-- different reporter contract, so member reports get their own table
-- rather than a retrofit of that one.
--
-- content_reports: one row per filed report.
--   reporter_user_id    the signed-in member who filed it.
--   target_type         'post' | 'comment' | 'profile'.
--   target_id           the reported row's id in its own table
--                       (posts / posts thread-replies + profile_comments
--                       + media_comments for 'comment' / creator_profiles).
--   target_owner_user_id who owned the target when the report was
--                       filed (denormalized so the queue keeps its
--                       context even if the content is later deleted).
--   target_summary      a short filed-time excerpt (post/comment body
--                       or profile display name) for the admin queue.
--   reason              one of the fixed category list the route
--                       validates (spam, harassment, hate_speech,
--                       violence, sexual_content, copyright, scam,
--                       other) — free-text reasons are the note's job.
--   status              the admin workflow, mirroring dmca_reports:
--                       new -> reviewing -> actioned / dismissed.
--
-- A report NEVER acts on the target by itself — it only queues the
-- target for a human admin (GET/PATCH /api/admin/reports, the
-- ADMIN_EMAILS-gated bench beside the DMCA inbox). No auto-hide, no
-- auto-ban, no notification is sent by filing one.
--
-- The partial unique index is the idempotency rail: one OPEN report
-- per (reporter, target). Re-filing while an earlier report is still
-- open returns the open row instead of stacking a duplicate; once
-- that report is decided (actioned/dismissed), the member may file
-- again and it lands as a fresh row.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'profile')),
  target_id UUID NOT NULL,
  target_owner_user_id UUID,
  target_summary TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'hate_speech', 'violence', 'sexual_content', 'copyright', 'scam', 'other')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'actioned', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_reports_status_idx
  ON content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS content_reports_reporter_idx
  ON content_reports (reporter_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS content_reports_open_unique_idx
  ON content_reports (reporter_user_id, target_type, target_id)
  WHERE status IN ('new', 'reviewing');
