# Operator Hands — Diagnosis (payfix lane 7, 2026-10-26)

Why the live chat operator navigates and explains but never performs a
charged action (PASS 4, rerun-oct26-statecheck.md), traced end to end
through the code on main @ ecc63098.

## The path as built

1. **Intent detection** — exactly ONE trigger exists: the LLM ending its
   reply with a machine marker `[[DO:<tool-id> {args}]]`
   (`lib/operator-chat.ts` `extractActionMarker`;
   `lib/ai-chat-assistant.ts` OPERATOR_RULES rule 3 + `buildToolList()`).
   There is **no deterministic/code intent detection anywhere**. If the
   model does not emit a marker, `processOperatorReply` returns null and
   the turn is an ordinary Q&A answer.
2. **Confirmation issuance** — `processOperatorReply` (charged branch) →
   `proposeAction` (`lib/operator-executor.ts`): registry price quoted by
   code, args validated/normalized by the tool validator, one live
   pending row per member, 10-minute TTL. Sound.
3. **Confirmation consumption** — `processOperatorPreTurn` runs before the
   model on the next message: a tight yes-regex consumes the pending row
   via `executeAction`; a no cancels it. Sound.
4. **Execution** — `executeAction`: kill-switch gate, Tier-4 admin gate,
   confirmation validation (user/tool/args-hash/price match), daily cap
   (20, counting only today's UTC `done` rows with `priceCharged > 0`),
   guarded single-use consume (`status='pending'` → `consumed`), then the
   Tier-3 handler in `lib/operator-tools-tier3.ts` calls the SAME rail
   core the pages call (`lib/rail-core.ts` `invokeRailHandler` wrappers).
   Sound — and unit-proven (`operator-executor.test.ts`,
   `operator-tier3.test.ts`, `operator-hands.test.ts`).

   **Every one of those tests mocks the model to emit a perfect marker.**
   The downstream half is proven; the upstream half (a live model
   actually emitting the marker on the live surface) never was.

## Why live degrades to navigation-only

**Primary dead path — the live surface's model path cannot be relied on
to emit markers, and its fallback structurally cannot:**

- The website widget (`ThyCheatCodeChat.tsx`) talks ONLY to
  `POST /api/free-chat`, never to `/api/chat`.
- `routes/free-chat.ts` has exactly one model provider: Groq
  (`callGroq`, `openai/gpt-oss-120b`, keyed by `GROQ_API_KEY`).
  `GROQ_API_KEY` does not appear in `.env.example`, and no record shows
  it set in production (production env is documented as holding
  OPENAI + ELEVENLABS keys).
- When the Groq key is absent OR the Groq call fails, `getChatReply`
  falls back to `getKnowledgeReply()` — a deterministic knowledge-base
  composer (`describeFeature`: “Name — path. Description. Prices… Guide…
  Next step…”). **It cannot emit a `[[DO:…]]` marker by construction.**
  `processOperatorReply` finds no marker → returns null → the KB text
  ships, with Tier-1 doors attached (`buildReplyDoors` is computed from
  the member's message independently of the model). That is exactly the
  PASS-4 observation: page guide + OPEN button, no proposal, no
  confirmation, ever.
- Even when Groq does answer, marker emission is a prompt request to a
  free-tier model (`max_tokens: 500`) carrying a large grounding prompt;
  a paraphrase instead of a marker fails silently to the same Q&A path.

**Registry gaps — two of the three PASS-4 probes name actions that do
not exist as tools at all:**

- *“Make me a bio”*: the catalog has only `bio.publish` (publish an
  EXISTING draft bio page, `PUBLISH_COST` 100). The Bio Generator rail
  (`routes/generate/bio-generator.ts`, `BIO_COST` 100, shared core
  `generateBiosForUser` used verbatim by the page and the public API)
  has **no operator tool**. A generate-a-bio request can at best be
  misrouted to publish, whose validator answers with a page guide
  (“build one on the Bio Page page first…”).
- *Direct SFX order*: **no SFX tool exists**, and the SFX rail
  (`routes/generate/sfx.ts`, `SFX_CREDIT_COST` 100) is an inline route
  handler with no exported core, so the operator could not call the
  page's rail even via a marker.
- *“List the charged actions you can perform in chat”*: **no code path
  composes that list.** The tool list exists only inside the system
  prompt (`buildToolList`); the KB fallback answers about site features,
  so the member gets feature descriptions + doors instead.

## Invariant audit of existing code (executor + Tier-3 handlers)

Held: `OPERATOR_HANDS_ENABLED` defaults ON when absent
(`operatorHandsEnabled`); single-use confirmations (guarded consume +
replay refusal audited); cap counts only today's UTC `done` rows with
`priceCharged > 0` and a cap refusal does NOT burn the confirmation;
video handler reports `priceCharged: 0` at submit and the rail charges
on success inside its poll handler (`driveOperatorVideoTask` polls that
same handler); every catalog price is imported from its rail's own
constant (400/800/1,200 songs via `creditCostForLength`, video 400,
bio-publish 100, brand kit 200, headshot 100, stream-pack 100,
UGC video 400, UGC persona 100).

Flagged (not fixed by this lane, recorded for the report):
- Only the UGC rails accept the confirmation's idempotency key; for the
  other rails the executor's single-use consume is the only wall against
  a double charge (documented in the executor header, still true).
- `countChargedActionsToday` loads all of a member's audit rows and
  filters in JS — correct, not scalable.

## The fix (this lane)

1. **Deterministic intent layer** in the shared chat protocol
   (`lib/operator-chat.ts`): a pre-model turn that recognizes clear
   charged-action requests and the capability-listing question in code,
   extracts only args the member actually stated, and runs the SAME
   `proposeAction` path the marker uses (validator asks when details
   are missing; server composes the proposal + price). Works identically
   on the KB-fallback path, the Groq path, and `/api/chat` — the
   operator's hands no longer depend on a model choosing to emit a
   marker. Model markers keep working as before.
2. **`bio.generate` tool** (Tier 3, 100 VB from `BIO_COST`) on the
   existing shared core `generateBiosForUser` — the page's own rail,
   with its charge-exactly-once + refund-on-failure behavior and the
   confirmation's idempotency key passed through.
3. **`sfx.generate` tool** (Tier 3, 100 VB from `SFX_CREDIT_COST`): the
   SFX route handler is extracted verbatim into a named handler with a
   `runGenerateSfx` rail-core wrapper (the established Lane-E pattern),
   so the page and the operator call the identical code.
4. **Capability listing** composed by code from the live registry when a
   member asks what the operator can do in chat.
