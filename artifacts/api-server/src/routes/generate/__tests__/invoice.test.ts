/**
 * Tests for the Sponsor Invoice Generator backend.
 *
 * Covers: the 50-Visual-Buc price, input schema validation, and the
 * zero-dependency PDF renderer (structure validity, gold/black branding,
 * multi-page overflow, and the Bow Down Visuals footer credit).
 */
import { describe, expect, it } from "vitest";
import { INVOICE_CREDIT_COST, invoiceRequestSchema } from "../invoice";
import { renderInvoicePdf } from "../../../lib/invoice-render";
import { PdfBuilder } from "../../../lib/pdf";
import type { Invoice } from "@workspace/db";

const validBody = {
  brandName: "Wave Energy",
  brandEmail: "pay@waveenergy.co",
  creatorName: "Test Creator",
  creatorEmail: "creator@example.com",
  paymentDetails: "Cash App: $testcreator",
  lineItems: [
    { description: "Sponsored TikTok post (60s)", quantity: 1, rateCents: 250000 },
    { description: "Usage licensing — 90 days", quantity: 1, rateCents: 75000 },
  ],
  currency: "USD",
  dueDate: "2026-11-06",
  notes: "Net 30.",
};

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: "user-1",
    invoiceNumber: "BDV-2026-0001",
    brandName: "Wave Energy",
    brandEmail: "pay@waveenergy.co",
    creatorName: "Test Creator",
    creatorEmail: "creator@example.com",
    paymentDetails: "Cash App: $testcreator",
    lineItems: [
      { description: "Sponsored TikTok post (60s)", quantity: 1, rateCents: 250000 },
      { description: "Usage licensing — 90 days", quantity: 1, rateCents: 75000 },
    ],
    totalCents: 325000,
    currency: "USD",
    dueDate: new Date("2026-11-06T00:00:00Z"),
    notes: "Net 30.",
    status: "unpaid",
    paidAt: null,
    createdAt: new Date("2026-10-07T00:00:00Z"),
    ...overrides,
  };
}

describe("INVOICE_CREDIT_COST", () => {
  it("charges 50 Visual Bucs per generated invoice PDF", () => {
    expect(INVOICE_CREDIT_COST).toBe(50);
  });
});

describe("invoiceRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(invoiceRequestSchema.safeParse(validBody).success).toBe(true);
  });

  it("rejects an empty brand name", () => {
    const r = invoiceRequestSchema.safeParse({ ...validBody, brandName: "  " });
    expect(r.success).toBe(false);
  });

  it("rejects zero line items", () => {
    const r = invoiceRequestSchema.safeParse({ ...validBody, lineItems: [] });
    expect(r.success).toBe(false);
  });

  it("rejects a negative rate", () => {
    const r = invoiceRequestSchema.safeParse({
      ...validBody,
      lineItems: [{ description: "X", quantity: 1, rateCents: -50 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid due date", () => {
    const r = invoiceRequestSchema.safeParse({ ...validBody, dueDate: "not-a-date" });
    expect(r.success).toBe(false);
  });

  it("uppercases the currency code", () => {
    const r = invoiceRequestSchema.safeParse({ ...validBody, currency: "eur" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("EUR");
  });
});

describe("renderInvoicePdf", () => {
  it("produces a structurally valid PDF with gold/black branding", () => {
    const buf = renderInvoicePdf(makeInvoice());
    const s = buf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("(INVOICE)");
    expect(s).toContain("BDV-2026-0001");
    expect(s).toContain("Made with Bow Down Visuals");
    // xref table offset must point at the literal "xref"
    const xrefAt = s.lastIndexOf("startxref");
    const xrefOff = parseInt(s.slice(xrefAt).split(/\s+/)[1]!, 10);
    expect(s.slice(xrefOff, xrefOff + 4)).toBe("xref");
  });

  it("escapes PDF string metacharacters in user input", () => {
    const buf = renderInvoicePdf(makeInvoice({ brandName: "Acme (Co.) \\ Ltd" }));
    const s = buf.toString("latin1");
    expect(s).toContain("Acme \\(Co.\\) \\\\ Ltd");
  });

  it("overflows long line-item lists across multiple pages with footers on each", () => {
    const inv = makeInvoice({
      lineItems: Array.from({ length: 42 }, (_, i) => ({
        description: `Deliverable ${i + 1}`,
        quantity: 1,
        rateCents: 100,
      })),
    });
    const s = renderInvoicePdf(inv).toString("latin1");
    const count = s.match(/\/Count (\d+)/)?.[1];
    expect(Number(count)).toBeGreaterThan(1);
    expect((s.match(/Made with Bow Down Visuals/g) ?? []).length).toBe(Number(count));
  });
});

describe("PdfBuilder", () => {
  it("renders an empty document without crashing", () => {
    const b = new PdfBuilder("empty");
    b.addPage();
    const s = b.toBuffer().toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
  });
});
