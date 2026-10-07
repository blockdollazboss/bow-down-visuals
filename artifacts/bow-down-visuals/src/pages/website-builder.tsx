import { useState, useEffect, useRef } from "react";
import {
  Globe, Loader2, Sparkles, Download, Eye, FileCode2, Wand2,
  Mic2, Newspaper, Link2, MapPin, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";

/* ─── AI Website Builder ─────────────────────────────────────────────────
   Export model: describe a site → AI builds a complete static site package
   (HTML/CSS/JS + README with deploy guides) → private preview → pay a
   one-time 30-credit build fee → download the zip → host it on your own
   domain. NOTHING is ever published or hosted on bowdownvisuals.com.

   Creator-niche templates: artist site, press kit, link-in-bio-plus,
   tour page. Conversational edits at 2 credits each. */

const BUILD_COST = 30;
const EDIT_COST = 2;

const TEMPLATES = [
  {
    key: "artist-site",
    labelKey: "websiteBuilder.templateArtistSite",
    icon: Mic2,
    blurbKey: "websiteBuilder.templateArtistSiteBlurb",
  },
  {
    key: "press-kit",
    labelKey: "websiteBuilder.templatePressKit",
    icon: Newspaper,
    blurbKey: "websiteBuilder.templatePressKitBlurb",
  },
  {
    key: "link-in-bio",
    labelKey: "websiteBuilder.templateLinkInBio",
    icon: Link2,
    blurbKey: "websiteBuilder.templateLinkInBioBlurb",
  },
  {
    key: "tour-page",
    labelKey: "websiteBuilder.templateTourPage",
    icon: MapPin,
    blurbKey: "websiteBuilder.templateTourPageBlurb",
  },
] as const;
type TemplateKey = (typeof TEMPLATES)[number]["key"];

type FilesMap = Record<string, string>;

interface GenerateResponse {
  files?: FilesMap;
  templateLabel?: string;
  businessName?: string;
  fileCount?: number;
  ownership?: string;
  error?: string;
}

/* Inline styles.css + script.js into index.html for iframe preview. */
function buildPreviewHtml(files: FilesMap): string {
  let html = files["index.html"] ?? "";
  const css = files["styles.css"] ?? "";
  const js = files["script.js"] ?? "";
  if (css) {
    html = html.replace(
      /<link[^>]*styles\.css[^>]*>/i,
      `<style>\n${css}\n</style>`
    );
  }
  if (js) {
    html = html.replace(
      /<script[^>]*script\.js[^>]*><\/script>/i,
      `<script>\n${js.replace(/<\/script>/gi, "<\\/script>")}\n</script>`
    );
  }
  return html;
}

declare global {
  interface Window { JSZip?: any }
}

function loadJsZip(): Promise<any> {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error("Could not load zip library"));
    document.head.appendChild(s);
  });
}

