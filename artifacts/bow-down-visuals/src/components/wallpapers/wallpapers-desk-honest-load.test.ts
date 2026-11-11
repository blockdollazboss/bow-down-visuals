/**
 * WallpapersDesk (the wallpaper desk) — honest load
 * classification (Stack-400 C-28 components residual,
 * deep-pins tranche 2). The desk is a generation surface:
 * priced renders (confirmedFetch) settling through artist-image
 * / runway task polls, plus store actions. The standard's
 * demand here is that no success is claimed before the server
 * proves it:
 *
 * - THE STORE LISTING: "Listed in your store" is toasted only
 *   from an ok response carrying a real product id — an ok
 *   without one throws the failure line, exactly like a non-ok.
 * - THE TASK POLLS follow the house discipline (the same
 *   interpretTaskPoll family the World desks use): a done read
 *   without a result is a failure, not a wallpaper.
 *
 * NO FIX in this lane — the flows already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("./WallpapersDesk.tsx");

describe("the store listing: listed is claimed only from a proven product", () => {
  it("an ok without a product id throws, like a non-ok", () => {
    expect(desk).toContain('const res = await fetch("/api/storefront/products", {');
    expect(desk).toContain("if (!res.ok || !data.product?.id) {");
    expect(desk).toContain("setListedId(data.product.id);");
    expect(desk.indexOf("if (!res.ok || !data.product?.id) {")).toBeLessThan(desk.indexOf("setListedId(data.product.id);"));
  });

  it("the success toast rides the proven id; failure lands on the error line", () => {
    expect(desk).toContain('toast({ title: t("wallpapers.listedToast", { defaultValue: "Listed in your store" }) });');
    expect(desk).toContain("setListError(plainErrorText(e,");
    expect(desk.indexOf("setListedId(data.product.id);")).toBeLessThan(desk.indexOf("toast({ title: t(\"wallpapers.listedToast\""));
  });
});
