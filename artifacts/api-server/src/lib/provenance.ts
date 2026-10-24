import PDFDocument from "pdfkit";

/* ─── Provenance & AI-disclosure kit (Stack-100 #3, feature lane F7) ──────
   Every asset a creator makes here gets a provenance record: what made it
   (tool + model where the rail is known), who made it, when, and a factual
   summary of its history — derived from data the platform already stores
   (generation_history rows + hub-project asset entries), never invented.
   On top of the record sit two things destinations and brand lawyers ask
   for: an AI-disclosure line (embedded in exported files when the export
   toggle is on — see lib/disclosure-metadata.ts) and a downloadable
   licence certificate stating the creator's chosen terms for the asset.

   Honest scope: this is a records + metadata layer. It is NOT C2PA
   signing — Content Credentials require a trusted signing certificate
   the platform does not hold, and faking a signature would be worse than
   none. The records here are the layer a future C2PA signer would sign. */

export const PROVENANCE_PLATFORM = "Bow Down Visuals";

/* ─── Licence catalogue ───────────────────────────────────────────────────
   The licences a creator can state for their own asset. The site's beats
   licences (Basic / Premium / Exclusive in routes/generate/beats-pricing)
   are sale tiers for other people's beats — not terms a creator states
   for their own work — so the certificate uses this small standard set.
   Default is All Rights Reserved: a creator keeps every right until they
   say otherwise. */
export type LicenceId =
  | "all-rights-reserved"
  | "cc-by-4.0"
  | "cc-by-sa-4.0"
  | "cc-by-nc-4.0"
  | "cc0-1.0";

export interface AssetLicence {
  id: LicenceId;
  name: string;
  /** Plain-language statement of what the licence means, printed on the certificate. */
  summary: string;
  /** Canonical public text of the licence (null for All Rights Reserved — there is no deed). */
  url: string | null;
}

