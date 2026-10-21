import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useState, useEffect, useRef } from "react";
import {
  Globe, Loader2, Sparkles, Download, Eye, FileCode2, Wand2,
  Mic2, Newspaper, Link2, MapPin, CheckCircle2, AlertTriangle,
  FolderOpen, History, RotateCcw, Trash2, Save, Plus,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";

/* ─── AI Website Builder ─────────────────────────────────────────────────
   Export model: describe a site → AI builds a complete static site package
   (HTML/CSS/JS + README with deploy guides) → private preview → pay a
   one-time 30-credit build fee → download the zip → host it on your own
   domain. NOTHING is ever published or hosted on bowdownvisuals.com.

   Creator-niche templates: artist site, press kit, link-in-bio-plus,
   tour page. Conversational edits at 2 credits each.

   Persistence (migration 0195): every build is saved to the member's
   account server-side as a project; re-generations and edits append
   versions. Saved sites re-open here (or from My Projects → Websites)
   with the exact files restored — a refresh no longer loses the site.
   No preview image is stored: cards say the preview renders live on
   open, because it does (the same iframe the builder already uses). */

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
  /* Persistence (0195): the saved project + head version, and whether
     the server-side save landed. saved:false keeps the files — the
     page offers an explicit retry save. */
  projectId?: string | null;
  version?: number | null;
  saved?: boolean;
}

interface ProjectSummary {
  id: string;
  name: string;
  template: string;
  templateLabel: string;
  versionCount: number;
  latestVersion: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectBrief {
  description: string;
  style: string;
  colorScheme: string;
}

interface VersionMeta {
  id: string;
  version: number;
  source: string;
  note: string | null;
  fileCount: number;
  createdAt: string;
}

interface VersionPayload {
  projectId: string;
  version: number;
  source: string;
  note: string | null;
  brief: ProjectBrief;
  files: FilesMap;
  fileCount: number;
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
  const isLight = useIsLightTheme();
  usePageTitle("Website Builder", "Describe the site you want and the AI builds it — preview it privately, then export your website package.");
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
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

  /* ── Persistence state (0195) ── */
  const [projectId, setProjectId] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [savedBuilds, setSavedBuilds] = useState<ProjectSummary[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  const [savingRetry, setSavingRetry] = useState(false);
  const [opening, setOpening] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /* The per-build client id: sent with generate + retry saves so a
     retried save lands on the same server project (server upserts by
     (user, clientRef)). Minted lazily; reset when starting fresh. */
  const clientRefRef = useRef<string | null>(null);
  const deepLinkOpenedRef = useRef(false);

  function buildClientRef(): string {
    if (!clientRefRef.current) clientRefRef.current = crypto.randomUUID();
    return clientRefRef.current;
  }

  const canGenerate =
    businessName.trim().length >= 1 && description.trim().length >= 20 && !loading;

  useEffect(() => {
    if (files && iframeRef.current && showPreview) {
      iframeRef.current.srcdoc = buildPreviewHtml(files);
    }
  }, [files, showPreview]);

  /* ── Persistence helpers (0195) ── */
  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return { Authorization: `Bearer ${token ?? ""}` };
  }

