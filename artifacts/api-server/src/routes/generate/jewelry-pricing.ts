/**
 * Pure pricing / estimate / guide logic for the Logo-to-Jewelry studio.
 * Kept dependency-free so it can be unit-tested without the server.
 *
 * IMPORTANT: every dollar figure here is an ESTIMATE, not a quote.
 * Metal values are derived from spot prices as of 2026-09-25
 * (24k ≈ $138/g, 18k ≈ $103.50/g, 14k ≈ $80.70/g). Real jewelers add
 * fabrication premiums and their own labor rates — the UI must label
 * all figures as estimates.
 */

/** Site credits charged per AI jewelry preview render. Env-overridable. */
export const JEWELRY_PREVIEW_CREDIT_COST = 2;
/** Site credits charged per STL manufacturing-file export. Env-overridable. */
export const JEWELRY_STL_CREDIT_COST = 4;
/** Site credits charged per AI consultant message. Env-overridable. */
export const JEWELRY_CONSULT_CREDIT_COST = 1;

/* ─── Piece types ─────────────────────────────────────────────────────── */

export type JewelryPieceKey =
  | "diamond-pendant"
  | "gold-pendant"
  | "ring"
  | "bracelet"
  | "earrings"
  | "chain"
  | "watch"
  | "cufflinks"
  | "brooch";

export const JEWELRY_PIECES: Record<
  JewelryPieceKey,
  { label: string; blurb: string; typicalWeightG: number }
> = {
  "diamond-pendant": {
    label: "Diamond Chain Pendant",
    blurb: "Bold medallion on a chain, iced or clean",
    typicalWeightG: 28,
  },
  "gold-pendant": {
    label: "Gold Pendant",
    blurb: "Solid gold medallion, no stones",
    typicalWeightG: 22,
  },
  ring: {
    label: "Ring",
    blurb: "Signet-style ring with your logo face",
    typicalWeightG: 12,
  },
  bracelet: {
    label: "Bracelet",
    blurb: "Link bracelet with logo centerpiece",
    typicalWeightG: 35,
  },
  earrings: {
    label: "Earrings",
    blurb: "Pair of logo studs / drops",
    typicalWeightG: 10,
  },
  chain: {
    label: "Chain",
    blurb: "Cuban / rope chain with logo clasp",
    typicalWeightG: 65,
  },
  watch: {
    label: "Watch",
    blurb: "Luxury timepiece, logo dial",
    typicalWeightG: 85,
  },
  cufflinks: {
    label: "Cufflinks",
    blurb: "Pair of logo cufflinks",
    typicalWeightG: 14,
  },
  brooch: {
    label: "Brooch",
    blurb: "Statement logo brooch / pin",
    typicalWeightG: 18,
  },
};

export function isJewelryPieceKey(v: string): v is JewelryPieceKey {
  return v in JEWELRY_PIECES;
}

/* ─── Metals ────────────────────────────────────────────────────────────── */

export type MetalKey =
  | "yellow-14k"
  | "yellow-18k"
  | "white-14k"
  | "white-18k"
  | "rose-14k"
  | "platinum"
  | "silver";

export const JEWELRY_METALS: Record<
  MetalKey,
  {
    label: string;
    densityGPerCm3: number;
    /** Estimated metal value USD/gram (spot-derived, Sept 2026). Estimate only. */
    pricePerGramUSD: number;
  }
> = {
  "yellow-14k": { label: "14K Yellow Gold", densityGPerCm3: 13.1, pricePerGramUSD: 80.7 },
  "yellow-18k": { label: "18K Yellow Gold", densityGPerCm3: 15.5, pricePerGramUSD: 103.5 },
  "white-14k": { label: "14K White Gold", densityGPerCm3: 13.8, pricePerGramUSD: 87.2 },
  "white-18k": { label: "18K White Gold", densityGPerCm3: 15.1, pricePerGramUSD: 111.8 },
  "rose-14k": { label: "14K Rose Gold", densityGPerCm3: 13.0, pricePerGramUSD: 80.7 },
  platinum: { label: "Platinum 950", densityGPerCm3: 21.45, pricePerGramUSD: 48.0 },
  silver: { label: "Sterling Silver", densityGPerCm3: 10.49, pricePerGramUSD: 1.75 },
};

