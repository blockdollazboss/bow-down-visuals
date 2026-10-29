/**
 * shop-product-title-wrap.test.ts — stack700 lane (shop title).
 *
 * Owner screenshot, Oct 28 16:23 EDT (TEST Buyer D Shop, light theme):
 * the product title on a shop product card read "TEST Digital Download —
 * delete pre-la…" — ellipsis-cut on ONE line by Tailwind `truncate`,
 * inside a tall card with empty space below it. A customer must be able
 * to read the full product title on the seller's shop page.
 *
 * Decision (from the grid evidence): product names are capped at 120
 * chars by the create form (my-shop.tsx maxLength={120}). A line clamp
 * (even 2–3 lines) can still ellipsis a legitimate max-length name at
 * the card's column widths, so the title WRAPS IN FULL — no clamp, no
 * ellipsis. Row consistency is kept structurally instead: the card is a
 * flex column, the body flexes, and the price is pinned to the bottom
 * of the body (mt-auto), so a row of mixed title lengths keeps equal
 * card heights and aligned prices.
 *
 * The same ellipsis defect sat on the sibling product-card surface —
 * the profile store tile (ProfileStoreSection) — fixed the same way:
 * wrap, never cut. (Compact list ROWS — cart lines, bump offers,
 * library delivery rows — keep their single-line truncation: beside a
 * price/action in a horizontal row is the correct pattern there, and
 * the full title one tap away fills the product dialog.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const shopSrc = readFileSync(join(__dirname, "shop.tsx"), "utf8");
const profileStoreSrc = readFileSync(
  join(__dirname, "../components/artist/ProfileStoreSection.tsx"),
  "utf8",
);

/** The className of the element whose direct child text is `expr`. */
function classNameOfElementRendering(src: string, expr: string): string {
  const idx = src.indexOf(`{${expr}}`);
  expect(idx, `expression {${expr}} not found`).toBeGreaterThan(-1);
  const open = src.lastIndexOf("<", idx);
  const tag = src.slice(open, idx);
  const m = tag.match(/className=(?:\{`([^`]*)`|"([^"]*)"|`([^`]*)`)/);
  expect(m, `no className found on element rendering {${expr}}`).not.toBeNull();
  return (m![1] ?? m![2] ?? m![3] ?? "").replace(/\$\{[^}]*\}/g, " ");
}

describe("shop product card — the full title is readable", () => {
  it("the card title wraps instead of truncating", () => {
    const cls = classNameOfElementRendering(shopSrc, "p.name");
    expect(cls).not.toContain("truncate");
    expect(cls).not.toContain("line-clamp");
    expect(cls).toContain("break-words");
  });

  it("the card is a flex column and the price is pinned to the body bottom (row alignment)", () => {
    // The product-grid card button carries the flex column…
    const cardBtn = shopSrc.match(/onClick=\{\(\) => setSelected\(p\)\}[\s\S]{0,400}?className=\{`([^`]*)`\}/);
    expect(cardBtn, "product card button not found").not.toBeNull();
    expect(cardBtn![1]).toContain("flex");
    expect(cardBtn![1]).toContain("flex-col");
    // …the card body flexes to fill the stretched card…
    expect(shopSrc).toContain('className="p-4 flex flex-1 flex-col"');
    // …and the price rides mt-auto so prices align across a row of
    // mixed title lengths instead of floating under each title.
    const priceCls = classNameOfElementRendering(shopSrc, "priceLabel(p.price_cents)");
    expect(priceCls).toContain("mt-auto");
  });

  it("the card grid renders the product name exactly once — as the wrapping title", () => {
    // Scope to the grid region (between the product-grid marker and the
    // detail-modal marker): the only element rendering {p.name} there is
    // the title itself, whose classes the first test already pins.
    const gridStart = shopSrc.indexOf("{/* product grid */}");
    const gridEnd = shopSrc.indexOf("{/* product detail modal */}");
    expect(gridStart).toBeGreaterThan(-1);
    expect(gridEnd).toBeGreaterThan(gridStart);
    const grid = shopSrc.slice(gridStart, gridEnd);
    expect(grid.match(/\{p\.name\}/g)).toHaveLength(1);
    expect(classNameOfElementRendering(grid, "p.name")).not.toContain("truncate");
  });
});

describe("profile store tile — sibling product card, same rule", () => {
  it("the tile title wraps instead of truncating", () => {
    const cls = classNameOfElementRendering(profileStoreSrc, "item.title");
    expect(cls).not.toContain("truncate");
    expect(cls).not.toContain("line-clamp");
    expect(cls).toContain("break-words");
  });
});
