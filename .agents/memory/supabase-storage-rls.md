---
name: Supabase storage per-user RLS
description: Correct INSERT policy for per-user storage buckets
---

For public buckets where each user stores files under their own `${userId}/...` prefix, the INSERT policy must enforce folder ownership, not just authentication.

**Rule:** `with check (bucket_id = '<bucket>' and auth.uid()::text = (storage.foldername(name))[1])` — match the same predicate the SELECT-own/DELETE/UPDATE policies use.

**Why:** `auth.role() = 'authenticated'` alone lets any signed-in user write into another user's folder namespace (broken access control). Caught in code review on the `audio-stems` bucket.

**How to apply:** see `supabase/setup.sql`. Note `artist-photos` historically used the weaker authenticated-only check; mirror the ownership-scoped pattern for new buckets. Client uploads go to `${user.id}/...` (see `artifacts/bow-down-visuals/src/lib/audio-stems.ts`).

**Operational gotcha — buckets are NOT auto-created.** `db push`/Drizzle only manage tables, never `storage.buckets`. Buckets + their RLS policies exist only after `supabase/setup.sql` is run manually in the Supabase SQL Editor. Until then, uploads fail with HTTP 400 `{"statusCode":"404","error":"Bucket not found"}`. The anon/user JWT cannot create buckets (POST /storage/v1/bucket → 403 "new row violates row-level security policy"), and no service-role key is available in this env — so this is always a user-performed manual step. Symptom to recognize: a brand-new Supabase project where tables work (projects insert succeeds) but ALL buckets 404. Probing `GET /storage/v1/bucket/<id>` with anon also returns 404 even when the bucket exists; the only reliable existence check is attempting an upload.

**Testing gotcha:** to e2e-test stem features without a browser file-picker, sign up a throwaway account via `/auth/v1/signup` (needs Supabase "Confirm email" OFF — otherwise no session + email rate-limit 429), upload generated WAV bytes server-side to `audio-stems/<userId>/...`, then POST `/api/projects` with `outputData.editorSettings.musicStudio.stems`. Seed clips ≥~10s — a 1s clip finishes before the test agent can observe playback advancing.
