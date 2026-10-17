# The World's public assets

## `default-character.png` — the house default figure (ASSET SLOT)

The King's Hall scene loads `public/world/default-character.png` once
and stands every default presence (anyone who didn't walk in as a
Creative Vault character) as that figure: life-size (1.92 m), the
art's aspect preserved, a soft floor shadow, a subtle idle sway, and
landmarked lips that move with the speaker's voice.

**Drop-in contract for the approved art** (owner ruling, 2026-10-16:
a King Shark palace guard — NOT the King's main character, no crown,
not his locked chain):

- PNG, full-body standing figure, head-to-toe in frame
- Transparent background (the figure stands in the hall as a cut-out)
- Frontal face (the mouth is landmarked for voice lips)
- Tall aspect — roughly 0.4–0.55 width/height (e.g. 900×2000)
- At least ~1024 px tall so it stays crisp at life size

Until the approved art lands in this slot, the file is absent on
purpose: the scene treats a missing slot exactly like a failed
portrait load and the capsule figure stands as the fallback. Dropping
the file in needs no code change.
