/* Provenance & AI-disclosure kit (Stack-100 #3 lane F7) — the record layer.
 * Facts only: derivation states a model only where the producing rail pins
 * one; the certificate's wording is modelled separately from its PDF so
 * both can be pinned; the PDF is generated uncompressed so its text is
 * verifiable in the raw bytes. */
import { describe, it, expect } from "vitest";
import {
  ASSET_LICENCES,
  DEFAULT_LICENCE_ID,
  DISCLOSURE_DEFAULT_ENABLED,
  aiDisclosureLine,
  aiDisclosureMetadataText,
  aiInvolvementCertificateLine,
  buildLicenceCertificatePdf,
  buildProvenanceRecord,
  certificateContent,
  isLicenceId,
  licenceById,
  toolFactsForGenerationType,
  toolForHubKind,
  type ProvenanceRecord,
} from "../provenance";
import { generationLinkageByUrl } from "../asset-library";

describe("licence catalogue", () => {
  it("has unique ids, https deed urls, and the conservative default", () => {
    const ids = ASSET_LICENCES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_LICENCE_ID).toBe("all-rights-reserved");
    for (const licence of ASSET_LICENCES) {
      expect(licence.name.length).toBeGreaterThan(3);
      expect(licence.summary.length).toBeGreaterThan(40);
      if (licence.url !== null) expect(licence.url).toMatch(/^https:\/\/creativecommons\.org\//);
    }
    expect(licenceById("all-rights-reserved").url).toBeNull();
  });

  it("isLicenceId accepts only catalogue ids", () => {
    expect(isLicenceId("cc-by-4.0")).toBe(true);
    expect(isLicenceId("cc0-1.0")).toBe(true);
    expect(isLicenceId("mit")).toBe(false);
    expect(isLicenceId("")).toBe(false);
    expect(isLicenceId(null)).toBe(false);
    expect(isLicenceId(42)).toBe(false);
  });
});

