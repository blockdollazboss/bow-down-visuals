import { plainErrorText } from "../../../lib/api-error";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
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
  exportProblemStrings,
  exportResultLine,
  exportResultStrings,
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

/** Catalog keys for the seam's option labels — the seam keeps the
 *  English labels as defaults; the desk renders its own language.
 *  Field labels key by field key, except `fileUrl`, whose label
 *  names the medium (file / audio / video link) per kind. */
const KIND_LABEL_KEYS: Record<CatalogExportKind, string> = {
  tracks: "worldCatalogLibrary.exportKindTracks",
  releases: "worldCatalogLibrary.exportKindReleases",
  videos: "worldCatalogLibrary.exportKindVideos",
  projects: "worldCatalogLibrary.exportKindProjects",
  store: "worldCatalogLibrary.exportKindStore",
};
const FORMAT_LABEL_KEYS: Record<CatalogExportFormat, string> = {
  csv: "worldCatalogLibrary.exportFormatCsv",
  json: "worldCatalogLibrary.exportFormatJson",
};
const FIELD_LABEL_KEYS: Record<string, string> = {
  id: "worldCatalogLibrary.exportFieldId",
  title: "worldCatalogLibrary.exportFieldTitle",
  source: "worldCatalogLibrary.exportFieldSource",
  durationSec: "worldCatalogLibrary.exportFieldDurationSec",
  createdAt: "worldCatalogLibrary.exportFieldCreated",
  artistName: "worldCatalogLibrary.exportFieldArtist",
  status: "worldCatalogLibrary.exportFieldStatus",
  artworkUrl: "worldCatalogLibrary.exportFieldArtworkLink",
  thumbnailUrl: "worldCatalogLibrary.exportFieldThumbnailLink",
  name: "worldCatalogLibrary.exportFieldName",
  type: "worldCatalogLibrary.exportFieldType",
  concept: "worldCatalogLibrary.exportFieldConcept",
  templateKey: "worldCatalogLibrary.exportFieldTemplate",
  attribution: "worldCatalogLibrary.exportFieldAttribution",
  artistVaultId: "worldCatalogLibrary.exportFieldVaultCharacter",
  updatedAt: "worldCatalogLibrary.exportFieldUpdated",
  kind: "worldCatalogLibrary.exportFieldKind",
  priceCents: "worldCatalogLibrary.exportFieldPriceCents",
  isActive: "worldCatalogLibrary.exportFieldActive",
  mediaUrls: "worldCatalogLibrary.exportFieldMediaLinks",
};
const FILE_URL_LABEL_KEYS: Record<CatalogExportKind, string> = {
  tracks: "worldCatalogLibrary.exportFieldFileLink",
  releases: "worldCatalogLibrary.exportFieldAudioLink",
  videos: "worldCatalogLibrary.exportFieldVideoLink",
  projects: "worldCatalogLibrary.exportFieldFileLink",
  store: "worldCatalogLibrary.exportFieldFileLink",
};

export function CatalogExportDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const problemStrings = exportProblemStrings(t);
  const resultStrings = exportResultStrings(t);
  const fieldLabel = (kind: CatalogExportKind, fieldKey: string): string =>
    fieldKey === "fileUrl"
      ? t(FILE_URL_LABEL_KEYS[kind])
      : t(FIELD_LABEL_KEYS[fieldKey] ?? fieldKey);
  const authHeaders = useDeskAuthHeaders();
  const [kind, setKind] = useState<CatalogExportKind>("tracks");
  const [fields, setFields] = useState<string[]>(() => allExportFields("tracks"));
  const [format, setFormat] = useState<CatalogExportFormat>("csv");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportBuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-50 bdv-touch-target ${
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
    const problem = exportBuildProblem(kind, fields, problemStrings, t(KIND_LABEL_KEYS[kind]));
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
        throw new Error(apiErrorLine(data, t("worldCatalogLibrary.exportBuildError")));
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
      setError(plainErrorText(e, t("worldCatalogLibrary.exportBuildError")));
    } finally { setBusy(false); }
  };

  return (
    <NativeCard isLight={isLight} title={t("worldCatalogLibrary.exportTitle")}>
      <div data-testid="world-catalog-export-desk">
        <p className={`text-xs ${muted}`}>
          {t("worldCatalogLibrary.exportIntro")}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("worldCatalogLibrary.exportAriaKind")}>
          {CATALOG_EXPORT_KIND_OPTIONS.map((o) => (
            <button key={o.kind} type="button" data-testid={`world-catalog-export-kind-${o.kind}`}
              disabled={busy} onClick={() => pickKind(o.kind)} className={chip(kind === o.kind)}>
              {t(KIND_LABEL_KEYS[o.kind])}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("worldCatalogLibrary.exportAriaFields")}>
          {CATALOG_EXPORT_FIELD_OPTIONS[kind].map((f) => (
            <button key={f.key} type="button" data-testid={`world-catalog-export-field-${f.key}`}
              aria-pressed={fields.includes(f.key)} disabled={busy}
              onClick={() => toggleField(f.key)} className={chip(fields.includes(f.key))}>
              {fieldLabel(kind, f.key)}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("worldCatalogLibrary.exportAriaFormat")}>
            {CATALOG_EXPORT_FORMAT_OPTIONS.map((o) => (
              <button key={o.format} type="button" data-testid={`world-catalog-export-format-${o.format}`}
                disabled={busy} onClick={() => { setFormat(o.format); setResult(null); }} className={chip(format === o.format)}>
                {t(FORMAT_LABEL_KEYS[o.format])}
              </button>
            ))}
          </div>
          <button type="button" data-testid="world-catalog-export-build" disabled={busy}
            onClick={() => void build()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busy ? t("worldCatalogLibrary.exportBuilding") : t("worldCatalogLibrary.exportBuild")}
          </button>
        </div>

        {result && (
          <p data-testid="world-catalog-export-result" className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>
            {result.count >= 0
              ? exportResultLine(result, resultStrings, t(KIND_LABEL_KEYS[result.kind]), i18n.language)
              : t("worldCatalogLibrary.exportFallbackLine", { kind, file: catalogFileName(kind, format) }) +
                (result.truncated ? t("worldCatalogLibrary.exportFallbackCapSuffix") : "")}
          </p>
        )}
        {error && <p className="mt-2 text-xs font-semibold text-red-400">{error}</p>}
      </div>
    </NativeCard>
  );
}
