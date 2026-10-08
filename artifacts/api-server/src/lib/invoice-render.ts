/* ─── Invoice PDF layout ──────────────────────────────────────────────────
   Gold/black luxury invoice. Rendered server-side from the stored invoice
   row (regenerated on every download, so the "Made with Bow Down Visuals"
   footer and any branding updates always apply). No images — base-14 fonts
   + vector rects/lines only, via lib/pdf.ts (zero dependencies). */

import { PdfBuilder, PdfPage, GOLD, GOLD_DARK, GREY, LIGHT_GREY, WHITE, BLACK } from "./pdf";
import type { Invoice, InvoiceLineItem } from "@workspace/db";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const FOOTER_H = 46;

function formatMoney(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function drawFooter(page: PdfPage, pageNum: number, totalPages: number): void {
  const y = PAGE_H - FOOTER_H + 18;
  page.line(MARGIN, PAGE_W - MARGIN, y, GOLD, 1.5);
  page.text(PAGE_W / 2, y + 10, "Made with Bow Down Visuals", {
    size: 9,
    color: GREY,
    align: "center",
  });
  if (totalPages > 1) {
    page.text(PAGE_W - MARGIN, y + 10, `Page ${pageNum} of ${totalPages}`, {
      size: 8,
      color: GREY,
      align: "right",
    });
  }
}

/** First-page header: black band, gold INVOICE lockup, creator + dates. */
function drawHeader(page: PdfPage, inv: Invoice): void {
  // black band
  page.rect(0, 0, PAGE_W, 132, BLACK);
  // gold rule under band
  page.rect(0, 132, PAGE_W, 4, GOLD);

  page.text(MARGIN, 30, "INVOICE", { size: 34, bold: true, color: GOLD });
  page.text(MARGIN, 74, inv.invoiceNumber, { size: 15, bold: true, color: WHITE });
  page.text(MARGIN, 96, "Bow Down Visuals · Creator Invoice", { size: 10, color: [0.72, 0.72, 0.72] });

  // dates, right-aligned inside the band
  page.text(PAGE_W - MARGIN, 34, `Issued  ${formatDate(inv.createdAt)}`, {
    size: 11,
    color: WHITE,
    align: "right",
  });
  page.text(PAGE_W - MARGIN, 52, `Due  ${formatDate(inv.dueDate)}`, {
    size: 11,
    bold: true,
    color: GOLD,
    align: "right",
  });
  page.text(PAGE_W - MARGIN, 96, "Billed by", { size: 9, color: GREY, align: "right" });
  page.text(PAGE_W - MARGIN, 108, inv.creatorName, { size: 12, bold: true, color: WHITE, align: "right" });

  page.cursor = 132 + 28;
}

/** "From" / "Bill to" blocks. */
function drawParties(page: PdfPage, inv: Invoice): void {
  const y = page.cursor;
  const colW = (PAGE_W - MARGIN * 2 - 32) / 2;
  const rightX = MARGIN + colW + 32;

  page.text(MARGIN, y, "From", { size: 10, bold: true, color: GOLD_DARK });
  let rows = page.text(MARGIN, y + 16, inv.creatorName, { size: 12, bold: true, maxWidth: colW });
  let yy = y + 16 + rows * 15;
  if (inv.creatorEmail) {
    page.text(MARGIN, yy, inv.creatorEmail, { size: 10, color: GREY, maxWidth: colW });
    yy += 15;
  }
  if (inv.paymentDetails) {
    rows = page.text(MARGIN, yy, `Pay to: ${inv.paymentDetails}`, {
      size: 10,
      color: GREY,
      maxWidth: colW,
    });
    yy += rows * 15;
  }

  page.text(rightX, y, "Bill to", { size: 10, bold: true, color: GOLD_DARK });
  let ry = y + 16;
  rows = page.text(rightX, ry, inv.brandName, { size: 12, bold: true, maxWidth: colW });
  ry += rows * 15;
  if (inv.brandEmail) {
    page.text(rightX, ry, inv.brandEmail, { size: 10, color: GREY, maxWidth: colW });
    ry += 15;
  }
  page.text(rightX, ry, `Invoice ${inv.invoiceNumber}`, { size: 10, color: GREY });
  page.text(rightX, ry + 15, inv.status === "paid" ? "Status: PAID" : "Status: Due", {
    size: 10,
    bold: true,
    color: inv.status === "paid" ? [0.16, 0.5, 0.28] : GOLD_DARK,
  });

  page.cursor = Math.max(yy, ry + 32) + 14;
}

interface ColumnLayout {
  x: number;
  w: number;
  align: "left" | "right";
  label: string;
}

function drawTableHeader(page: PdfPage, cols: ColumnLayout[], rowH: number): void {
  const y = page.cursor;
  page.rect(MARGIN, y, PAGE_W - MARGIN * 2, rowH, GOLD);
  cols.forEach((c) => {
    const tx = c.align === "right" ? c.x + c.w - 8 : c.x + 8;
    page.text(tx, y + 7, c.label, { size: 10, bold: true, color: BLACK, align: c.align });
  });
  page.cursor = y + rowH;
}

function drawLineItems(page: PdfPage, builder: PdfBuilder, items: InvoiceLineItem[], currency: string): PdfPage {
  const descW = 300;
  const cols: ColumnLayout[] = [
    { x: MARGIN, w: descW, align: "left", label: "Description" },
    { x: MARGIN + descW, w: 70, align: "right", label: "Qty" },
    { x: MARGIN + descW + 70, w: 80, align: "right", label: "Rate" },
    { x: MARGIN + descW + 150, w: PAGE_W - MARGIN * 2 - descW - 150, align: "right", label: "Amount" },
  ];
  const rowH = 30;

  const newPageWithHeader = (): PdfPage => {
    const p = builder.addPage();
    p.cursor = 48;
    drawTableHeader(p, cols, rowH);
    return p;
  };

  let active = page;
  if (!active.ensureSpace(rowH + 40)) active = newPageWithHeader();
  else drawTableHeader(active, cols, rowH);

  items.forEach((item, i) => {
    const wrapped = Math.max(
      1,
      Math.ceil(item.description.length / 62)
    );
    const need = Math.max(rowH, wrapped * 14 + 12);
    if (!active.ensureSpace(need)) active = newPageWithHeader();
    const y = active.cursor;
    if (i % 2 === 1) active.rect(MARGIN, y, PAGE_W - MARGIN * 2, need, LIGHT_GREY);

    const descRows = active.text(MARGIN + 8, y + 8, item.description, {
      size: 10,
      maxWidth: descW - 16,
      lineHeight: 14,
    });
    const rowUsed = Math.max(descRows * 14 + 12, rowH);
    active.text(cols[1]!.x + cols[1]!.w - 8, y + 8, String(item.quantity), {
      size: 10,
      align: "right",
    });
    active.text(cols[2]!.x + cols[2]!.w - 8, y + 8, formatMoney(item.rateCents, currency), {
      size: 10,
      align: "right",
    });
    active.text(cols[3]!.x + cols[3]!.w - 8, y + 8, formatMoney(item.quantity * item.rateCents, currency), {
      size: 10,
      bold: true,
      align: "right",
    });
    active.cursor = y + rowUsed;
  });

  return active;
}

export function renderInvoicePdf(inv: Invoice): Buffer {
  const builder = new PdfBuilder(`Invoice ${inv.invoiceNumber}`);
  const first = builder.addPage();

  drawHeader(first, inv);
  drawParties(first, inv);
  const last = drawLineItems(first, builder, inv.lineItems ?? [], inv.currency);

  // totals
  const totalY = last.cursor + 18;
  last.line(MARGIN, PAGE_W - MARGIN, totalY, GOLD, 1.5);
  last.text(MARGIN + 8, totalY + 10, "Total due", { size: 13, bold: true, color: BLACK });
  last.text(PAGE_W - MARGIN - 8, totalY + 10, formatMoney(inv.totalCents, inv.currency), {
    size: 16,
    bold: true,
    color: GOLD_DARK,
    align: "right",
  });
  last.cursor = totalY + 44;

  if (inv.notes) {
    last.text(MARGIN, last.cursor, "Notes", { size: 10, bold: true, color: GOLD_DARK });
    const rows = last.text(MARGIN, last.cursor + 15, inv.notes, {
      size: 10,
      color: GREY,
      maxWidth: PAGE_W - MARGIN * 2,
    });
    last.cursor += 15 + rows * 14 + 10;
  }

  builder.forEachPage((p, pageNum, totalPages) => drawFooter(p, pageNum, totalPages));

  return builder.toBuffer();
}
