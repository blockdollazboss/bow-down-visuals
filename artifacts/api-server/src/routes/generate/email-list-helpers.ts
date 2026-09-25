/**
 * Email List Builder — pure helpers (pricing, validation, prompt building,
 * CSV export). Kept free of Express/DB imports so unit tests stay fast.
 */

/* 1 credit per AI newsletter draft — env-overridable without a deploy.
   A newsletter draft is a short GPT-6 Sol completion (a fraction of a cent
   in provider fees), so 1 credit holds a deep margin while honoring the
   standing rule that every AI feature costs a fee. Everything else on the
   page (lists, subscribers, dashboard, export) is pure interface/data —
   free per the pricing rule. */
export const EMAIL_NEWSLETTER_CREDIT_COST =
  Number(process.env["EMAIL_NEWSLETTER_CREDIT_COST"]) || 1;

export const EMAIL_FREE_SUBSCRIBER_LIMIT = 1000;

const RESERVED_HANDLES = new Set([
  "admin", "api", "app", "dashboard", "join", "login", "signup",
  "settings", "pricing", "support", "help", "blog", "news",
]);

export function isHandleAvailable(handle: string): boolean {
  return !RESERVED_HANDLES.has(handle.toLowerCase());
}

const HANDLE_RE = /^[a-z0-9-]{3,40}$/;

export function isValidHandle(handle: string): boolean {
  return HANDLE_RE.test(handle) && isHandleAvailable(handle);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email.trim());
}

/* Newsletter tones — keys must stay in sync with the frontend. */
export const NEWSLETTER_TONES = [
  "hype",
  "behind-the-scenes",
  "personal",
  "announcement",
] as const;
export type NewsletterTone = (typeof NEWSLETTER_TONES)[number];

const TONE_DIRECTION: Record<NewsletterTone, string> = {
  "hype": "high-energy, confident, celebration mode — big news energy",
  "behind-the-scenes": "intimate studio-diary voice — process, struggles, wins",
  "personal": "warm and direct, like a letter to a close friend",
  "announcement": "clear and punchy — the facts up front, excitement after",
};

export function isNewsletterTone(t: unknown): t is NewsletterTone {
  return typeof t === "string" && (NEWSLETTER_TONES as readonly string[]).includes(t);
}

export interface NewsletterBrief {
  topic: string;
  tone: NewsletterTone;
  creatorName: string;
  listName: string;
  callToAction?: string;
}

/* Builds the system prompt for the AI newsletter writer. Uses
   max_completion_tokens at the call site (never max_tokens — GPT-6
   rejects it). */
export function buildNewsletterPrompt(brief: NewsletterBrief): string {
  const ctaLine = brief.callToAction?.trim()
    ? ` End with this call to action: "${brief.callToAction.trim()}".`
    : ` End with a natural call to action (reply to the email, stream the song, etc.).`;
  return (
    `You are a newsletter ghostwriter for independent music creators. ` +
    `Write a fan newsletter for "${brief.creatorName}" (list: "${brief.listName}"). ` +
    `Tone: ${TONE_DIRECTION[brief.tone]}. ` +
    `The newsletter is about: "${brief.topic}". ` +
    `Structure: (1) a subject line under 50 characters that earns the open, ` +
    `(2) a warm opening line, (3) 3-5 short paragraphs with personality and ` +
    `zero corporate speak, (4) one clear call to action. ` +
    `Write in the creator's first-person voice, speaking directly to fans ("you").` +
    ctaLine +
    ` Return ONLY JSON: {"subject": "...", "body": "..."} — body may use ` +
    `plain-text paragraphs separated by blank lines.`
  );
}

export interface NewsletterDraft {
  subject: string;
  body: string;
}

/* Parses the model response defensively — never throws on malformed JSON. */
export function parseNewsletterDraft(raw: string): NewsletterDraft | null {
  try {
    const parsed = JSON.parse(raw) as { subject?: unknown; body?: unknown };
    const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
    const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
    if (!subject || !body) return null;
    return { subject: subject.slice(0, 200), body: body.slice(0, 50000) };
  } catch {
    return null;
  }
}

/* CSV export — quotes fields containing commas, quotes, or newlines. */
export function subscribersToCsv(
  rows: Array<{ email: string; name?: string | null; subscribedAt: string; source: string }>
): string {
  const escape = (v: string): string =>
    /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const lines = ["email,name,subscribed_at,source"];
  for (const r of rows) {
    lines.push(
      [r.email, r.name ?? "", r.subscribedAt, r.source].map(escape).join(",")
    );
  }
  return lines.join("\n");
}

/* Embeddable signup form snippet for the creator's own site. */
export function buildEmbedSnippet(handle: string, listName: string): string {
  const action = `https://bowdownvisuals.com/api/email-list/subscribe`;
  return (
    `<!-- ${listName} — email signup (Bow Down Visuals) -->\n` +
    `<form action="${action}" method="POST" ` +
    `style="display:flex;gap:8px;max-width:420px">\n` +
    `  <input type="hidden" name="handle" value="${handle}" />\n` +
    `  <input type="email" name="email" required placeholder="you@example.com" ` +
    `style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid #3a2f12;background:#0a0a0a;color:#fff" />\n` +
    `  <button type="submit" ` +
    `style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#d4af37,#8a6d1b);color:#000;font-weight:700;cursor:pointer">Join</button>\n` +
    `</form>`
  );
}
