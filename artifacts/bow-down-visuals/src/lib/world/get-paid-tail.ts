/**
 * get-paid-tail.ts — the pure logic behind the Get Paid Room's tail
 * desks (World Parity P3-F): the catalog-export BUILDER and the
 * succession/legacy settings desk, both native in-world at the
 * Earnings Board.
 *
 * The law, same as the other money desks: NOTHING is invented
 * here. Both rails already exist site-side in
 * api-server/src/routes/trust.ts; these desks are promotions of
 * them, and every kind, field, cap and payload mirrors the 2D
 * surface that owns the rail:
 *
 * - The export builder rides the Settings "Your whole catalog"
 *   builder (TrustPanels' CatalogExportPanel): POST
 *   /api/catalog-export/build { kind, fields, format } — one kind,
 *   only the fields the creator picks, downloaded as CSV or JSON.
 *   The kind/field options below mirror
 *   components/trust/catalog-export-options EXACTLY (which itself
 *   mirrors the server whitelist CATALOG_EXPORT_KINDS in
 *   routes/trust.ts — the server rejects anything else), and the
 *   lib test pins the mirror so drift breaks a test, not a user.
 *   The rail's row cap is the server's CATALOG_EXPORT_ROW_CAP
 *   (2,000): when a build hits it the response SAYS so
 *   (X-Export-Truncated + the JSON body's `truncated`), and the
 *   desk repeats that honestly instead of posing as the whole
 *   catalog. Audience is deliberately NOT a builder kind — it
 *   rides the full package (POST /api/catalog-export), which is
 *   not this desk.
 * - Succession rides TrustPanels' LegacySettings +
 *   LegacyContactSettings: GET/POST/DELETE
 *   /api/legacy/designation, GET /api/legacy/inbox + POST
 *   /api/legacy/inbox/:id/respond, GET/PUT/DELETE
 *   /api/legacy/contact — the panel's exact bodies. The
 *   designation names a Bow Down Visuals account (a UUID) that
 *   would take over the catalog and the page after MANUAL review;
 *   it never covers private messages or payment rails, and nothing
 *   transfers automatically. The legacy contact is a different
 *   record — any person the team should CONTACT — and promises no
 *   transfer, no payout and no legal effect. The form problems
 *   below mirror the server's zod bounds (heir a UUID;
 *   instructions ≤ 2,000; contact name 1–120, email valid ≤ 254,
 *   note ≤ 1,000) so the desk refuses the same bodies the server
 *   would 400, in the member's own words first.
 *
 * Everything here is pure (no fetch, no React) so the payload
 * shaping and parsing are unit-tested; the components stay thin.
 */

export { apiErrorLine } from "./money-desks";

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];

/* ─── Catalog-export builder ─────────────────────────────────────── */

export type CatalogExportKind = "tracks" | "releases" | "videos" | "projects" | "store";
export type CatalogExportFormat = "csv" | "json";

/** The builder's kinds — components/trust/catalog-export-options'
 *  CATALOG_EXPORT_KIND_OPTIONS, verbatim (labels included). */
export const CATALOG_EXPORT_KIND_OPTIONS: readonly { kind: CatalogExportKind; label: string }[] = [
  { kind: "tracks", label: "Tracks" },
  { kind: "releases", label: "Releases" },
  { kind: "videos", label: "Videos" },
  { kind: "projects", label: "Projects" },
  { kind: "store", label: "Store products" },
];

/** The builder's fields per kind — CATALOG_EXPORT_FIELD_OPTIONS,
 *  verbatim. Keys are the server whitelist's public field names. */
