---
name: Scene reorder persistence in My Projects modal
description: Saved scene reorder reverts on modal re-open unless parent projects state is patched after save.
---

When MusicVideoTimeline saves via PATCH /api/projects/:id, the DB is updated but the parent's
`projects` state array still holds the old output_data.scenes. Reopening the modal re-initializes
`modalScenes` from the stale project data.

**Why:** ResultModal initializes `modalScenes` from `project.output_data?.scenes` on mount.
If the parent `projects` array is stale, re-opening re-reads the old order.

**How to apply:** Wire `onSaveSuccess` in MusicVideoTimeline → `onScenesSaved(modalScenes)` in
ResultModal → update both `openProject` and the `projects` array in `my-projects.tsx`.
Pattern already implemented in `my-projects.tsx` `onScenesSaved` and `onExportComplete` callbacks.