export default function WebsiteBuilder() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [template, setTemplate] = useState<TemplateKey>("artist-site");
  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("");
  const [colorScheme, setColorScheme] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [files, setFiles] = useState<FilesMap | null>(null);
  const [editRequest, setEditRequest] = useState("");
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const canGenerate =
    businessName.trim().length >= 1 && description.trim().length >= 20 && !loading;

  useEffect(() => {
    if (files && iframeRef.current && showPreview) {
      iframeRef.current.srcdoc = buildPreviewHtml(files);
    }
  }, [files, showPreview]);

  async function generate() {
    if (!canGenerate) return;
    setLoading(true);
    setError("");
    setFiles(null);
    try {
      const res = await confirmedFetch("/api/website-builder/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: BUILD_COST,
        overrideFeature: t("websiteBuilder.confirmBuild"),
        body: JSON.stringify({
          template,
          businessName: businessName.trim(),
          description: description.trim(),
          style: style.trim(),
          colorScheme: colorScheme.trim(),
        }),
      });
      const data = (await res!.json()) as GenerateResponse;
      if (!data.files) {
        throw new Error(data.error || t("websiteBuilder.generationFailedError"));
      }
      setFiles(data.files);
      setShowPreview(true);
    } catch (e: any) {
      setError(e.message || t("websiteBuilder.genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function applyEdit() {
    if (!files || editRequest.trim().length < 5 || editing) return;
    setEditing(true);
    setError("");
    try {
      const res = await confirmedFetch("/api/website-builder/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: EDIT_COST,
        overrideFeature: t("websiteBuilder.confirmEdit"),
        body: JSON.stringify({
          template,
          businessName: businessName.trim(),
          currentFiles: files,
          editRequest: editRequest.trim(),
        }),
      });
      const data = (await res!.json()) as GenerateResponse;
      if (!data.files) {
        throw new Error(data.error || t("websiteBuilder.editFailedError"));
      }
      setFiles(data.files);
      setEditRequest("");
    } catch (e: any) {
      setError(e.message || t("websiteBuilder.genericError"));
    } finally {
      setEditing(false);
    }
  }

  async function downloadZip() {
    if (!files) return;
    setDownloading(true);
    setError("");
    try {
      const JSZip = await loadJsZip();
      const zip = new JSZip();
      const folder = zip.folder(
        `${businessName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-site`
      );
      for (const [path, content] of Object.entries(files)) {
        folder.file(path, content);
      }
      const blob = await folder.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${businessName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-website.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(t("websiteBuilder.zipError"));
    } finally {
      setDownloading(false);
    }
  }

  const fileNames = files ? Object.keys(files) : [];

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-28">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-sm text-primary">
            <Globe className="h-4 w-4" />
            {t("websiteBuilder.pageTitle")}
          </div>
          <h1 className="mb-3 text-4xl font-black tracking-tight md:text-5xl">
            {t("websiteBuilder.heading")} <span className="text-primary">{t("websiteBuilder.headingAccent")}</span>
          </h1>
          <p className="mx-auto max-w-2xl text-white/60">
            {t("websiteBuilder.heroDesc1")}{" "}
            <span className="text-primary font-semibold">{t("websiteBuilder.buildFee", { cost: BUILD_COST })}</span>{" "}
            {t("websiteBuilder.heroDesc2")}
          </p>
        </div>

        {!user && <OutOfCredits />}

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
            <p>{error}</p>
          </div>
        )}

        {/* Template picker */}
        <h2 className="mb-4 text-xl font-bold">{t("websiteBuilder.stepPickTemplate")}</h2>
        <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TEMPLATES.map((tpl) => {
            const Icon = tpl.icon;
            const active = template === tpl.key;
            return (
              <button
                key={tpl.key}
                onClick={() => setTemplate(tpl.key)}
                className={`rounded-2xl border p-5 text-left transition ${
                  active
                    ? "border-primary bg-primary/10 shadow-[0_0_24px_rgba(212,175,55,0.25)]"
                    : "border-white/10 bg-white/5 hover:border-primary/40"
                }`}
              >
                <Icon className={`mb-3 h-7 w-7 ${active ? "text-primary" : "text-white/60"}`} />
                <p className="mb-1 font-bold">{t(tpl.labelKey)}</p>
                <p className="text-sm text-white/50">{t(tpl.blurbKey)}</p>
                {active && (
                  <p className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {t("websiteBuilder.selected")}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Brief */}
        <h2 className="mb-4 text-xl font-bold">{t("websiteBuilder.stepDescribe")}</h2>
        <div className="mb-10 grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-white/70">
              {t("websiteBuilder.siteNameLabel")}
            </label>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. TRGDY TRBLZ"
              maxLength={120}
              className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/60 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-white/70">
              {t("websiteBuilder.descriptionLabel")} <span className="text-white/40">({t("websiteBuilder.minCharsHint")})</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("websiteBuilder.descriptionPlaceholder")}
              rows={5}
              maxLength={3000}
              className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/60 focus:outline-none"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-white/70">
                {t("websiteBuilder.styleLabel")} <span className="text-white/40">({t("websiteBuilder.optional")})</span>
              </label>
              <input
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={t("websiteBuilder.stylePlaceholder")}
                maxLength={500}
                className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/60 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-white/70">
                {t("websiteBuilder.colorsLabel")} <span className="text-white/40">({t("websiteBuilder.optional")})</span>
              </label>
              <input
                value={colorScheme}
                onChange={(e) => setColorScheme(e.target.value)}
                placeholder={t("websiteBuilder.colorsPlaceholder")}
                maxLength={200}
                className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/60 focus:outline-none"
              />
            </div>
          </div>
          <button
            onClick={generate}
            disabled={!canGenerate}
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-8 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
            {loading ? t("websiteBuilder.building") : t("websiteBuilder.buildButton", { cost: BUILD_COST })}
          </button>
          <p className="text-xs text-white/40">
            {t("websiteBuilder.feeNote")}
          </p>
        </div>

        {/* Result */}
        {files && (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Eye className="h-5 w-5 text-primary" /> {t("websiteBuilder.stepPreview")}
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowPreview((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold hover:border-primary/50"
                >
                  <FileCode2 className="h-4 w-4" />
                  {showPreview ? t("websiteBuilder.viewFiles") : t("websiteBuilder.viewPreview")}
                </button>
                <button
                  onClick={downloadZip}
                  disabled={downloading}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-40"
                >
                  {downloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {downloading ? t("websiteBuilder.zipping") : t("websiteBuilder.downloadZip")}
                </button>
              </div>
            </div>

            {showPreview ? (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-4 py-2.5">
                  <span className="h-3 w-3 rounded-full bg-red-500/70" />
                  <span className="h-3 w-3 rounded-full bg-amber-500/70" />
                  <span className="h-3 w-3 rounded-full bg-emerald-500/70" />
                  <span className="ml-3 text-xs text-white/40">{t("websiteBuilder.privatePreview")}</span>
                </div>
                <iframe
                  ref={iframeRef}
                  title={t("websiteBuilder.sitePreviewTitle")}
                  sandbox="allow-scripts"
                  className="h-[600px] w-full bg-white"
                />
              </div>
            ) : (
              <div className="grid gap-2">
                {fileNames.map((name) => (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <span className="flex items-center gap-2 font-mono text-sm">
                      <FileCode2 className="h-4 w-4 text-primary" /> {name}
                    </span>
                    <span className="text-xs text-white/40">
                      {(new Blob([files[name]]).size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Conversational edits */}
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
              <h3 className="mb-2 flex items-center gap-2 font-bold">
                <Wand2 className="h-5 w-5 text-primary" /> {t("websiteBuilder.editsTitle")}
              </h3>
              <p className="mb-4 text-sm text-white/50">
                {t("websiteBuilder.editsDesc", { cost: EDIT_COST })}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={editRequest}
                  onChange={(e) => setEditRequest(e.target.value)}
                  placeholder={t("websiteBuilder.editPlaceholder")}
                  maxLength={1000}
                  className="flex-1 rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-white placeholder:text-white/30 focus:border-primary/60 focus:outline-none"
                />
                <button
                  onClick={applyEdit}
                  disabled={editing || editRequest.trim().length < 5}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-6 py-3 font-semibold text-primary hover:bg-primary/20 disabled:opacity-40"
                >
                  {editing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  {editing ? t("websiteBuilder.applying") : t("websiteBuilder.applyEditButton", { cost: EDIT_COST })}
                </button>
              </div>
            </div>

            <p className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm text-white/60">
              <span className="font-semibold text-primary">{t("websiteBuilder.ownershipStrong")}</span>{" "}
              {t("websiteBuilder.ownershipDesc")}
            </p>
          </div>
        )}
      </main>

    </div>
  );
}
