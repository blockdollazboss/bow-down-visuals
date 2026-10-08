# Suno Feature Research (Oct 2026)

## Generation Modes
- Inspiration (Simple) Mode — description → AI writes lyrics + full track
- Custom Mode — user lyrics (verbatim), style prompt, title; section metatags ([Verse], [Chorus])
- Instrumental Mode — vocal-free tracks
- Sound Effects Mode — short SFX generation
- Suno Speech (beta) — spoken intro/outro → song
- Hum-to-Song — hum melody → full arrangement
- Audio Upload Input — upload audio as source material (8 min free, 30 min paid)
- Lyrics-Only Generation — standalone AI lyric writer (free, no song credits)
- Inspo Mode (v4.5+) — analyze playlist vibe → new generation

## Input Controls
- Style prompt (comma-separated: genre → BPM → key → mood → vocals → instruments → mix)
- Lyrics field with section metatags (~5,000 chars)
- Title (80 chars), Exclude Styles, Vocal Gender
- Sliders: Weirdness, Style Influence, Audio Influence, Variety (v6)
- Max Mode (v6, 2× credits), Duration slider, Personalize toggle
- Metatag system: structure, vocal delivery, dynamics, SFX tags
- Style optimizer tool

## Generation Options
- Model selector (v4 → v5.5), 2 variants per generation (A/B)
- Auto-generated cover art, Wild Card Variant

## Post-Generation
- Extend, Remix, Remaster, Cover, Replace Section, Mashup
- Underpainting (instrumental to uploaded audio), Overpainting (vocals to uploaded audio)
- Add Samples, Add Vocals, Add Instrumental, Upload Extend/Cover, Concat, Inspo from audio

## Editing (Studio)
- Song Editor: rewrite lyrics, reorder sections, replace segments
- Section regeneration, multitrack timeline, mute/solo/volume per stem
- BPM/time-signature controls, waveform editing, MIDI import/record/edit
- Wavetable synth, custom effects plugins, session-aware chatbot

## Audio Features
- Stem separation (up to 12 stems on Premier)
- Vocal extraction, MP3/WAV/MIDI/MP4 export, word-level timing data

## Library
- Song library, playlists, favorites, albums (LP/EP with tracklist + cover art)
- Trash, search/filter, "My Taste" profile, mobile apps

## Sharing
- Public song pages, privacy controls, draft sharing, community/explore
- Commercial rights on paid tiers, external distribution via DistroKid etc.

## Personas
- Saved vocal identities, persona library, custom voice models (v5.5)
- Voice recording as source, vocal gender selection

## Notes for our build
- Our provider is ElevenLabs music v2.5 — need to check API for: custom lyrics, instrumental mode, extend/remix, stems
- Highest-value quick wins: Custom lyrics mode, instrumental toggle, 2 variants, vocal gender, style presets
- Medium: Extend, cover art generation, stem separation (we have vocal-removal already)
- Hard/dependent: Replace Section, multitrack Studio, personas (needs model support)
