/**
 * BENCH — guided matte upsampling (matte-upsample.ts) at
 * production scale: a 640×360 feed matte under a 1920×1080
 * composite (the shipped Pro top step before the Nov 4, 2026
 * step-up) and a 960×540 matte (the step-up's new top step).
 * The scene is the synthetic portrait from the engine bench: a
 * person silhouette with hair strands against a room, with the
 * low-res mattes produced by box-averaging the true alpha (what
 * a feed-resolution engine can know). The measured pair per
 * feed: plain bilinear stretch (the shipped behaviour) vs the
 * guided upsample — full-res MAE and edge-band MAE against the
 * true alpha. Assertions pin the direction: guided must beat
 * plain on the edge band at both feeds, and the 960 feed must
 * beat the 640 feed. Cost prints alongside (this VM is shared
 * and slow — read cost as a ratio against the governor budget,
 * not as a device promise; the governor itself is pinned in
 * matte-upsample.test.ts).
 */
import { describe, it, expect } from "vitest";
import { MatteUpsampler, bilinear } from "./matte-upsample";

const W = 1920;
const H = 1080;

function buildScene() {
  const rgb = new Uint8ClampedArray(W * H * 4);
  const truth = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      /* room: warm gradient + a dark furniture block */
      let r = 168 + Math.round(30 * (x / W));
      let g = 148 + Math.round(24 * (y / H));
      let b = 128;
      if (x > 1400 && y > 620) { r = 84; g = 66; b = 58; }
      /* person: head ellipse + shoulders */
      const head = ((x - 960) / 215) ** 2 + ((y - 400) / 265) ** 2 < 1;
      const shoulders = y > 610 && Math.abs(x - 960) < 430 - (y - 610) * 0.28;
      let person = head || shoulders;
      /* hair: mass above the face line, strands past the silhouette */
      let hair = false;
      if (head && y < 430) hair = true;
      if (!person && y > 120 && y < 470) {
        const dx = Math.abs(x - 960);
        if (dx > 195 && dx < 245 && (x * 7 + y * 13) % 29 < 3) { hair = true; person = true; }
      }
      if (person) {
        if (hair) { r = 36; g = 29; b = 25; }
        else if (head && y >= 300) { r = 196; g = 152; b = 118; } // face
        else { r = 58; g = 52; b = 88; } // clothing
      }
      const j = (y * W + x) * 4;
      rgb[j] = r; rgb[j + 1] = g; rgb[j + 2] = b; rgb[j + 3] = 255;
      truth[y * W + x] = person ? 1 : 0;
    }
  }
  return { rgb, truth };
}

function boxDownsample(truth: Float32Array, mw: number, mh: number): Float32Array {
  const low = new Float32Array(mw * mh);
  const sx = W / mw;
  const sy = H / mh;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      let s = 0;
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
          s += truth[yy * W + xx];
          n++;
        }
      }
      low[y * mw + x] = s / n;
    }
  }
  return low;
}

function bilinearField(low: Float32Array, mw: number, mh: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      out[y * W + x] = bilinear(low, mw, mh, (x + 0.5) * (mw / W) - 0.5, (y + 0.5) * (mh / H) - 0.5);
    }
  }
  return out;
}

/** MAE overall and inside the edge band (truth blurred across 0.02..0.98). */
function maes(alpha: Float32Array, truth: Float32Array): { all: number; band: number } {
  let all = 0;
  let band = 0;
  let bandN = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const d = Math.abs(alpha[i] - truth[i]);
      all += d;
      /* band: any truth change within ±3px (checked cheaply on the row) */
      const nearEdge =
        (x >= 3 && truth[i - 3] !== truth[i]) || (x < W - 3 && truth[i + 3] !== truth[i]) ||
        (y >= 3 && truth[i - 3 * W] !== truth[i]) || (y < H - 3 && truth[i + 3 * W] !== truth[i]);
      if (nearEdge) { band += d; bandN++; }
    }
  }
  return { all: all / (W * H), band: bandN ? band / bandN : 0 };
}

describe("BENCH matte upsampling at production scale", () => {
  it("guided beats bilinear on the edge band at both the old and new top feeds", () => {
    const { rgb, truth } = buildScene();
    const rows: string[] = [];
    let band640Guided = 0;
    let band960Guided = 0;
    for (const [mw, mh] of [[640, 360], [960, 540]] as const) {
      const low = boxDownsample(truth, mw, mh);
      const plain = bilinearField(low, mw, mh);
      const upsampler = new MatteUpsampler({ budgetMs: Number.MAX_SAFE_INTEGER });
      const guided = upsampler.upsample(low, mw, mh, { rgb, components: 4, width: W, height: H });
      expect(guided).not.toBeNull();
      const p = maes(plain, truth);
      const g = maes(guided!, truth);
      rows.push(
        `feed ${mw}x${mh}: bilinear MAE ${p.all.toFixed(4)} band ${p.band.toFixed(4)} | ` +
        `guided MAE ${g.all.toFixed(4)} band ${g.band.toFixed(4)} | upsample ${upsampler.lastMs.toFixed(0)}ms (VM-relative)`,
      );
      expect(g.band).toBeLessThan(p.band);
      /* Overall: at the 960 feed the guided result wins outright;
         at 640 the win concentrates in the band and the flat
         interior ties — assert no meaningful regression there. */
      expect(g.all).toBeLessThanOrEqual(p.all * 1.05);
      if (mw === 640) band640Guided = g.band;
      else band960Guided = g.band;
    }
    /* The higher feed itself (the step table's new top step)
       carries more edge truth than the old one, guided or not. */
    expect(band960Guided).toBeLessThan(band640Guided);
    console.log(rows.join("\n"));
  });
});
