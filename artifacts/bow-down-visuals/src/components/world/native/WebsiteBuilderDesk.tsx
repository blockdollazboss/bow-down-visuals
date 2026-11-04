import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Download, Eye, FileCode2, FolderOpen, Globe,
  History, LayoutTemplate, Loader2, Plus, RotateCcw, Save, Shuffle, Sparkles,
  Trash2, Wand2,
} from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  cloneTemplateFiles,
  parseGalleryTemplates,
  starterBrief,
  type GalleryTemplate,
} from "@/lib/website-builder-gallery";
import {
  WEBSITE_BUILDER_EDIT_FAILED_LINE,
  WEBSITE_BUILDER_EDIT_PATH,
  WEBSITE_BUILDER_FEE_NOTE,
  WEBSITE_BUILDER_GENERATE_PATH,
  WEBSITE_BUILDER_GENERATION_FAILED_LINE,
  WEBSITE_BUILDER_OUT_OF_CREDITS_LINE,
  WEBSITE_BUILDER_PREVIEW_OPENS_NOTE,
  WEBSITE_BUILDER_PROJECTS_PATH,
  WEBSITE_BUILDER_SAVE_FAILED_LINE,
  WEBSITE_BUILDER_TEMPLATES,
  WEBSITE_BUILDER_TEMPLATES_PATH,
  WEBSITE_BUILD_COST_VB,
  WEBSITE_DESCRIPTION_MAX,
  WEBSITE_DESCRIPTION_MIN,
  WEBSITE_EDIT_COST_VB,
  WEBSITE_EDIT_MAX,
  WEBSITE_NAME_MAX,
  buildPreviewHtml,
  buildWebsiteEditBody,
  buildWebsiteGenerateBody,
  buildWebsiteSaveBody,
  isWebsiteTemplateKey,
  normalizeWebsiteEditResult,
  normalizeWebsiteGenerateResult,
  normalizeWebsiteProjectDetail,
  normalizeWebsiteProjects,
  normalizeWebsiteSaveResult,
  normalizeWebsiteVersionPayload,
  websiteBuilderOutOfCredits,
  websiteBriefReady,
  websiteEditReady,
  websiteProjectPath,
  websiteProjectRestorePath,
  websiteProjectVersionPath,
  websiteSourceLabel,
  websiteZipFileName,
  websiteZipFolderName,
  type WebsiteFiles,
  type WebsiteProjectSummary,
  type WebsiteSeededFrom,
  type WebsiteTemplateKey,
  type WebsiteVersionMeta,
} from "@/lib/world/website-builder-desk";

/* ─── Website Builder, in-world (stack100 wave 4, item 23, #97) ────
   The whole builder at My Studio, on the builder's own rails — the
   same endpoints pages/website-builder.tsx calls: describe a site,
   the AI builds the complete package (3,000 Bucs, registry-priced),
   conversational edits (200 Bucs), saved projects with version
   history and restore (free), a private preview, and the zip
   download — all in the room, no page pull-up.

   The export model is the page's, unchanged and stated in the desk:
   you own the files outright, you host them on your own domain,
   NOTHING is published or hosted on bowdownvisuals.com.

   Money honesty, mirrored from the page: build/edit ride the
   standing CreditConfirm path with NO desk-side price override —
   the popup names the registry's own cost and feature — and a
   declined confirm sends nothing and charges nothing. The rails
   charge before the AI call and refund on failure, so a failed
   build or edit reads "refunded", never dressed as success; a build
   whose server save failed keeps its files in the desk and offers
   the explicit retry save, exactly like the page.

   Members only, like the board itself: the My Studio board never
   renders for a guest (guest-pitch instead), and every rail is
   requireAuth server-side besides. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

declare global {
  interface Window {
    JSZip?: any;
  }
}

/* The page's zip mechanism, kept: JSZip from the same CDN build. */
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "";
  }
}

