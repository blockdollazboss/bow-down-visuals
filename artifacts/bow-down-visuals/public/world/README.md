# The World's public assets

## `default-character.png` + `default-character-female.png` — the house default figures (ASSET SLOTS)

The King's Hall scene loads both files once and stands every
default presence (anyone who didn't walk in as a Creative Vault
character) as one of the two palace guards: life-size (1.92 m), the
art's aspect preserved, a soft floor shadow, a subtle idle sway,
and landmarked lips that move with the speaker's voice.

- `default-character.png` — the male palace guard (the house default)
- `default-character-female.png` — the female palace guard

A presence with no explicit pick is dealt a guard deterministically
(a hash of its identity — the same deal on every client, all
session); picking either guard in the "Walk in as" picker overrides
the deal. The picks travel as the character ids `house:palace-guard`
and `house:palace-guard-female`, which the world room resolves
itself — house property, no vault row behind them.

**The art contract** (owner ruling, 2026-10-16, both guards approved
the same day: King Shark palace guards — NOT the King's main
character, no crown, not his locked chain):

- PNG, full-body standing figure, head-to-toe in frame
- Transparent background (the figure stands in the hall as a cut-out)
- Frontal face (the mouth is landmarked for voice lips)
- Tall aspect — roughly 0.4–0.55 width/height
- At least ~1024 px tall so it stays crisp at life size
- Trimmed to the figure (feet at the frame's bottom edge — the
  plane's height IS the figure's height)

Current art: matted from the approved light-grey studio sheets —
male 979×2167 (aspect 0.452), female 1003×2171 (aspect 0.462).

If a slot file is missing or can't load, the scene treats it exactly
like a failed portrait load and the capsule figure stands as that
guard's fallback. Replacing the art needs no code change.
