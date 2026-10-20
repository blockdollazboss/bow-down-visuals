/**
 * Promo cards ride the branding kit (Stack-4 wave-2 #4, migration
 * 0181) — route tests on the REAL mounted promo-cards router.
 *
 * The image pipeline runs for real (ffmpeg + the vendored fonts) with
 * only the provider, storage, credits, kit read, and DB mocked:
 *  - with a kit, generation snapshots it: the snapshot steers the
 *    background prompt (palette / vibe / fonts), rides the POST
 *    response, the recorded card rows, and the history DTO.
 *  - without a kit, generation behaves exactly as it did before the
 *    kit was wired in — the background prompt is byte-identical to
 *    the pre-kit prompt and the snapshot is null, never an error.
 *  - a kit edited after generation does not mutate already-generated
 *    cards: the first pack's stored snapshot keeps the values it was
 *    made with while a second pack snapshots the edited kit.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { deflateSync } from "node:zlib";

const ME = "11111111-1111-4111-8111-111111111111";

/* ── A tiny valid-PNG encoder (solid + noise) for the image mocks ── */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(width: number, height: number, noise: boolean): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % 256;
  };
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width * 3; x++) {
      raw[rowStart + 1 + x] = noise ? rnd() : 200;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
const BG_PNG_B64 = makePng(64, 64, false).toString("base64");
const LOGO_PNG = makePng(128, 128, true); // noise → deflates past the 1 KB fetch floor

const h = vi.hoisted(() => ({
  fake: null as any,
  kit: null as any,
  prompts: [] as string[],
  charges: [] as number[],
}));
h.kit = null;

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = ME;
    req.userCredits = 1000;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_userId: string, amount: number) => {
    h.charges.push(amount);
    return 900;
  }),
  refundCredits: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    images: {
      generate: async (args: any) => {
        h.prompts.push(args.prompt);
        return { data: [{ b64_json: BG_PNG_B64 }] };
      },
    },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(
    async (objectName: string) => `supabase://generated-clips/${objectName}`,
  ),
  refreshSupabaseStorageUrl: async (ref: string) => `https://playable.test/${ref}`,
}));

