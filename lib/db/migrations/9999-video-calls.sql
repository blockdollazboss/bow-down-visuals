-- 9999 (PROVISIONAL — Stack-200 video-calls lane): 1:1 video calls
-- inside Messages, Phase 1. The number is provisional: the join lane
-- renumbers this file into the next free slot at integration time.
-- Nothing else in this lane depends on the number.
--
-- video_calls is the call-history ledger: one row per call attempt,
-- born 'ringing', settled exactly once. The Messages thread reads it
-- (GET /api/dm/:id/calls) and interleaves entries with the thread's
-- messages. Calls themselves are WebRTC peer-to-peer; the server
-- only signals (over the existing LiveWsGateway) and keeps this
-- ledger — no media ever touches the server, no paid provider.
--
-- Privacy is inherited from conversations.status at call time
-- (blocked / request threads cannot ring — see canCallConversation);
-- this table stores no content, no SDP, no ICE candidates.
--
-- Idempotent: safe to re-run as a no-op. No BEGIN/COMMIT, no CONCURRENTLY.

CREATE TABLE IF NOT EXISTS video_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_user_id uuid NOT NULL,
  callee_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ringing',
  end_reason text,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_calls_status_check CHECK (status IN ('ringing','accepted','declined','missed','cancelled','busy','blocked','failed','ended')),
  CONSTRAINT video_calls_participants_check CHECK (caller_user_id <> callee_user_id),
  CONSTRAINT video_calls_duration_check CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS video_calls_conversation_idx ON video_calls (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS video_calls_caller_idx ON video_calls (caller_user_id, created_at);
CREATE INDEX IF NOT EXISTS video_calls_callee_idx ON video_calls (callee_user_id, created_at);
CREATE INDEX IF NOT EXISTS video_calls_status_idx ON video_calls (status, created_at);
