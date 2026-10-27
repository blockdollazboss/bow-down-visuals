# upg-live-stage — PLAN (banked first, survival rule)

Branch: stack200/upg-live-stage @ base ecc63098. Work DIRECTLY. Commit-ladder every rung.

## Deltas (audit-scoped, from stack200-board.md DEDUPE AUDIT)

- **#172 Auto-Highlights** — UPGRADE of Streamer Clips (`routes/generate/streamer-clips.ts`) + editor Repurpose.
  Delta ONLY: automatic trigger at stream END on the stream's own recording (existing flow = manual VOD upload);
  best-3 selection from chat spikes / reactions / replay signals; creator approval before anything posts;
  per-creator on/off. Docked in live→promote flow (stream wrap-up → clips/shorts surfaces).

- **#166 Stage Manager** — UPGRADE of Stream Copilot (`components/go-live/StreamCopilotSection.tsx`) + operator.
  Delta ONLY: real-time in-stream co-hosting — pin the right comment, drop the creator's links on mention,
  Royal Sting at milestones, early trouble flags — each action with own on/off + mid-stream mute.
  PEACE LAW: kick/mute/lock of PEOPLE stays admin-command-only; co-host ceiling = flagging + helpful actions.

- **#153 Creator Classes** — UPGRADE of Ticketed Live Streams (BUILT: `lib/live-tickets.ts`, migration 0231)
  + Courses (store product kind `course`, `lib/courses.ts`). Do NOT build a new ticketing rail.
  Delta ONLY: class format on ticketed live (teacher controls + enrollment) and the replay automatically
  listed as a sellable course/asset after the session.

## Rules
- Both themes; docked into home surfaces, no standalone pages.
- Migrations: provisional 9999-*.sql only.
- Suites + typechecks green on lane before done.
- Append progress to ~/workspace/upg-wave-manifest.md incrementally.

## Steps
1. [x] PLAN banked.
2. Explore existing rails: streamer-clips, copilot, live-tickets, courses, stream-end lifecycle, live chat/socket.
3. #153 first (smallest delta, rails exist).
4. #172 next (trigger + selection + approval + on/off).
5. #166 last (real-time co-host).
6. Full lane suites + typechecks; manifest verdicts.
