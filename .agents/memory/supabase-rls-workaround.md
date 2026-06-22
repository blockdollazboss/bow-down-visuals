---
name: Supabase RLS UPDATE workaround
description: Projects table has no UPDATE policy — all writes use DELETE+INSERT pattern instead
---

## Rule
Never use `.update()` on the `projects` table. Use DELETE then INSERT with the same ID.

**Why:** The Supabase `projects` table was created without an UPDATE RLS policy. All `.update()` calls (via JS client or direct REST) return 204 but affect 0 rows silently. The INSERT and DELETE policies both exist.

**How to apply:**
- In `artifacts/api-server/src/routes/projects.ts` PATCH handler: SELECT full row → DELETE → INSERT with updated output_data
- In `artifacts/api-server/src/routes/generate/export-video.ts`: same pattern for saving export metadata
- On INSERT failure, attempt to restore the old row (no-throw)
- setup.sql now includes the missing UPDATE policy for future: `create policy "Users can update own projects" on projects for update using (auth.uid() = user_id);`

**Applied to:** PATCH /api/projects/:id and POST /api/export-final-video (step 7)