  async function loadSavedBuilds() {
    setSavedLoading(true);
    setSavedError("");
    try {
      const res = await fetch("/api/website-builder/projects", {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(t("websiteBuilder.loadSavedFailed"));
      const data = (await res.json()) as { projects: ProjectSummary[] };
      setSavedBuilds(data.projects ?? []);
    } catch {
      setSavedError(t("websiteBuilder.loadSavedFailed"));
    } finally {
      setSavedLoading(false);
    }
  }

  async function loadVersions(id: string) {
    const res = await fetch(`/api/website-builder/projects/${id}`, {
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(t("websiteBuilder.openFailed"));
    const data = (await res.json()) as {
      project: ProjectSummary & { brief: ProjectBrief };
      versions: VersionMeta[];
    };
    setVersions(data.versions ?? []);
    return data;
  }

  /* Re-open: restore the EXACT saved build — files, template, and the
     brief that produced the version — into the builder. */
  async function openProject(id: string, version?: number) {
    setOpening(true);
    setError("");
    try {
      const detail = await loadVersions(id);
      const target = version ?? detail.project.latestVersion;
      const res = await fetch(
        `/api/website-builder/projects/${id}/versions/${target}`,
        { headers: await authHeaders() },
      );
      if (!res.ok) throw new Error(t("websiteBuilder.openFailed"));
      const payload = (await res.json()) as VersionPayload;
      setFiles(payload.files);
      const known = TEMPLATES.find((tpl) => tpl.key === detail.project.template);
      if (known) setTemplate(known.key);
      setBusinessName(detail.project.name);
      setDescription(payload.brief.description);
      setStyle(payload.brief.style);
      setColorScheme(payload.brief.colorScheme);
      setProjectId(id);
      setCurrentVersion(detail.project.latestVersion);
      setViewingVersion(target);
      setSaveFailed(false);
      setShowPreview(true);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("project", id);
        window.history.replaceState(null, "", url);
      } catch { /* non-browser — the project still opened */ }
    } catch (e: any) {
      setError(e.message || t("websiteBuilder.openFailed"));
    } finally {
      setOpening(false);
    }
  }

  /* The explicit save behind the retry button (and the only write
     path that runs without an AI call): posts the working files to
     the projects endpoint — appending to the open project, or
     creating under this build's clientRef. */
  async function retrySave() {
    if (!files || savingRetry) return;
    setSavingRetry(true);
    setError("");
    try {
      const res = await fetch("/api/website-builder/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders()),
        },
        body: JSON.stringify({
          projectId: projectId ?? undefined,
          clientRef: buildClientRef(),
          template,
          businessName: businessName.trim(),
          brief: {
            description: description.trim(),
            style: style.trim(),
            colorScheme: colorScheme.trim(),
          },
          files,
        }),
      });
      const data = (await res.json()) as {
        project?: ProjectSummary;
        version?: number;
        error?: string;
      };
      if (!res.ok || !data.project) {
        throw new Error(data.error || t("websiteBuilder.saveFailed"));
      }
      setProjectId(data.project.id);
      setCurrentVersion(data.version ?? null);
      setViewingVersion(data.version ?? null);
      setSaveFailed(false);
      void loadSavedBuilds();
      void loadVersions(data.project.id).catch(() => {});
    } catch (e: any) {
      setError(e.message || t("websiteBuilder.saveFailed"));
    } finally {
      setSavingRetry(false);
    }
  }

  /* Restore = the old version becomes a NEW head version server-side;
     the response payload is the restored build, loaded here. */
  async function restoreVersion(version: number) {
    if (!projectId || opening) return;
    setOpening(true);
    setError("");
    try {
      const res = await fetch(
        `/api/website-builder/projects/${projectId}/versions/${version}/restore`,
        { method: "POST", headers: await authHeaders() },
      );
      const data = (await res.json()) as VersionPayload & {
        version: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || t("websiteBuilder.restoreFailed"));
      setFiles(data.files);
      setDescription(data.brief.description);
      setStyle(data.brief.style);
      setColorScheme(data.brief.colorScheme);
      setCurrentVersion(data.version);
      setViewingVersion(data.version);
      setShowPreview(true);
      void loadVersions(projectId).catch(() => {});
      void loadSavedBuilds();
    } catch (e: any) {
      setError(e.message || t("websiteBuilder.restoreFailed"));
    } finally {
      setOpening(false);
    }
  }

  async function deleteBuild(id: string) {
    setError("");
    try {
      const res = await fetch(`/api/website-builder/projects/${id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(t("websiteBuilder.deleteFailed"));
      setSavedBuilds((prev) => prev.filter((p) => p.id !== id));
      setConfirmDeleteId(null);
      if (id === projectId) startNewSite();
    } catch (e: any) {
      setError(e.message || t("websiteBuilder.deleteFailed"));
    }
  }

  function startNewSite() {
    setFiles(null);
    setProjectId(null);
    setCurrentVersion(null);
    setViewingVersion(null);
    setVersions([]);
    setShowVersions(false);
    setSaveFailed(false);
    setEditRequest("");
    setBusinessName("");
    setDescription("");
    setStyle("");
    setColorScheme("");
    clientRefRef.current = null;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("project");
      window.history.replaceState(null, "", url);
    } catch { /* non-browser — state still reset */ }
  }

  function sourceLabel(source: string): string {
    switch (source) {
      case "generate": return t("websiteBuilder.sourceGenerate");
      case "regenerate": return t("websiteBuilder.sourceRegenerate");
      case "edit": return t("websiteBuilder.sourceEdit");
      case "restore": return t("websiteBuilder.sourceRestore");
      case "save": return t("websiteBuilder.sourceSave");
      default: return source;
    }
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return "";
    }
  }

  /* Saved list loads with the signed-in member; a ?project= deep link
     (e.g. from My Projects → Websites) opens that build directly. */
  useEffect(() => {
    if (!user) return;
    void loadSavedBuilds();
    if (!deepLinkOpenedRef.current) {
      deepLinkOpenedRef.current = true;
      try {
        const q = new URLSearchParams(window.location.search).get("project");
        if (q) void openProject(q);
      } catch { /* unparseable query — the builder still loads */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
          /* Persistence targeting: re-generating with a project open
             appends a version to it; the clientRef keeps a first-time
             build retry-safe. */
          projectId: projectId ?? undefined,
          clientRef: buildClientRef(),
        }),
      });
      const data = (await res!.json()) as GenerateResponse;
      if (!data.files) {
        throw new Error(data.error || t("websiteBuilder.generationFailedError"));
      }
      setFiles(data.files);
      setShowPreview(true);
      if (data.projectId) {
        setProjectId(data.projectId);
        setCurrentVersion(data.version ?? null);
        setViewingVersion(data.version ?? null);
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("project", data.projectId);
          window.history.replaceState(null, "", url);
        } catch { /* non-browser — the build still saved */ }
        void loadSavedBuilds();
        void loadVersions(data.projectId).catch(() => {});
      }
      setSaveFailed(data.saved === false);
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
          /* With a project open, the edit result is appended server-
             side as that project's new head version. */
          projectId: projectId ?? undefined,
        }),
      });
      const data = (await res!.json()) as GenerateResponse;
      if (!data.files) {
        throw new Error(data.error || t("websiteBuilder.editFailedError"));
      }
      setFiles(data.files);
      setEditRequest("");
      if (data.projectId) {
        setCurrentVersion(data.version ?? null);
        setViewingVersion(data.version ?? null);
        setSaveFailed(data.saved === false);
        void loadVersions(data.projectId).catch(() => {});
        void loadSavedBuilds();
      }
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

        {/* Save-failed banner: the build exists, the save didn't land */}
        {saveFailed && files && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
            <p className="flex-1">{t("websiteBuilder.saveFailed")}</p>
            <button
              onClick={() => void retrySave()}
              disabled={savingRetry}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40"
            >
              {savingRetry ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t("websiteBuilder.retrySaveButton")}
            </button>
          </div>
        )}

        {/* Saved sites (0195) — the member's builder projects. No
            preview thumbnails are stored, so each card says plainly
            that the preview renders live when the site is opened. */}
        {user && (
          <div className="mb-10">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
              <FolderOpen className="h-5 w-5 text-primary" /> {t("websiteBuilder.savedSitesTitle")}
            </h2>
            {savedLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("websiteBuilder.building")}
              </div>
            ) : savedError ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
                {savedError}
              </p>
            ) : savedBuilds.length === 0 ? (
              <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
                {t("websiteBuilder.savedSitesEmpty")}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {savedBuilds.map((p) => (
                  <div
                    key={p.id}
                    className={`rounded-2xl border p-5 ${
                      p.id === projectId
                        ? "border-primary bg-primary/10 shadow-[0_0_24px_rgba(212,175,55,0.25)]"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <p className="font-bold">{p.name}</p>
                    <p className="text-sm font-semibold text-primary">
                      {t(TEMPLATES.find((tpl) => tpl.key === p.template)?.labelKey ?? "websiteBuilder.pageTitle")}
                    </p>
                    <p className="mt-1 text-xs text-white/40">
                      {t("websiteBuilder.cardMeta", { version: p.latestVersion, count: p.fileCount })}
                      {" · "}
                      {t("websiteBuilder.updatedLabel", { date: formatDate(p.updatedAt) })}
                    </p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-white/40">
                      <Eye className="h-3.5 w-3.5" /> {t("websiteBuilder.previewOpensNote")}
                    </p>
                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => void openProject(p.id)}
                        disabled={opening}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-40"
                      >
                        <FolderOpen className="h-3.5 w-3.5" /> {t("websiteBuilder.openButton")}
                      </button>
                      {confirmDeleteId === p.id ? (
                        <button
                          onClick={() => void deleteBuild(p.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/60 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/25"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t("websiteBuilder.confirmDeleteButton")}
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(p.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-red-500/40 hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t("websiteBuilder.deleteButton")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
        <div className={`mb-10 grid gap-4 rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
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

            {/* Saved-project status + version controls (0195) */}
            {projectId && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("websiteBuilder.savedBadge", { version: currentVersion ?? "" })}
                </span>
                <button
                  onClick={() => setShowVersions((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white"
                >
                  <History className="h-3.5 w-3.5" /> {t("websiteBuilder.versionsTitle")}
                </button>
                <button
                  onClick={startNewSite}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white"
                >
                  <Plus className="h-3.5 w-3.5" /> {t("websiteBuilder.startNewSite")}
                </button>
              </div>
            )}
            {projectId &&
              viewingVersion !== null &&
              currentVersion !== null &&
              viewingVersion !== currentVersion && (
                <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/80">
                  {t("websiteBuilder.viewingOldVersion", { version: viewingVersion })}
                </p>
              )}
            {projectId && showVersions && (
              <div className="mb-6 grid gap-2">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="text-sm">
                      <span className="font-semibold">
                        {t("websiteBuilder.versionLabel", { version: v.version })}
                      </span>
                      <span className="text-white/40">
                        {" · "}
                        {sourceLabel(v.source)}
                        {" · "}
                        {t("websiteBuilder.fileCountLabel", { count: v.fileCount })}
                        {" · "}
                        {formatDate(v.createdAt)}
                      </span>
                      {v.version === currentVersion && (
                        <span className="ml-2 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                          {t("websiteBuilder.currentBadge")}
                        </span>
                      )}
                      {v.note && (
                        <p className="mt-0.5 text-xs italic text-white/40">
                          &ldquo;{v.note}&rdquo;
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void openProject(projectId, v.version)}
                        disabled={opening || v.version === viewingVersion}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-40"
                      >
                        <Eye className="h-3.5 w-3.5" /> {t("websiteBuilder.viewButton")}
                      </button>
                      {v.version !== currentVersion && (
                        <button
                          onClick={() => void restoreVersion(v.version)}
                          disabled={opening}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-40"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> {t("websiteBuilder.restoreButton")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

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
            <div className={`mt-8 rounded-2xl border p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
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
