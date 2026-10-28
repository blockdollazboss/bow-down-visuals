/**
 * purchases-panel-delivery-missing.test.ts — stack600.
 *
 * Gate Pass 2 follow-up: a paid shop sale whose product carried no
 * deliverable now rides GET /api/shops/my-purchases as a
 * deliveryMissing order record (downloadUrl: null). The panel must
 * render those rows honestly — an order-record / waiting-on-file
 * chip — and must NEVER render a Download anchor with a null href.
 * Delivered rows keep the Download button exactly as before.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const panelSrc = readFileSync(join(__dirname, "PurchasesPanel.tsx"), "utf8");

describe("PurchasesPanel — undelivered-sale rows", () => {
  it("types the download URL as nullable and carries the missing flag", () => {
    expect(panelSrc).toContain("downloadUrl: string | null;");
    expect(panelSrc).toContain("deliveryMissing?: boolean;");
  });

  it("branches on deliveryMissing before rendering any Download anchor", () => {
    const branchAt = panelSrc.indexOf("p.deliveryMissing ? (");
    const anchorAt = panelSrc.indexOf("p.downloadUrl ?? undefined");
    expect(branchAt).toBeGreaterThan(-1);
    expect(anchorAt).toBeGreaterThan(branchAt);
  });

  it("words the missing state honestly: digital waits on the seller's file, the rest are order records", () => {
    expect(panelSrc).toContain('p.productType === "digital"');
    expect(panelSrc).toContain("library.purchasesAwaitingFile");
    expect(panelSrc).toContain("Waiting on the seller's file");
    expect(panelSrc).toContain("library.purchasesOrderRecorded");
    expect(panelSrc).toContain("Order recorded");
  });

  it("delivered rows keep the real download link (p.downloadUrl still drives the anchor)", () => {
    expect(panelSrc).toContain("href={p.downloadUrl ?? undefined}");
    expect(panelSrc).toContain('t("library.purchasesDownload"');
  });
});
