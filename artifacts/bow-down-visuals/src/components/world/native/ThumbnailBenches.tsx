import { useEffect, useRef, useState } from "react";
import { Loader2, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { parsePanelPayloadFor } from "@/lib/world/panel-payload";
import { getThumbnailTemplate } from "@/data/thumbnail-templates";
import {
  buildThumbnailVariantsPayload,
  buildThumbnailWinnerPublishHref,
  ctrPredictionOfResponse,
  schedulePrefillForMedia,
  THUMBNAIL_BATCH_SIZE,
  thumbnailBenchSlots,
  thumbnailGeneratorCost,
  thumbnailGeneratorFields,
  THUMBNAIL_FACE_FIELD,
  thumbnailImagesOfResponse,
  thumbnailImproveCost,
  THUMBNAIL_IMPROVE_FIELD,
  thumbnailImproveFields,
  thumbnailImprovedUrlOfResponse,
  thumbnailPartialImagesOfResponse,
  THUMBNAIL_TEST_FIELD,
  THUMBNAIL_TEST_MAX_FILES,
  THUMBNAIL_TEST_MIN_FILES,
  thumbnailTestCost,
  thumbnailTestFields,
  thumbnailVariantsCost,
  thumbnailVariantsOfResponse,
  THUMBNAIL_WINNER_HANDOFF_KEY,
  type CtrPrediction,
} from "@/lib/world/create-desks";
import {
  DeskSelectField,
  DeskTextField,
  QuestProgressChip,
  useDeskAuthHeaders,
  useQuestProgressChip,
} from "./CreateDeskShared";
import { SchedulerComposeStandalone } from "./SchedulerDesk";

/* ─── Ring 2 (2.9 + 2.10) — the Thumbnail Desk's pro benches ────────
   thumbnail-studio.tsx's own benches docked:
   - the 4-variation maker (POST /api/thumbnail-generator, multipart
     — prompt / stylePreset / aspectRatio / overlayText / facePhoto /
     attribution), with the text-overlay editor: the words + their
     live preview over the current image before the server renders
     them in for real;
   - the A/B variants bench (POST /api/wave8/thumbnail-ab/variants)
     with a pick-the-winner tap;
   - the CTR prediction bench (POST /api/thumbnail-test) — the
     page's honest framing kept: a prediction from best practices,
     never a guarantee. Prices from the registry, shown up front.
   R2 #10 finish: the bench tells the truth about a batch that
   stopped partway (the server refunds it and returns the landed
   variations — they render as real slots beside failed ones, with
   a fresh-batch run as the retry); the A/B pair faces off LARGE
   with the original beside them, like the page; and picking the
   winner SAVES it on the page's own rail — the winner's permanent
   url rides the packaging handoff Video Studio reads back — with
   the publish door offered as an explicit link. */

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

export function ThumbnailBenches({
  isLight,
  panelPayload,
}: {
  isLight: boolean;
  /** The panel payload the Thumbnail Desk was opened with
   *  (Stack-100 #2 item 97): RAW — parsed defensively below for
   *  this station only. Absent/garbage = the benches open blank. */
  panelPayload?: unknown;
}) {
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState("bold-text-pop");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [overlayText, setOverlayText] = useState("");
  const [overlayPosition, setOverlayPosition] = useState<"top" | "middle" | "bottom">("bottom");
  const [attribution, setAttribution] = useState(false);

  /* Panel payload (Stack-100 #2 item 97): a handoff that named a
     thumbnail template — a Daily Drop thumbnail "Use" — opens the
     benches PREFILLED with that template's prompt, style, aspect
     and overlay words (the same fields the website maker's
     ?template= deep link preloads). Parsed defensively for THIS
     station only, applied once on open; an unknown slug fills
     nothing and the benches open blank, as a plain open does.
     Prefilling is free — only a generation run charges. */
  const payloadAppliedRef = useRef(false);
  useEffect(() => {
    if (payloadAppliedRef.current) return;
    payloadAppliedRef.current = true;
    const payload = parsePanelPayloadFor("thumbnail-desk", panelPayload);
    if (!payload || payload.kind !== "thumbnail-template") return;
    const tpl = getThumbnailTemplate(payload.templateSlug);
    if (!tpl) return;
    setPrompt(tpl.prompt);
    setStylePreset(tpl.stylePreset);
    setAspectRatio(tpl.aspectRatio);
    setOverlayText(tpl.overlayText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [images, setImages] = useState<Array<{ url: string; variation: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /* Slots of the batch of 4 that did NOT land (a stopped batch, or a
     short answer) — rendered as failed slots, never filled in with
     another slot's image. batchNote carries the refund truth when
     the server stopped partway. */
  const [failedCount, setFailedCount] = useState(0);
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const [variants, setVariants] = useState<Array<{ url: string; label: string; prompt: string }>>([]);
  /* The image the current A/B pair was generated from — the
     head-to-head's "original" card, frozen at run time so changing
     the bench selection afterwards can't swap it. */
  const [variantsSource, setVariantsSource] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [winnerScheduleOpen, setWinnerScheduleOpen] = useState(false);
  const [testFiles, setTestFiles] = useState<File[]>([]);
  const [testPreviews, setTestPreviews] = useState<string[]>([]);
  const [ctr, setCtr] = useState<CtrPrediction | null>(null);
  /* Stack-100 #50: apply-suggestions state — one improving slot at
     a time (the studio's own rule), improved urls by candidate. */
  const [improving, setImproving] = useState<number | null>(null);
  const [improvedUrls, setImprovedUrls] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const faceRef = useRef<HTMLInputElement | null>(null);

  const selectedUrl = images.find((i) => i.variation === selected)?.url ?? images[0]?.url ?? null;
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  /* The bench after a run: landed variations as ready slots, the
     rest as failed slots (thumbnailBenchSlots never fills a slot
     from another slot's image). */
  const slots = thumbnailBenchSlots(images);
  const benchTouched = images.length > 0 || failedCount > 0;

  const runMaker = async () => {
    if (busy || prompt.trim().length < 3) return;
    setBusy("maker");
    setError(null);
    void quest.snapshot();
    let landedThisRun = false;
    try {
      const form = new FormData();
      for (const [k, v] of thumbnailGeneratorFields({ prompt, stylePreset, aspectRatio, overlayText, attribution })) form.append(k, v);
      if (faceFile) form.append(THUMBNAIL_FACE_FIELD, faceFile);
      const res = await fetch("/api/thumbnail-generator", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        /* A batch that stopped partway: the server refunded it and
           the variations that DID land ride the error body in
           permanent storage. Show them as real results beside
           failed slots — never dropped, never dressed up. */
        const partial = thumbnailPartialImagesOfResponse(data);
        if (partial.length > 0) {
          landedThisRun = true;
          setImages(partial);
          setSelected(partial[0]!.variation);
          setFailedCount(THUMBNAIL_BATCH_SIZE - partial.length);
          setBatchNote(
            `${partial.length} of ${THUMBNAIL_BATCH_SIZE} landed before the batch stopped — your ${thumbnailGeneratorCost().toLocaleString("en-US")} Visual Bucs were refunded. What's here is real and saved; the empty slots didn't generate.`,
          );
          setWinner(null);
          setVariants([]);
          setVariantsSource(null);
          refreshProfile();
          void quest.checkAfter();
          return;
        }
        throw new Error(data.error ?? "Thumbnail generation failed.");
      }
      const parsed = thumbnailImagesOfResponse(data);
      if (parsed.length === 0) throw new Error("The maker came back without images — nothing to pick from.");
      landedThisRun = true;
      setImages(parsed);
      setSelected(parsed[0]!.variation);
      setFailedCount(THUMBNAIL_BATCH_SIZE - parsed.length);
      setBatchNote(null);
      setWinner(null);
      setVariants([]);
      setVariantsSource(null);
      refreshProfile();
      void quest.checkAfter();
    } catch (err) {
      /* A run that landed nothing on an empty bench still shows its
         outcome: a full row of failed slots with the fresh-batch
         retry. A re-run's failure never clears a bench that already
         holds real images. */
      if (!landedThisRun && images.length === 0) setFailedCount(THUMBNAIL_BATCH_SIZE);
      setError(err instanceof Error ? err.message : "Thumbnail generation failed.");
    } finally {
      setBusy(null);
    }
  };

  const runVariants = async () => {
    if (busy || !selectedUrl) return;
    setBusy("variants");
    setError(null);
    setWinner(null);
    try {
      const res = await fetch("/api/wave8/thumbnail-ab/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildThumbnailVariantsPayload({ sourceImageUrl: selectedUrl, title: overlayText || prompt, niche: stylePreset })),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Variant generation failed.");
      setVariants(thumbnailVariantsOfResponse(data));
      setVariantsSource(selectedUrl);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Variant generation failed.");
    } finally {
      setBusy(null);
    }
  };

  /* Picking the winner SAVES it, on the website's own rail: the
     winner's permanent url rides the packaging handoff that Video
     Studio reads back (thumbnail-studio.tsx's pickWinner writes the
     exact same key), so a winner picked in the palace is the
     thumbnail the packaging flow picks up. */
  const pickWinner = (url: string) => {
    setWinner(url);
    try {
      localStorage.setItem(THUMBNAIL_WINNER_HANDOFF_KEY, url);
    } catch {
      /* storage unavailable — the winner still shows on the bench */
    }
  };

  const runCtr = async () => {
    if (busy || testFiles.length < THUMBNAIL_TEST_MIN_FILES) return;
    setBusy("ctr");
    setError(null);
    try {
      const form = new FormData();
      for (const f of testFiles) form.append(THUMBNAIL_TEST_FIELD, f);
      for (const [k, v] of thumbnailTestFields({ title: overlayText, niche: stylePreset })) form.append(k, v);
      const res = await fetch("/api/thumbnail-test", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "The prediction didn't land.");
      const parsed = ctrPredictionOfResponse(data);
      if (!parsed) throw new Error("The prediction came back unreadable — nothing was concluded.");
      setCtr(parsed);
      setImprovedUrls({});
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "CTR prediction failed.");
    } finally {
      setBusy(null);
    }
  };

  /* Stack-100 #50 — apply one candidate's suggestions on the
     studio's own rail (POST /api/thumbnail-test/improve): the
     candidate's File + its tips from THIS prediction. The improved
     image lands beside the candidate; saving it as the winner
     rides the same handoff key the A/B winner rides. */
  const applySuggestions = async (index: number) => {
    const tips = ctr?.tips[index];
    const file = testFiles[index];
    if (!ctr || !tips || tips.length === 0 || !file || improving !== null || busy !== null) return;
    setImproving(index);
    setError(null);
    void quest.snapshot();
    try {
      const form = new FormData();
      form.append(THUMBNAIL_IMPROVE_FIELD, file);
      for (const [k, v] of thumbnailImproveFields({ tips })) form.append(k, v);
      const res = await fetch("/api/thumbnail-test/improve", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (res.status === 402) {
        setError("You're out of Visual Bucs — top up to generate improved thumbnails.");
        return;
      }
      if (!res.ok) throw new Error(data.message ?? data.error ?? "The improved version didn't land.");
      const url = thumbnailImprovedUrlOfResponse(data);
      if (!url) throw new Error("The improved version came back without an image.");
      setImprovedUrls((prev) => ({ ...prev, [index]: url }));
      refreshProfile();
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The improved version didn't land.");
    } finally {
      setImproving(null);
    }
  };

  return (
    <div data-testid="world-thumbnail-benches" className={`space-y-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
      <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        Pro benches — variations, A/B, predicted clicks
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField isLight={isLight} label="Thumbnail idea" value={prompt} onChange={setPrompt} />
        <DeskSelectField isLight={isLight} label="Style preset" value={stylePreset} onChange={setStylePreset} options={["bold-text-pop", "shocked-face", "luxury", "gaming", "vlog", "minimal"].map((s) => ({ value: s, label: s }))} />
        <DeskSelectField isLight={isLight} label="Format" value={aspectRatio} onChange={setAspectRatio} options={[{ value: "16:9", label: "Wide 16:9" }, { value: "9:16", label: "Vertical 9:16" }, { value: "1:1", label: "Square 1:1" }]} />
      </div>

      {/* Text-overlay editor: words + placement, previewed live over
          the current image; the maker renders them in server-side. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <DeskTextField isLight={isLight} label="Overlay text (the words on the thumbnail)" value={overlayText} onChange={setOverlayText} />
        <DeskSelectField isLight={isLight} label="Overlay placement (preview)" value={overlayPosition} onChange={(v) => setOverlayPosition(v as "top" | "middle" | "bottom")} options={[{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }]} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className={chipBtn(isLight)}>
          {faceFile ? `Face photo: ${faceFile.name}` : "Add your face / an asset photo"}
          <input
            ref={faceRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="world-thumbnail-face-upload"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFaceFile(f);
                setFacePreview(URL.createObjectURL(f));
              }
            }}
          />
        </label>
        {facePreview ? <img src={facePreview} alt="Face or asset for the thumbnail" className="h-10 w-10 rounded-lg object-cover" /> : null}
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={attribution} onChange={(e) => setAttribution(e.target.checked)} />
          Made-with credit on the thumbnail
        </label>
      </div>
      <button type="button" data-testid="world-thumbnail-maker-run" onClick={() => void runMaker()} disabled={busy !== null || prompt.trim().length < 3} className={goldBtn}>
        {busy === "maker" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Make 4 variations · {thumbnailGeneratorCost().toLocaleString("en-US")} Visual Bucs
      </button>

      {benchTouched ? (
        <div className="space-y-2" data-testid="world-thumbnail-bench">
          {selectedUrl ? (
            <div className="relative overflow-hidden rounded-xl">
              <img src={selectedUrl} alt="Your thumbnail" className="w-full rounded-xl object-contain" />
              {overlayText.trim() ? (
                <span
                  data-testid="world-thumbnail-overlay-preview"
                  className={`pointer-events-none absolute left-0 right-0 px-3 text-center text-lg font-black uppercase text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] ${
                    overlayPosition === "top" ? "top-2" : overlayPosition === "middle" ? "top-1/2 -translate-y-1/2" : "bottom-2"
                  }`}
                >
                  {overlayText}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="grid grid-cols-4 gap-2">
            {slots.map((slot) =>
              slot.status === "ready" ? (
                <button key={slot.variation} type="button" onClick={() => setSelected(slot.variation)} className={`overflow-hidden rounded-lg border-2 ${selected === slot.variation ? "border-[#d4af37]" : "border-transparent"}`}>
                  <img src={slot.url} alt={slot.variation} className="h-14 w-full object-cover" />
                </button>
              ) : (
                <div
                  key={slot.variation}
                  data-testid="world-thumbnail-failed-slot"
                  className={`flex h-14 items-center justify-center rounded-lg border-2 border-dashed text-center ${isLight ? "border-[#92600a]/40" : "border-white/20"}`}
                >
                  <span className={`px-1 text-[11px] font-bold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>Didn&rsquo;t land</span>
                </div>
              ),
            )}
          </div>
          {batchNote ? <p className={`text-xs ${muted}`}>{batchNote}</p> : null}
          {failedCount > 0 ? (
            <button type="button" data-testid="world-thumbnail-fresh-batch" onClick={() => void runMaker()} disabled={busy !== null || prompt.trim().length < 3} className={chipBtn(isLight)}>
              {busy === "maker" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Run a fresh batch · {thumbnailGeneratorCost().toLocaleString("en-US")} Visual Bucs
            </button>
          ) : null}
          {selectedUrl ? (
            <button type="button" data-testid="world-thumbnail-variants-run" onClick={() => void runVariants()} disabled={busy !== null} className={chipBtn(isLight)}>
              {busy === "variants" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Make A/B variants of this one · {thumbnailVariantsCost().toLocaleString("en-US")} Visual Bucs
            </button>
          ) : null}
        </div>
      ) : null}

      {variants.length > 0 ? (
        <div className="space-y-2" data-testid="world-thumbnail-variants">
          <p className={`text-xs font-semibold ${muted}`}>Head to head — pick the winner. That&rsquo;s the one that ships.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {variantsSource ? (
              <div className={`overflow-hidden rounded-lg border-2 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
                <img src={variantsSource} alt="Your original thumbnail" className="aspect-video w-full object-cover" />
                <span className="block px-1.5 py-1 text-[11px] font-bold">Your original</span>
              </div>
            ) : null}
            {variants.map((v) => (
              <div key={v.url} className={`overflow-hidden rounded-lg border-2 ${winner === v.url ? "border-[#d4af37]" : "border-transparent"}`}>
                <img src={v.url} alt={v.label} className="aspect-video w-full object-cover" />
                <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                  <span className="min-w-0 truncate text-[11px] font-bold">{v.label}</span>
                  {winner === v.url ? (
                    <span className="shrink-0 text-[11px] font-bold text-[#d4af37]">Your winner</span>
                  ) : (
                    <button type="button" data-testid="world-thumbnail-pick-winner" onClick={() => pickWinner(v.url)} className={chipBtn(isLight)}>
                      Pick the winner
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {winner ? (
            <div data-testid="world-thumbnail-winner" className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold">
                Winner saved — it&rsquo;s the thumbnail your video packaging flow picks up.
              </p>
              <a
                href={buildThumbnailWinnerPublishHref({ winnerUrl: winner, title: overlayText || prompt })}
                target="_blank"
                rel="noreferrer"
                className={chipBtn(isLight)}
              >
                Use as thumbnail for a video
              </a>
              <button
                type="button"
                data-testid="world-thumbnail-schedule"
                aria-expanded={winnerScheduleOpen}
                onClick={() => setWinnerScheduleOpen((v) => !v)}
                className={chipBtn(isLight)}
              >
                Schedule it
              </button>
              {winnerScheduleOpen ? (
                <div className="w-full">
                  <SchedulerComposeStandalone
                    isLight={isLight}
                    prefill={schedulePrefillForMedia(winner, "image", "My winning thumbnail — made with Bow Down Visuals")}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* CTR prediction bench — upload 2–4 candidates, the studio's
          predictor scores them. A prediction, never a guarantee. */}
      <div className="space-y-2 border-t border-dashed border-[#d4af37]/30 pt-3">
        <label className={chipBtn(isLight)}>
          {testFiles.length > 0 ? `${testFiles.length} candidate(s) picked` : `Pick ${THUMBNAIL_TEST_MIN_FILES}–${THUMBNAIL_TEST_MAX_FILES} thumbnails to compare`}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            data-testid="world-thumbnail-ctr-upload"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).slice(0, THUMBNAIL_TEST_MAX_FILES);
              setTestFiles(files);
              setTestPreviews(files.map((f) => URL.createObjectURL(f)));
              setCtr(null);
              setImprovedUrls({});
            }}
          />
        </label>
        {testPreviews.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {testPreviews.map((p, i) => (
              <img key={p} src={p} alt={`Candidate ${i + 1}`} className="h-14 w-24 rounded-lg object-cover" />
            ))}
          </div>
        ) : null}
        <button type="button" data-testid="world-thumbnail-ctr-run" onClick={() => void runCtr()} disabled={busy !== null || testFiles.length < THUMBNAIL_TEST_MIN_FILES} className={goldBtn}>
          {busy === "ctr" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Predict the clicks · {thumbnailTestCost().toLocaleString("en-US")} Visual Bucs
        </button>
        {ctr ? (
          <div data-testid="world-thumbnail-ctr-result" className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-black">
              <Trophy className="h-4 w-4 text-[#d4af37]" />
              Predicted winner: thumbnail {ctr.winnerIndex + 1} — {ctr.confidence}% confidence
            </p>
            <p className={`text-xs ${muted}`}>Scores: {ctr.overallScores.map((s, i) => `#${i + 1}: ${s}`).join(" · ")}</p>
            {ctr.reasoning ? <p className={`text-xs ${muted}`}>{ctr.reasoning}</p> : null}
            <p className={`text-[11px] italic ${muted}`}>{ctr.disclaimer || "A prediction from thumbnail best practices — not a guarantee of real clicks."}</p>
            {/* Stack-100 #50: apply a candidate's own tips on the
                improve rail — offered only where the prediction
                actually carried tips for that candidate. */}
            <div className="space-y-2 pt-1">
              {ctr.tips.map((tips, i) =>
                tips.length > 0 && testFiles[i] ? (
                  <div key={i} className="space-y-1.5" data-testid={`world-thumbnail-ctr-apply-row-${i}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold">Thumbnail {i + 1} — the predictor&rsquo;s tips:</span>
                      {improvedUrls[i] ? (
                        <span className="text-xs font-bold text-[#d4af37]">Improved version ready below</span>
                      ) : (
                        <button
                          type="button"
                          data-testid="world-thumbnail-ctr-apply"
                          onClick={() => void applySuggestions(i)}
                          disabled={improving !== null || busy !== null}
                          className={chipBtn(isLight)}
                        >
                          {improving === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Apply suggestions · {thumbnailImproveCost().toLocaleString("en-US")} Visual Bucs
                        </button>
                      )}
                    </div>
                    <ul className={`list-disc space-y-0.5 pl-5 text-xs ${muted}`}>
                      {tips.map((tip) => (
                        <li key={tip}>{tip}</li>
                      ))}
                    </ul>
                    {improvedUrls[i] ? (
                      <div className="space-y-1.5" data-testid="world-thumbnail-ctr-improved">
                        <img src={improvedUrls[i]} alt={`Improved thumbnail ${i + 1}`} className="aspect-video w-full max-w-md rounded-xl object-cover" />
                        <div className="flex flex-wrap gap-2">
                          {winner === improvedUrls[i] ? (
                            <span className="text-xs font-bold text-[#d4af37]">Saved as your winner</span>
                          ) : (
                            <button type="button" data-testid="world-thumbnail-ctr-improved-save" onClick={() => pickWinner(improvedUrls[i]!)} className={chipBtn(isLight)}>
                              Save as the winner
                            </button>
                          )}
                          <a href={improvedUrls[i]} download className={chipBtn(isLight)}>
                            Download the improved one
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null,
              )}
            </div>
          </div>
        ) : null}
      </div>
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
    </div>
  );
}
