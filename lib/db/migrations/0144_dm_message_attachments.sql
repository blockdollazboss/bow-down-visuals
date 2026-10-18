-- 0144: DM message attachments (World Ring 2, item 2.17 — "Send your
-- work to a person"). Until now the DM rails carried text only, so a
-- creator handing a collaborator a beat, a cover or a clip had to
-- leave for another app. Messages gain one optional attachment:
--   attachment_url  — the PERMANENT storage ref (supabase:// / r2://)
--                     of the sender's own uploaded/mirrored file,
--                     never a signed URL; reads mint fresh URLs.
--   attachment_type — 'audio' | 'image' | 'video' (validated at the
--                     route; the column stays plain text like the
--                     rest of this schema's kind fields).
--   attachment_name — the sender's own file title, shown as the
--                     work's title in-thread.
-- All nullable: every pre-0144 message is text-only and stays valid.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_type text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_name text;
