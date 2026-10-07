-- Client review links (CapCut parity): shareable, tokenized review pages
-- with timestamped comments for client/collaborator feedback.
-- Free feature (no credit cost) — collaboration growth loop.
CREATE TABLE IF NOT EXISTS review_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  -- sha256 hex of the unguessable URL token; the raw token is never stored
  token_hash TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT 'Untitled video',
  video_url TEXT NOT NULL,
  -- 'clip' | 'project_export' | 'other'
  source_type TEXT NOT NULL DEFAULT 'other',
  source_id TEXT,
  -- scrypt hash ('scrypt$salt$hash'); NULL = no password
  password_hash TEXT,
  -- 'open' | 'changes_requested' | 'approved' | 'closed'
  status TEXT NOT NULL DEFAULT 'open',
  expires_at TIMESTAMPTZ,
  -- Creator inbox "new comments" marker: comments created after this are new
  feedback_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_links_user ON review_links(user_id);
CREATE INDEX IF NOT EXISTS idx_review_links_status ON review_links(status);

CREATE TABLE IF NOT EXISTS review_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES review_links(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Reviewer',
  -- seconds into the video the comment refers to
  timestamp_sec DOUBLE PRECISION NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  -- sha256(ip|ua) for abuse tracing; never exposed via API
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_comments_link ON review_comments(link_id);
CREATE INDEX IF NOT EXISTS idx_review_comments_link_created ON review_comments(link_id, created_at);