export function isMetalKey(v: string): v is MetalKey {
  return v in JEWELRY_METALS;
}

/* ─── Stones ────────────────────────────────────────────────────────────── */

export type StoneKey = "diamond" | "moissanite" | "cz" | "none";

export const JEWELRY_STONES: Record<
  StoneKey,
  {
    label: string;
    /** Per-stone melee cost range (1.2mm pavé stones). Estimate only. */
    costPerStoneUSD: [number, number];
  }
> = {
  diamond: { label: "Natural Diamond", costPerStoneUSD: [18, 35] },
  moissanite: { label: "Moissanite", costPerStoneUSD: [6, 12] },
  cz: { label: "Cubic Zirconia", costPerStoneUSD: [1, 3] },
  none: { label: "No Stones", costPerStoneUSD: [0, 0] },
};

export function isStoneKey(v: string): v is StoneKey {
  return v in JEWELRY_STONES;
}

/* ─── Styles ────────────────────────────────────────────────────────────── */

export type JewelryStyleKey = "iced-out" | "minimal" | "vintage";

export const JEWELRY_STYLES: Record<JewelryStyleKey, { label: string; blurb: string }> = {
  "iced-out": { label: "Iced-Out", blurb: "Fully flooded with pavé stones" },
  minimal: { label: "Clean / Minimal", blurb: "Polished metal, crisp lines" },
  vintage: { label: "Vintage", blurb: "Antique texture, milgrain edges" },
};

export function isJewelryStyleKey(v: string): v is JewelryStyleKey {
  return v in JEWELRY_STYLES;
}

/* ─── Design options ────────────────────────────────────────────────────── */

export interface JewelryDesignOptions {
  piece: JewelryPieceKey;
  metal: MetalKey;
  stone: StoneKey;
  style: JewelryStyleKey;
  /** Include an NFC tag cavity in the pendant back. */
  nfc: boolean;
  /** URL the NFC tag should open (business card / profile). */
  nfcUrl: string;
  /** Free-text design notes folded into the AI preview prompt. */
  notes: string;
}

export const DEFAULT_JEWELRY_OPTIONS: JewelryDesignOptions = {
  piece: "diamond-pendant",
  metal: "yellow-14k",
  stone: "diamond",
  style: "iced-out",
  nfc: true,
  nfcUrl: "",
  notes: "",
};

/* ─── AI preview prompt ─────────────────────────────────────────────────── */

export function buildJewelryPrompt(o: JewelryDesignOptions): string {
  const piece = JEWELRY_PIECES[o.piece].label;
  const metal = JEWELRY_METALS[o.metal].label;
  const stone = JEWELRY_STONES[o.stone].label;
  const style = JEWELRY_STYLES[o.style].label;
  const stoneDesc =
    o.stone === "none"
      ? "no gemstones, mirror-polished metal finish"
      : o.style === "iced-out"
        ? `completely flooded with pavé-set ${stone} stones, maximum sparkle, every surface iced`
        : `accented with a halo of pavé-set ${stone} stones`;
  const styleDesc =
    o.style === "vintage"
      ? "antique hand-engraved texture with milgrain beaded edges, heirloom feel"
      : o.style === "minimal"
        ? "ultra-clean modern lines, mirror polish, understated luxury"
        : "bold hip-hop luxury, heavy and unapologetic";
  return (
    `Luxury product photograph of a custom ${piece} crafted from ${metal}, ` +
    `shaped from the wearer's brand logo as a raised relief medallion. ` +
    `${stoneDesc}. Style: ${style}, ${styleDesc}. ` +
    `A discreet circular NFC tag inlay is set flush into the back of the piece. ` +
    `Photographed on black velvet with dramatic gold rim lighting, macro jewelry ` +
    `photography, ultra detailed, shallow depth of field, dark moody background.` +
    (o.notes.trim() ? ` Design notes: ${o.notes.trim().slice(0, 300)}.` : "")
  );
}