export const CATALOG_EXPORT_FIELD_OPTIONS: Record<CatalogExportKind, readonly { key: string; label: string }[]> = {
  tracks: [
    { key: "id", label: "ID" }, { key: "title", label: "Title" }, { key: "source", label: "Source" },
    { key: "durationSec", label: "Duration (sec)" }, { key: "fileUrl", label: "File link" }, { key: "createdAt", label: "Created" },
  ],
  releases: [
    { key: "id", label: "ID" }, { key: "title", label: "Title" }, { key: "artistName", label: "Artist" },
    { key: "status", label: "Status" }, { key: "fileUrl", label: "Audio link" }, { key: "artworkUrl", label: "Artwork link" },
    { key: "createdAt", label: "Created" },
  ],
  videos: [
    { key: "id", label: "ID" }, { key: "title", label: "Title" }, { key: "status", label: "Status" },
    { key: "fileUrl", label: "Video link" }, { key: "thumbnailUrl", label: "Thumbnail link" }, { key: "createdAt", label: "Created" },
  ],
  projects: [
    { key: "id", label: "ID" }, { key: "name", label: "Name" }, { key: "type", label: "Type" },
    { key: "concept", label: "Concept" }, { key: "templateKey", label: "Template" }, { key: "attribution", label: "Attribution" },
    { key: "artistVaultId", label: "Vault character" }, { key: "createdAt", label: "Created" }, { key: "updatedAt", label: "Updated" },
  ],
  store: [
    { key: "id", label: "ID" }, { key: "title", label: "Title" }, { key: "kind", label: "Kind" },
    { key: "priceCents", label: "Price (cents)" }, { key: "isActive", label: "Active" }, { key: "mediaUrls", label: "Media links" },
    { key: "createdAt", label: "Created" },
  ],
};

export const CATALOG_EXPORT_FORMAT_OPTIONS: readonly { format: CatalogExportFormat; label: string }[] = [
  { format: "csv", label: "CSV (spreadsheet)" },
  { format: "json", label: "JSON" },
];

/** The server's row cap (CATALOG_EXPORT_ROW_CAP in
 *  routes/trust.ts) — named so the desk's truncation line quotes
 *  the rail's own number. */
export const CATALOG_EXPORT_ROW_CAP = 2000;

export function exportKindLabel(kind: CatalogExportKind): string {
  return CATALOG_EXPORT_KIND_OPTIONS.find((o) => o.kind === kind)?.label ?? kind;
}

/** Every field key of a kind, in the whitelist's order — the
 *  desk's starting selection (the site builder starts from all
 *  fields too: its body omits `fields`, which the server reads
 *  as the full whitelist; the desk sends them explicitly so what
 *  was built is exactly what the member saw ticked). */
export function allExportFields(kind: CatalogExportKind): string[] {
  return CATALOG_EXPORT_FIELD_OPTIONS[kind].map((f) => f.key);
}

/** The desk-side refusal, in the member's words, for a build the
 *  server would 400: unknown kind, no fields picked (the rail
 *  requires at least one), or a field off the kind's whitelist. */
export function exportBuildProblem(kind: string, fields: readonly string[]): string | null {
  const def = (CATALOG_EXPORT_FIELD_OPTIONS as Record<string, readonly { key: string }[]>)[kind];
  if (!def) return "Choose a catalog kind — tracks, releases, videos, projects or store products.";
  if (fields.length === 0) return "Pick at least one field to include in the export.";
  const allowed = new Set(def.map((f) => f.key));
  const bad = fields.filter((f) => !allowed.has(f));
  if (bad.length > 0) return `${exportKindLabel(kind as CatalogExportKind)} has no field called ${bad.join(", ")}.`;
  return null;
}

export function exportBuildPath(): string {
  return "/api/catalog-export/build";
}

/** POST body for the build — the site builder's own shape:
 *  { kind, fields, format }, fields de-duplicated in the order
 *  the member ticked them. */
export function exportBuildPayload(
  kind: CatalogExportKind,
  fields: readonly string[],
  format: CatalogExportFormat,
): { kind: CatalogExportKind; fields: string[]; format: CatalogExportFormat } {
  return { kind, fields: [...new Set(fields)], format };
}

/** The download's filename — the server's own Content-Disposition
 *  name (my-catalog-<kind>.<format>), so the file the member
 *  saves in-world is the file the website would have given them. */
export function catalogFileName(kind: CatalogExportKind, format: CatalogExportFormat): string {
  return `my-catalog-${kind}.${format}`;
}

export interface ExportBuildResult {
  kind: CatalogExportKind;
  format: CatalogExportFormat;
  /** Rows the file carries — the JSON body's own `count`, or the
   *  CSV's data lines (header excluded). */
  count: number;
  /** The rail hit its 2,000-row cap and the file carries the
   *  newest rows only — the server says so, the desk repeats it. */
  truncated: boolean;
  exportedAt: string | null;
}

