/* ─── DM attachments + search for the website messages page ──────────────
   STACK-20 R2 #6 (UPGRADE-PROGRAM 2.17, website half). The server rail
   and the World Post Office desk shipped in Ring 2: POST
   /api/dm/attachments/upload lands a file in permanent storage under
   the sender's own dm/<userId>/ prefix (the publish pipeline,
   mirror-on-save), POST /api/dm/:id/send carries ONE attachment, and
   every read mints a fresh URL from the stored permanent ref. Size
   caps mirror the site's publish rules: images 10 MB, audio/video
   80 MB (enforced server-side).

   The website page never grew the client half: its Msg/Conv types
   dropped the attachment fields the shared DTO already sends, so a
   beat handed off in the World rendered as an empty bubble here, and
   the page had no attach control and no search at all. This seam is
   the page's own mirror of the desk's semantics (lib/world/
   social-desk.ts) — same labels, same haystacks, same honesty: an
   attachment is never silently dropped, and search says what it
   covers. */

export const DM_ATTACHMENT_UPLOAD_PATH = "/api/dm/attachments/upload";

/* The thread fetch (GET /api/dm/:id/messages) defaults to the latest
   50 messages; the page loads exactly that window, so thread search
   covers the loaded window — the search copy says so. */
export const DM_THREAD_LOADED_COUNT = 50;

export type DmKnownKind = "audio" | "image" | "video";

/** The attachment as the page keeps it. `type` stays the raw DTO
 *  string: the three known kinds get players, anything else still
 *  renders as a named file row — never nothing. */
export interface PageDmAttachment {
  url: string;
  type: string;
  name: string;
}

interface DmAttachmentFields {
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
}

/** The attachment a message carries (or null). Needs an openable URL
 *  and the work's name; a missing type degrades to the file row. */
export function dmAttachmentOf(m: DmAttachmentFields): PageDmAttachment | null {
  if (!m.attachment_url || !m.attachment_name) return null;
  return { url: m.attachment_url, type: m.attachment_type ?? "", name: m.attachment_name };
}

/** Which player a piece of work gets; unknown kinds get the file row. */
export function dmAttachmentRenderKind(att: PageDmAttachment): DmKnownKind | "file" {
  return att.type === "audio" || att.type === "image" || att.type === "video" ? att.type : "file";
}

/** How a piece of work is introduced — a creator hand-off is the work
 *  it is, never a bare file (the desk's words, verbatim). */
export function dmWorkLabel(type: string): string {
  return type === "audio" ? "Beat" : type === "video" ? "Clip" : type === "image" ? "Artwork" : "File";
}

/** The conversation-list preview line: the words when there are
 *  words, the work's name when the last message was a hand-off. */
export function dmPreviewLine(
  last: { body: string; attachment_type?: string | null; attachment_name?: string | null } | null,
): string {
  if (!last) return "No messages yet";
  if (last.body.trim().length > 0) return last.body;
  if (last.attachment_name) return `${dmWorkLabel(last.attachment_type ?? "")}: ${last.attachment_name}`;
  return "No messages yet";
}

/** Classify a picked file by MIME, the way the server's upload filter
 *  does (audio/*, video/*, image/* — anything else can't ride). */
export function dmKindForMime(mime: string): DmKnownKind | null {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  return null;
}

const DM_EXT_KIND: Record<string, DmKnownKind> = {
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio", aac: "audio",
  mp4: "video", mov: "video", webm: "video", m4v: "video",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", avif: "image",
};

/** Classify a by-URL attachment from its file extension; a URL whose
 *  kind can't be told can't be attached (the server validates too). */
export function dmKindForUrl(url: string): DmKnownKind | null {
  try {
    const m = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(new URL(url.trim()).pathname);
    return m ? (DM_EXT_KIND[m[1]!.toLowerCase()] ?? null) : null;
  } catch {
    return null;
  }
}

/** The file's own name out of a URL (what the work is titled). */
export function dmNameForUrl(url: string): string {
  try {
    const last = new URL(url.trim()).pathname.split("/").filter(Boolean).pop() ?? "";
    const name = decodeURIComponent(last).trim();
    return name.length > 0 ? name.slice(0, 200) : "Shared work";
  } catch {
    return "Shared work";
  }
}

/** A send may carry words, a piece of work, or both — never neither
 *  (the server's refine says the same). */
export function dmCanSend(body: string, hasAttachment: boolean): boolean {
  return body.trim().length > 0 || hasAttachment;
}

/* ─── Search ──────────────────────────────────────────────────────────── */

function dmHaystack(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((p) => typeof p === "string").join(" ").toLowerCase();
}

export function dmNormalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Search inside the loaded thread window: words and work titles
 *  both count (the desk's haystack, mirrored). */
export function dmMessageHit(
  m: { body: string; attachment_name?: string | null },
  query: string,
): boolean {
  const q = dmNormalizeQuery(query);
  if (!q) return true;
  return dmHaystack([m.body, m.attachment_name]).includes(q);
}

/** Search the conversation list: the creator's name, their slug, the
 *  last words, or the title of the last piece of work sent. */
export function dmConversationHit(
  c: {
    other: { profile: { displayName: string; slug: string } | null };
    last_message: { body: string; attachment_name?: string | null } | null;
  },
  query: string,
): boolean {
  const q = dmNormalizeQuery(query);
  if (!q) return true;
  return dmHaystack([
    c.other.profile?.displayName, c.other.profile?.slug,
    c.last_message?.body, c.last_message?.attachment_name,
  ]).includes(q);
}

/** Split a message body around every case-insensitive match so the
 *  page can light the match up in place. An empty query yields the
 *  whole body as one un-hit segment. */
export function dmHighlightSegments(
  text: string,
  query: string,
): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at === -1) break;
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + needle.length), hit: true });
    i = at + needle.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}
