-- 0214: Creator Courses (Stack-100 #3, #21) — a course is a store_products
-- row of the new kind 'course' (price = the product price; purchased through
-- the existing checkout/verify rail). Sections and lessons belong to the
-- product; per-buyer progress rows belong to the buyer. Drip: a section's
-- release_offset_days counts from the buyer's purchase (joined store_orders
-- row, status 'completed'); 0/null = available immediately.
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

-- Kind widening (the check is named by Postgres: store_products_kind_check).
DO $$ BEGIN
  ALTER TABLE store_products DROP CONSTRAINT IF EXISTS store_products_kind_check;
  ALTER TABLE store_products ADD CONSTRAINT store_products_kind_check
    CHECK (kind IN ('download','merch','digital','service','ticket','course'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS course_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  title text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  release_offset_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS course_sections_product_idx ON course_sections (product_id, position);

CREATE TABLE IF NOT EXISTS course_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES course_sections(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'video',
  video_url text,
  body text,
  is_preview boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_lessons_kind_check CHECK (kind IN ('video','text'))
);
CREATE INDEX IF NOT EXISTS course_lessons_section_idx ON course_lessons (section_id, position);
CREATE INDEX IF NOT EXISTS course_lessons_product_idx ON course_lessons (product_id);

CREATE TABLE IF NOT EXISTS course_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS course_lesson_progress_user_lesson_ux
  ON course_lesson_progress (user_id, lesson_id);
CREATE INDEX IF NOT EXISTS course_lesson_progress_user_product_idx
  ON course_lesson_progress (user_id, product_id);