/** CSV data-row count: the body is header + one line per row,
 *  CRLF-joined with a trailing CRLF (routes/trust.ts's own
 *  rendering). Quoted cells can carry embedded newlines, so this
 *  counts RECORDS by the file's own terminator after the header —
 *  a count of lines, stated as rows; good enough for the desk's
 *  summary because the header flag, not this number, carries the
 *  truncation truth. Returns null when the text has no header. */
export function csvRowCount(text: string): number | null {
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  return lines.length - 1;
}

/** Shape the build's answer for the desk's result line. For JSON
 *  the body is the export document itself ({ count, truncated,
 *  exportedAt, rows }); for CSV the count comes from the file and
 *  truncation from the X-Export-Truncated header the component
 *  read before the body was consumed. Returns null when the body
 *  can't be read as that format's answer — the desk then reports
 *  the download without inventing a count. */
export function parseExportBuildResult(
  kind: CatalogExportKind,
  format: CatalogExportFormat,
  bodyText: string,
  truncatedHeader: boolean,
): ExportBuildResult | null {
  if (format === "json") {
    let doc: unknown;
    try { doc = JSON.parse(bodyText); } catch { return null; }
    if (!isObj(doc) || !Array.isArray(doc["rows"])) return null;
    const rows = doc["rows"] as unknown[];
    const count = typeof doc["count"] === "number" && Number.isFinite(doc["count"]) ? (doc["count"] as number) : rows.length;
    return {
      kind,
      format,
      count,
      truncated: doc["truncated"] === true || truncatedHeader,
      exportedAt: str(doc["exportedAt"]),
    };
  }
  const count = csvRowCount(bodyText);
  if (count === null) return null;
  return { kind, format, count, truncated: truncatedHeader, exportedAt: null };
}

/** The desk's honest one-liner after a build: what was built, how
 *  much of it, and — when the cap cut it — that the file holds
 *  the newest 2,000 rows, not the whole kind. */
export function exportResultLine(result: ExportBuildResult): string {
  const base = `Built: ${result.count.toLocaleString("en-US")} ${exportKindLabel(result.kind).toLowerCase()} · ${result.format.toUpperCase()} — downloading as ${catalogFileName(result.kind, result.format)}.`;
  return result.truncated
    ? `${base} That hit the ${CATALOG_EXPORT_ROW_CAP.toLocaleString("en-US")}-row cap, so the file carries your newest rows only.`
    : base;
}

/* ─── Succession / legacy ────────────────────────────────────────── */

