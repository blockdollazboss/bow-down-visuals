/* ─── Press-release writer seam (stack1100 world parity) ─────────
   The last BUSINESS_NATIVE_FOLLOW_ONS bench entry graduates: the
   press-release writer that shares the 2D press-kit page
   (components/PressReleasePanel.tsx) now docks into the in-world
   Press Kit desk, on the panel's own rails:

     POST /api/press-release        → { release } — 100 Visual Bucs,
                                      charged by the rail, ridden
                                      through the credit confirmation
                                      (confirmedFetch) exactly like
                                      the page, cost pinned in
                                      lib/credit-costs.ts.
     PUT /api/press-kit/:id         → save the finished release into
                                      the kit's press_releases, the
                                      page's own append chain.

   The request body is the panel's, field for field (panel
   handleGenerate): quote / datelineCity omitted when blank,
   contactInfo always present, keyFacts the cleaned non-empty list.
   The .txt rendering is the panel's formatReleaseText, line for
   line (minus the opt-in attribution footer, which stays off
   in-world — nothing is added to a member's release unasked). */

export const PRESS_RELEASE_PATH = "/api/press-release";

/** The registry's pinned price (lib/credit-costs.ts:
 *  "/api/press-release": { cost: 100 }). The confirmation names it
 *  before the charge; the rail charges its own constant. */
export const PRESS_RELEASE_COST_VB = 100;

export const PRESS_RELEASE_FEATURE = "Press Release Generator";

export const ANNOUNCEMENT_TYPE_OPTIONS = [
  { key: "single", label: "New single" },
  { key: "album", label: "New album" },
  { key: "tour", label: "Tour" },
  { key: "launch", label: "Product / brand launch" },
  { key: "milestone", label: "Milestone" },
] as const;

export type AnnouncementTypeKey = (typeof ANNOUNCEMENT_TYPE_OPTIONS)[number]["key"];

export interface PressReleaseForm {
  announcementType: string;
  topic: string;
  artistName: string;
  /** One key fact per line — the panel's add-a-row list, flattened
   *  to the in-world idiom; the seam cleans it to the rail's array. */
  keyFactsText: string;
  quote: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  datelineCity: string;
}

export function cleanKeyFacts(text: string): string[] {
  return text
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
}

/** The rail's own rules (pressReleaseSchema): artist 1–120, topic
 *  10–2000, 1–8 facts each ≤200, quote ≤600, type in the enum. The
 *  desk checks before the confirmation so a member never confirms a
 *  charge for a body the rail would refuse. */
export function pressReleaseReady(form: PressReleaseForm): boolean {
  if (!ANNOUNCEMENT_TYPE_OPTIONS.some((t) => t.key === form.announcementType)) return false;
  const artist = form.artistName.trim();
  if (artist.length === 0 || artist.length > 120) return false;
  const topic = form.topic.trim();
  if (topic.length < 10 || topic.length > 2000) return false;
  const facts = cleanKeyFacts(form.keyFactsText);
  if (facts.length === 0 || facts.length > 8) return false;
  if (facts.some((f) => f.length > 200)) return false;
  if (form.quote.trim().length > 600) return false;
  return true;
}

export function buildPressReleaseBody(form: PressReleaseForm): Record<string, unknown> {
  return {
    announcementType: form.announcementType,
    topic: form.topic.trim(),
    artistName: form.artistName.trim(),
    keyFacts: cleanKeyFacts(form.keyFactsText),
    quote: form.quote.trim() || undefined,
    contactInfo: {
      name: form.contactName.trim(),
      email: form.contactEmail.trim(),
      phone: form.contactPhone.trim(),
    },
    datelineCity: form.datelineCity.trim() || undefined,
  };
}

export interface GeneratedRelease {
  headline: string;
  dateline: string;
  lede: string;
  body: string[];
  quote: string;
  boilerplate: string;
  contactBlock: string[];
  social: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Parse the rail's { release } answer. Null when the shape isn't
 *  the rail's — a charged generation that can't be read is a failed
 *  attempt, never a blank card over a paid result. */
export function parseGeneratedRelease(payload: unknown): GeneratedRelease | null {
  const root = asRecord(payload);
  const rel = root ? asRecord(root["release"]) : null;
  if (!rel) return null;
  const headline = str(rel["headline"]);
  const lede = str(rel["lede"]);
  if (!headline || !lede) return null;
  return {
    headline,
    dateline: str(rel["dateline"]),
    lede,
    body: strList(rel["body"]),
    quote: str(rel["quote"]),
    boilerplate: str(rel["boilerplate"]),
    contactBlock: strList(rel["contactBlock"]),
    social: str(rel["social"]),
  };
}

/** The panel's formatReleaseText, line for line: FOR IMMEDIATE
 *  RELEASE, headline, dateline — lede, body paragraphs, the quote
 *  attribution, the About boilerplate, the ### end mark, contacts. */
export function formatReleaseText(r: GeneratedRelease, artistName: string): string {
  const lines = [
    "FOR IMMEDIATE RELEASE",
    "",
    r.headline,
    "",
    r.dateline ? `${r.dateline} — ${r.lede}` : r.lede,
    "",
    ...r.body.flatMap((p) => [p, ""]),
    ...(r.quote ? [`"${r.quote}" — ${artistName}`, ""] : []),
    ...(r.boilerplate ? [`About ${artistName}`, r.boilerplate, ""] : []),
    "###",
    ...r.contactBlock,
  ];
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** The saved-kit entry, the panel's own shape (press-kit page type:
 *  { id, headline, body, announcementType, social, createdAt }). */
export interface PressKitReleaseEntry {
  id: string;
  headline: string;
  body: string;
  announcementType: string;
  social: string;
  createdAt: string;
}

export function buildKitReleaseEntry(
  release: GeneratedRelease,
  form: PressReleaseForm,
  now: Date,
): PressKitReleaseEntry {
  return {
    id: `pr-${now.getTime()}`,
    headline: release.headline,
    body: formatReleaseText(release, form.artistName.trim()),
    announcementType: form.announcementType,
    social: release.social,
    createdAt: now.toISOString(),
  };
}

/** Read a kit row's existing saved releases off GET
 *  /api/press-kit/mine's raw payload — the summary seam
 *  (parsePressKits) doesn't carry press_releases, and the append
 *  must start from the kit's real list or it would overwrite it. */
export function savedReleasesForKit(
  minePayload: unknown,
  kitId: string,
): PressKitReleaseEntry[] | null {
  const root = asRecord(minePayload);
  const kits = root?.["kits"];
  if (!Array.isArray(kits)) return null;
  for (const raw of kits) {
    const kit = asRecord(raw);
    if (!kit || kit["id"] !== kitId) continue;
    const releases = kit["press_releases"];
    if (!Array.isArray(releases)) return [];
    const out: PressKitReleaseEntry[] = [];
    for (const r of releases) {
      const row = asRecord(r);
      if (!row || typeof row["id"] !== "string" || typeof row["headline"] !== "string") return null;
      out.push({
        id: row["id"],
        headline: row["headline"],
        body: str(row["body"]),
        announcementType: str(row["announcementType"]),
        social: str(row["social"]),
        createdAt: str(row["createdAt"]),
      });
    }
    return out;
  }
  return null;
}
