-- Press releases saved to a press kit (from the Press Release Generator panel).
-- Stored as a JSON array: [{ id, headline, body, announcementType, social, createdAt }]
ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS press_releases JSONB NOT NULL DEFAULT '[]';
