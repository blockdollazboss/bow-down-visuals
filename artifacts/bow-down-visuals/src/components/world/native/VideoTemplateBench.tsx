import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clapperboard, Link2, Upload, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage } from "@/lib/api-error";
import { r2UploadFile } from "@/lib/r2-storage";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";
import { NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  VIDEO_TEMPLATES_PATH,
  VIDEO_TEMPLATE_APPLY_PATH,
  VIDEO_TEMPLATE_UPLOAD_MAX_BYTES,
  buildVideoTemplateApplyBody,
  interpretTemplateJob,
  templateJobErrorLine,
  missingSlotLabels,
  parseVideoTemplateCatalog,
  slotAcceptsMedia,
  videoTemplateApplyCost,
  videoTemplateApplyFeature,
  videoTemplateJobPath,
  videoTemplatePrefill,
  type VideoTemplateCatalogEntry,
} from "@/lib/world/templates-desk";

/* ─── Video Template bench — the Video Desk (Stack-100 w4 #100) ─────
   The receiving end of the video-template panel payload (item
   27): the editor's Templates tab, native in the World. The
   bench loads the rail's own catalog (GET
   /api/video-template/templates — the full recipes), preselects
   the template the Templates Desk handed over (the editor
   panel's deep-link discipline: only a key the catalog itself
   carries), fills the recipe's slots from uploads or pasted
   links, and applies through the SAME rail the editor uses —
   POST /api/video-template/apply, priced from the credit-cost
   registry, confirmed through the standing CreditConfirm path
   before anything charges, polled to a finished video that
   plays right here. A failed render is auto-refunded by the
   rail, and the bench says so.

   Honest states: a catalog read that fails — or answers in a
   shape the bench can't trust — is a failure with Retry, never
   an empty shelf; a payload slug the catalog doesn't know
   preselects nothing; declining the spend confirmation returns
   to the form untouched. */