describe("tool/model derivation — facts only", () => {
  it("song rails name the pinned ElevenLabs music model", () => {
    const facts = toolFactsForGenerationType("Make a Song");
    expect(facts.tool).toBe("Make a Song");
    expect(facts.model).toContain("ElevenLabs Music");
    expect(facts.model).toContain(process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5");
  });

  it("runway clips name Runway", () => {
    expect(toolFactsForGenerationType("runway_video_clip")).toEqual({ tool: "AI Video Clip", model: "Runway" });
  });

  it("unknown types keep their own label and claim NO model", () => {
    const facts = toolFactsForGenerationType("Some Future Tool");
    expect(facts.tool).toBe("Some Future Tool");
    expect(facts.model).toBeNull();
    expect(toolFactsForGenerationType(null).model).toBeNull();
  });

  it("hub kinds map to their desks", () => {
    expect(toolForHubKind("song")).toBe("Song desk");
    expect(toolForHubKind("thumbnail")).toBe("Thumbnail Studio");
    expect(toolForHubKind("nonsense")).toBe("Bow Down Visuals studio");
    expect(toolForHubKind(null)).toBe("Bow Down Visuals studio");
  });
});

const songRecord = (): ProvenanceRecord =>
  buildProvenanceRecord({
    assetId: "gen:11111111-1111-4111-8111-111111111111",
    title: "Midnight Crown",
    mediaKind: "audio",
    origin: "generation",
    creatorId: "22222222-2222-4222-8222-222222222222",
    creatorName: "TRGDY TRBLZ",
    createdAt: "2026-10-23T12:00:00.000Z",
    generationType: "Make a Song",
    prompt: "a royal trap anthem about a shark king",
    creditsUsed: 400,
    saveStatus: "saved",
  });

describe("buildProvenanceRecord", () => {
  it("derives a full record for a generated song", () => {
    const r = songRecord();
    expect(r.aiGenerated).toBe(true);
    expect(r.createdWith.platform).toBe("Bow Down Visuals");
    expect(r.createdWith.model).toContain("ElevenLabs Music");
    expect(r.licence).toBe("all-rights-reserved");
    expect(r.disclosureDefaultEnabled).toBe(DISCLOSURE_DEFAULT_ENABLED);
    expect(r.editHistory[0]).toContain("Created 2026-10-23");
    expect(r.editHistory.some((l) => l.includes('Prompt: "a royal trap anthem'))).toBe(true);
    expect(r.editHistory.some((l) => l.includes("400 Visual Bucs"))).toBe(true);
    expect(r.editHistory.some((l) => l.includes("Saved to the creator's library"))).toBe(true);
  });

  it("honours a stored licence and falls back on garbage", () => {
    const base = {
      assetId: "gen:x",
      title: "t",
      mediaKind: "image" as const,
      origin: "generation" as const,
      creatorId: "u",
      creatorName: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      generationType: "thumbnail",
    };
    expect(buildProvenanceRecord({ ...base, storedLicence: "cc-by-4.0" }).licence).toBe("cc-by-4.0");
    expect(buildProvenanceRecord({ ...base, storedLicence: "nonsense" }).licence).toBe("all-rights-reserved");
    expect(buildProvenanceRecord({ ...base }).licence).toBe("all-rights-reserved");
  });

  it("hub assets are not claimed as AI generations and carry their detail", () => {
    const r = buildProvenanceRecord({
      assetId: "hub:abc",
      title: "Cover art",
      mediaKind: "image",
      origin: "project",
      creatorId: "u",
      creatorName: "Creator",
      createdAt: "2026-10-01T00:00:00.000Z",
      hubKind: "thumbnail",
      hubDetail: "From Thumbnail Studio",
    });
    expect(r.aiGenerated).toBe(false);
    expect(r.createdWith.tool).toBe("Thumbnail Studio");
    expect(r.editHistory[0]).toContain("Added to the library 2026-10-01");
    expect(r.editHistory[0]).toContain("From Thumbnail Studio");
  });
});

/* ─── Hub-origin AI state (more-provenance, F7 review MEDIUM) ─────────────
   A hub entry is a desk output's library copy. Without a generation-row
   link it must read UNKNOWN — never "no AI" — and with a link it inherits
   the generation's proven AI facts. */
describe("hub-origin AI involvement — honest states", () => {
  const hubBase = {
    assetId: "hub:abc",
    title: "Cover art",
    mediaKind: "image" as const,
    origin: "project" as const,
    creatorId: "u",
    creatorName: "Creator",
    createdAt: "2026-10-01T00:00:00.000Z",
    hubKind: "thumbnail",
    hubDetail: "From Thumbnail Studio",
  };

  it("unlinked hub assets are UNKNOWN, not 'no AI'", () => {
    const r = buildProvenanceRecord({ ...hubBase });
    expect(r.aiInvolvement).toBe("unknown");
    expect(r.aiGenerated).toBe(false); // not proven — the boolean never claims a negative
    expect(r.editHistory.some((l) => l.includes("AI involvement is not recorded"))).toBe(true);
    const line = aiInvolvementCertificateLine(r);
    expect(line).toContain("not recorded");
    expect(line).toContain("neither confirms nor rules out");
    expect(line).not.toContain("No AI generation");
    const content = certificateContent(r, new Date("2026-10-24T00:00:00.000Z"));
    expect(content.lines.find((l) => l.label === "AI involvement")?.value).toBe(line);
  });

  it("hub assets linked to a generation row inherit its AI facts", () => {
    const r = buildProvenanceRecord({
      ...hubBase,
      linkedGeneration: { generationType: "thumbnail", prompt: "a crown over a city", creditsUsed: 100 },
    });
    expect(r.aiInvolvement).toBe("ai");
    expect(r.aiGenerated).toBe(true);
    expect(r.createdWith.tool).toBe("Thumbnail Studio");
    expect(r.createdWith.model).toBeNull(); // thumbnail rail pins no model — none is claimed
    expect(r.editHistory.some((l) => l.includes("generation record linked"))).toBe(true);
    expect(r.editHistory.some((l) => l.includes('Prompt: "a crown over a city"'))).toBe(true);
    expect(r.editHistory.some((l) => l.includes("100 Visual Bucs"))).toBe(true);
    expect(aiInvolvementCertificateLine(r)).toContain("created with AI assistance");
  });

  it("a linked song generation carries its pinned model through the hub copy", () => {
    const r = buildProvenanceRecord({
      ...hubBase,
      hubKind: "song",
      mediaKind: "audio",
      linkedGeneration: { generationType: "Make a Song", prompt: null, creditsUsed: 400 },
    });
    expect(r.aiInvolvement).toBe("ai");
    expect(r.createdWith.tool).toBe("Make a Song");
    expect(r.createdWith.model).toContain("ElevenLabs Music");
  });

  it("generation-origin records are always 'ai'", () => {
    expect(songRecord().aiInvolvement).toBe("ai");
    expect(songRecord().aiGenerated).toBe(true);
  });

  it("generationLinkageByUrl keys rows by their stored media URL only", () => {
    const map = generationLinkageByUrl([
      { generationType: "thumbnail", result: { thumbnailUrl: "https://cdn.example/cover.png" }, prompt: "p1", creditsUsed: 100, createdAt: new Date() },
      { generationType: "Make a Song", result: { videoUrl: "https://cdn.example/song.mp4" }, prompt: "p2", creditsUsed: 400, createdAt: new Date() },
      { generationType: "lyrics", result: { content: "text only" }, prompt: "p3", creditsUsed: 10, createdAt: new Date() },
    ]);
    expect(map.get("https://cdn.example/cover.png")).toEqual({ generationType: "thumbnail", prompt: "p1", creditsUsed: 100 });
    expect(map.get("https://cdn.example/song.mp4")?.generationType).toBe("Make a Song");
    expect(map.size).toBe(2); // the text-only row stores no media URL — no link is invented
  });
});

describe("disclosure lines", () => {
  it("the full line names the tool, the model and the platform", () => {
    const line = aiDisclosureLine(songRecord());
    expect(line).toContain("created with AI assistance");
    expect(line).toContain("Make a Song");
    expect(line).toContain("ElevenLabs Music");
    expect(line).toContain("Bow Down Visuals");
  });

  it("the metadata text is compact and carries the AI-generated marker", () => {
    const text = aiDisclosureMetadataText(songRecord());
    expect(text.startsWith("AI-generated content")).toBe(true);
    expect(text).toContain("bowdownvisuals.com");
  });
});

describe("licence certificate", () => {
  it("content states the work, the creator, the licence and the honest limits", () => {
    const content = certificateContent(songRecord(), new Date("2026-10-24T00:00:00.000Z"));
    expect(content.heading).toBe("Licence Certificate");
    expect(content.lines.find((l) => l.label === "Work")?.value).toBe("Midnight Crown");
    expect(content.lines.find((l) => l.label === "Creator")?.value).toBe("TRGDY TRBLZ");
    expect(content.licenceName).toBe("All Rights Reserved");
    expect(content.statement).toContain("not a legal filing");
    expect(content.statement).toContain("C2PA");
    expect(content.recordId).toBe("gen:11111111-1111-4111-8111-111111111111");
    expect(content.issuedAt).toBe("2026-10-24T00:00:00.000Z");
  });

  /* PDFKit draws page text as TJ arrays of hex-encoded fragments, split at
     kerning boundaries — so the honest byte probe decodes every hex
     fragment in order and reads the reconstructed page text. (The info
     dictionary strings are plain and asserted separately.) */
  function pdfPageText(pdf: Buffer): string {
    const raw = pdf.toString("latin1");
    const fragments: string[] = [];
    for (const m of raw.matchAll(/<([0-9a-fA-F]+)>/g)) {
      fragments.push(Buffer.from(m[1]!, "hex").toString("latin1"));
    }
    return fragments.join("");
  }

  it("PDF bytes carry the certificate text (uncompressed, verifiable)", async () => {
    const pdf = await buildLicenceCertificatePdf(songRecord(), { issuedAt: new Date("2026-10-24T00:00:00.000Z") });
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const pageText = pdfPageText(pdf);
    expect(pageText).toContain("LICENCE CERTIFICATE");
    expect(pageText).toContain("Midnight Crown");
    expect(pageText).toContain("All Rights Reserved");
    expect(pageText).toContain("TRGDY TRBLZ");
    /* the info dictionary states the licence in plain strings too */
    const raw = pdf.toString("latin1");
    expect(raw).toContain("Licence for");
    expect(raw).toContain("(TRGDY TRBLZ)");
  });

  it("PDF renders with a logo buffer and for CC licences prints the deed url", async () => {
    const record = buildProvenanceRecord({
      assetId: "gen:y",
      title: "Open Song",
      mediaKind: "audio",
      origin: "generation",
      creatorId: "u",
      creatorName: "Creator",
      createdAt: "2026-10-01T00:00:00.000Z",
      generationType: "Make a Song",
      storedLicence: "cc-by-4.0",
    });
    /* 1x1 transparent PNG — proves the image path executes; content rules
       (whole logo only) are enforced by the route's logo resolver. */
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const pdf = await buildLicenceCertificatePdf(record, { logoPng: png });
    const pageText = pdfPageText(pdf);
    expect(pageText).toContain("creativecommons.org/licenses/by/4.0");
    expect(pageText).toContain("CC BY 4.0");
    expect(pageText).toContain("Open Song");
  });
});
