/* Thy Books — EPUB and PDF export generation.
   Phase 2: export a book's chapters as a valid EPUB 3 file or a
   print-ready interior PDF. */

import PDFDocument from "pdfkit";
import * as archiver from "archiver";
import { PassThrough } from "stream";

export interface BookExportData {
  title: string;
  subtitle?: string | null;
  author_name?: string | null;
  genre?: string | null;
  description?: string | null;
  cover_url?: string | null;
  chapters: Array<{
    title: string;
    content: string;
    position: number;
  }>;
}

/* Escape XML special chars for EPUB XHTML. */
function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Convert chapter plain text to simple XHTML paragraphs.
   Blank lines become paragraph breaks; single newlines become <br/>. */
function textToXhtmlParagraphs(text: string): string {
  const blocks = text.split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((l) => escXml(l.trim()))
        .filter(Boolean)
        .join("<br/>\n");
      return lines ? `    <p>${lines}</p>` : "";
    })
    .filter(Boolean)
    .join("\n");
}

const EPUB_CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function buildOpf(data: BookExportData, chapterIds: string[]): string {
  const author = escXml(data.author_name || "Unknown Author");
  const title = escXml(data.title);
  const manifestItems = chapterIds
    .map((id) => `    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("\n");
  const spineItems = chapterIds.map((id) => `    <itemref idref="${id}"/>`).join("\n");
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:bowdownvisuals:${Date.now()}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>en</dc:language>
    <dc:description>${escXml(data.description || "")}</dc:description>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`;
}

function buildNcx(data: BookExportData, chapterIds: string[], chapters: BookExportData["chapters"]): string {
  const navPoints = chapterIds
    .map((id, i) => {
      const ch = chapters[i]!;
      return `    <navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escXml(ch.title)}</text></navLabel>
      <content src="${id}.xhtml"/>
    </navPoint>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="urn:bowdownvisuals:${Date.now()}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escXml(data.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

function buildNavXhtml(data: BookExportData, chapterIds: string[], chapters: BookExportData["chapters"]): string {
  const items = chapterIds
    .map((id, i) => `      <li><a href="${id}.xhtml">${escXml(chapters[i]!.title)}</a></li>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Table of Contents</title></head>
<body>
  <nav epub:type="toc">
    <h1>Contents</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`;
}

function buildChapterXhtml(chapter: { title: string; content: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(chapter.title)}</title></head>
<body>
  <h1>${escXml(chapter.title)}</h1>
${textToXhtmlParagraphs(chapter.content)}
</body>
</html>`;
}

/* Title page XHTML. */
function buildTitleXhtml(data: BookExportData): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(data.title)}</title></head>
<body>
  <h1>${escXml(data.title)}</h1>
  ${data.subtitle ? `<h2>${escXml(data.subtitle)}</h2>` : ""}
  <p>by ${escXml(data.author_name || "Unknown Author")}</p>
</body>
</html>`;
}

/* Generate a valid EPUB 3 file as a Buffer.
   The mimetype file MUST be first and uncompressed per the EPUB spec. */
export async function generateEpub(data: BookExportData): Promise<Buffer> {
  const sorted = [...data.chapters].sort((a, b) => a.position - b.position);
  const chapterIds = ["title", ...sorted.map((_, i) => `chapter-${i + 1}`)];

  return new Promise((resolve, reject) => {
    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const out = new PassThrough();
    out.on("data", (c: Buffer) => chunks.push(c));
    out.on("end", () => resolve(Buffer.concat(chunks)));
    out.on("error", reject);
    archive.on("error", reject);
    archive.pipe(out);

    /* mimetype first, stored (no compression) — required by the spec. */
    archive.append("application/epub+zip", { name: "mimetype", store: true });
    archive.append(EPUB_CONTAINER, { name: "META-INF/container.xml" });
    archive.append(buildOpf(data, chapterIds), { name: "OEBPS/content.opf" });
    archive.append(buildNcx(data, chapterIds.slice(1), sorted), { name: "OEBPS/toc.ncx" });
    archive.append(buildNavXhtml(data, chapterIds, [{ title: data.title, content: "", position: -1 }, ...sorted]), {
      name: "OEBPS/nav.xhtml",
    });
    archive.append(buildTitleXhtml(data), { name: "OEBPS/title.xhtml" });
    sorted.forEach((ch, i) => {
      archive.append(buildChapterXhtml(ch), { name: `OEBPS/chapter-${i + 1}.xhtml` });
    });

    archive.finalize();
  });
}

/* ── PDF ── */

/* Generate a print-ready interior PDF as a Buffer.
   6" x 9" trim size, generous margins, page numbers, chapter breaks.
   Returns the PDF plus the page count (needed for Lulu spine math). */
export async function generatePdf(data: BookExportData): Promise<{ pdf: Buffer; pageCount: number }> {
  return new Promise((resolve, reject) => {
    /* 6x9 inches at 72pt = 432 x 648 */
    const doc = new PDFDocument({
      size: [432, 648],
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title: data.title,
        Author: data.author_name || "Unknown Author",
        Subject: data.subtitle || "",
        Keywords: data.genre || "",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    let pageCount = 1;
    doc.on("pageAdded", () => { pageCount++; });
    doc.on("end", () => resolve({ pdf: Buffer.concat(chunks), pageCount }));
    doc.on("error", reject);

    const sorted = [...data.chapters].sort((a, b) => a.position - b.position);
    let pageNum = 0;

    const footer = () => {
      pageNum++;
      if (pageNum <= 1) return; // no footer on title page
      const y = doc.page.height - 50;
      doc
        .fontSize(9)
        .fillColor("#666666")
        .text(String(pageNum), doc.page.margins.left, y, {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "center",
        });
    };
    doc.on("pageAdded", footer);

    /* Title page */
    doc
      .fontSize(28)
      .fillColor("#111111")
      .font("Helvetica-Bold")
      .text(data.title, { align: "center" });
    if (data.subtitle) {
      doc.moveDown(0.5).fontSize(14).font("Helvetica").fillColor("#444444").text(data.subtitle, { align: "center" });
    }
    doc.moveDown(2).fontSize(12).fillColor("#222222").text(`by ${data.author_name || "Unknown Author"}`, {
      align: "center",
    });
    if (data.description) {
      doc.moveDown(2).fontSize(10).fillColor("#555555").text(data.description, { align: "center" });
    }
    pageNum = 1;

    /* Chapters — each starts on a new page */
    for (const ch of sorted) {
      doc.addPage();
      doc
        .fontSize(20)
        .font("Helvetica-Bold")
        .fillColor("#111111")
        .text(ch.title, { align: "left" });
      doc.moveDown(1.5);

      const paragraphs = ch.content.split(/\n\s*\n/);
      doc.fontSize(11).font("Helvetica").fillColor("#1a1a1a");
      for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        /* First-line indent for body paragraphs, justified like a real book. */
        doc.text(trimmed.replace(/\n/g, " "), {
          align: "justify",
          indent: 18,
          paragraphGap: 6,
          lineGap: 2,
        });
      }
    }

    doc.end();
  });
}

/* Safe filename from a book title. */
export function bookFilename(title: string, ext: string): string {
  const safe = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "book";
  return `${safe}.${ext}`;
}

/* ── Print-ready cover PDF ── */

export interface CoverPdfData {
  title: string;
  subtitle?: string | null;
  author_name?: string | null;
  description?: string | null; // back-cover blurb
  /* Spine width in inches — from Lulu /cover-dimensions/. */
  spineWidthInches: number;
  /* Optional cover art image (Buffer of PNG/JPEG). Placed on the front cover. */
  coverArt?: Buffer | null;
}

/* Generate a one-piece cover spread PDF: back cover + spine + front cover.
   6x9 trim, 0.125" bleed on all outer edges. All measurements in points. */
export async function generateCoverPdf(data: CoverPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const PT = 72; // points per inch
    const TRIM_W = 6 * PT;
    const TRIM_H = 9 * PT;
    const BLEED = 0.125 * PT;
    const spine = Math.max(0.1, data.spineWidthInches) * PT;

    const pageW = TRIM_W * 2 + spine + BLEED * 2;
    const pageH = TRIM_H + BLEED * 2;

    const doc = new PDFDocument({
      size: [pageW, pageH],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `${data.title} — Cover`,
        Author: data.author_name || "Unknown Author",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    /* X coordinates of each panel (including bleed offset) */
    const backX = BLEED;
    const spineX = BLEED + TRIM_W;
    const frontX = BLEED + TRIM_W + spine;
    const panelY = BLEED;

    /* ── Back cover: dark luxury background + blurb ── */
    doc.rect(backX, panelY, TRIM_W, TRIM_H).fill("#0d0d0d");
    const backInnerX = backX + 36;
    const backInnerW = TRIM_W - 72;
    let by = panelY + 60;
    doc.fillColor("#d4af37").font("Helvetica-Bold").fontSize(11).text("ABOUT THIS BOOK", backInnerX, by, { width: backInnerW });
    by += 28;
    if (data.description) {
      doc.fillColor("#e8e8e8").font("Helvetica").fontSize(10).text(data.description.slice(0, 1200), backInnerX, by, {
        width: backInnerW,
        lineGap: 4,
      });
      by = doc.y + 24;
    }
    /* Publisher mark at bottom of back cover */
    doc.fillColor("#d4af37").font("Helvetica-Bold").fontSize(9).text("BOW DOWN VISUALS", backInnerX, panelY + TRIM_H - 60, { width: backInnerW, align: "left" });

    /* ── Spine: title + author, rotated ── */
    doc.rect(spineX, panelY, spine, TRIM_H).fill("#111111");
    doc.save();
    /* Rotate so text reads top-to-bottom down the spine */
    doc.translate(spineX + spine / 2, panelY + TRIM_H / 2).rotate(90);
    const spineText = `${data.title}${data.author_name ? `  •  ${data.author_name}` : ""}`;
    doc.fillColor("#d4af37").font("Helvetica-Bold").fontSize(Math.min(14, spine * 0.55)).text(spineText, -TRIM_H / 2 + 36, -7, {
      width: TRIM_H - 72,
      align: "center",
    });
    doc.restore();

    /* ── Front cover ── */
    if (data.coverArt) {
      try {
        doc.image(data.coverArt, frontX, panelY, { width: TRIM_W, height: TRIM_H });
      } catch {
        doc.rect(frontX, panelY, TRIM_W, TRIM_H).fill("#0d0d0d");
      }
    } else {
      /* No art — elegant typographic cover */
      doc.rect(frontX, panelY, TRIM_W, TRIM_H).fill("#0d0d0d");
      /* Gold rule accents */
      doc.rect(frontX + 36, panelY + 48, TRIM_W - 72, 2).fill("#d4af37");
      doc.rect(frontX + 36, panelY + TRIM_H - 50, TRIM_W - 72, 2).fill("#d4af37");
    }
    /* Title block overlaid at top of front cover */
    const fx = frontX + 36;
    const fw = TRIM_W - 72;
    /* Subtle scrim for readability when art is present */
    if (data.coverArt) {
      doc.rect(frontX, panelY, TRIM_W, 190).fillOpacity(0.55).fill("#000000").fillOpacity(1);
    }
    doc.fillColor(data.coverArt ? "#ffffff" : "#d4af37").font("Helvetica-Bold").fontSize(26).text(data.title, fx, panelY + 56, {
      width: fw,
      align: "center",
    });
    let fy = doc.y + 10;
    if (data.subtitle) {
      doc.fillColor(data.coverArt ? "#e8e8e8" : "#a8a8a8").font("Helvetica").fontSize(13).text(data.subtitle, fx, fy, { width: fw, align: "center" });
      fy = doc.y + 8;
    }
    if (data.author_name) {
      doc.fillColor("#d4af37").font("Helvetica-Bold").fontSize(12).text(data.author_name.toUpperCase(), fx, fy, { width: fw, align: "center" });
    }

    doc.end();
  });
}