vi.mock("../../lib/brand-record", () => ({
  readBrandKit: async () => h.kit,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    promoCards: actual.promoCardsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import promoCardsRouter, {
  buildPromoCardBackgroundPrompt,
  promoCardAccentColor,
  promoCardBrandFontFile,
  promoCardBrandFonts,
  promoCardBrandSnapshot,
} from "../generate/promo-cards";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  app.get("/logo.png", (_req, res) => {
    res.type("png").send(LOGO_PNG);
  });
  app.use(promoCardsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  h.fake.clear();
  h.kit = null;
  h.prompts = [];
  h.charges = [];
});

function fullKit(over: Record<string, unknown> = {}) {
  return {
    brandName: "Nova Empire",
    vibe: "royal street luxury",
    industry: "Music",
    colors: [
      { hex: "#FF0055", name: "Neon Rose", role: "primary" },
      { hex: "#00E5FF", name: "Laser Cyan", role: "accent" },
    ],
    fonts: [{ heading: "Bebas Neue", body: "Poppins", usage: "Posters" }],
    logoPrompt: "A neon rose crest",
    taglines: ["Stay royal."],
    selectedTagline: null,
    logoUrl: `${base}/logo.png`,
    bioLines: [],
    pressFacts: [],
    generatedAt: null,
    updatedAt: null,
    ...over,
  };
}

const EXPECTED_SNAPSHOT = {
  brandName: "Nova Empire",
  logoUrl: "", // filled per-test once base is known
  primaryColor: "#FF0055",
  vibe: "royal street luxury",
  colors: [
    { hex: "#FF0055", name: "Neon Rose", role: "primary" },
    { hex: "#00E5FF", name: "Laser Cyan", role: "accent" },
  ],
  fonts: [{ heading: "Bebas Neue", body: "Poppins", usage: "Posters" }],
};

async function postCards(body: Record<string, unknown>) {
  const res = await fetch(`${base}/promo-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

/* ─── The snapshot builder (pure) ─────────────────────────────────── */

describe("promoCardBrandSnapshot", () => {
  it("derives the UGC-shaped core fields and copies colors/fonts in full", () => {
    const kit = fullKit();
    const snap = promoCardBrandSnapshot(kit);
    expect(snap).toEqual({ ...EXPECTED_SNAPSHOT, logoUrl: `${base}/logo.png` });
    /* A copy, never an alias: mutating the kit cannot reach it. */
    kit.colors[0].hex = "#00FF00";
    kit.fonts[0].heading = "Anton";
    expect(snap!.colors[0]!.hex).toBe("#FF0055");
    expect(snap!.fonts[0]!.heading).toBe("Bebas Neue");
  });

  it("no kit → null; blank name/vibe derive to null like the UGC snapshot", () => {
    expect(promoCardBrandSnapshot(null)).toBeNull();
    const snap = promoCardBrandSnapshot(fullKit({ brandName: "", vibe: "", logoUrl: null }));
    expect(snap).toMatchObject({ brandName: null, vibe: null, logoUrl: null, primaryColor: "#FF0055" });
  });

  it("accent + fonts resolve from the snapshot, with honest fallbacks", () => {
    const snap = promoCardBrandSnapshot(fullKit());
    expect(promoCardAccentColor(snap)).toBe("0xFF0055");
    expect(promoCardAccentColor(null)).toBe("0xE8B64C");
    expect(promoCardAccentColor(promoCardBrandSnapshot(fullKit({
      colors: [{ hex: "not-a-hex", name: "Bad", role: "primary" }],
    })))).toBe("0xE8B64C");

    const fonts = promoCardBrandFonts(snap);
    expect(fonts.heading).toMatch(/BebasNeue-Regular\.ttf$/);
    expect(fonts.body).toMatch(/Poppins-Bold\.ttf$/);
    expect(promoCardBrandFonts(null)).toEqual({ heading: null, body: null });
    /* A kit font the server doesn't carry resolves to null — the
       burned text falls back instead of pretending. */
    expect(promoCardBrandFontFile("Inter")).toBeNull();
    expect(promoCardBrandFontFile("Cinzel")).toMatch(/Cinzel-Variable\.ttf$/);
  });
});

/* ─── Generation ──────────────────────────────────────────────────── */

describe("POST /promo-cards with a brand kit", () => {
  it("snapshots the kit onto the response, the card rows, and the render prompt", async () => {
    h.kit = fullKit();
    const r = await postCards({
      releaseTitle: "Midnight Gold",
      artistName: "Lil Nova",
      style: "out-now",
      sizes: ["1:1"],
    });
    expect(r.status).toBe(200);
    const expected = { ...EXPECTED_SNAPSHOT, logoUrl: `${base}/logo.png` };
    expect(r.body.brand).toEqual(expected);
    expect(r.body.cards).toHaveLength(1);
    expect(h.charges).toEqual([100]);

    /* The render prompt carries the brand: palette, vibe, typography. */
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toContain("#FF0055");
    expect(h.prompts[0]).toContain("Neon Rose");
    expect(h.prompts[0]).toContain("royal street luxury");
    expect(h.prompts[0]).toContain("Bebas Neue");

    /* The record: one row, carrying the same snapshot. */
    const rows = h.fake.store("promoCards").rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].brandSnapshot).toEqual(expected);

    /* And the history DTO serves it back as the card's brand. */
    const list = await (await fetch(`${base}/promo-cards`)).json();
    expect(list.cards[0].brand).toEqual(expected);
  }, 60_000);

  it("a kit updated after generation does not mutate already-generated cards", async () => {
    h.kit = fullKit();
    const first = await postCards({
      releaseTitle: "Midnight Gold",
      artistName: "Lil Nova",
      style: "out-now",
      sizes: ["1:1"],
    });
    expect(first.status).toBe(200);

    /* The creator rebrands: same record edited in place AND the next
       read returns the new kit. */
    h.kit.colors[0].hex = "#00FF00";
    h.kit.brandName = "Renamed Empire";
    const second = await postCards({
      releaseTitle: "Second Drop",
      artistName: "Lil Nova",
      style: "announcement",
      sizes: ["1:1"],
    });
    expect(second.status).toBe(200);
    expect(second.body.brand.primaryColor).toBe("#00FF00");

    const rows = h.fake.store("promoCards").rows;
    expect(rows).toHaveLength(2);
    const firstRow = rows.find((r: any) => r.releaseTitle === "Midnight Gold");
    const secondRow = rows.find((r: any) => r.releaseTitle === "Second Drop");
    expect(firstRow.brandSnapshot.primaryColor).toBe("#FF0055");
    expect(firstRow.brandSnapshot.brandName).toBe("Nova Empire");
    expect(secondRow.brandSnapshot.primaryColor).toBe("#00FF00");
    expect(secondRow.brandSnapshot.brandName).toBe("Renamed Empire");
  }, 60_000);
});

describe("POST /promo-cards without a brand kit", () => {
  it("behaves exactly as before: legacy prompt, null snapshot, no error", async () => {
    h.kit = null;
    const r = await postCards({
      releaseTitle: "Midnight Gold",
      artistName: "Lil Nova",
      style: "out-now",
      sizes: ["1:1"],
    });
    expect(r.status).toBe(200);
    expect(r.body.brand).toBeNull();
    expect(r.body.cards).toHaveLength(1);
    expect(h.charges).toEqual([100]);

    /* Byte-identical to the pre-kit prompt for this style. */
    expect(h.prompts[0]).toBe(
      "Social media promo card background for a music release. " +
        "explosive release-day poster background, dark black background with molten gold fireworks and glowing embers, triumphant high-energy celebration, cinematic. " +
        "Leave a large clean central area empty for artwork and text. " +
        "ABSOLUTELY NO text, words, letters, logos, or watermarks anywhere in the image. " +
        "Gold and black luxury aesthetic.",
    );
    expect(buildPromoCardBackgroundPrompt(
      { bgSuffix: "x" } as any,
      null,
    )).toContain("Gold and black luxury aesthetic.");

    const rows = h.fake.store("promoCards").rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].brandSnapshot).toBeNull();

    const list = await (await fetch(`${base}/promo-cards`)).json();
    expect(list.cards[0].brand).toBeNull();
  }, 60_000);
});