export const ASSET_LICENCES: readonly AssetLicence[] = [
  {
    id: "all-rights-reserved",
    name: "All Rights Reserved",
    summary:
      "The creator keeps every right in this work. Nobody may copy, distribute, adapt, or use it — commercially or otherwise — without the creator's written permission first.",
    url: null,
  },
  {
    id: "cc-by-4.0",
    name: "CC BY 4.0 — Creative Commons Attribution",
    summary:
      "Anyone may share and adapt this work for any purpose, including commercially, as long as they credit the creator, link back to the licence, and say what they changed.",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  {
    id: "cc-by-sa-4.0",
    name: "CC BY-SA 4.0 — Creative Commons Attribution-ShareAlike",
    summary:
      "Anyone may share and adapt this work for any purpose, including commercially, as long as they credit the creator and license anything they make from it under these same terms.",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  {
    id: "cc-by-nc-4.0",
    name: "CC BY-NC 4.0 — Creative Commons Attribution-NonCommercial",
    summary:
      "Anyone may share and adapt this work for non-commercial purposes only, as long as they credit the creator. Commercial use requires the creator's separate permission.",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
  },
  {
    id: "cc0-1.0",
    name: "CC0 1.0 — Public Domain Dedication",
    summary:
      "The creator waives every right in this work, worldwide, to the fullest extent the law allows. Anyone may use it for any purpose without permission or credit.",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
];

export const DEFAULT_LICENCE_ID: LicenceId = "all-rights-reserved";

export function isLicenceId(value: unknown): value is LicenceId {
  return typeof value === "string" && ASSET_LICENCES.some((l) => l.id === value);
}

export function licenceById(id: LicenceId): AssetLicence {
  return ASSET_LICENCES.find((l) => l.id === id) ?? ASSET_LICENCES[0]!;
}

/* ─── Tool / model derivation ─────────────────────────────────────────────
   Facts only: the tool is the surface the row itself names; the model is
   stated only where the producing rail pins one in code. Anything else
   reports model: null — the record never guesses a model. */
const MUSIC_MODEL_LABEL = `ElevenLabs Music (${process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5"})`;

const GENERATION_TYPE_FACTS: Record<string, { tool: string; model: string | null }> = {
  "Make a Song": { tool: "Make a Song", model: MUSIC_MODEL_LABEL },
  "Generate Audio": { tool: "Song Generator", model: MUSIC_MODEL_LABEL },
  "Extend Audio": { tool: "Song Extender", model: MUSIC_MODEL_LABEL },
  "Hum to Song": { tool: "Hum to Song", model: MUSIC_MODEL_LABEL },
  "Inspo Mode Song": { tool: "Inspo Mode Song", model: MUSIC_MODEL_LABEL },
  "Song Cover": { tool: "Song Cover", model: MUSIC_MODEL_LABEL },
  "Harmony Generator": { tool: "Harmony Generator", model: MUSIC_MODEL_LABEL },
  "Make Song + Video": { tool: "Make Song + Video", model: MUSIC_MODEL_LABEL },
  "Make a Music Video": { tool: "Make a Music Video", model: null },
  "Generate Beat": { tool: "Beat Maker", model: null },
  "Auto Director Plan": { tool: "Auto Director", model: null },
  runway_video_clip: { tool: "AI Video Clip", model: "Runway" },
  lip_sync_clip: { tool: "Lip Sync", model: null },
  thumbnail: { tool: "Thumbnail Studio", model: null },
  spotify_canvas: { tool: "Spotify Canvas", model: null },
};

const HUB_KIND_TOOLS: Record<string, string> = {
  beat: "Beat Maker",
  song: "Song desk",
  sfx: "SFX Generator",
  hum: "Hum to Song",
  stems: "Stem Splitter",
  video: "Video studio",
  clip: "Video Editor",
  image: "Image studio",
  thumbnail: "Thumbnail Studio",
  script: "Script desk",
  other: "Bow Down Visuals studio",
};

export function toolFactsForGenerationType(generationType: string | null): { tool: string; model: string | null } {
  if (generationType && GENERATION_TYPE_FACTS[generationType]) return GENERATION_TYPE_FACTS[generationType]!;
  return { tool: generationType || "Bow Down Visuals studio", model: null };
}

export function toolForHubKind(hubKind: string | null): string {
  return (hubKind && HUB_KIND_TOOLS[hubKind]) || "Bow Down Visuals studio";
}

/* ─── The record ────────────────────────────────────────────────────────── */
export type ProvenanceMediaKind = "audio" | "video" | "image" | "stems" | "script" | "other";

export interface ProvenanceRecord {
  /** Library asset id, e.g. "gen:<uuid>" or "hub:<uuid>". */
  assetId: string;
  title: string;
  mediaKind: ProvenanceMediaKind;
  creator: { id: string; name: string | null };
  createdWith: { tool: string; model: string | null; platform: string };
  createdAt: string; // ISO
  /** True when the asset came out of a generation rail (vs an upload). */
  aiGenerated: boolean;
  /** Factual history lines, oldest first — only what stored data proves. */
  editHistory: string[];
  licence: LicenceId;
  /** What the export doors do unless the creator turns it off per export. */
  disclosureDefaultEnabled: boolean;
}

export const DISCLOSURE_DEFAULT_ENABLED = true;

export interface ProvenanceDerivationInput {
  assetId: string;
  title: string;
  mediaKind: ProvenanceMediaKind;
  origin: "project" | "generation";
  creatorId: string;
  creatorName: string | null;
  createdAt: string;
  generationType?: string | null;
  hubKind?: string | null;
  hubDetail?: string | null;
  prompt?: string | null;
  creditsUsed?: number | null;
  saveStatus?: string | null;
  storedLicence?: unknown;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function buildProvenanceRecord(input: ProvenanceDerivationInput): ProvenanceRecord {
  const facts =
    input.origin === "generation"
      ? toolFactsForGenerationType(input.generationType ?? null)
      : { tool: toolForHubKind(input.hubKind ?? null), model: null as string | null };

  const day = input.createdAt.slice(0, 10);
  const editHistory: string[] = [];
  if (input.origin === "generation") {
    editHistory.push(`Created ${day} with ${facts.tool}${facts.model ? ` · ${facts.model}` : ""} on ${PROVENANCE_PLATFORM}.`);
    if (input.prompt && input.prompt.trim()) {
      editHistory.push(`Prompt: "${truncate(input.prompt.trim(), 140)}"`);
    }
    if (typeof input.creditsUsed === "number" && input.creditsUsed > 0) {
      editHistory.push(`Generation cost: ${input.creditsUsed} Visual Bucs.`);
    }
    if (input.saveStatus === "saved") editHistory.push("Saved to the creator's library.");
  } else {
    editHistory.push(`Added to the library ${day}${input.hubDetail ? ` — ${input.hubDetail}` : ""}.`);
  }

  return {
    assetId: input.assetId,
    title: input.title || "Untitled asset",
    mediaKind: input.mediaKind,
    creator: { id: input.creatorId, name: input.creatorName },
    createdWith: { tool: facts.tool, model: facts.model, platform: PROVENANCE_PLATFORM },
    createdAt: input.createdAt,
    aiGenerated: input.origin === "generation",
    editHistory,
    licence: isLicenceId(input.storedLicence) ? input.storedLicence : DEFAULT_LICENCE_ID,
    disclosureDefaultEnabled: DISCLOSURE_DEFAULT_ENABLED,
  };
}

/* ─── Disclosure lines ──────────────────────────────────────────────────── */
const MEDIA_NOUNS: Record<ProvenanceMediaKind, string> = {
  audio: "track",
  video: "video",
  image: "image",
  stems: "audio",
  script: "work",
  other: "work",
};

/** The full disclosure sentence — used in export descriptions + certificates. */
export function aiDisclosureLine(record: Pick<ProvenanceRecord, "mediaKind" | "createdWith">): string {
  const noun = MEDIA_NOUNS[record.mediaKind] ?? "work";
  const model = record.createdWith.model ? ` (${record.createdWith.model})` : "";
  return `This ${noun} was created with AI assistance using ${record.createdWith.tool}${model} on ${PROVENANCE_PLATFORM}.`;
}

/** The compact form that rides inside file metadata (ID3 / MP4 / XMP). */
export function aiDisclosureMetadataText(record: Pick<ProvenanceRecord, "createdWith">): string {
  const model = record.createdWith.model ? ` · ${record.createdWith.model}` : "";
  return `AI-generated content · Made with ${record.createdWith.tool}${model} on ${PROVENANCE_PLATFORM} — bowdownvisuals.com`;
}

/* ─── Licence certificate ─────────────────────────────────────────────────
   Content is modelled separately from the PDF so the wording itself is
   testable, and the PDF is generated uncompressed so any holder can
   verify its text in the raw bytes — a certificate you cannot read back
   is decoration, not proof. No signature block and no C2PA claim: this
   certificate records the creator's stated terms, nothing more. */
export interface CertificateContent {
  heading: string;
  lines: { label: string; value: string }[];
  licenceName: string;
  licenceSummary: string;
  licenceUrl: string | null;
  statement: string;
  recordId: string;
  issuedAt: string; // ISO
}

export function certificateContent(record: ProvenanceRecord, issuedAt = new Date()): CertificateContent {
  const licence = licenceById(record.licence);
  return {
    heading: "Licence Certificate",
    lines: [
      { label: "Work", value: record.title },
      { label: "Creator", value: record.creator.name ?? "Bow Down Visuals creator" },
      { label: "Created with", value: `${record.createdWith.tool}${record.createdWith.model ? ` · ${record.createdWith.model}` : ""} on ${record.createdWith.platform}` },
      { label: "Created on", value: record.createdAt.slice(0, 10) },
      { label: "AI involvement", value: record.aiGenerated ? aiDisclosureLine(record) : "No AI generation is recorded for this work." },
    ],
    licenceName: licence.name,
    licenceSummary: licence.summary,
    licenceUrl: licence.url,
    statement:
      "This certificate records the licence the creator selected for this work in their Bow Down Visuals provenance record. It is a true copy of that stated licence — not a legal filing, a notarization, or a Content Credentials (C2PA) credential.",
    recordId: record.assetId,
    issuedAt: issuedAt.toISOString(),
  };
}

const CERT_GOLD = "#d4af37";
const CERT_PARCHMENT = "#f5efe0";
const CERT_MUTED = "#b8ab8a";
const CERT_INK = "#14100a";

export function buildLicenceCertificatePdf(
  record: ProvenanceRecord,
  opts: { logoPng?: Buffer | null; issuedAt?: Date } = {},
): Promise<Buffer> {
  const content = certificateContent(record, opts.issuedAt ?? new Date());
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 56, bottom: 56, left: 56, right: 56 },
      compress: false,
      info: {
        Title: `${content.heading} — ${record.title}`,
        Author: record.creator.name ?? PROVENANCE_PLATFORM,
        Subject: `Licence for "${record.title}" (${content.licenceName})`,
        Keywords: "licence, provenance, Bow Down Visuals",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    /* Dark certificate ground, gold frame — the house marble-and-gold read,
       drawn (not imaged) so the page is identical with or without the logo. */
    doc.save().rect(0, 0, pageW, pageH).fill(CERT_INK).restore();
    doc.save().lineWidth(2).strokeColor(CERT_GOLD).rect(24, 24, pageW - 48, pageH - 48).stroke().restore();
    doc.save().lineWidth(0.75).strokeColor(CERT_MUTED).rect(32, 32, pageW - 64, pageH - 64).stroke().restore();

    let y = 64;
    if (opts.logoPng) {
      /* The whole lockup, untouched — scale + placement only. */
      doc.image(opts.logoPng, pageW / 2 - 90, y, { width: 180 });
      y += 190;
    } else {
      doc.fillColor(CERT_GOLD).font("Helvetica-Bold").fontSize(24).text("BOW DOWN VISUALS", 56, y, { align: "center" });
      y += 34;
      doc.fillColor(CERT_MUTED).font("Helvetica").fontSize(10).text("THE CONTENT CREATOR'S CHEAT CODE", 56, y, { align: "center" });
      y += 30;
    }

    doc.fillColor(CERT_PARCHMENT).font("Helvetica-Bold").fontSize(22).text(content.heading.toUpperCase(), 56, y, { align: "center" });
    y += 40;

    for (const line of content.lines) {
      doc.fillColor(CERT_MUTED).font("Helvetica-Bold").fontSize(9).text(line.label.toUpperCase(), 72, y);
      doc.fillColor(CERT_PARCHMENT).font("Helvetica").fontSize(12).text(line.value, 190, y - 2, { width: pageW - 190 - 72 });
      y += 30;
    }

    y += 10;
    doc.save().moveTo(72, y).lineTo(pageW - 72, y).lineWidth(1).strokeColor(CERT_GOLD).stroke().restore();
    y += 22;
    doc.fillColor(CERT_GOLD).font("Helvetica-Bold").fontSize(13).text(content.licenceName, 72, y, { width: pageW - 144 });
    y += 24;
    doc.fillColor(CERT_PARCHMENT).font("Helvetica").fontSize(11).text(content.licenceSummary, 72, y, { width: pageW - 144, lineGap: 4 });
    y += doc.heightOfString(content.licenceSummary, { width: pageW - 144, lineGap: 4 }) + 14;
    if (content.licenceUrl) {
      doc.fillColor(CERT_MUTED).font("Helvetica").fontSize(10).text(`Full licence text: ${content.licenceUrl}`, 72, y, { width: pageW - 144 });
      y += 26;
    }

    doc.fillColor(CERT_MUTED).font("Helvetica-Oblique").fontSize(9).text(content.statement, 72, y, { width: pageW - 144, lineGap: 3 });
    doc
      .fillColor(CERT_MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(`Provenance record: ${content.recordId} · Certificate issued: ${content.issuedAt.slice(0, 10)}`, 72, pageH - 84, { width: pageW - 144, align: "center" });

    doc.end();
  });
}
