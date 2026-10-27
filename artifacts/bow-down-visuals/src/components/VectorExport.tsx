import { useState } from "react";
import { FileCode2 } from "lucide-react";
import { assessRasterOnlyDesign } from "@/lib/design-vector-export";

/**
 * The "Export as SVG" door for a design that is a generated picture
 * (Logo Studio logos, generated thumbnails). There is no honest SVG
 * for a raster picture, so the door says so — plainly, with the raster
 * option named — instead of downloading a picture wrapped in an SVG
 * shell and calling it a vector. True-vector export lives where
 * designs are built from text and shapes: the Photo desk's SVG export
 * (lib/photo-design-export.ts) and the Branding Kit's brand sheet
 * (lib/design-vector-export.ts).
 */
export function RasterVectorExportNote({
  kindLabel,
  tone = "dark",
}: {
  /** "logo" | "thumbnail" — names the design in the refusal copy. */
  kindLabel: string;
  tone?: "dark" | "light";
}) {
  const [open, setOpen] = useState(false);
  const assessment = assessRasterOnlyDesign({ kindLabel });
  const light = tone === "light";
  const option = assessment.rasterOptions[0]!;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="raster-vector-export"
        className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-bold transition ${
          light
            ? "border-black/15 text-black/60 hover:border-black/35 hover:text-black"
            : "border-white/15 text-white/60 hover:border-primary/50 hover:text-primary"
        }`}
      >
        <FileCode2 className="h-4 w-4" /> Export as SVG
      </button>
      {open && (
        <div
          role="note"
          data-testid="raster-vector-note"
          className={`basis-full rounded-xl border p-3 text-left text-xs leading-relaxed ${
            light ? "border-black/10 bg-black/[0.03] text-black/60" : "border-white/10 bg-white/[0.03] text-white/55"
          }`}
        >
          <p className={`font-bold ${light ? "text-black/80" : "text-white/85"}`}>
            No SVG for this one — honestly.
          </p>
          <p className="mt-1">{assessment.reason}</p>
          <p className={`mt-1.5 font-semibold ${light ? "text-black/75" : "text-white/75"}`}>
            Your export here: {option.label} — {option.note}
          </p>
        </div>
      )}
    </>
  );
}
