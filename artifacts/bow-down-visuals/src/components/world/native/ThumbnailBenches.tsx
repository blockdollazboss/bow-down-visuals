import { useRef, useState } from "react";
import { Loader2, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildThumbnailVariantsPayload,
  ctrPredictionOfResponse,
  thumbnailGeneratorCost,
  thumbnailGeneratorFields,
  THUMBNAIL_FACE_FIELD,
  thumbnailImagesOfResponse,
  THUMBNAIL_TEST_FIELD,
  THUMBNAIL_TEST_MAX_FILES,
  THUMBNAIL_TEST_MIN_FILES,
  thumbnailTestCost,
  thumbnailTestFields,
  thumbnailVariantsCost,
  thumbnailVariantsOfResponse,
  type CtrPrediction,
} from "@/lib/world/create-desks";
import {
  DeskSelectField,
  DeskTextField,
  QuestProgressChip,
  useDeskAuthHeaders,
  useQuestProgressChip,
} from "./CreateDeskShared";

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
     never a guarantee. Prices from the registry, shown up front. */

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

export function ThumbnailBenches({ isLight }: { isLight: boolean }) {
  const { getAccessToken, refreshProfile } = useAuth();
  const authHeaders = useDeskAuthHeaders();
  const quest = useQuestProgressChip();
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState("bold-text-pop");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [overlayText, setOverlayText] = useState("");
  const [overlayPosition, setOverlayPosition] = useState<"top" | "middle" | "bottom">("bottom");
  const [attribution, setAttribution] = useState(false);
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [facePreview, setFacePreview] = useState<string | null>(null);
  const [images, setImages] = useState<Array<{ url: string; variation: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [variants, setVariants] = useState<Array<{ url: string; label: string; prompt: string }>>([]);
  const [winner, setWinner] = useState<string | null>(null);
  const [testFiles, setTestFiles] = useState<File[]>([]);
  const [testPreviews, setTestPreviews] = useState<string[]>([]);
  const [ctr, setCtr] = useState<CtrPrediction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const faceRef = useRef<HTMLInputElement | null>(null);

  const selectedUrl = images.find((i) => i.variation === selected)?.url ?? images[0]?.url ?? null;
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  const runMaker = async () => {
    if (busy || prompt.trim().length < 3) return;
    setBusy("maker");
    setError(null);
    void quest.snapshot();
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
      if (!res.ok) throw new Error(data.error ?? "Thumbnail generation failed.");
      const parsed = thumbnailImagesOfResponse(data);
      if (parsed.length === 0) throw new Error("The maker came back without images — nothing to pick from.");
      setImages(parsed);
      setSelected(parsed[0]!.variation);
      setWinner(null);
      setVariants([]);
      refreshProfile();
      void quest.checkAfter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thumbnail generation failed.");
    } finally {
      setBusy(null);
    }
  };

  const runVariants = async () => {
    if (busy || !selectedUrl) return;
    setBusy("variants");
    setError(null);
    try {
      const res = await fetch("/api/wave8/thumbnail-ab/variants", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildThumbnailVariantsPayload({ sourceImageUrl: selectedUrl, title: overlayText || prompt, niche: stylePreset })),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Variant generation failed.");
      setVariants(thumbnailVariantsOfResponse(data));
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Variant generation failed.");
    } finally {
      setBusy(null);
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
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "CTR prediction failed.");
    } finally {
      setBusy(null);
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

      {selectedUrl ? (
        <div className="space-y-2">
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
          <div className="flex flex-wrap gap-2">
            {images.map((img) => (
              <button key={img.variation} type="button" onClick={() => setSelected(img.variation)} className={`overflow-hidden rounded-lg border-2 ${selected === img.variation ? "border-[#d4af37]" : "border-transparent"}`}>
                <img src={img.url} alt={img.variation} className="h-14 w-24 object-cover" />
              </button>
            ))}
          </div>
          <button type="button" data-testid="world-thumbnail-variants-run" onClick={() => void runVariants()} disabled={busy !== null} className={chipBtn(isLight)}>
            {busy === "variants" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Make A/B variants of this one · {thumbnailVariantsCost().toLocaleString("en-US")} Visual Bucs
          </button>
        </div>
      ) : null}

      {variants.length > 0 ? (
        <div className="space-y-2" data-testid="world-thumbnail-variants">
          <p className={`text-xs font-semibold ${muted}`}>Tap the winner — that&rsquo;s the one to ship.</p>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button key={v.url} type="button" onClick={() => setWinner(v.url)} className={`overflow-hidden rounded-lg border-2 text-left ${winner === v.url ? "border-[#d4af37]" : "border-transparent"}`}>
                <img src={v.url} alt={v.label} className="h-16 w-28 object-cover" />
                <span className="block px-1 py-0.5 text-[11px] font-bold">{v.label}{winner === v.url ? " — your winner" : ""}</span>
              </button>
            ))}
          </div>
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
          </div>
        ) : null}
      </div>
      {error ? <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p> : null}
      <QuestProgressChip isLight={isLight} lines={quest.lines} />
    </div>
  );
}