export function WebsiteBuilderDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const errCls = isLight ? "text-[#8a2f1b]" : "text-red-300";
  const amberBox = isLight
    ? "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#6B5B36]"
    : "border-amber-500/40 bg-amber-500/10 text-amber-200";

  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* Saved projects */
  const [projects, setProjects] = useState<WebsiteProjectSummary[] | null>(null);
  const [projectsFailed, setProjectsFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [opening, setOpening] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /* Gallery shelf */
  const [gallery, setGallery] = useState<GalleryTemplate[]>([]);
  const [remixedFrom, setRemixedFrom] = useState<string | null>(null);

  /* The brief */
  const [template, setTemplate] = useState<WebsiteTemplateKey>("artist-site");
  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("");
  const [colorScheme, setColorScheme] = useState("");

  /* The working build */
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [files, setFiles] = useState<WebsiteFiles | null>(null);
  const [seededFrom, setSeededFrom] = useState<WebsiteSeededFrom | null>(null);
  const [editRequest, setEditRequest] = useState("");
  const [showPreview, setShowPreview] = useState(true);

  /* Persistence */
  const [projectId, setProjectId] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [versions, setVersions] = useState<WebsiteVersionMeta[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savingRetry, setSavingRetry] = useState(false);
  /* The per-build client id: sent with generate + retry saves so a
     retried save lands on the same server project (the rail upserts
     by (user, clientRef)). Minted lazily; reset on Start-New. */
  const clientRefRef = useRef<string | null>(null);

  function buildClientRef(): string {
    if (!clientRefRef.current) clientRefRef.current = crypto.randomUUID();
    return clientRefRef.current;
  }

  /* Saved projects load with the desk. A failed load is a failed
     load — the error state with a retry, never an empty shelf. */
  useEffect(() => {
    let cancelled = false;
    setProjectsFailed(false);
    (async () => {
      try {
        const res = await fetch(WEBSITE_BUILDER_PROJECTS_PATH, {
          headers: await authHeaders(),
        });
        if (!res.ok) throw new Error(`projects ${res.status}`);
        const parsed = normalizeWebsiteProjects(await res.json());
        if (!parsed) throw new Error("projects shape");
        if (!cancelled) setProjects(parsed);
      } catch {
        if (!cancelled) setProjectsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  /* Template gallery — real starter builds served by the API. If the
     fetch fails, the shelf simply does not render; the brief flow is
     untouched (the page's behavior). */
  useEffect(() => {
    let cancelled = false;
    fetch(WEBSITE_BUILDER_TEMPLATES_PATH)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setGallery(parseGalleryTemplates(data));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadVersions(id: string) {
    const res = await fetch(websiteProjectPath(id), { headers: await authHeaders() });
    if (!res.ok) throw new Error(`detail ${res.status}`);
    const detail = normalizeWebsiteProjectDetail(await res.json());
    if (!detail) throw new Error("detail shape");
    setVersions(detail.versions);
    return detail;
  }

  /* Re-open: restore the EXACT saved build — files, template, and the
     brief that produced the version — into the desk. */
  async function openProject(id: string, version?: number) {
    setOpening(true);
    setError(null);
    try {
      const detail = await loadVersions(id);
      const target = version ?? detail.project.latestVersion;
      const res = await fetch(websiteProjectVersionPath(id, target), {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`version ${res.status}`);
      const payload = normalizeWebsiteVersionPayload(await res.json());
      if (!payload) throw new Error("version shape");
      setFiles(payload.files);
      if (isWebsiteTemplateKey(detail.project.template)) {
        setTemplate(detail.project.template);
      }
      setBusinessName(detail.project.name);
      setDescription(payload.brief.description);
      setStyle(payload.brief.style);
      setColorScheme(payload.brief.colorScheme);
      setSeededFrom(null);
      setRemixedFrom(null);
      setProjectId(id);
      setCurrentVersion(detail.project.latestVersion);
      setViewingVersion(target);
      setSaveFailed(false);
      setShowPreview(true);
    } catch {
      setError("Couldn't open that saved site.");
    } finally {
      setOpening(false);
    }
  }

  /* The explicit save behind the retry button (and the only write
     path that runs without an AI call): posts the working files to
     the projects endpoint — appending to the open project, or
     creating under this build's clientRef. FREE. */
  async function retrySave() {
    if (!files || savingRetry) return;
    setSavingRetry(true);
    setError(null);
    try {
      const res = await fetch(WEBSITE_BUILDER_PROJECTS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          buildWebsiteSaveBody({
            projectId,
            clientRef: buildClientRef(),
            template,
            businessName,
            brief: { description, style, colorScheme },
            files,
          }),
        ),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn't save that site."));
      const saved = normalizeWebsiteSaveResult(data);
      if (!saved) throw new Error("save shape");
      setProjectId(saved.project.id);
      setCurrentVersion(saved.version);
      setViewingVersion(saved.version);
      setSaveFailed(false);
      setTick((t) => t + 1);
      void loadVersions(saved.project.id).catch(() => {});
    } catch (err) {
      setError(plainErrorText(err, "Couldn't save that site."));
    } finally {
      setSavingRetry(false);
    }
  }

  /* Restore = the old version becomes a NEW head version server-side;
     the response payload is the restored build, loaded here. FREE. */
  async function restoreVersion(version: number) {
    if (!projectId || opening) return;
    setOpening(true);
    setError(null);
    try {
      const res = await fetch(websiteProjectRestorePath(projectId, version), {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn't restore that version."));
      const payload = normalizeWebsiteVersionPayload(data);
      if (!payload) throw new Error("restore shape");
      setFiles(payload.files);
      setDescription(payload.brief.description);
      setStyle(payload.brief.style);
      setColorScheme(payload.brief.colorScheme);
      setCurrentVersion(payload.version);
      setViewingVersion(payload.version);
      setShowPreview(true);
      void loadVersions(projectId).catch(() => {});
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Couldn't restore that version."));
    } finally {
      setOpening(false);
    }
  }

  async function deleteBuild(id: string) {
    setError(null);
    try {
      const res = await fetch(websiteProjectPath(id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`delete ${res.status}`);
      setProjects((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
      setConfirmDeleteId(null);
      if (id === projectId) startNewSite();
    } catch {
      setError("Couldn't delete that site.");
    }
  }

  function startNewSite() {
    setFiles(null);
    setSeededFrom(null);
    setRemixedFrom(null);
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
  }

  /* Remix: start from the template's real files — preview, edits, and
     download all work on it exactly like a generated build — and
     prefill the brief from the template's starter brief. FREE. */
  function remix(tpl: GalleryTemplate) {
    if (!isWebsiteTemplateKey(tpl.id)) return;
    setTemplate(tpl.id);
    const brief = starterBrief(tpl);
    setDescription(brief.description);
    setStyle(brief.style);
    setColorScheme(brief.colorScheme);
    setFiles(cloneTemplateFiles(tpl));
    setSeededFrom(null);
    setShowPreview(true);
    setRemixedFrom(tpl.name);
    setError(null);
  }

  async function generate() {
    if (!websiteBriefReady({ businessName, description, style, colorScheme }) || building) return;
    setBuilding(true);
    setError(null);
    setOutOfCredits(false);
    setFiles(null);
    setSeededFrom(null);
    setRemixedFrom(null);
    try {
      const res = await confirmedFetch(WEBSITE_BUILDER_GENERATE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          buildWebsiteGenerateBody({
            template,
            businessName,
            description,
            style,
            colorScheme,
            projectId,
            clientRef: buildClientRef(),
          }),
        ),
      });
      if (!res) return; // declined the confirmation — nothing sent, nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (websiteBuilderOutOfCredits(res.status, data)) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, WEBSITE_BUILDER_GENERATION_FAILED_LINE));
      }
      const result = normalizeWebsiteGenerateResult(data);
      if (!result) throw new Error(WEBSITE_BUILDER_GENERATION_FAILED_LINE);
      setFiles(result.files);
      setSeededFrom(result.seededFrom);
      setShowPreview(true);
      if (result.projectId) {
        setProjectId(result.projectId);
        setCurrentVersion(result.version);
        setViewingVersion(result.version);
        setTick((t) => t + 1);
        void loadVersions(result.projectId).catch(() => {});
      }
      setSaveFailed(!result.saved);
      refreshProfile();
    } catch (err) {
      setError(plainErrorText(err, WEBSITE_BUILDER_GENERATION_FAILED_LINE));
    } finally {
      setBuilding(false);
    }
  }

  async function applyEdit() {
    if (!files || !websiteEditReady(files, editRequest) || editing) return;
    setEditing(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(WEBSITE_BUILDER_EDIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(
          buildWebsiteEditBody({
            template,
            businessName,
            currentFiles: files,
            editRequest,
            projectId,
          }),
        ),
      });
      if (!res) return; // declined the confirmation — nothing sent, nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (websiteBuilderOutOfCredits(res.status, data)) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, WEBSITE_BUILDER_EDIT_FAILED_LINE));
      }
      const result = normalizeWebsiteEditResult(data);
      if (!result) throw new Error(WEBSITE_BUILDER_EDIT_FAILED_LINE);
      setFiles(result.files);
      setEditRequest("");
      if (result.projectId) {
        setCurrentVersion(result.version);
        setViewingVersion(result.version);
        setSaveFailed(!result.saved);
        void loadVersions(result.projectId).catch(() => {});
        setTick((t) => t + 1);
      }
      refreshProfile();
    } catch (err) {
      setError(plainErrorText(err, WEBSITE_BUILDER_EDIT_FAILED_LINE));
    } finally {
      setEditing(false);
    }
  }

  async function downloadZip() {
    if (!files || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const JSZip = await loadJsZip();
      const zip = new JSZip();
      const folder = zip.folder(websiteZipFolderName(businessName));
      for (const [path, content] of Object.entries(files)) {
        folder.file(path, content);
      }
      const blob = await folder.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = websiteZipFileName(businessName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not create the zip. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  const briefReady = websiteBriefReady({ businessName, description, style, colorScheme });
  const fileNames = files ? Object.keys(files) : [];

  return (
    <NativeCard isLight={isLight} title="Website Builder">
      <div data-testid="world-website-builder-desk" className="space-y-3">
        <p className={`text-sm ${muted}`}>
          Describe your site, the AI builds the complete package — pages, styles, and a deploy
          guide. A build costs {WEBSITE_BUILD_COST_VB.toLocaleString("en-US")} Visual Bucs, named
          again before anything charges; each follow-up edit is {WEBSITE_EDIT_COST_VB} Bucs.
          Preview it privately here, download the zip, and host it on your own domain.
        </p>

        {error ? <p className={`text-xs ${errCls}`}>{error}</p> : null}
        {outOfCredits ? (
          <p className={`text-xs font-semibold ${strong}`}>{WEBSITE_BUILDER_OUT_OF_CREDITS_LINE}</p>
        ) : null}

        {/* Save-failed banner: the build exists, the save didn't land */}
        {saveFailed && files ? (
          <div
            className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-xs ${amberBox}`}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="flex-1">{WEBSITE_BUILDER_SAVE_FAILED_LINE}</p>
            <button
              type="button"
              className={goldBtn}
              disabled={savingRetry}
              onClick={() => void retrySave()}
            >
              {savingRetry ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Retry save
            </button>
          </div>
        ) : null}

        {/* Saved sites — the member's builder projects. No preview
            thumbnails are stored, so each row says plainly that the
            preview renders live when the site is opened. */}
        <div data-testid="world-website-builder-projects" className="space-y-1.5">
          <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
            <FolderOpen className="mr-1.5 inline h-3.5 w-3.5 text-[#d4af37]" />
            Your saved sites
          </p>
          {projects === null && !projectsFailed ? (
            <NativeLoadingState isLight={isLight} message="Loading your saved sites…" />
          ) : projectsFailed ? (
            <NativeErrorState
              isLight={isLight}
              message="Couldn't load your saved sites."
              onRetry={() => setTick((t) => t + 1)}
            />
          ) : projects && projects.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message="No saved sites yet."
              detail="Every site you build is saved to your account automatically — close the tab and pick up right where you left off."
            />
          ) : (
            projects?.map((p) => (
              <div
                key={p.id}
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                  p.id === projectId
                    ? "border-[#d4af37]/60 bg-[#d4af37]/10"
                    : isLight
                      ? "border-[#C9A84C]/40 bg-white/50"
                      : "border-white/10 bg-white/5"
                }`}
              >
                <Globe className="h-4 w-4 shrink-0 text-[#d4af37]" />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs font-bold ${strong}`}>{p.name}</span>
                  <span className={`block text-[11px] ${muted}`}>
                    {p.templateLabel ||
                      WEBSITE_BUILDER_TEMPLATES.find((tpl) => tpl.key === p.template)?.label ||
                      "Website Builder"}
                    {" · "}Version {p.latestVersion} · {p.fileCount} files · {formatDate(p.updatedAt)}
                  </span>
                  <span className={`block text-[11px] ${muted}`}>{WEBSITE_BUILDER_PREVIEW_OPENS_NOTE}</span>
                </span>
                <button
                  type="button"
                  className={chipBtn(isLight)}
                  disabled={opening}
                  onClick={() => void openProject(p.id)}
                >
                  <FolderOpen className="h-3.5 w-3.5" /> Open
                </button>
                {confirmDeleteId === p.id ? (
                  <button
                    type="button"
                    className={goldBtn}
                    onClick={() => void deleteBuild(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Confirm delete
                  </button>
                ) : (
                  <button
                    type="button"
                    className={chipBtn(isLight)}
                    onClick={() => setConfirmDeleteId(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Template gallery — real starter builds, one per creator
            niche. Remix seeds a build with the template's actual
            files. The shelf is simply absent if the read fails. */}
        {gallery.length > 0 ? (
          <div data-testid="world-website-builder-gallery" className="space-y-1.5">
            <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
              <LayoutTemplate className="mr-1.5 inline h-3.5 w-3.5 text-[#d4af37]" />
              Start from a finished look
            </p>
            <p className={`text-xs ${muted}`}>
              Real starter sites built for your kind of creating — remix one and it loads below,
              ready to preview, edit, and take with you.
            </p>
            {gallery.map((tpl) => (
              <div
                key={tpl.id}
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                  isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs font-bold ${strong}`}>
                    {tpl.name} <span className={muted}>· {tpl.verticalLabel}</span>
                  </span>
                  <span className={`block text-[11px] ${muted}`}>
                    {tpl.bestFor} · {Object.keys(tpl.files).length} files — a real starter site,
                    not a picture of one
                  </span>
                </span>
                <button type="button" className={chipBtn(isLight)} onClick={() => remix(tpl)}>
                  <Shuffle className="h-3.5 w-3.5" /> Remix this template
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* The brief */}
        <div data-testid="world-website-builder-brief" className="space-y-2">
          <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
            1. Pick a template
          </p>
          <div className="flex flex-wrap gap-1.5">
            {WEBSITE_BUILDER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                aria-pressed={template === tpl.key}
                className={template === tpl.key ? goldBtn : chipBtn(isLight)}
                onClick={() => setTemplate(tpl.key)}
              >
                {tpl.label}
              </button>
            ))}
          </div>
          <p className={`text-xs ${muted}`}>
            {WEBSITE_BUILDER_TEMPLATES.find((tpl) => tpl.key === template)?.blurb ?? ""}
          </p>

          <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
            2. Describe your site
          </p>
          <input
            className={deskInputCls(isLight)}
            placeholder="Site / artist name — e.g. TRGDY TRBLZ"
            maxLength={WEBSITE_NAME_MAX}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            aria-label="Site / artist name"
          />
          <textarea
            className={deskInputCls(isLight)}
            placeholder={`What should the site say and do? (min ${WEBSITE_DESCRIPTION_MIN} characters)`}
            rows={4}
            maxLength={WEBSITE_DESCRIPTION_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label="What should the site say and do?"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={deskInputCls(isLight)}
              placeholder="Style preferences (optional) — e.g. bold typography, lots of imagery"
              maxLength={500}
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              aria-label="Style preferences"
            />
            <input
              className={deskInputCls(isLight)}
              placeholder="Colors (optional) — e.g. black and gold"
              maxLength={200}
              value={colorScheme}
              onChange={(e) => setColorScheme(e.target.value)}
              aria-label="Colors"
            />
          </div>
          <button
            type="button"
            className={goldBtn}
            disabled={!briefReady || building}
            onClick={() => void generate()}
          >
            {building ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {building
              ? "Building your site…"
              : `Build my site — ${WEBSITE_BUILD_COST_VB.toLocaleString("en-US")} Visual Bucs`}
          </button>
          <p className={`text-[11px] ${muted}`}>{WEBSITE_BUILDER_FEE_NOTE}</p>
        </div>

        {/* The working build */}
        {files ? (
          <div data-testid="world-website-builder-result" className="space-y-2">
            {seededFrom ? (
              <p className={`rounded-xl border px-3 py-2 text-xs ${muted} ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
                <span className={`font-semibold ${strong}`}>Built from your real material.</span>{" "}
                {seededFrom.songs + seededFrom.videos + seededFrom.products + seededFrom.shows > 0
                  ? `Your site was seeded with ${seededFrom.songs} songs, ${seededFrom.videos} videos, ${seededFrom.products} products, and ${seededFrom.shows} upcoming shows from your Bow Down Visuals account — real titles, prices, and dates, nothing invented.`
                  : "You don't have catalog material on Bow Down Visuals yet, so sections without your content use clearly labeled placeholders you can edit."}
                {seededFrom.brandKit
                  ? " Your saved brand kit (colors, fonts, and logo) was used."
                  : ""}
              </p>
            ) : null}
            {remixedFrom ? (
              <p className={`rounded-xl border px-3 py-2 text-xs ${muted} ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
                Started from the {remixedFrom} template — it's loaded in the preview below. Make
                it yours with the edit box, or download it as-is.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                3. Preview &amp; take it with you
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  className={chipBtn(isLight)}
                  aria-expanded={showPreview}
                  onClick={() => setShowPreview((v) => !v)}
                >
                  <FileCode2 className="h-3.5 w-3.5" />
                  {showPreview ? "View files" : "View preview"}
                </button>
                <button
                  type="button"
                  className={goldBtn}
                  disabled={downloading}
                  onClick={() => void downloadZip()}
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {downloading ? "Zipping…" : "Download site (.zip)"}
                </button>
              </div>
            </div>

            {projectId ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                    isLight
                      ? "border-[#C9A84C]/50 text-[#6B5B36]"
                      : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Saved to your account · Version {currentVersion ?? ""}
                </span>
                <button
                  type="button"
                  className={chipBtn(isLight)}
                  aria-expanded={showVersions}
                  onClick={() => setShowVersions((v) => !v)}
                >
                  <History className="h-3.5 w-3.5" /> Version history
                </button>
                <button type="button" className={chipBtn(isLight)} onClick={startNewSite}>
                  <Plus className="h-3.5 w-3.5" /> Start a new site
                </button>
              </div>
            ) : null}

            {projectId &&
            viewingVersion !== null &&
            currentVersion !== null &&
            viewingVersion !== currentVersion ? (
              <p className={`rounded-xl border px-3 py-2 text-[11px] ${amberBox}`}>
                You're viewing version {viewingVersion} — restoring it or editing from here saves
                a new version. Nothing is ever overwritten.
              </p>
            ) : null}

            {projectId && showVersions ? (
              <div data-testid="world-website-builder-versions" className="space-y-1.5">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                      isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <span className="min-w-0 flex-1 text-xs">
                      <span className={`font-semibold ${strong}`}>Version {v.version}</span>
                      <span className={muted}>
                        {" · "}
                        {websiteSourceLabel(v.source)}
                        {" · "}
                        {v.fileCount} files
                        {" · "}
                        {formatDate(v.createdAt)}
                      </span>
                      {v.version === currentVersion ? (
                        <span className="ml-2 rounded-full bg-[#d4af37]/20 px-2 py-0.5 text-[10px] font-bold text-[#d4af37]">
                          Current
                        </span>
                      ) : null}
                      {v.note ? (
                        <span className={`block text-[11px] italic ${muted}`}>
                          &ldquo;{v.note}&rdquo;
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className={chipBtn(isLight)}
                      disabled={opening || v.version === viewingVersion}
                      onClick={() => projectId && void openProject(projectId, v.version)}
                    >
                      <Eye className="h-3.5 w-3.5" /> View
                    </button>
                    {v.version !== currentVersion ? (
                      <button
                        type="button"
                        className={chipBtn(isLight)}
                        disabled={opening}
                        onClick={() => void restoreVersion(v.version)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Restore
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {showPreview ? (
              <div
                className={`overflow-hidden rounded-2xl border ${
                  isLight ? "border-[#C9A84C]/40" : "border-white/10"
                }`}
              >
                <div
                  className={`flex items-center gap-2 border-b px-3 py-2 ${
                    isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/5"
                  }`}
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                  <span className={`ml-2 text-[11px] ${muted}`}>
                    Private preview — only you can see this
                  </span>
                </div>
                <iframe
                  title="Site preview"
                  sandbox="allow-scripts"
                  srcDoc={buildPreviewHtml(files)}
                  className="h-[420px] w-full bg-white"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                {fileNames.map((name) => (
                  <div
                    key={name}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                      isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <span className={`flex items-center gap-2 font-mono text-xs ${strong}`}>
                      <FileCode2 className="h-3.5 w-3.5 text-[#d4af37]" /> {name}
                    </span>
                    <span className={`text-[11px] ${muted}`}>
                      {(new Blob([files[name]]).size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Conversational edits */}
            <div className="space-y-2">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                <Wand2 className="mr-1.5 inline h-3.5 w-3.5 text-[#d4af37]" />
                Want changes? Just say so.
              </p>
              <p className={`text-xs ${muted}`}>
                "Make the hero section darker", "change the headline to…", "use warmer colors" —
                each edit regenerates the site at {WEBSITE_EDIT_COST_VB} Visual Bucs.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  className={deskInputCls(isLight)}
                  placeholder="Describe the change…"
                  maxLength={WEBSITE_EDIT_MAX}
                  value={editRequest}
                  onChange={(e) => setEditRequest(e.target.value)}
                  aria-label="Describe the change"
                />
                <button
                  type="button"
                  className={goldBtn}
                  disabled={editing || !websiteEditReady(files, editRequest)}
                  onClick={() => void applyEdit()}
                >
                  {editing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  {editing
                    ? "Applying…"
                    : `Apply edit — ${WEBSITE_EDIT_COST_VB} Visual Bucs`}
                </button>
              </div>
            </div>

            <p className={`rounded-xl border px-3 py-2 text-xs ${muted} ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
              <span className={`font-semibold ${strong}`}>You own this outright.</span> The zip
              includes every file plus a README with step-by-step deploy guides for Netlify,
              Vercel, Cloudflare Pages, and cPanel. Put it on your own hosting, your own domain —
              your responsibility, your asset.
            </p>
          </div>
        ) : null}
      </div>
    </NativeCard>
  );
}