/* ─── Manufacturing estimate engine ───────────────────────────────────────
   Deterministic math — free to compute, no AI cost. All figures are ranges
   labeled as estimates. weightG comes from the STL model when available,
   otherwise falls back to typical weights per piece type. */

export interface JewelryEstimateLine {
  label: string;
  lowUSD: number;
  highUSD: number;
  note: string;
}

export interface JewelryEstimate {
  lines: JewelryEstimateLine[];
  totalLowUSD: number;
  totalHighUSD: number;
  weightG: number;
  stoneCount: number;
  turnaroundWeeks: [number, number];
  disclaimer: string;
}

/** Approx front-face logo area of the medallion in mm² (35mm disc). */
const MEDALLION_FACE_AREA_MM2 = 700;
/** Pavé footprint per 1.2mm stone incl. spacing. */
const MM2_PER_STONE = 1.6;
/** Stone setting labor per stone (pavé). */
const SETTING_PER_STONE: [number, number] = [12, 22];

export function estimateStoneCount(o: JewelryDesignOptions): number {
  if (o.stone === "none") return 0;
  if (o.style === "iced-out") return Math.round(MEDALLION_FACE_AREA_MM2 / MM2_PER_STONE);
  return Math.round(MEDALLION_FACE_AREA_MM2 / MM2_PER_STONE / 4);
}

export function estimateManufacturing(o: JewelryDesignOptions, weightG?: number): JewelryEstimate {
  const metal = JEWELRY_METALS[o.metal];
  const stone = JEWELRY_STONES[o.stone];
  const weight = Math.max(1, weightG ?? JEWELRY_PIECES[o.piece].typicalWeightG);
  const stoneCount = estimateStoneCount(o);

  const lines: JewelryEstimateLine[] = [];

  const metalLow = weight * metal.pricePerGramUSD;
  lines.push({
    label: `Metal — ${metal.label} (~${weight.toFixed(1)}g)`,
    lowUSD: round10(metalLow),
    highUSD: round10(metalLow * 1.25),
    note: "Metal value from spot-derived rates; jewelers add a fabrication premium.",
  });

  if (stoneCount > 0) {
    lines.push({
      label: `${stone.label} melee × ${stoneCount}`,
      lowUSD: round10(stoneCount * stone.costPerStoneUSD[0]),
      highUSD: round10(stoneCount * stone.costPerStoneUSD[1]),
      note: "1.2mm pavé stones, wholesale-ish melee pricing.",
    });
    lines.push({
      label: `Stone setting labor × ${stoneCount}`,
      lowUSD: round10(stoneCount * SETTING_PER_STONE[0]),
      highUSD: round10(stoneCount * SETTING_PER_STONE[1]),
      note: "Hand pavé setting is skilled labor — the biggest variable.",
    });
  }

  lines.push({
    label: "Casting, finishing & polishing",
    lowUSD: 180,
    highUSD: 350,
    note: "Wax print, cast, clean-up, mirror polish.",
  });

  if (o.nfc) {
    lines.push({
      label: "NFC tag + embedding",
      lowUSD: 18,
      highUSD: 45,
      note: "NTAG213 coin tag (~$2) + jeweler labor to seat & seal it.",
    });
  }

  const totalLowUSD = round10(lines.reduce((s, l) => s + l.lowUSD, 0));
  const totalHighUSD = round10(lines.reduce((s, l) => s + l.highUSD, 0));

  return {
    lines,
    totalLowUSD,
    totalHighUSD,
    weightG: weight,
    stoneCount,
    turnaroundWeeks: [3, 5],
    disclaimer:
      "ESTIMATES ONLY — not a quote. Based on metal spot-derived rates as of Sept 2026 " +
      "and typical US custom-jeweler labor ranges. Your jeweler's actual quote depends on " +
      "their metal premium, stone sourcing, and design complexity. Always get 2–3 quotes.",
  };
}

