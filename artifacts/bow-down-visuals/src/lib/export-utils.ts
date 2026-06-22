import jsPDF from "jspdf";

const BRAND  = "BOW DOWN VISUALS";
const SLOGAN = "Create the Song. Create the Video. Promote the Release.";

export interface ExportMeta {
  projectType:  string;
  artistName?:  string | null;
  songTitle?:   string | null;
  genre?:       string | null;
  mood?:        string | null;
  createdAt?:   string | Date;
  result:       string;
}

function formatDate(d?: string | Date): string {
  return (d ? new Date(d) : new Date()).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function buildFilename(meta: ExportMeta): string {
  return (
    [meta.artistName, meta.songTitle, meta.projectType]
      .filter(Boolean)
      .join(" - ")
      .replace(/[^a-z0-9 \-]/gi, "")
      .trim() || "bow-down-visuals-export"
  );
}

/* ─── TXT ─── */
export function downloadTxt(meta: ExportMeta): void {
  const sep = "═".repeat(52);
  const rows: string[] = [
    BRAND,
    SLOGAN,
    sep,
    `Project Type : ${meta.projectType}`,
    ...(meta.artistName ? [`Artist Name  : ${meta.artistName}`] : []),
    ...(meta.songTitle  ? [`Song Title   : ${meta.songTitle}`]  : []),
    ...(meta.genre      ? [`Genre        : ${meta.genre}`]      : []),
    ...(meta.mood       ? [`Mood         : ${meta.mood}`]       : []),
    `Date Created : ${formatDate(meta.createdAt)}`,
    sep,
    "",
    meta.result,
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${buildFilename(meta)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── PDF ─── */
export function downloadPdf(meta: ExportMeta): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW   = doc.internal.pageSize.getWidth();
  const pageH   = doc.internal.pageSize.getHeight();
  const margin  = 18;
  const colW    = pageW - margin * 2;
  const GOLD    = [180, 140, 20] as const;
  const GOLD_DIM = [150, 115, 15] as const;
  const WHITE   = [255, 255, 255] as const;
  const LIGHT   = [215, 215, 215] as const;
  const BG      = [10, 10, 10] as const;

  function bg() {
    doc.setFillColor(...BG);
    doc.rect(0, 0, pageW, pageH, "F");
  }

  bg();

  /* Gold header bar */
  doc.setFillColor(...GOLD);
  doc.rect(0, 0, pageW, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...WHITE);
  doc.text(BRAND, margin, 14);

  let y = 32;

  /* Slogan */
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8.5);
  doc.setTextColor(...GOLD_DIM);
  doc.text(SLOGAN, margin, y);
  y += 9;

  /* Separator */
  doc.setDrawColor(...GOLD_DIM);
  doc.setLineWidth(0.35);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  /* Metadata rows */
  const metaRows: [string, string][] = [
    ["Project Type", meta.projectType],
    ...(meta.artistName ? [["Artist Name",  meta.artistName] as [string, string]] : []),
    ...(meta.songTitle  ? [["Song Title",   meta.songTitle]  as [string, string]] : []),
    ...(meta.genre      ? [["Genre",        meta.genre]      as [string, string]] : []),
    ...(meta.mood       ? [["Mood",         meta.mood]       as [string, string]] : []),
    ["Date Created", formatDate(meta.createdAt)],
  ];

  for (const [label, value] of metaRows) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GOLD);
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...LIGHT);
    doc.text(value, margin + 34, y);
    y += 6;
  }

  y += 4;
  doc.setDrawColor(45, 45, 45);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  /* Generated content */
  for (const line of meta.result.split("\n")) {
    const isHeader = line.startsWith("## ");
    const text     = isHeader ? line.replace(/^## /, "").trim() : line;

    if (isHeader) {
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...GOLD);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...LIGHT);
    }

    if (text === "") {
      y += 3.5;
      continue;
    }

    const wrapped = doc.splitTextToSize(text, colW) as string[];
    for (const wl of wrapped) {
      if (y > pageH - margin) {
        doc.addPage();
        bg();
        y = margin;
      }
      doc.text(wl, margin, y);
      y += isHeader ? 6 : 4.8;
    }
  }

  /* Footer — brand line on the final page */
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  doc.text(`${BRAND}  ·  Create the Song. Create the Video. Promote the Release.`, margin, pageH - 8);

  doc.save(`${buildFilename(meta)}.pdf`);
}
