import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import {
  CATALOG_EXPORT_FIELD_OPTIONS,
  CATALOG_EXPORT_FORMAT_OPTIONS,
  CATALOG_EXPORT_KIND_OPTIONS,
  allExportFields,
  apiErrorLine,
  catalogFileName,
  exportBuildPath,
  exportBuildPayload,
  exportBuildProblem,
  exportResultLine,
  parseExportBuildResult,
  type CatalogExportFormat,
  type CatalogExportKind,
  type ExportBuildResult,
} from "@/lib/world/get-paid-tail";

/* ─── CatalogExportDesk — the catalog-export BUILDER, in the
   Get Paid Room (World Parity P3-F). The Settings page's builder
   (TrustPanels' CatalogExportPanel) is the reference: one catalog
   kind, only the fields the creator picks, built by POST
   /api/catalog-export/build and downloaded as a CSV or JSON file.
   The file is the result in-world — the EarningsBoard statement
   pattern: fetch it with the member's token, hand it to the
   browser's save dialog, stay in the room (a download is not a
   pull-up; plan §3.9). The desk's result line reports the
   server's own count, and when the rail's 2,000-row cap cut the
   build the line says so — the server flags it
   (X-Export-Truncated / the JSON body's `truncated`) and the
   desk never poses a capped file as the whole catalog. Kind and
   field options ride lib/world/get-paid-tail, which mirrors (and
   test-pins) the site's own options module. The full-catalog
   PACKAGE (POST /api/catalog-export, one manifest of everything)
   is a different tool and is not this desk. The EarningsBoard
   already pitches guests, so no fetch fires for them. */

export function CatalogExportDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const [kind, setKind] = useState<CatalogExportKind>("tracks");
  const [fields, setFields] = useState<string[]>(() => allExportFields("tracks"));
  const [format, setFormat] = useState<CatalogExportFormat>("csv");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportBuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${
      active ? "bg-[#d4af37] text-black" : isLight ? "border border-[#7A5A12]/30 text-[#6B5B36]" : "border border-white/15 text-white/75"
    }`;

  const pickKind = (next: CatalogExportKind) => {
    setKind(next);
    setFields(allExportFields(next));
    setResult(null);
    setError(null);
  };

  const toggleField = (key: string) => {
    setFields((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
    setResult(null);
  };

  const build = async () => {
    if (busy) return;
    const problem = exportBuildProblem(kind, fields);
    if (problem) { setError(problem); setResult(null); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(exportBuildPath(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(exportBuildPayload(kind, fields, format)),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(apiErrorLine(data, "Could not build that export."));
      }
      const truncatedHeader = res.headers.get("X-Export-Truncated") === "true";
      const text = await res.text();
      const parsed = parseExportBuildResult(kind, format, text, truncatedHeader);
      const blob = new Blob([text], { type: format === "json" ? "application/json" : "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = catalogFileName(kind, format);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setResult(
        parsed ?? { kind, format, count: -1, truncated: truncatedHeader, exportedAt: null },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build that export.");
    } finally { setBusy(false); }
  };

  return (
    <NativeCard isLight={isLight} title="Your catalog, downloadable">
      <div data-testid="world-catalog-export-desk">
        <p className={`text-xs ${muted}`}>
          Build a file of your own catalog — one kind, the fields you pick, as a spreadsheet (CSV) or JSON.
          The file downloads here; you stay in the room. For the everything-at-once package, that&rsquo;s the
          full-catalog export on the website&rsquo;s settings.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Catalog kind">
          {CATALOG_EXPORT_KIND_OPTIONS.map((o) => (
            <button key={o.kind} type="button" data-testid={`world-catalog-export-kind-${o.kind}`}
              disabled={busy} onClick={() => pickKind(o.kind)} className={chip(kind === o.kind)}>
              {o.label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Export fields">
          {CATALOG_EXPORT_FIELD_OPTIONS[kind].map((f) => (
            <button key={f.key} type="button" data-testid={`world-catalog-export-field-${f.key}`}
              aria-pressed={fields.includes(f.key)} disabled={busy}
              onClick={() => toggleField(f.key)} className={chip(fields.includes(f.key))}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Export format">
            {CATALOG_EXPORT_FORMAT_OPTIONS.map((o) => (
              <button key={o.format} type="button" data-testid={`world-catalog-export-format-${o.format}`}
                disabled={busy} onClick={() => { setFormat(o.format); setResult(null); }} className={chip(format === o.format)}>
                {o.label}
              </button>
            ))}
          </div>
          <button type="button" data-testid="world-catalog-export-build" disabled={busy}
            onClick={() => void build()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busy ? "Building…" : "Build & download"}
          </button>
        </div>

        {result && (
          <p data-testid="world-catalog-export-result" className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>
            {result.count >= 0
              ? exportResultLine(result)
              : `Your ${kind} export is downloading as ${catalogFileName(kind, format)}.${result.truncated ? " It hit the export cap, so the file carries your newest rows only." : ""}`}
          </p>
        )}
        {error && <p className="mt-2 text-xs font-semibold text-red-400">{error}</p>}
      </div>
    </NativeCard>
  );
}