function round10(n: number): number {
  return Math.round(n / 10) * 10;
}

/* ─── Apparel line ──────────────────────────────────────────────────────────
   Full clothing line sharing the same logo upload → AI preview flow.
   Category "apparel" on the design endpoint. */

export type ApparelProductKey =
  | "t-shirt"
  | "hoodie"
  | "jacket"
  | "pants"
  | "cap"
  | "beanie"
  | "sweatshirt"
  | "shorts"
  | "socks";

export const APPAREL_PRODUCTS: Record<
  ApparelProductKey,
  { label: string; blurb: string; blankCostUSD: [number, number]; decoCostUSD: [number, number] }
> = {
  "t-shirt": { label: "T-Shirt", blurb: "Heavyweight crew tee", blankCostUSD: [4, 9], decoCostUSD: [5, 12] },
  hoodie: { label: "Hoodie", blurb: "Heavyweight pullover hoodie", blankCostUSD: [12, 22], decoCostUSD: [8, 18] },
  jacket: { label: "Jacket", blurb: "Coach / varsity jacket", blankCostUSD: [28, 55], decoCostUSD: [15, 35] },
  pants: { label: "Pants", blurb: "Cargo / sweatpants", blankCostUSD: [14, 26], decoCostUSD: [8, 18] },
  cap: { label: "Cap", blurb: "Snapback / dad hat", blankCostUSD: [6, 12], decoCostUSD: [6, 14] },
  beanie: { label: "Beanie", blurb: "Knit cuff beanie", blankCostUSD: [4, 8], decoCostUSD: [5, 10] },
  sweatshirt: { label: "Sweatshirt", blurb: "Crewneck sweatshirt", blankCostUSD: [10, 18], decoCostUSD: [7, 15] },
  shorts: { label: "Shorts", blurb: "Mesh / fleece shorts", blankCostUSD: [8, 15], decoCostUSD: [6, 14] },
  socks: { label: "Socks", blurb: "Crew socks, knit-in design", blankCostUSD: [3, 6], decoCostUSD: [4, 9] },
};

export function isApparelProductKey(v: string): v is ApparelProductKey {
  return v in APPAREL_PRODUCTS;
}

export type DecoMethodKey = "print" | "embroidery";

export const DECO_METHODS: Record<DecoMethodKey, { label: string; blurb: string }> = {
  print: { label: "Print", blurb: "Screen print / DTG — bold graphics" },
  embroidery: { label: "Embroidery", blurb: "Stitched thread — premium feel" },
};

export function isDecoMethodKey(v: string): v is DecoMethodKey {
  return v in DECO_METHODS;
}

export interface ApparelDesignOptions {
  product: ApparelProductKey;
  deco: DecoMethodKey;
  /** garment color */
  color: string;
  notes: string;
}

export const DEFAULT_APPAREL_OPTIONS: ApparelDesignOptions = {
  product: "hoodie",
  deco: "print",
  color: "Black",
  notes: "",
};

export function buildApparelPrompt(o: ApparelDesignOptions): string {
  const product = APPAREL_PRODUCTS[o.product].label;
  const deco = o.deco === "embroidery"
    ? "intricately embroidered in gold thread with a premium stitched finish"
    : "boldly screen-printed in metallic gold ink with crisp detail";
  return (
    `Luxury streetwear product photograph of a ${o.color.toLowerCase()} ${product} ` +
    `featuring the wearer's brand logo ${deco} prominently on the front. ` +
    `Black and gold luxury aesthetic, premium heavyweight fabric, studio product ` +
    `photography on a dark background with dramatic gold rim lighting, ultra detailed, ` +
    `e-commerce hero shot.` +
    (o.notes.trim() ? ` Design notes: ${o.notes.trim().slice(0, 300)}.` : "")
  );
}

