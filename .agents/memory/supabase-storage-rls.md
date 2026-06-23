---
name: Supabase storage per-user RLS
description: Correct INSERT policy for per-user storage buckets
---

For public buckets where each user stores files under their own `${userId}/...` prefix, the INSERT policy must enforce folder ownership, not just authentication.

**Rule:** `with check (bucket_id = '<bucket>' and auth.uid()::text = (storage.foldername(name))[1])` — match the same predicate the SELECT-own/DELETE/UPDATE policies use.

**Why:** `auth.role() = 'authenticated'` alone lets any signed-in user write into another user's folder namespace (broken access control). Caught in code review on the `audio-stems` bucket.

**How to apply:** see `supabase/setup.sql`. Note `artist-photos` historically used the weaker authenticated-only check; mirror the ownership-scoped pattern for new buckets. Client uploads go to `${user.id}/...` (see `artifacts/bow-down-visuals/src/lib/audio-stems.ts`).
