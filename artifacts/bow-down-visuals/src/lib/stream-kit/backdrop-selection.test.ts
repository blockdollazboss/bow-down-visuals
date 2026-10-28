/**
 * backdrop-selection.test.ts — pins the unified green-screen
 * background flow (owner directive, Oct 28, 2026: "Once I put the
 * fake green screen on, I should be able to choose my own background
 * — it shouldn't be separate. I should be able to upload any photo.").
 *
 * Before this lane the studio held only a built-in backdrop id; the
 * upload control silently dropped the file when the camera was off
 * (`if (!file || !changerRef.current) return;`), applied nothing at
 * camera start (the start paths only ever loaded BACKDROP_URIS), and
 * BackgroundChanger.setImage revoked the previous backdrop's object
 * URL before the new image had even loaded, so a failed pick could
 * take the working background down with it.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  backdropSelectionSource,
  greenScreenCueVisible,
  isCustomSelection,
  isSelectionActive,
  selectionAfterUpload,
  validateBackdropUpload,
  BACKDROP_UPLOAD_ACCEPT,
  BACKDROP_UPLOAD_MAX_BYTES,
  DEFAULT_BACKDROP_SELECTION,
  type BackdropSelection,
} from "./backdrop-selection";
import { BACKDROP_URIS } from "./backdrops";

const studio = readFileSync(
  new URL("../../components/go-live/BroadcastStudio.tsx", import.meta.url),
  "utf8",
);
const changer = readFileSync(new URL("./background-changer.ts", import.meta.url), "utf8");

/** The "Behind me" section of the studio, sliced out of the source. */
const behindMe = studio.slice(studio.indexOf("Behind me"), studio.indexOf("Camera effects"));

describe("selection → compositor source", () => {
  it("a built-in selection resolves to that backdrop's data URI", () => {
    expect(backdropSelectionSource({ kind: "builtin", id: "throne" }, null)).toBe(BACKDROP_URIS["throne"]);
    expect(backdropSelectionSource(DEFAULT_BACKDROP_SELECTION, null)).toBe(BACKDROP_URIS["stage"]);
  });

  it("an unknown built-in resolves to null, never a wrong picture", () => {
    expect(backdropSelectionSource({ kind: "builtin", id: "no-such-scene" }, null)).toBeNull();
  });

  it("an upload resolves to the held File itself — the compositor input", () => {
    const file = new File(["pixels"], "my-room.jpg", { type: "image/jpeg" });
    expect(backdropSelectionSource({ kind: "custom", name: "my-room.jpg" }, file)).toBe(file);
  });

  it("a pasted link resolves to the held URL string", () => {
    expect(backdropSelectionSource({ kind: "custom", name: "Pasted image link" }, "https://x.test/a.png")).toBe(
      "https://x.test/a.png",
    );
  });

  it("a custom selection with nothing held resolves to null (honest empty)", () => {
    expect(backdropSelectionSource({ kind: "custom", name: "gone" }, null)).toBeNull();
  });

  it("the background never depends on the engine: resolution takes no quality input", () => {
    /* Engine independence is structural: the resolver's inputs are
       the selection and the held source only. Switching Pro ↔
       MediaPipe re-runs BackgroundChanger.setQuality, which never
       touches the backdrop — pinned in the changer source below. */
    expect(backdropSelectionSource.length).toBe(2);
    const setQualityBody = changer.slice(changer.indexOf("async setQuality"), changer.indexOf("async stop"));
    expect(setQualityBody).not.toContain("_backdrop");
    expect(setQualityBody).not.toContain("setImage");
  });
});

describe("upload rules — the app's existing image rules", () => {
  it("accepts JPG, PNG and WebP photos", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateBackdropUpload({ type, size: 1024 })).toBeNull();
    }
    expect(BACKDROP_UPLOAD_ACCEPT).toBe("image/png,image/jpeg,image/webp");
  });

  it("refuses other file types with a clear message", () => {
    const msg = validateBackdropUpload({ type: "image/gif", size: 1024 });
    expect(msg).toContain("JPG, PNG, or WebP");
    expect(validateBackdropUpload({ type: "application/pdf", size: 1024 })).toBe(msg);
    expect(validateBackdropUpload({ type: "", size: 1024 })).toBe(msg);
  });

  it("refuses an oversized photo and names the 5 MB line", () => {
    expect(validateBackdropUpload({ type: "image/png", size: BACKDROP_UPLOAD_MAX_BYTES })).toBeNull();
    const msg = validateBackdropUpload({ type: "image/png", size: BACKDROP_UPLOAD_MAX_BYTES + 1 });
    expect(msg).toContain("5 MB");
  });

  it("refuses an empty file", () => {
    expect(validateBackdropUpload({ type: "image/png", size: 0 })).toContain("empty");
  });
});