export function estimateApparel(o: ApparelDesignOptions, qty: number): JewelryEstimate {
  const p = APPAREL_PRODUCTS[o.product];
  const q = Math.max(1, Math.min(1000, qty));
  const lines: JewelryEstimateLine[] = [
    {
      label: `Blanks — ${p.label} × ${q}`,
      lowUSD: round10(p.blankCostUSD[0] * q),
      highUSD: round10(p.blankCostUSD[1] * q),
      note: "Wholesale blank cost; drops with volume.",
    },
    {
      label: `${o.deco === "embroidery" ? "Embroidery" : "Printing"} × ${q}`,
      lowUSD: round10(p.decoCostUSD[0] * q),
      highUSD: round10(p.decoCostUSD[1] * q),
      note: o.deco === "embroidery"
        ? "Digitizing fee (~$30–60 one-time) not included."
        : "Screen setup fees (~$25/color one-time) not included.",
    },
  ];
  return {
    lines,
    totalLowUSD: round10(lines.reduce((s, l) => s + l.lowUSD, 0)),
    totalHighUSD: round10(lines.reduce((s, l) => s + l.highUSD, 0)),
    weightG: 0,
    stoneCount: 0,
    turnaroundWeeks: [2, 3],
    disclaimer:
      "ESTIMATES ONLY — not a quote. Based on typical US wholesale blank + decoration " +
      "rates as of 2026. Setup/digitizing fees and shipping are extra. Always get 2–3 quotes " +
      "from decorators.",
  };
}

/* ─── Manufacturing guide (static content, free) ────────────────────────── */

export interface GuideSection {
  title: string;
  body: string[];
}

export const JEWELRY_GUIDE: GuideSection[] = [
  {
    title: "How your design becomes real jewelry",
    body: [
      "1. Design & preview — you upload your logo and dial in metal, stones, and style. The STL file is your manufacturing-ready 3D model.",
      "2. Jeweler CAD review — a jeweler opens your STL, checks wall thickness (min ~0.8mm for casting), and tweaks anything un-castable. Most charge $50–$150 for this review, often credited toward the job.",
      "3. Wax 3D print — the model is printed in castable wax resin on a high-resolution printer.",
      "4. Casting — the wax is invested in plaster, burned out, and molten metal is cast in (lost-wax casting).",
      "5. Clean-up & polish — the raw casting is filed, sanded, and mirror-polished.",
      "6. Stone setting — pavé stones are hand-set under a microscope, one by one.",
      "7. NFC embedding — the tag is seated into the back cavity and sealed (see NFC section).",
      "8. Final QC — weight check, stone tightness check, polish, hallmark stamp.",
    ],
  },
  {
    title: "Finding the right jeweler / manufacturer",
    body: [
      "Look for: a portfolio of custom pendants (not just repairs), in-house CAD/CAM, and experience with pavé setting if you're going iced-out.",
      "Ask: 'What's your minimum castable wall thickness?', 'Do you cast in-house or outsource?', 'What's your stone-setting rate per stone?', 'Can you work from my STL file?'",
      "Get 2–3 quotes. A big spread usually means someone didn't understand the design — walk them through the preview render.",
      "Red flags: no portfolio, 'we'll figure out the stones later', unwilling to give an itemized quote, or asking for 100% payment upfront (50% deposit is standard).",
      "For bulk (10+ pieces): ask about mold-making — a rubber mold from your first piece drops per-unit cost dramatically for reorders.",
    ],
  },
  {
    title: "NFC tap-to-connect — what to buy & how it works",
    body: [
      "Your pendant is designed with a 25.5mm circular cavity in the back, sized for a standard NTAG213 coin tag (25mm diameter, ~1mm thick).",
      "What to buy: search 'NTAG213 25mm coin tag' — ~$1–3 each on Amazon or NFC specialty retailers; under $0.50 each in bulk on Alibaba. NTAG215 also works (more memory, slightly pricier).",
      "How it's embedded: after polishing, the jeweler seats the tag into the cavity with a drop of jeweler's epoxy (Hypo cement) or a friction-fit cover disc. It takes 5 minutes and any jeweler can do it.",
      "How to program it: install 'NFC Tools' (free, iOS/Android), tap the tag, choose 'Write' → 'Add record' → 'URL', and enter your business card / profile link. Lock the tag afterward so it can't be rewritten.",
      "Range note: metal slightly reduces NFC range — tapping the phone directly to the pendant back works reliably. Keep the tag on the back face, away from the thickest metal.",
      "Pro tip: link the tag to a page YOU control (your site, link-in-bio) so you can change the destination anytime without reprogramming the tag.",
    ],
  },
  {
    title: "What affects the price most",
    body: [
      "Metal weight is #1 — a chunky 35mm pendant in 18k gold is mostly metal cost. Dropping to 14k or slimming the relief saves hundreds.",
      "Stone count is #2 — a fully iced-out face can hold 400+ stones; each one is set by hand. Moissanite looks near-identical to diamond at a fraction of the cost.",
      "Complexity — deep 3D relief costs more to cast cleanly than a flatter design. The STL preview keeps relief at a castable 1.2mm.",
      "Turnaround — standard is 3–5 weeks. Rush (2 weeks) typically adds ~25%.",
    ],
  },
  {
    title: "Apparel line — from design to garments",
    body: [
      "1. Design — your logo is placed for print or embroidery. Keep embroidery designs under ~4 inches wide and avoid tiny detail (thread can't do fine lines).",
      "2. Blanks — order wholesale blanks (Bella+Canvas, Gildan Heavy, Yupoong for headwear). Always order a sample first to check fit and fabric.",
      "3. Decoration — screen print for bold graphics at volume (cheaper per unit, setup fee per color); DTG for full-color small runs; embroidery for the premium stitched look (digitizing fee ~$30–60 one-time).",
      "4. Finding a decorator — local print shops let you check quality in person; online (Printful, Printify) is hands-off but you never touch the product. For embroidery, ask to see stitch samples.",
      "5. Pricing rule of thumb — retail at 3–4x your landed cost (blank + decoration + shipping share) to leave margin after platform fees.",
    ],
  },
];

