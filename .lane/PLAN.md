# upg-studio-gen — PLAN (banked first, survival rule)

Base: ecc63098 · branch: stack200/upg-studio-gen
Deltas (audit-scoped, source: ~/workspace/stack200-board.md DEDUPE AUDIT):

## #163 Podcast Multiplier — UPGRADE of Podcast desk + Repurpose/AI Clip Maker
Home: `routes/generate/podcast.ts` (episode generation + RSS chapters); Repurpose/AI Clip Maker takes video sources only.
DELTA ONLY: an existing podcast EPISODE as the source of a one-tap publish kit —
shorts + audiograms + show notes + cover art derived from the episode's actual audio/transcript.
Covered-check first: does any episode->kit path exist at base? (repurpose = video only per audit)

## N12 Hum-to-Song — UPGRADE of Hum-to-MIDI
Home: `lib/melody-analysis.ts` ("powers the client's MIDI export of the user's own hum");
`buildMelodyMidi` wired into stem splitter + songs route.
DELTA ONLY: the hum carried through to a PRODUCED DEMO on the song rails (arrangement/production
built around the extracted melody, landing as a song start in Create). Existing stops at melody/MIDI.

## #159 Your Own Tag — UPGRADE of Producer Tag Maker
Home: `routes/generate/producer-tag.ts` + `components/producer-tag/ProducerTagMaker.tsx`
(text -> TTS or cloned Artist Vault voice -> FX chain, 100 VB, MP3/WAV download).
DELTA ONLY: (a) the musical two-second sonic-logo form from the signature-sounds program,
(b) approve-by-ear gate, (c) automatic stamping in the export flow (toggleable),
(d) sounding on the profile, (e) one tag per creator as the house gift.
Existing tag is spoken, paid, download-only — stamps nothing, plays nowhere.

## Rules
- Build ONLY the deltas; dock into home features (CREATE->BRAND->PROMOTE->MONEY); both themes.
- Commit-ladder every rung. Migrations: provisional 9999-*.sql only. NO pushes/merges.
- If a delta is already covered by a joined lane: prove it, mark covered-with-evidence.
