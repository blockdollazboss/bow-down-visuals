/**
 * Avatar rig tests (avatar-rigs.ts): every character draws a full,
 * rich frame (many path + paint calls — an accidentally gutted rig
 * fails the floor) at neutral AND at drive extremes without
 * throwing; the upload rig reports false without a usable picture
 * and draws the picture when it has one.
 */
import { describe, it, expect } from "vitest";
import { AVATAR_CHARACTERS, drawAvatar, drawUploadedAvatar, isAvatarCharacterId } from "./avatar-rigs";
import { NEUTRAL_DRIVE, type DriveValues } from "./avatar-drive";

class FakeGradient {
  addColorStop(): void {}
}

class FakeCtx {
  calls: string[] = [];
  /** Geometry log with arguments — proves a rig actually MOVES with
   *  the drive (a rig can paint the same number of shapes in the
   *  wrong place; the mic's mouth only changes size, not count). */
  geo: string[] = [];
  fillStyle: unknown = "";
  strokeStyle: unknown = "";
  lineWidth = 1;
  lineCap = "";
  globalAlpha = 1;
  private rec(name: string): void {
    this.calls.push(name);
  }
  save(): void { this.rec("save"); }
  restore(): void { this.rec("restore"); }
  translate(): void { this.rec("translate"); }
  rotate(): void { this.rec("rotate"); }
  scale(): void { this.rec("scale"); }
  beginPath(): void { this.rec("beginPath"); }
  closePath(): void { this.rec("closePath"); }
  moveTo(): void { this.rec("moveTo"); }
  lineTo(): void { this.rec("lineTo"); }
  quadraticCurveTo(): void { this.rec("quadraticCurveTo"); }
  bezierCurveTo(): void { this.rec("bezierCurveTo"); }
  ellipse(...a: number[]): void { this.rec("ellipse"); this.geo.push(`e${a.map((n) => n.toFixed(1)).join(",")}`); }
  arc(...a: number[]): void { this.rec("arc"); this.geo.push(`a${a.map((n) => n.toFixed(1)).join(",")}`); }
  roundRect(...a: number[]): void { this.rec("roundRect"); this.geo.push(`r${a.map((n) => n.toFixed(1)).join(",")}`); }
  fill(): void { this.rec("fill"); }
  stroke(): void { this.rec("stroke"); }
  clip(): void { this.rec("clip"); }
  fillRect(): void { this.rec("fillRect"); }
  clearRect(): void { this.rec("clearRect"); }
  drawImage(): void { this.rec("drawImage"); }
  createLinearGradient(): FakeGradient { return new FakeGradient(); }
  createRadialGradient(): FakeGradient { return new FakeGradient(); }
  count(name: string): number {
    return this.calls.filter((c) => c === name).length;
  }
}

const EXTREMES: DriveValues[] = [
  { ...NEUTRAL_DRIVE },
  { yaw: 1, pitch: 1, roll: 1, lookX: 1, lookY: 1, blinkL: 1, blinkR: 1, mouthOpen: 1, brow: 1, talk: 1 },
  { yaw: -1, pitch: -1, roll: -1, lookX: -1, lookY: -1, blinkL: 0, blinkR: 1, mouthOpen: 0.5, brow: 0, talk: 0.4 },
];

const STARTERS = ["shark", "mask", "mic"] as const;

describe("avatar rigs", () => {
  it("ships exactly the three starters plus the upload slot", () => {
    expect(AVATAR_CHARACTERS.map((c) => c.id)).toEqual(["shark", "mask", "mic", "upload"]);
    for (const id of [...STARTERS, "upload"]) expect(isAvatarCharacterId(id)).toBe(true);
    expect(isAvatarCharacterId("crown")).toBe(false);
    expect(isAvatarCharacterId("nope")).toBe(false);
  });

  for (const id of STARTERS) {
    it(`${id} draws a rich frame at neutral and at drive extremes`, () => {
      for (const drive of EXTREMES) {
        const ctx = new FakeCtx();
        const ok = drawAvatar(ctx as never, id, drive, 720, 720, 2.35);
        expect(ok).toBe(true);
        // Richness floor: an emblem-grade rig is dozens of paints.
        expect(ctx.count("fill")).toBeGreaterThan(12);
        expect(ctx.calls.length).toBeGreaterThan(120);
        // Transparent canvas discipline: rigs never paint a backdrop.
        expect(ctx.count("clearRect")).toBe(0);
      }
    });

    it(`${id} actually moves when the drive changes (geometry, not just call count)`, () => {
      const quiet = new FakeCtx();
      drawAvatar(quiet as never, id, { ...NEUTRAL_DRIVE }, 720, 720, 1.0);
      const loud = new FakeCtx();
      drawAvatar(loud as never, id, { ...NEUTRAL_DRIVE, mouthOpen: 1, talk: 1 }, 720, 720, 1.0);
      expect(loud.geo.join("|")).not.toBe(quiet.geo.join("|"));
      const turned = new FakeCtx();
      drawAvatar(turned as never, id, { ...NEUTRAL_DRIVE, yaw: 0.8, roll: 0.5 }, 720, 720, 1.0);
      expect(turned.geo.join("|")).not.toBe(quiet.geo.join("|"));
    });
  }

  it("an unknown character id falls back to the shark rather than a blank source", () => {
    const ctx = new FakeCtx();
    const ok = drawAvatar(ctx as never, "mystery" as never, { ...NEUTRAL_DRIVE }, 720, 720, 0);
    expect(ok).toBe(true);
    expect(ctx.count("fill")).toBeGreaterThan(12);
  });

  it("upload rig: false without a picture, draws the picture with one", () => {
    const ctx = new FakeCtx();
    expect(drawUploadedAvatar(ctx as never, null, { ...NEUTRAL_DRIVE }, 720, 720, 0)).toBe(false);
    expect(ctx.count("drawImage")).toBe(0);
    const img = { el: {} as CanvasImageSource, width: 400, height: 600 };
    expect(drawUploadedAvatar(ctx as never, img, { ...NEUTRAL_DRIVE, talk: 0.7 }, 720, 720, 1.2)).toBe(true);
    expect(ctx.count("drawImage")).toBe(1);
    // A zero-size image is not usable either.
    expect(drawUploadedAvatar(new FakeCtx() as never, { el: {} as CanvasImageSource, width: 0, height: 0 }, { ...NEUTRAL_DRIVE }, 720, 720, 0)).toBe(false);
  });
});
