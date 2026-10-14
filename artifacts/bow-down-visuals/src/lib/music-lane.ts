/* ─── Music lane (editor) — Personas + session persistence ───────────────────
   Phase B of the formal music lane inside the editor's Music Studio.

   Personas ride the existing /api/personas CRUD (voice-personas route):
   a persona is a named style+voice preset. Its free-form `settings` jsonb
   carries the lane's form snapshot so applying a persona restores the exact
   sound it was saved from.

   Session persistence mirrors the song-and-video draft pattern:
   localStorage for the fast same-browser restore + POST /api/drafts
   (workflow "music-lane") debounced for cross-session restore. Sessions are
   scoped to a project id so one project's lane never leaks into another. */

export interface LanePersonaSettings {
  /** Style text (Custom-mode style field / Simple-mode prompt). */
  stylePrompt?: string;
  /** "male" | "female" | "auto" — the lane's vocal direction. */
  vocalGender?: string;
  instrumental?: boolean;
  lengthSeconds?: string;
  /** Singing voice binding: a voice_id from GET /api/voices (an account
   * voice — a library voice or one the user cloned). When set, generated
   * vocals are converted to this voice server-side (STS voice swap). */
  voiceId?: string;
  /** Display name captured alongside voiceId so the picker can label the
   * binding even before the voice list loads. */
  voiceName?: string;
}

/** One voice from GET /api/voices (the account's voice library). */
export interface LaneVoice {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category: string | null;
}

/** Load the account's voices for the persona voice picker. Voices are
 * optional — any failure returns an empty list and the lane works as before. */
export async function fetchLaneVoices(token: string | null): Promise<LaneVoice[]> {
  try {
    const res = await personaFetch(token, "/api/voices");
    if (!res.ok) return [];
    const data = (await res.json()) as { voices?: LaneVoice[] };
    return Array.isArray(data.voices) ? data.voices : [];
  } catch {
    return [];
  }
}

export interface LanePersona {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  gender: string | null;
  settings: LanePersonaSettings;
  isPublic: boolean;
  createdAt: string;
}

async function personaFetch(token: string | null, path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export async function fetchLanePersonas(token: string | null): Promise<LanePersona[]> {
  const res = await personaFetch(token, "/api/personas");
  if (!res.ok) throw new Error("Could not load personas.");
  const data = (await res.json()) as { personas?: LanePersona[] };
  return Array.isArray(data.personas) ? data.personas : [];
}

export async function createLanePersona(
  token: string | null,
  body: { name: string; gender: "male" | "female" | "neutral"; settings: LanePersonaSettings },
): Promise<LanePersona> {
  const res = await personaFetch(token, "/api/personas", {
    method: "POST",
    body: JSON.stringify({ name: body.name, description: "", gender: body.gender, settings: body.settings, isPublic: false }),
  });
  const data = (await res.json().catch(() => ({}))) as { persona?: LanePersona; error?: string };
  if (!res.ok || !data.persona) throw new Error(data.error || "Could not save that persona.");
  return data.persona;
}

export async function deleteLanePersona(token: string | null, id: string): Promise<void> {
  const res = await personaFetch(token, `/api/personas/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "Could not delete that persona.");
  }
}

/* ─── Lane session ─── */

export interface LaneSession {
  projectId: string | null;
  createMode: "simple" | "custom";
  prompt: string;
  style: string;
  title: string;
  lyrics: string;
  showLyrics: boolean;
  instrumental: boolean;
  vocalGender: string;
  lengthSeconds: string;
  variantCount: string;
  personaId: string | null;
  /** Singing voice selection (voice_id + display name), restored with the
   * session so a picked voice survives reloads like the persona does. */
  voiceId?: string | null;
  voiceName?: string | null;
  pickedVersion: { url: string; storagePath: string; name: string; durationSec?: number } | null;
  variants: Array<{ url: string; storagePath: string; label: string }>;
  pickedLabel: string;
  timestamp: number;
}

export const LANE_DRAFT_KEY = "bdv_draft_music_lane";
export const LANE_WORKFLOW = "music-lane";
const LANE_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadLocalLaneSession(projectId: string | null): LaneSession | null {
  try {
    const raw = localStorage.getItem(LANE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LaneSession;
    if (!parsed || typeof parsed !== "object") return null;
    if ((parsed.projectId ?? null) !== (projectId ?? null)) return null;
    if (Date.now() - (parsed.timestamp ?? 0) > LANE_DRAFT_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalLaneSession(session: LaneSession): void {
  try {
    localStorage.setItem(LANE_DRAFT_KEY, JSON.stringify(session));
  } catch {
    /* storage full/blocked — server draft still covers restore */
  }
}

export async function fetchServerLaneSession(
  token: string | null,
  projectId: string | null,
): Promise<LaneSession | null> {
  const res = await fetch(`/api/drafts?workflow=${LANE_WORKFLOW}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { drafts?: Array<{ draft_data?: LaneSession }> };
  const draft = data.drafts?.[0]?.draft_data;
  if (!draft || typeof draft !== "object") return null;
  if ((draft.projectId ?? null) !== (projectId ?? null)) return null;
  return draft;
}

export async function saveServerLaneSession(token: string | null, session: LaneSession): Promise<void> {
  await fetch("/api/drafts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      workflowType: LANE_WORKFLOW,
      title: session.title || "Music lane session",
      draftData: session,
    }),
  });
}
