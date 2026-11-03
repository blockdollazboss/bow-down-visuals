/**
 * copyright-desk — the seam behind the Get Paid room's native
 * Copyright desk (stack1500 world parity wave #3, census
 * item 23; the census counted /copyright ABSENT from the
 * World before this wave).
 *
 * Source of truth: artifacts/api-server/src/routes/generate/
 * copyright.ts.
 *   POST /api/copyright/draft { workType, title (1–200),
 *     authors? (≤500), creationDate? (≤20), published?,
 *     publishedDate? (≤20), notes? (≤1000) }
 *     → { description, filingNotes: string[], creditsUsed,
 *         creditsRemaining }
 *   POST /api/copyright/ask { question (1–1000 chars),
 *     history (≤12 of {role, content}) }
 *     → { answer, creditsUsed, creditsRemaining }
 *
 * PRICE: both rails are 100 Visual Bucs, pinned from the
 * registry rows ("/api/copyright/draft" = "Copyright Filing
 * Draft", "/api/copyright/ask" = "Copyright Answer") —
 * matching the route's COPYRIGHT_DRAFT_CREDITS /
 * COPYRIGHT_ASK_CREDITS (env-overridable, default 100) and
 * the page's badges. The desk runs both through the World's
 * confirmed-spend seam: a decline runs nothing; a 402 lands
 * in the out-of-Bucs state.
 *
 * NOT the desk's: the page's DMCA intake is a separate PUBLIC
 * form on its own rail — no account, no charge — and stays a
 * website surface; the desk covers the two member rails.
 *
 * The disclaimer is the page's own words, rendered verbatim:
 * "Bow Down Visuals is not a law firm and this page is not
 * legal advice…" The draft guard mirrors the page's bar: a
 * draft needs its description; filing notes ride as the
 * string list the rail sends.
 */
import { getCreditCost } from "../credit-costs";

export const COPYRIGHT_DRAFT_PATH = "/api/copyright/draft";
export const COPYRIGHT_ASK_PATH = "/api/copyright/ask";
export const COPYRIGHT_FEATURE_DRAFT = "Copyright Filing Draft";
export const COPYRIGHT_FEATURE_ASK = "Copyright Answer";

function registryCost(path: string): number {
  const row = getCreditCost(path);
  if (!row) throw new Error(`copyright-desk: no credit-cost registry row for ${path}`);
  return row.cost;
}

export const COPYRIGHT_DRAFT_COST = registryCost(COPYRIGHT_DRAFT_PATH);
export const COPYRIGHT_ASK_COST = registryCost(COPYRIGHT_ASK_PATH);

export const COPYRIGHT_DISCLAIMER =
  "Bow Down Visuals is not a law firm and this page is not legal advice. Copyright law has edge cases — for disputes, transfers, or anything high-stakes, consult an intellectual property attorney.";

export const COPYRIGHT_WORK_TYPES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "song", label: "Song (musical composition — melody + lyrics)" },
  { key: "sound-recording", label: "Sound recording (the recorded track/master)" },
  { key: "lyrics", label: "Lyrics (words only, no melody claimed)" },
  { key: "music-video", label: "Music video (audiovisual work)" },
  { key: "album", label: "Album / EP (group of works released together)" },
];

export interface CopyrightDraftForm {
  workType: string;
  title: string;
  authors: string;
  creationDate: string;
  published: boolean;
  publishedDate: string;
  notes: string;
}

export function buildCopyrightDraftPayload(form: CopyrightDraftForm): Record<string, unknown> | null {
  const title = form.title.trim();
  if (!title) return null;
  if (!COPYRIGHT_WORK_TYPES.some((t) => t.key === form.workType)) return null;
  return {
    workType: form.workType,
    title: title.slice(0, 200),
    authors: form.authors.trim().slice(0, 500),
    creationDate: form.creationDate.trim().slice(0, 20),
    published: form.published,
    publishedDate: form.published ? form.publishedDate.trim().slice(0, 20) : "",
    notes: form.notes.trim().slice(0, 1000),
  };
}

export interface CopyrightChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function buildCopyrightAskPayload(
  question: string,
  history: CopyrightChatMessage[],
): { question: string; history: CopyrightChatMessage[] } {
  return { question: question.trim(), history: history.slice(-12) };
}

export interface CopyrightDraft {
  description: string;
  filingNotes: string[];
}

/** The page's bar: a draft needs its description string. */
export function copyrightDraftOf(data: unknown): CopyrightDraft | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const description = typeof o["description"] === "string" ? o["description"].trim() : "";
  if (!description) return null;
  return {
    description,
    filingNotes: (Array.isArray(o["filingNotes"]) ? o["filingNotes"] : [])
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      .map((n) => n.trim()),
  };
}

export function copyrightAnswerOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const answer = (data as Record<string, unknown>)["answer"];
  return typeof answer === "string" && answer.trim().length > 0 ? answer : null;
}