describe("upload outcome bookkeeping — failure keeps the previous background", () => {
  const previous: BackdropSelection = { kind: "builtin", id: "marble" };

  it("a successful upload becomes the custom selection", () => {
    const next = selectionAfterUpload(previous, { ok: true, name: "porch.png" });
    expect(next).toEqual({ kind: "custom", name: "porch.png" });
    expect(isCustomSelection(next)).toBe(true);
  });

  it("a failed upload returns the previous selection untouched (identity)", () => {
    expect(selectionAfterUpload(previous, { ok: false })).toBe(previous);
  });

  it("selection activity is per-choice: built-ins by id, the one custom slot by kind", () => {
    expect(isSelectionActive({ kind: "builtin", id: "stage" }, { kind: "builtin", id: "stage" })).toBe(true);
    expect(isSelectionActive({ kind: "builtin", id: "stage" }, { kind: "builtin", id: "marble" })).toBe(false);
    expect(isSelectionActive({ kind: "custom", name: "a" }, { kind: "custom", name: "b" })).toBe(true);
    expect(isSelectionActive({ kind: "custom", name: "a" }, { kind: "builtin", id: "stage" })).toBe(false);
  });
});

describe("the unified panel — source contract on BroadcastStudio", () => {
  it("the picker and the upload tile live INSIDE the Behind-me panel", () => {
    expect(behindMe).toContain("data-testid={`btn-backdrop-${b.id}`}");
    expect(behindMe).toContain('data-testid="btn-backdrop-upload"');
    expect(behindMe).toContain("Upload your photo");
    expect(behindMe).toContain('aria-label="Your background"');
    /* the mode pills (the green-screen toggle family) are in the
       same panel, above the picker — one control, not two surfaces */
    expect(behindMe.indexOf('aria-label="Background mode"')).toBeLessThan(
      behindMe.indexOf('aria-label="Your background"'),
    );
  });

  it("green screen on → the cue ties the picker to it, in the same panel", () => {
    expect(greenScreenCueVisible("green")).toBe(true);
    expect(greenScreenCueVisible("image")).toBe(false);
    expect(greenScreenCueVisible("none")).toBe(false);
    expect(behindMe).toContain('data-testid="gs-bg-cue"');
    expect(behindMe).toContain("Green screen is on");
  });

  it("the upload input carries the app image rules, not a bare image/*", () => {
    expect(behindMe).toContain("accept={BACKDROP_UPLOAD_ACCEPT}");
    expect(behindMe).not.toContain('accept="image/*"');
    /* the upload handler (defined with the panel's other handlers,
       above the JSX) runs the shared validator before anything is held */
    expect(studio).toContain("validateBackdropUpload(file)");
  });

  it("no silent drops remain: the old early-return upload/URL handlers are gone", () => {
    expect(studio).not.toContain("if (!file || !changerRef.current) return;");
    expect(studio).not.toContain("if (!url || !changerRef.current) return;");
    /* the held choice is what the camera-start and engine-landed
       paths apply — a photo picked before the camera starts is no
       longer lost */
    expect(studio).toContain("applyBackdropSelection");
    expect(studio).toContain("holdCustomBackdrop");
    expect(studio).not.toContain("BACKDROP_URIS[backdropId]");
    expect(studio).not.toContain("setBackdropId");
  });

  it("the held custom photo renders as its own tile beside the built-ins", () => {
    expect(behindMe).toContain('data-testid="btn-backdrop-custom"');
    expect(behindMe.indexOf('data-testid="btn-backdrop-custom"')).toBeLessThan(
      behindMe.indexOf('data-testid="btn-backdrop-upload"'),
    );
  });
});

describe("changer failure semantics — a failed pick keeps the working background", () => {
  it("setImage revokes the previous object URL only AFTER the new image loads", () => {
    const body = changer.slice(changer.indexOf("async setImage"), changer.indexOf("hasBackdrop"));
    const loadAt = body.indexOf("img.onerror");
    const revokeAt = body.indexOf("URL.revokeObjectURL(this._backdropUrl);\n    this._backdropUrl = typeof source");
    expect(loadAt).toBeGreaterThan(-1);
    expect(revokeAt).toBeGreaterThan(loadAt);
    /* and the failed pick's own object URL is cleaned up on the way out */
    expect(body).toContain('if (typeof source !== "string") URL.revokeObjectURL(url);');
  });
});