export interface LegacyDesignation {
  id: string;
  /** The designating account (on inbox rows, this is the person
   *  who named the caller). */
  userId: string;
  heirUserId: string;
  status: string;
  instructions: string;
  includes: string[];
  excludes: string[];
  activation: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LegacyDesignationState {
  designation: LegacyDesignation | null;
  includes: string[];
  excludes: string[];
  activation: string;
}

function parseDesignation(raw: unknown): LegacyDesignation | null {
  if (!isObj(raw)) return null;
  const id = str(raw["id"]);
  const heirUserId = str(raw["heirUserId"]);
  if (!id || !heirUserId) return null;
  return {
    id,
    userId: str(raw["userId"]) ?? "",
    heirUserId,
    status: str(raw["status"]) ?? "pending",
    instructions: typeof raw["instructions"] === "string" ? raw["instructions"] : "",
    includes: stringList(raw["includes"]),
    excludes: stringList(raw["excludes"]),
    activation: str(raw["activation"]) ?? "manual_review",
    createdAt: str(raw["createdAt"]),
    updatedAt: str(raw["updatedAt"]),
  };
}

/** GET /api/legacy/designation — the caller's own designation
 *  plus the rail's standing includes/excludes/activation, which
 *  ride the payload whether or not a designation exists. */
export function parseLegacyDesignationState(payload: unknown): LegacyDesignationState | null {
  if (!isObj(payload)) return null;
  return {
    designation: parseDesignation(payload["designation"]),
    includes: stringList(payload["includes"]),
    excludes: stringList(payload["excludes"]),
    activation: str(payload["activation"]) ?? "manual_review",
  };
}

/** A write's answer ({ designation }) — the server's fresh truth
 *  for the one row, folded back into a designation. */
export function parseLegacyDesignationAnswer(payload: unknown): LegacyDesignation | null {
  if (!isObj(payload)) return null;
  return parseDesignation(payload["designation"]);
}

/** GET /api/legacy/inbox — designations naming the caller. */
export function parseLegacyInbox(payload: unknown): LegacyDesignation[] {
  if (!isObj(payload) || !Array.isArray(payload["designations"])) return [];
  const out: LegacyDesignation[] = [];
  for (const raw of payload["designations"]) {
    const d = parseDesignation(raw);
    if (d) out.push(d);
  }
  return out;
}

export interface LegacyContact {
  name: string;
  email: string;
  note: string;
}

/** GET /api/legacy/contact — null when no contact is recorded. */
export function parseLegacyContact(payload: unknown): LegacyContact | null {
  if (!isObj(payload) || !isObj(payload["contact"])) return null;
  const c = payload["contact"];
  const name = str(c["name"]);
  const email = str(c["email"]);
  if (!name || !email) return null;
  return { name, email, note: typeof c["note"] === "string" ? c["note"] : "" };
}

export function legacyDesignationPath(): string {
  return "/api/legacy/designation";
}
export function legacyInboxPath(): string {
  return "/api/legacy/inbox";
}
export function legacyRespondPath(id: string): string {
  return `/api/legacy/inbox/${encodeURIComponent(id)}/respond`;
}
export function legacyContactPath(): string {
  return "/api/legacy/contact";
}

/** POST /api/legacy/designation body — TrustPanels' own shape,
 *  verbatim: the heir's account id trimmed, instructions as
 *  typed (the server's zod trims and caps them). The desk seeds
 *  the instructions box from the loaded designation, like the
 *  panel, so a save carries the stored words back unless the
 *  member edits them. */
export function designationPayload(
  heirUserId: string,
  instructions: string,
): { heirUserId: string; instructions: string } {
  return { heirUserId: heirUserId.trim(), instructions };
}

/** PUT /api/legacy/contact body — the panel's own shape: name and
 *  email trimmed, note trimmed (an empty note rides as "", which
 *  the rail stores as no note). */
export function legacyContactPayload(
  name: string,
  email: string,
  note: string,
): { name: string; email: string; note: string } {
  return { name: name.trim(), email: email.trim(), note: note.trim() };
}

/** POST /api/legacy/inbox/:id/respond body. */
export function legacyRespondPayload(response: "accept" | "decline"): { response: "accept" | "decline" } {
  return { response };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The desk-side refusal for a designation the server would 400
 *  (heir must be an account UUID — z.string().uuid() — and
 *  instructions are capped at 2,000 characters). Self-naming is
 *  the server's own 400 and can't be checked here (the desk
 *  doesn't hold the caller's id) — its error line surfaces
 *  verbatim instead. */
export function designationProblem(heirUserId: string, instructions: string): string | null {
  const heir = heirUserId.trim();
  if (!heir) return "Enter your heir's account ID — ask them for it from their settings.";
  if (!UUID_RE.test(heir)) return "That doesn't look like an account ID — it should be the full ID from your heir's settings.";
  if (instructions.length > 2000) return "Instructions are capped at 2,000 characters — trim them and save again.";
  return null;
}

/** The desk-side refusal for a legacy contact the server would
 *  400 — legacyContactBody's bounds: name 1–120, a plausible email
 *  ≤ 254, note ≤ 1,000. The email check is deliberately the
 *  light shape test (one @, a dot after it); the server's zod
 *  email parse is the real gate and its refusal surfaces
 *  verbatim. */
export function legacyContactProblem(name: string, email: string, note: string): string | null {
  const n = name.trim();
  const e = email.trim();
  if (!n) return "Enter your legacy contact's name.";
  if (n.length > 120) return "Names are capped at 120 characters.";
  if (!e) return "Enter your legacy contact's email.";
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "That email doesn't look complete — check it and save again.";
  if (note.length > 1000) return "The note is capped at 1,000 characters — trim it and save again.";
  return null;
}

/** The standing line for the current designation, in the rail's
 *  own terms — or the honest absence. */
export function legacyDesignationLine(state: LegacyDesignationState): string {
  const d = state.designation;
  if (!d || d.status === "revoked") return "No designation recorded — your catalog and page have no named heir.";
  return `Current designation: ${d.status} — heir account ${d.heirUserId}.`;
}
