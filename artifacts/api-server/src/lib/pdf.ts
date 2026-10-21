/* ─── Minimal PDF writer ────────────────────────────────────────────────────
   Dependency-free PDF 1.4 generator (Helvetica / Helvetica-Bold base-14
   fonts, no embedding, no images). Used server-side to render branded
   invoices without adding a heavy PDF dependency to the api-server bundle.
   Supports multi-page documents via the Page helper's automatic overflow. */

export interface TextOptions {
  size?: number;
  bold?: boolean;
  /** [r, g, b] in 0..1 */
  color?: [number, number, number];
  align?: "left" | "center" | "right";
  /** max width in points — wraps words; returns rows used */
  maxWidth?: number;
  lineHeight?: number;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const BLACK: [number, number, number] = [0, 0, 0];
export { BLACK };
export const GOLD: [number, number, number] = [0.82, 0.68, 0.33]; // #d4ad55
export const GOLD_DARK: [number, number, number] = [0.62, 0.49, 0.22];
export const GREY: [number, number, number] = [0.42, 0.42, 0.42];
export const LIGHT_GREY: [number, number, number] = [0.95, 0.95, 0.95];
export const WHITE: [number, number, number] = [1, 1, 1];

/** Very rough width estimate for base-14 Helvetica (avg ~0.55em per char). */
function estimateWidth(text: string, size: number, bold: boolean): number {
  const perChar = bold ? 0.6 : 0.55;
  return text.length * size * perChar;
}

function wrapWords(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (estimateWidth(candidate, size, bold) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export class PdfPage {
  ops: string[] = [];
  width: number;
  height: number;
  /** current cursor y, measured from TOP (PDF y is flipped at emit time) */
  cursor: number;

  constructor(width = 612, height = 792) {
    this.width = width;
    this.height = height;
    this.cursor = height;
  }

  private toPdfY(topY: number): number {
    return this.height - topY;
  }

  private setColor(color: [number, number, number], fill: boolean): void {
    const c = color.map((v) => v.toFixed(3)).join(" ");
    this.ops.push(fill ? `${c} rg` : `${c} RG`);
  }

  /** Filled rectangle. x/y measured from top-left. */
  rect(x: number, y: number, w: number, h: number, color: [number, number, number]): void {
    this.setColor(color, true);
    this.ops.push(`${x.toFixed(2)} ${this.toPdfY(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  /** Horizontal line. */
  line(x1: number, x2: number, y: number, color: [number, number, number], width = 1): void {
    this.setColor(color, false);
    this.ops.push(`${width.toFixed(2)} w ${x1.toFixed(2)} ${this.toPdfY(y).toFixed(2)} m ${x2.toFixed(2)} ${this.toPdfY(y).toFixed(2)} l S`);
  }

  /** Draw text; returns the number of rows used (for maxWidth wrapping). */
  text(x: number, y: number, value: string, opts: TextOptions = {}): number {
    const size = opts.size ?? 11;
    const bold = opts.bold ?? false;
    const color = opts.color ?? BLACK;
    const font = bold ? "F2" : "F1";
    const lh = opts.lineHeight ?? size * 1.35;
    const lines = opts.maxWidth != null ? wrapWords(value, size, bold, opts.maxWidth) : [value];
    this.setColor(color, true);
    lines.forEach((line, i) => {
      let tx = x;
      if (opts.align === "center") {
        tx = x - estimateWidth(line, size, bold) / 2;
      } else if (opts.align === "right") {
        tx = x - estimateWidth(line, size, bold);
      }
      const ty = y + i * lh;
      this.ops.push(
        `BT /${font} ${size} Tf ${tx.toFixed(2)} ${this.toPdfY(ty + size * 0.8).toFixed(2)} Td (${escapeText(line)}) Tj ET`
      );
    });
    return lines.length;
  }

  /** Ensure `need` points of vertical space remain before the bottom margin.
      Cursor grows downward from the top of the page. */
  ensureSpace(need: number, marginBottom = 60): boolean {
    return this.cursor + need <= this.height - marginBottom;
  }

  gap(px: number): void {
    this.cursor -= px;
  }
}

export interface PdfDocument {
  title: string;
}

export class PdfBuilder {
  private pages: PdfPage[] = [];
  title: string;

  constructor(title = "") {
    this.title = title;
  }

  addPage(): PdfPage {
    const p = new PdfPage();
    this.pages.push(p);
    return p;
  }

  forEachPage(cb: (page: PdfPage, index: number, total: number) => void): void {
    this.pages.forEach((p, i) => cb(p, i + 1, this.pages.length));
  }

  toBuffer(): Buffer {
    const objects: string[] = [];
    const offsets: number[] = [];
    const nPages = this.pages.length;

    const catalogId = 1;
    const pagesId = 2;
    let nextId = 3;
    const pageIds: number[] = [];
    const contentIds: number[] = [];
    for (let i = 0; i < nPages; i++) {
      pageIds.push(nextId++);
      contentIds.push(nextId++);
    }
    const fontRegId = nextId++;
    const fontBoldId = nextId++;

    objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${nPages} >>`;

    this.pages.forEach((page, i) => {
      objects[pageIds[i]!] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 ${fontRegId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`;
      const stream = page.ops.join("\n");
      objects[contentIds[i]!] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
    });
    objects[fontRegId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
    objects[fontBoldId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`;

    const parts: Buffer[] = [];
    const header = Buffer.from("%PDF-1.4\n", "utf8");
    parts.push(header);
    let offset = header.length;
    for (let id = 1; id < nextId; id++) {
      const obj = Buffer.from(`${id} 0 obj\n${objects[id]}\nendobj\n`, "utf8");
      offsets[id] = offset;
      parts.push(obj);
      offset += obj.length;
    }
    const xrefOffset = offset;
    const xrefLines = [`xref`, `0 ${nextId}`, `0000000000 65535 f `];
    for (let id = 1; id < nextId; id++) {
      xrefLines.push(`${String(offsets[id]).padStart(10, "0")} 00000 n `);
    }
    const safeTitle = escapeText(this.title);
    const trailer = `trailer\n<< /Size ${nextId} /Root ${catalogId} 0 R /Info << /Title (${safeTitle}) /Producer (Bow Down Visuals) >> >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    parts.push(Buffer.from(xrefLines.join("\n") + "\n" + trailer, "utf8"));
    return Buffer.concat(parts);
  }
}
