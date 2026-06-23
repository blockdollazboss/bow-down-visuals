---
name: Bow Down video-editor persistence
description: How the Bow Down Visuals video editor stores all editor/music state
---

All video-editor state is persisted inside `output_data.editorSettings` on the project row — there is no dedicated DB table/column for editor or music data.

**Rule:** when adding new editor surfaces (e.g. the Music Studio), extend the `EditorSettings` shape in `artifacts/bow-down-visuals/src/lib/editor-settings.ts`, add defaults, and add a `normalize*` path so legacy projects (missing the new keys) hydrate without crashing.

**Why:** keeps the feature shippable with zero migrations and keeps saved projects backward-compatible.

**How to apply:** the editor autosaves (debounced) via PATCH `/api/projects/:id` which merges `outputData` + `scenes`. `normalizeEditorSettings(stored)` runs on load. Music Studio data is under `editorSettings.musicStudio`.
