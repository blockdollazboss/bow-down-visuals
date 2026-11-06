/**
 * VideoStudioDesk — the My Studio board's native Video Studio
 * desk (stack200 world parity lane B1, census item 5),
 * stacked at the board with the other project desks.
 *
 * The hub surface of pages/video-studio.tsx, native: the
 * camera-movement picker over the shared catalog
 * (data/video-studio — the page is unrouted, so its data
 * moved to a module both surfaces can read), one-click
 * presets, duration/aspect pickers, text and image modes, the
 * hub spine (project picks in, finished clips into the
 * project), and the Thumbnail desk's winning pick anchoring
 * image mode one-shot — all on the page's rail,
 * POST /api/generate-runway-clip (gen4.5, registry-priced),
 * polled the page's way to the page's deadline. The rail
 * charges only when a clip succeeds; a succeeded poll with
 * no clip is stated as exactly that.
 *
 * Copy lives in worldVideoStudio.* — the page never cataloged
 * its strings (defaultValue fallbacks), so the desk's catalog
 * carries the page's own wording where the page has wording.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clapperboard, ImagePlus, Loader2, Sparkles, Type } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { useHubProject, type HubAsset } from "@/lib/hub-project";
import { r2UploadFile } from "@/lib/r2-storage";
import { useConfirmedApi } from "@/lib/world/confirmed-api";
import { videoClipCost } from "@/lib/world/create-desks";
import {
  CAMERA_MOVEMENTS,
  ONE_CLICK_PRESETS,
  VIDEO_STUDIO_ASPECTS,
  VIDEO_STUDIO_DURATIONS,
} from "@/data/video-studio";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";
import {
  VIDEO_STUDIO_CLIP_PATH,
  VIDEO_STUDIO_POLL_DEADLINE_MS,
  VIDEO_STUDIO_POLL_MS,
  VIDEO_STUDIO_REFERENCE_MAX_BYTES,
  buildStudioClipBody,
  interpretStudioPoll,
  studioClipAsset,
  studioProjectPick,
  studioSubmitOf,
  takeThumbnailWinner,
  videoStudioTaskPath,
} from "@/lib/world/video-studio-desk";

interface StudioVideo {
  url: string;
  prompt: string;
  camera: string;
}

const PICK_KINDS = new Set(["song", "script", "thumbnail", "image"]);

export function VideoStudioDesk({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const { project, addAsset } = useHubProject();

  const [mode, setMode] = useState<"text" | "image">("text");
  const [prompt, setPrompt] = useState("");
  const [camera, setCamera] = useState<string>("push-in");
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState<string>("16:9");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [videos, setVideos] = useState<StudioVideo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* The Thumbnail desk's winning A/B pick anchors image mode —
     one-shot, the page's exact discipline. */
  useEffect(() => {
    const winner = takeThumbnailWinner(localStorage);
    if (winner) {
      setMode("image");
      setReferenceFile(null);
      setReferenceImage(winner);
    }
  }, []);

  const picks: HubAsset[] = (project?.assets ?? []).filter((a) => PICK_KINDS.has(a.kind));

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = isLight
    ? "w-full rounded-xl border border-[#7A5A12]/30 bg-white/70 px-3 py-2 text-sm text-[#2a1e07] placeholder:text-[#6B5B36]/60 outline-none"
    : "w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none";
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const sectionLabel = `text-[11px] font-black uppercase tracking-wider ${muted}`;

  function handleProjectPick(asset: HubAsset) {
    const pick = studioProjectPick(asset, prompt);
    if (!pick) return;
    if (pick.prompt !== undefined) setPrompt(pick.prompt);
    if (pick.aspect !== undefined) setAspect(pick.aspect);
    if (pick.referenceImage !== undefined) {
      setMode("image");
      setReferenceFile(null);
      setReferenceImage(pick.referenceImage);
    }
  }

  function handleImageUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(t("worldVideoStudio.errorNotImage"));
      return;
    }
    if (file.size > VIDEO_STUDIO_REFERENCE_MAX_BYTES) {
      setError(t("worldVideoStudio.errorImageTooLarge"));
      return;
    }
    setError(null);
    setReferenceFile(file);
    setReferenceImage(URL.createObjectURL(file));
  }

  async function handleGenerate() {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const token = await getAccessToken();
      /* A picked photo uploads to real storage first — the
         page's rule (never an unbounded base64 data URL). */
      let referenceUrl = referenceImage;
      if (mode === "image" && referenceFile) {
        const key = `video-studio-refs/${Date.now()}-${referenceFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        referenceUrl = await r2UploadFile(key, referenceFile, referenceFile.type, token);
        if (!mountedRef.current) return;
        setReferenceImage(referenceUrl);
        setReferenceFile(null);
      }

      const submitRes = await confirmedFetch(VIDEO_STUDIO_CLIP_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildStudioClipBody({
            prompt,
            cameraId: camera,
            aspectId: aspect,
            referenceImageUrl: mode === "image" ? referenceUrl : null,
          }),
        ),
        overrideCost: videoClipCost(),
        overrideFeature: "Generate Video Clip",
      });
      if (submitRes === null) return; // member declined — nothing ran
      const submitData = (await submitRes.json().catch(() => ({}))) as Record<string, unknown>;
      const submit = studioSubmitOf(submitData);
      if (!submitRes.ok || !submit) {
        throw new Error(apiErrorMessage(submitData, t("worldVideoStudio.failed")));
      }

      /* Poll the page's way: every 5s to a 5-minute deadline. */
      let videoUrl: string | null = null;
      const deadline = Date.now() + VIDEO_STUDIO_POLL_DEADLINE_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, VIDEO_STUDIO_POLL_MS));
        if (!mountedRef.current) return;
        const pollRes = await fetch(videoStudioTaskPath(submit.taskId), {
          headers: authHeaders(),
          credentials: "include",
        });
        const verdict = interpretStudioPoll(await pollRes.json().catch(() => ({})));
        if (verdict.state === "done") {
          videoUrl = verdict.url;
          break;
        }
        if (verdict.state === "empty") {
          throw new Error(t("worldVideoStudio.emptySuccess"));
        }
        if (verdict.state === "failed") {
          throw new Error(verdict.message ?? t("worldVideoStudio.failed"));
        }
      }
      if (!videoUrl) throw new Error(t("worldVideoStudio.timedOut"));
      if (!mountedRef.current) return;

      setVideos((prev) => [{ url: videoUrl as string, prompt: prompt.trim(), camera }, ...prev]);
      addAsset(
        studioClipAsset({
          url: videoUrl,
          prompt,
          cameraId: camera,
          aspectId: aspect,
          durationSec: submit.durationSec,
        }),
      );
      refreshProfile();
    } catch (err) {
      if (mountedRef.current) setError(plainErrorText(err, t("worldVideoStudio.failed")));
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="world-video-studio-desk">
      <div>
        <p className={`inline-flex items-center gap-2 text-base font-black ${strong}`}>
          <Clapperboard className="h-4 w-4 text-[#d4af37]" /> {t("worldVideoStudio.title")}
        </p>
        <p className={`text-xs ${muted}`}>{t("worldVideoStudio.subtitle")}</p>
      </div>

      {picks.length > 0 ? (
        <div className="space-y-1.5" data-testid="world-video-studio-desk-picks">
          <p className={sectionLabel}>{t("worldVideoStudio.fromProject")}</p>
          <div className="flex flex-wrap gap-1.5">
            {picks.map((a) => (
              <button key={a.id} type="button" className={chipCls(false)} onClick={() => handleProjectPick(a)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <p className={sectionLabel}>{t("worldVideoStudio.presetsLabel")}</p>
        <div className="flex flex-wrap gap-1.5" data-testid="world-video-studio-desk-presets">
          {ONE_CLICK_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={chipCls(false)}
              title={p.blurb}
              onClick={() => {
                setPrompt(p.prompt);
                setCamera(p.camera);
                setDuration(p.duration);
                setAspect(p.aspect);
              }}
            >
              {p.icon} {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5" data-testid="world-video-studio-desk-mode">
        <button type="button" className={chipCls(mode === "text")} onClick={() => setMode("text")}>
          <Type className="h-3.5 w-3.5" /> {t("worldVideoStudio.modeText")}
        </button>
        <button type="button" className={chipCls(mode === "image")} onClick={() => setMode("image")}>
          <ImagePlus className="h-3.5 w-3.5" /> {t("worldVideoStudio.modeImage")}
        </button>
      </div>

      {mode === "image" ? (
        <div className={`space-y-2 rounded-xl border p-3 ${cardCls}`}>
          {referenceImage ? (
            <img src={referenceImage} alt="" className="max-h-40 w-full rounded-lg object-cover" />
          ) : null}
          <label
            className={`bdv-touch-target inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-black transition ${
              isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/80 hover:text-white"
            }`}
          >
            <ImagePlus className="h-4 w-4" /> {t("worldVideoStudio.uploadPhoto")}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageUpload(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      ) : null}

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("worldVideoStudio.promptPlaceholder")}
        aria-label={t("worldVideoStudio.promptPlaceholder")}
        rows={3}
        className={inputCls}
      />

      <div className="space-y-1.5">
        <p className={sectionLabel}>{t("worldVideoStudio.cameraLabel")}</p>
        <div className="flex flex-wrap gap-1.5" data-testid="world-video-studio-desk-cameras">
          {CAMERA_MOVEMENTS.map((c) => (
            <button
              key={c.id}
              type="button"
              data-testid={`world-video-studio-desk-camera-${c.id}`}
              className={chipCls(camera === c.id)}
              onClick={() => setCamera(c.id)}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="space-y-1.5">
          <p className={sectionLabel}>{t("worldVideoStudio.durationLabel")}</p>
          <div className="flex gap-1.5">
            {VIDEO_STUDIO_DURATIONS.map((d) => (
              <button key={d} type="button" className={chipCls(duration === d)} onClick={() => setDuration(d)}>
                {d}s
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <p className={sectionLabel}>{t("worldVideoStudio.aspectLabel")}</p>
          <div className="flex gap-1.5">
            {VIDEO_STUDIO_ASPECTS.map((a) => (
              <button key={a.id} type="button" className={chipCls(aspect === a.id)} onClick={() => setAspect(a.id)}>
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        data-testid="world-video-studio-desk-generate"
        className="bdv-touch-target inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
        disabled={generating || !prompt.trim()}
        onClick={() => void handleGenerate()}
      >
        {generating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {t("worldVideoStudio.generating")}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" /> {t("worldVideoStudio.generate")} · {videoClipCost()} VB
          </>
        )}
      </button>
      {error ? (
        <p className="text-sm text-red-500" data-testid="world-video-studio-desk-error">
          {error}
        </p>
      ) : null}

      {videos.length > 0 ? (
        <div className="space-y-2" data-testid="world-video-studio-desk-results">
          <p className={sectionLabel}>{t("worldVideoStudio.resultsLabel")}</p>
          {videos.map((v, i) => (
            <article key={`${v.url}-${i}`} className={`rounded-xl border p-3 ${cardCls}`}>
              <video src={v.url} controls className="w-full rounded-lg" preload="metadata" />
              <p className={`mt-2 line-clamp-2 text-xs ${muted}`}>{v.prompt}</p>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