export function VideoTemplateBench({
  isLight,
  panelPayload,
}: {
  isLight: boolean;
  panelPayload?: unknown;
}) {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const applyCost = videoTemplateApplyCost();
  const applyFeature = videoTemplateApplyFeature();

  const [loadState, setLoadState] = useState<"loading" | "failed" | "ready">("loading");
  const [catalog, setCatalog] = useState<VideoTemplateCatalogEntry[]>([]);
  const [selected, setSelected] = useState<VideoTemplateCatalogEntry | null>(null);
  const [slotUrls, setSlotUrls] = useState<Record<string, string>>({});
  const [slotDrafts, setSlotDrafts] = useState<Record<string, string>>({});
  const [overlayTexts, setOverlayTexts] = useState<string[]>([]);
  const [musicBedUrl, setMusicBedUrl] = useState("");
  const [endCard, setEndCard] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [jobState, setJobState] = useState<"idle" | "working" | "done" | "failed">("idle");
  const [jobStage, setJobStage] = useState("");
  const [jobProgress, setJobProgress] = useState(0);
  const [jobError, setJobError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultDuration, setResultDuration] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const deepLinkKey = videoTemplatePrefill(panelPayload);
  const appliedDeepLink = useRef<string | null>(null);

  const text = isLight ? "text-[#2A2118]" : "text-[#F3E9D2]";
  const muted = isLight ? "text-[#2A2118]/60" : "text-[#F3E9D2]/55";
  const inputCls = `w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none ${
    isLight
      ? "border-black/15 bg-white/70 text-[#2A2118] placeholder:text-[#2A2118]/40"
      : "border-white/15 bg-white/[0.04] text-[#F3E9D2] placeholder:text-[#F3E9D2]/40"
  }`;
  const chipCls = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
      active
        ? "border-transparent bg-[#C9A227] text-black"
        : isLight
          ? "border-black/15 text-[#2A2118]/70 hover:border-black/30"
          : "border-white/15 text-[#F3E9D2]/70 hover:border-white/30"
    }`;

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const pickTemplate = useCallback(
    (entry: VideoTemplateCatalogEntry) => {
      stopPolling();
      setSelected(entry);
      setSlotUrls({});
      setSlotDrafts({});
      setOverlayTexts(entry.overlays.map((o) => o.text));
      setMusicBedUrl("");
      setEndCard(false);
      setNotice(null);
      setJobError(null);
      setJobState("idle");
      setResultUrl(null);
      setResultDuration(null);
    },
    [stopPolling],
  );

  const loadCatalog = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch(VIDEO_TEMPLATES_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error(`catalog ${res.status}`);
      const parsed = parseVideoTemplateCatalog(await res.json().catch(() => null));
      if (!parsed) throw new Error("catalog drift");
      setCatalog(parsed.templates);
      setLoadState("ready");
    } catch {
      setLoadState("failed");
    }
  }, [authHeaders]);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  /* The payload's preselect — once the catalog lands, and only
     for a key the catalog itself carries (the second gate). */
  useEffect(() => {
    if (loadState !== "ready" || !deepLinkKey) return;
    if (appliedDeepLink.current === deepLinkKey) return;
    const found = catalog.find((t) => t.key === deepLinkKey);
    if (found) {
      appliedDeepLink.current = deepLinkKey;
      pickTemplate(found);
    }
  }, [loadState, catalog, deepLinkKey, pickTemplate]);

  const onUpload = async (slot: VideoTemplateCatalogEntry["slots"][number], file: File | undefined) => {
    if (!file || !selected) return;
    if (!slotAcceptsMedia(slot, file.name, file.type)) {
      setNotice(
        slot.kind === "video"
          ? t("worldDeskRemainder.vtbNeedsVideoFile", { label: slot.label })
          : t("worldDeskRemainder.vtbNeedsPhotoFile", { label: slot.label }),
      );
      return;
    }
    if (file.size > VIDEO_TEMPLATE_UPLOAD_MAX_BYTES) {
      setNotice(t("worldDeskRemainder.vtbFileTooBig"));
      return;
    }
    setUploadingSlot(slot.key);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
      const url = await r2UploadFile(
        `${user?.id ?? "anon"}/video-templates/${Date.now()}-${slot.key}.${ext}`,
        file,
        file.type || "application/octet-stream",
        token,
      );
      if (!slotAcceptsMedia(slot, url, file.type)) {
        setNotice(t("worldDeskRemainder.vtbUploadDoesntFit", { label: slot.label }));
        return;
      }
      setSlotUrls((prev) => ({ ...prev, [slot.key]: url }));
    } catch {
      setNotice(t("worldDeskRemainder.vtbUploadFailed"));
    } finally {
      setUploadingSlot(null);
    }
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(videoTemplateJobPath(jobId), { headers: await authHeaders() });
        const read = interpretTemplateJob(await res.json().catch(() => null));
        if (read.state === "done" && read.resultUrl) {
          stopPolling();
          setResultUrl(read.resultUrl);
          setResultDuration(read.durationSec);
          setJobState("done");
          void refreshProfile();
        } else if (read.state === "failed") {
          stopPolling();
          setJobState("failed");
          setJobError(templateJobErrorLine(read, t("worldDeskRemainder.vtbJobFailed")));
        } else {
          setJobStage(read.stage || t("worldDeskRemainder.vtbStageWorking"));
          setJobProgress(read.progress);
        }
      } catch {
        /* a missed poll is not a failed render — keep polling */
      }
    }, 3000);
  };

  const apply = async () => {
    if (!selected || jobState === "working") return;
    const missing = missingSlotLabels(selected, slotUrls);
    if (missing.length > 0) {
      setNotice(t("worldDeskRemainder.vtbAddMedia", { labels: missing.join(", ") }));
      return;
    }
    setNotice(null);
    setJobError(null);
    let res: Response | null;
    try {
      res = await confirmedFetch(VIDEO_TEMPLATE_APPLY_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildVideoTemplateApplyBody({ entry: selected, slotUrls, overlayTexts, musicBedUrl, endCard }),
        ),
        overrideCost: applyCost,
        overrideFeature: applyFeature,
      });
    } catch {
      setJobError(t("worldDeskRemainder.vtbReachFailed"));
      return;
    }
    if (!res) return; /* the member declined the confirmation — back to the form, untouched */
    if (!res.ok) {
      if (res.status === 402) {
        setJobError(t("worldDeskRemainder.vtbOutOfCredits"));
      } else {
        setJobError(apiErrorMessage(await res.json().catch(() => null), t("worldDeskRemainder.vtbStartFailed")));
      }
      return;
    }
    const data = (await res.json().catch(() => null)) as { jobId?: string } | null;
    if (!data?.jobId) {
      setJobError(t("worldDeskRemainder.vtbRenderDidntStart"));
      return;
    }
    void refreshProfile();
    setJobState("working");
    setJobStage("queued");
    setJobProgress(0);
    startPolling(data.jobId);
  };

  return (
    <div className="space-y-3" data-testid="world-video-template-bench">
      <div>
        <h4 className={`flex items-center gap-2 text-sm font-bold ${text}`}>
          <Clapperboard className="h-4 w-4 text-[#C9A227]" /> {t("worldDeskRemainder.vtbTitle")}
        </h4>
        <p className={`mt-0.5 text-xs ${muted}`}>
          {t("worldDeskRemainder.vtbIntro", { cost: applyCost })}
        </p>
      </div>

      {loadState === "loading" ? (
        <NativeLoadingState isLight={isLight} message={t("worldDeskRemainder.vtbLoading")} />
      ) : loadState === "failed" ? (
        <div data-testid="world-video-template-bench-load-failed">
          <NativeErrorState
            isLight={isLight}
            title={t("worldDeskRemainder.vtbLoadFailedTitle")}
            message={t("worldDeskRemainder.vtbLoadFailedMessage")}
            onRetry={() => void loadCatalog()}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" data-testid="world-video-template-bench-catalog">
            {catalog.map((t) => (
              <button
                key={t.key}
                type="button"
                className={chipCls(selected?.key === t.key)}
                onClick={() => pickTemplate(t)}
                data-testid={`world-video-template-bench-pick-${t.key}`}
              >
                {t.name}
              </button>
            ))}
          </div>

          {selected ? (
            <div className="space-y-3" data-testid="world-video-template-bench-configure">
              <div>
                <p className={`text-sm font-semibold ${text}`}>{selected.name}</p>
                <p className={`text-xs ${muted}`}>{selected.tagline}</p>
                <p className={`mt-0.5 text-[11px] ${muted}`}>
                  {t("worldDeskRemainder.vtbMeta", {
                    aspect: selected.aspect,
                    seconds: Math.round(selected.outputSeconds),
                    count: selected.slots.length,
                    clipWord: selected.slots.length === 1 ? t("worldDeskRemainder.vtbClipOne") : t("worldDeskRemainder.vtbClipMany"),
                  })}
                </p>
              </div>

              <div className="space-y-2">
                {selected.slots.map((slot) => {
                  const filled = slotUrls[slot.key];
                  return (
                    <div
                      key={slot.key}
                      className={`rounded-xl border p-2.5 ${
                        isLight ? "border-black/10 bg-white/60" : "border-white/10 bg-white/[0.04]"
                      }`}
                      data-testid={`world-video-template-bench-slot-${slot.key}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-xs font-semibold ${text}`}>
                          {slot.label}{" "}
                          <span className={muted}>
                            · {slot.kind === "any" ? t("worldDeskRemainder.vtbKindAny") : slot.kind === "video" ? t("worldDeskRemainder.vtbKindVideo") : t("worldDeskRemainder.vtbKindPhoto")} · {slot.durationSec}s
                          </span>
                        </p>
                        {filled ? (
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${muted}`}
                            onClick={() =>
                              setSlotUrls((prev) => {
                                const next = { ...prev };
                                delete next[slot.key];
                                return next;
                              })
                            }
                            data-testid={`world-video-template-bench-slot-clear-${slot.key}`}
                          >
                            <X className="h-3 w-3" /> {t("worldDeskRemainder.vtbClear")}
                          </button>
                        ) : null}
                      </div>
                      {filled ? (
                        slotAcceptsMedia(slot, filled) && !/\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i.test(filled) ? (
                          <img src={filled} alt={slot.label} className="mt-2 max-h-28 rounded-lg object-cover" />
                        ) : (
                          <video src={filled} className="mt-2 max-h-28 rounded-lg" muted playsInline preload="metadata" />
                        )
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input
                            ref={(el) => {
                              fileRefs.current[slot.key] = el;
                            }}
                            type="file"
                            accept={slot.kind === "photo" ? "image/*" : slot.kind === "video" ? "video/*" : "image/*,video/*"}
                            className="hidden"
                            onChange={(e) => {
                              void onUpload(slot, e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                          <button
                            type="button"
                            disabled={uploadingSlot === slot.key}
                            onClick={() => fileRefs.current[slot.key]?.click()}
                            className="inline-flex items-center gap-1 rounded-lg bg-[#C9A227] px-2.5 py-1.5 text-[11px] font-bold text-black transition hover:bg-[#dbb52f] disabled:opacity-50"
                            data-testid={`world-video-template-bench-slot-upload-${slot.key}`}
                          >
                            <Upload className="h-3 w-3" /> {uploadingSlot === slot.key ? t("worldDeskRemainder.vtbUploading") : t("worldDeskRemainder.vtbUpload")}
                          </button>
                          <div className="flex min-w-44 flex-1 items-center gap-1.5">
                            <Link2 className={`h-3.5 w-3.5 shrink-0 ${muted}`} />
                            <input
                              value={slotDrafts[slot.key] ?? ""}
                              onChange={(e) => setSlotDrafts((prev) => ({ ...prev, [slot.key]: e.target.value }))}
                              onBlur={() => {
                                const url = (slotDrafts[slot.key] ?? "").trim();
                                if (!url) return;
                                if (!slotAcceptsMedia(slot, url)) {
                                  setNotice(
                                    slot.kind === "video"
                                      ? t("worldDeskRemainder.vtbNeedsVideoLink", { label: slot.label })
                                      : t("worldDeskRemainder.vtbNeedsPhotoLink", { label: slot.label }),
                                  );
                                  return;
                                }
                                setSlotUrls((prev) => ({ ...prev, [slot.key]: url }));
                              }}
                              placeholder={t("worldDeskRemainder.vtbLinkPlaceholder")}
                              aria-label={t("worldDeskRemainder.vtbLinkAria", { label: slot.label })}
                              className={inputCls}
                              data-testid={`world-video-template-bench-slot-url-${slot.key}`}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selected.overlays.length > 0 ? (
                <div className="space-y-1.5" data-testid="world-video-template-bench-overlays">
                  <p className={`text-xs font-semibold ${text}`}>{t("worldDeskRemainder.vtbWordsLabel")}</p>
                  {selected.overlays.map((o, i) => (
                    <input
                      key={i}
                      value={overlayTexts[i] ?? ""}
                      maxLength={140}
                      onChange={(e) =>
                        setOverlayTexts((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))
                      }
                      className={inputCls}
                      aria-label={t("worldDeskRemainder.vtbWordsAria", { position: o.position })}
                      data-testid={`world-video-template-bench-overlay-${i}`}
                    />
                  ))}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label className={`block text-xs font-semibold ${text}`}>
                  {t("worldDeskRemainder.vtbMusicBed")}{" "}
                  <span className={muted}>
                    {selected.audioMode === "bed" ? t("worldDeskRemainder.vtbMusicBedDrops") : t("worldDeskRemainder.vtbMusicBedOptional")}
                  </span>
                </label>
                <input
                  value={musicBedUrl}
                  onChange={(e) => setMusicBedUrl(e.target.value)}
                  placeholder={t("worldDeskRemainder.vtbMusicBedPlaceholder")}
                  aria-label={t("worldDeskRemainder.vtbMusicBed")}
                  className={inputCls}
                  data-testid="world-video-template-bench-music-bed"
                />
                <label className={`flex items-center gap-2 text-xs ${text}`}>
                  <input
                    type="checkbox"
                    checked={endCard}
                    onChange={(e) => setEndCard(e.target.checked)}
                    data-testid="world-video-template-bench-end-card"
                  />
                  {t("worldDeskRemainder.vtbEndCard")}
                </label>
              </div>

              {notice ? (
                <p className="text-xs font-medium text-red-500" data-testid="world-video-template-bench-notice">
                  {notice}
                </p>
              ) : null}

              {jobState === "working" ? (
                <div data-testid="world-video-template-bench-working">
                  <div className={`h-2 overflow-hidden rounded-full ${isLight ? "bg-black/10" : "bg-white/10"}`}>
                    <div className="h-full bg-[#C9A227] transition-all" style={{ width: `${Math.max(4, Math.min(100, jobProgress))}%` }} />
                  </div>
                  <p className={`mt-1 text-xs ${muted}`}>
                    {jobStage === "queued" ? t("worldDeskRemainder.vtbQueued") : t("worldDeskRemainder.vtbRendering", { stage: jobStage, progress: jobProgress })}
                  </p>
                </div>
              ) : jobState === "done" && resultUrl ? (
                <div data-testid="world-video-template-bench-done">
                  <video src={resultUrl} controls playsInline className="w-full rounded-xl" />
                  <p className={`mt-1 text-xs ${muted}`}>
                    {t("worldDeskRemainder.vtbDone", { secondsPart: resultDuration ? t("worldDeskRemainder.vtbDoneSeconds", { seconds: resultDuration.toFixed(1) }) : "" })}
                  </p>
                </div>
              ) : (
                <>
                  {jobState === "failed" && jobError ? (
                    <p className="text-xs font-medium text-red-500" data-testid="world-video-template-bench-job-error">
                      {jobError}{t("worldDeskRemainder.vtbRefundSuffix", { cost: applyCost })}
                    </p>
                  ) : jobError ? (
                    <p className="text-xs font-medium text-red-500" data-testid="world-video-template-bench-apply-error">
                      {jobError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void apply()}
                    className="w-full rounded-lg bg-[#C9A227] px-3 py-2 text-sm font-bold text-black transition hover:bg-[#dbb52f]"
                    data-testid="world-video-template-bench-apply"
                  >
                    {t("worldDeskRemainder.vtbApply", { cost: applyCost })}
                  </button>
                </>
              )}
            </div>
          ) : (
            <p className={`text-xs ${muted}`} data-testid="world-video-template-bench-pick-first">
              {t("worldDeskRemainder.vtbPickFirst")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
