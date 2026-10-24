/**
 * #29 alt text on the client contract (social-api):
 *  - asAttachment PRESERVES a stored alt (it used to be dropped by the
 *    narrowing, which would have silently erased descriptions on any
 *    surface that re-shapes attachments).
 *  - Empty / non-string / over-long alts normalize away or cap at 400.
 *  - buildShortPostBody forwards thumbnailAltText as
 *    thumbnail_alt_text only when non-empty, clamped to 400.
 */
import { describe, expect, it } from "vitest";
import { asAttachment, type LooseAttachment } from "./social-api";
import { buildShortPostBody } from "./short-publish";

describe("asAttachment — alt preservation (#29)", () => {
  it("keeps the alt on image, video, product, track and watch attachments", () => {
    expect(asAttachment({ kind: "image", url: "https://x/a.png", alt: "A gold stage." } as LooseAttachment))
      .toEqual({ kind: "image", url: "https://x/a.png", alt: "A gold stage." });
    expect(asAttachment({ kind: "video", url: "https://x/v.mp4", thumb: "https://x/t.jpg", alt: "Cover: red lights." } as LooseAttachment))
      .toEqual({ kind: "video", url: "https://x/v.mp4", thumb: "https://x/t.jpg", alt: "Cover: red lights." });
    expect(asAttachment({ kind: "product", id: "p1", kindSlug: "merch", image: "https://x/p.png", alt: "Black tee, gold crown print." } as LooseAttachment))
      .toMatchObject({ alt: "Black tee, gold crown print." });
    expect(asAttachment({ kind: "track", id: "t1", artwork: "https://x/a.jpg", alt: "Neon skyline artwork." } as LooseAttachment))
      .toMatchObject({ alt: "Neon skyline artwork." });
    expect(asAttachment({ kind: "watch", id: "w1", thumb: "https://x/w.jpg", alt: "Studio session still." } as LooseAttachment))
      .toMatchObject({ alt: "Studio session still." });
  });

  it("drops empty/non-string alts and caps long ones at 400", () => {
    expect(asAttachment({ kind: "image", url: "https://x/a.png", alt: "   " } as LooseAttachment))
      .toEqual({ kind: "image", url: "https://x/a.png", alt: undefined });
    expect(asAttachment({ kind: "image", url: "https://x/a.png", alt: 42 } as unknown as LooseAttachment))
      .toEqual({ kind: "image", url: "https://x/a.png", alt: undefined });
    const long = asAttachment({ kind: "image", url: "https://x/a.png", alt: "y".repeat(900) } as LooseAttachment);
    expect(long?.kind === "image" && long.alt).toHaveLength(400);
  });
});

describe("buildShortPostBody — cover alt forwarding (#29)", () => {
  const base = {
    profileId: "11111111-1111-4111-8111-111111111111",
    title: "My short",
    videoUrl: "https://x/v.mp4",
    publish: true,
  };

  it("forwards a trimmed thumbnail_alt_text", () => {
    const body = buildShortPostBody({ ...base, thumbnailAltText: "  A dancer mid-spin, gold confetti. " });
    expect(body["thumbnail_alt_text"]).toBe("A dancer mid-spin, gold confetti.");
  });

  it("omits the field when blank or absent", () => {
    expect(buildShortPostBody({ ...base, thumbnailAltText: "   " })).not.toHaveProperty("thumbnail_alt_text");
    expect(buildShortPostBody({ ...base })).not.toHaveProperty("thumbnail_alt_text");
  });

  it("clamps an over-long description to the endpoint's 400 cap", () => {
    const body = buildShortPostBody({ ...base, thumbnailAltText: "z".repeat(900) });
    expect(String(body["thumbnail_alt_text"])).toHaveLength(400);
  });
});
