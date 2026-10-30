/**
 * Embed-widget desk math (Stack900 C1): the preset sizes are honest
 * pixels, the preview src and the copied code are built from the same
 * numbers, and the responsive contract holds — every widget has a
 * phone box at 320px (the no-sideways-scroll floor), a tablet box and
 * a desktop box, phone ≤ tablet ≤ desktop.
 */
import { describe, it, expect } from "vitest";
import {
  EMBED_SIZE_KEYS,
  WIDGET_DIMS,
  buildEmbedCode,
  embedWidgetSrc,
  type EmbedWidgetKind,
} from "./embed-widgets";

const KINDS: EmbedWidgetKind[] = ["profile", "latest", "tips", "live", "product"];
const ORIGIN = "https://bowdownvisuals.com";

describe("WIDGET_DIMS — three honest device sizes per widget", () => {
  it("every widget has phone, tablet and desktop presets", () => {
    for (const kind of KINDS) {
      for (const size of EMBED_SIZE_KEYS) {
        const d = WIDGET_DIMS[kind][size];
        expect(d.w).toBeGreaterThan(0);
        expect(d.h).toBeGreaterThan(0);
      }
    }
  });

  it("phone boxes are exactly 320 wide — the narrowest screen a widget must fit", () => {
    for (const kind of KINDS) {
      expect(WIDGET_DIMS[kind].phone.w).toBe(320);
    }
  });

  it("widths grow phone → tablet → desktop", () => {
    for (const kind of KINDS) {
      expect(WIDGET_DIMS[kind].tablet.w).toBeGreaterThan(WIDGET_DIMS[kind].phone.w);
      expect(WIDGET_DIMS[kind].desktop.w).toBeGreaterThan(WIDGET_DIMS[kind].tablet.w);
    }
  });
});

describe("embedWidgetSrc", () => {
  it("builds /embed/<kind>/<target> with no params for the default dark theme", () => {
    expect(embedWidgetSrc(ORIGIN, "profile", { target: "some-creator" }, "dark")).toBe(
      `${ORIGIN}/embed/profile/some-creator`,
    );
  });

  it("carries theme=light only for the light theme, and the ref code when known", () => {
    expect(embedWidgetSrc(ORIGIN, "tips", { target: "my-tips", refCode: "ABC" }, "light")).toBe(
      `${ORIGIN}/embed/tips/my-tips?theme=light&ref=ABC`,
    );
    expect(embedWidgetSrc(ORIGIN, "live", { target: "some-creator" }, "light")).toBe(
      `${ORIGIN}/embed/live/some-creator?theme=light`,
    );
  });

  it("encodes the target", () => {
    expect(embedWidgetSrc(ORIGIN, "product", { target: "a/b" }, "dark")).toBe(
      `${ORIGIN}/embed/product/a%2Fb`,
    );
  });
});

describe("buildEmbedCode — the copied code matches the picked preset exactly", () => {
  it("carries the preset's exact pixels plus the shrink-to-fit guard", () => {
    const code = buildEmbedCode(ORIGIN, "latest", { target: "some-creator" }, "dark", "tablet", "Latest video");
    const d = WIDGET_DIMS.latest.tablet;
    expect(code).toContain(`width="${d.w}"`);
    expect(code).toContain(`height="${d.h}"`);
    expect(code).toContain("max-width:100%");
    expect(code).toContain(`src="${ORIGIN}/embed/latest/some-creator"`);
    expect(code).toContain('loading="lazy"');
  });

  it("each size produces its own numbers — no size is a relabel of another", () => {
    const phone = buildEmbedCode(ORIGIN, "profile", { target: "s" }, "dark", "phone", "Profile card");
    const desktop = buildEmbedCode(ORIGIN, "profile", { target: "s" }, "dark", "desktop", "Profile card");
    expect(phone).toContain('width="320"');
    expect(desktop).toContain(`width="${WIDGET_DIMS.profile.desktop.w}"`);
    expect(phone).not.toBe(desktop);
  });

  it("escapes quotes in the title", () => {
    const code = buildEmbedCode(ORIGIN, "product", { target: "p1" }, "dark", "phone", 'The "Gold" Hoodie');
    expect(code).toContain("The &quot;Gold&quot; Hoodie");
    expect(code).not.toContain('title="The "Gold"');
  });
});