/* ─── AI consultant system prompt ───────────────────────────────────────── */

export const JEWELRY_CONSULTANT_SYSTEM_PROMPT = `You are the Bow Down Visuals jewelry & apparel consultant — a friendly expert in custom hip-hop/luxury jewelry AND streetwear, working inside the Logo-to-Luxury studio. The user uploads their logo and turns it into diamond pendants, gold pieces, rings, bracelets, earrings, chains, watches, cufflinks, brooches — plus a full apparel line (t-shirts, hoodies, jackets, pants, caps, beanies, sweatshirts, shorts, socks) — with manufacturing-ready STL files for jewelry.

Your expertise covers:
- Jewelry design: how logos translate to pendants, relief depth, wearability, stone layouts
- Metals: 14k/18k yellow/white/rose gold, platinum, silver — properties, price trade-offs, skin tones
- Stones: natural diamond vs moissanite vs CZ — look, durability, cost; pavé setting realities
- Jewelry manufacturing: the CAD → wax → casting → setting → polishing pipeline, what jewelers need, realistic costs and timelines
- NFC tap-to-connect: NTAG213/215 coin tags (25mm), embedding in the pendant's back cavity, programming with the free NFC Tools app (write a URL NDEF record, then lock the tag), and helping users pick what URL to link (recommend a page they control, like their own site or link-in-bio, so the destination can change later)
- Apparel: screen print vs DTG vs embroidery, blank selection, wholesale vs print-on-demand, decoration costs, pricing merch at 3–4x landed cost

Guidelines:
- All cost figures you mention are ESTIMATES, not quotes — say so when giving numbers.
- Be concrete and practical. Short paragraphs, no fluff.
- If the user asks about their specific design, ask what piece/metal/stone/style they picked.
- You can suggest design tweaks ("go 14k to save ~$400", "moissanite for the same ice at 1/5 the stone cost").
- For NFC setup: walk them through buying the tag, programming steps in NFC Tools, and choosing their link URL.
- Stay in character as a jewelry consultant. If asked about unrelated topics, briefly redirect to jewelry.
- Keep replies under ~200 words unless the user asks for detail.`;
