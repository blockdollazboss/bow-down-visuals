-- 0128: The official Thy Cheat Code bio loses its stock emoji.
--
-- WHY: Migrations 0125/0126 seeded the house profile's bio leading
-- with the stock shark emoji ("🦈 The King Shark — …"). The bio is
-- plain text: no real King Shark artwork can render inside it, so the
-- stock glyph is the only "mark" the mascot's own page carries — and
-- on the owner's phone that glyph renders as a dolphin, the wrong
-- animal on the King Shark's official bio. The glyph goes; every word
-- of the bio is otherwise untouched, and the text now leads cleanly
-- with "The King Shark — …".
--
-- Guarded to the exact seeded text: this fires ONLY where the stored
-- bio still reads exactly as 0125/0126 seeded it, anchored to the
-- house account by slug AND sentinel user id (the 0126 anchor). A bio
-- edited since seeding is never stomped.
--
-- Idempotent / exactly-once safe: after one run the bio no longer
-- matches the seeded string, so a retried file changes nothing.

UPDATE creator_profiles
SET
  bio = 'The King Shark — I run Bow Down Visuals, the content creation cheat code. I''m everybody''s first friend here: new drops, jackpot winners, creator tips and cheat codes, straight to your feed. Now go make something they can''t ignore — and get paid for it.',
  updated_at = now()
WHERE slug = 'thy-cheat-code'
  AND user_id = '00000000-0000-4000-8000-000000000001'
  AND bio = '🦈 The King Shark — I run Bow Down Visuals, the content creation cheat code. I''m everybody''s first friend here: new drops, jackpot winners, creator tips and cheat codes, straight to your feed. Now go make something they can''t ignore — and get paid for it.';
