/**
 * LinkToHitBench — Link-to-Hit's native bench at the My
 * Studio board (Stack 300 world parity, census Lane B item
 * 12 / manifest item 105), stacked with the board's other
 * Create-family desks: the /create hub comedy panel, in the
 * room.
 *
 * The panel's own flow on its own rails (lib/world/
 * link-to-hit-bench.ts): a social link and/or a REAL upload
 * (the picked file hosts through /api/upload-clip first —
 * free, unconfirmed), comments the song is written from, a
 * genre that's the creator's call, then the analyze run —
 * 300 Bucs behind the spend confirmation, the override the
 * panel itself passes. The package renders whole: source
 * card (whatever the link publicly exposed — never faked),
 * comedy concept, the cut (your clips vs AI roast inserts,
 * never blended), and the funny song with its copy text.
 * "Make this song" opens the Song Desk station in-world.
 * A decline runs nothing; a 402 lands in the out-of-Bucs
 * state; a failed run is refunded server-side. Copy rides
 * linkToHit.*.
 */
import { useState } from "react";
import { Check, Copy, Film, Link2, Loader2, Music2, Plus, Sparkles, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "@/lib/api-error";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useIsAdmin, uploadLimitBytes, uploadLimitLabel } from "@/lib/use-is-admin";
import { DeskTextField, deskInputCls } from "./CreateDeskLeaf";
import {
  LINK_TO_HIT_ANALYZE_PATH,
  LINK_TO_HIT_COST,
  LINK_TO_HIT_DEFAULT_GENRE,
  LINK_TO_HIT_FEATURE,
  LINK_TO_HIT_GENRE_PRESETS,
  LINK_TO_HIT_MEMBER_UPLOAD_BYTES,
  LINK_TO_HIT_SONG_STATION_ID,
  LINK_TO_HIT_UPLOAD_PATH,
  addLinkToHitComment,
  buildLinkToHitPayload,
  linkToHitFileVerdict,
  linkToHitFinalGenre,
  linkToHitInputReady,
  linkToHitPackageOf,
  linkToHitSongCopyText,
  linkToHitUploadUrlOf,
  type LinkToHitPackage,
} from "@/lib/world/link-to-hit-bench";

export function LinkToHitBench({
  isLight,
  onOpenStation,
}: {
  isLight: boolean;
  onOpenStation?: (stationId: string) => void;
}) {
  const { t } = useTranslation();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  /* Uploads ride /api/upload-clip: members 80 MB, owner 1 GB —
     the panel's own helpers. */
  const isAdmin = useIsAdmin();

  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [commentInput, setCommentInput] = useState("");
  const [comments, setComments] = useState<string[]>([]);
  const [genre, setGenre] = useState<string>(LINK_TO_HIT_DEFAULT_GENRE);
  const [customGenre, setCustomGenre] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [pkg, setPkg] = useState<LinkToHitPackage | null>(null);
  const [copied, setCopied] = useState(false);

  const hasUpload = uploadFile !== null;
  const finalGenre = linkToHitFinalGenre(customGenre, genre);
  const ready = linkToHitInputReady({ url, description, hasUpload, fileName, comments, genre: finalGenre });
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const labelCls = `text-[11px] font-bold uppercase tracking-widest ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;

  function addComment() {
    const next = addLinkToHitComment(comments, commentInput);
    if (!next) return;
    setComments(next);
    setCommentInput("");
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const limit = uploadLimitBytes(isAdmin, LINK_TO_HIT_MEMBER_UPLOAD_BYTES);
    const verdict = linkToHitFileVerdict(f, limit);
    if (verdict === "not-video") {
      setError(t("linkToHit.notVideo"));
      return;
    }
    if (verdict === "too-large") {
      setError(t("linkToHit.tooLarge", { limit: uploadLimitLabel(isAdmin, LINK_TO_HIT_MEMBER_UPLOAD_BYTES) }));
      return;
    }
    setError(null);
    setUploadFile(f);
    setFileName(f.name);
  }

  async function generate() {
    if (!ready || loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      /* The picked file REALLY uploads (the panel's own fix:
         the analysis once ran on the filename alone). Hosted
         via /api/upload-clip, its URL rides along. */
      let effectiveUrl = url.trim();
      if (uploadFile) {
        setUploading(true);
        const form = new FormData();
        form.append("clip", uploadFile, uploadFile.name);
        const upRes = await fetch(LINK_TO_HIT_UPLOAD_PATH, { method: "POST", body: form });
        const upData: unknown = await upRes.json().catch(() => ({}));
        setUploading(false);
        const hosted = linkToHitUploadUrlOf(upData);
        if (!upRes.ok || !hosted) {
          throw new Error(apiErrorMessage(upData, t("linkToHit.uploadFailed")));
        }
        effectiveUrl = hosted;
      }
      const res = await confirmedFetch(LINK_TO_HIT_ANALYZE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: LINK_TO_HIT_COST,
        overrideFeature: LINK_TO_HIT_FEATURE,
        body: JSON.stringify(
          buildLinkToHitPayload({ url, description, hasUpload, fileName, comments, genre: finalGenre }, effectiveUrl),
        ),
      });
      if (!res) return; // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      const parsed = linkToHitPackageOf(data);
      if (!res.ok || !parsed) {
        throw new Error(apiErrorMessage(data, t("linkToHit.failed")));
      }
      setPkg(parsed);
      refreshProfile();
    } catch (e) {
      setError(plainErrorText(e, t("linkToHit.failed")));
    } finally {
      setLoading(false);
      setUploading(false);
    }
  }

  function copySong() {
    if (!pkg) return;
    void navigator.clipboard?.writeText(linkToHitSongCopyText(pkg)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  const genreChipCls = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/60 hover:text-white"
    }`;

  return (
    <div className="space-y-3" data-testid="world-link-to-hit-bench">
      <div className="flex items-center gap-2">
        <Link2 className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>{t("linkToHit.title")}</p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {t("linkToHit.cost")}
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{t("linkToHit.desc")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <DeskTextField
            isLight={isLight}
            label={t("linkToHit.urlLabel")}
            value={url}
            onChange={setUrl}
            placeholder="https://…"
          />
          <p className={`mt-1 text-[11px] ${muted}`}>{t("linkToHit.urlNote")}</p>
        </div>
        <div>
          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("linkToHit.uploadLabel")}
          </span>
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm transition bdv-touch-target ${
              hasUpload
                ? isLight ? "border-[#C9A84C] text-[#7A5A12]" : "border-[#d4af37]/60 text-[#e8c86a]"
                : isLight ? "border-[#C9A84C]/40 text-[#6B5B36] hover:border-[#C9A84C]/70" : "border-white/15 text-white/55 hover:border-white/30"
            }`}
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span className="truncate">{hasUpload ? fileName : t("linkToHit.uploadCta")}</span>
            <input type="file" accept="video/*" className="hidden" onChange={handleFile} />
          </label>
        </div>
      </div>

      <label className="block">
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("linkToHit.descLabel")}
        </span>
        <textarea
          aria-label={t("linkToHit.descLabel")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("linkToHit.descPh")}
          className={`${deskInputCls(isLight)} min-h-[70px] resize-y`}
        />
      </label>

      <div>
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("linkToHit.commentsLabel")}
        </span>
        <div className="flex gap-2">
          <input
            aria-label={t("linkToHit.commentsLabel")}
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addComment()}
            placeholder={t("linkToHit.commentsPh")}
            maxLength={500}
            className={deskInputCls(isLight)}
          />
          <button
            type="button"
            aria-label={t("worldBenches300.addComment")}
            onClick={addComment}
            disabled={!commentInput.trim() || comments.length >= 20}
            className={`shrink-0 rounded-xl border px-3 disabled:opacity-40 bdv-touch-target ${isLight ? "border-[#C9A84C]/40 text-[#7A5A12]" : "border-white/15 text-white"}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        {comments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {comments.map((c, i) => (
              <span key={i} className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${cardCls}`}>
                <span className="max-w-[280px] truncate">“{c}”</span>
                <button
                  type="button"
                  onClick={() => setComments((prev) => prev.filter((_, idx) => idx !== i))}
                  className={muted}
                  aria-label={t("worldBenches300.removeLabel")}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("linkToHit.genreLabel")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {LINK_TO_HIT_GENRE_PRESETS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => { setGenre(g); setCustomGenre(""); }}
              className={genreChipCls(genre === g && !customGenre)}
            >
              {g}
            </button>
          ))}
        </div>
        <input
          aria-label={t("linkToHit.genreLabel")}
          value={customGenre}
          onChange={(e) => setCustomGenre(e.target.value)}
          placeholder={t("linkToHit.genreCustomPh")}
          maxLength={60}
          className={`${deskInputCls(isLight)} mt-2`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="world-link-to-hit-run"
          onClick={() => void generate()}
          disabled={loading || !ready}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {uploading ? t("worldBenches300.uploadingClip") : t("linkToHit.generate")}
        </button>
      </div>
      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature: LINK_TO_HIT_FEATURE })}
        </p>
      )}
      {error && (
        <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
      )}

      {pkg && (
        <div className="space-y-3" data-testid="world-link-to-hit-result">
          {pkg.source && (pkg.source.title || pkg.source.thumbnail) && (
            <div className={`flex items-center gap-3 rounded-xl border p-3 ${cardCls}`}>
              {pkg.source.thumbnail && <img src={pkg.source.thumbnail} alt="" className="h-14 w-14 rounded-lg object-cover" />}
              <div className="min-w-0">
                <p className={`truncate text-sm font-bold ${strong}`}>{pkg.source.title}</p>
                {pkg.source.author && <p className={`text-xs ${muted}`}>{pkg.source.author}</p>}
              </div>
            </div>
          )}

          <div className={`rounded-xl border p-3 ${cardCls}`}>
            <p className={`${labelCls} flex items-center gap-1.5`}>
              <Film className="h-3.5 w-3.5" /> {t("linkToHit.concept")}
            </p>
            <p className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed ${isLight ? "text-[#2a1e07]/85" : "text-white/85"}`}>
              {pkg.comedyConcept}
            </p>
          </div>

          {pkg.segments.length > 0 && (
            <div className={`rounded-xl border p-3 ${cardCls}`}>
              <p className={labelCls}>{t("linkToHit.segments")}</p>
              <div className="mt-2 space-y-2">
                {pkg.segments.map((seg, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-2.5 ${
                      seg.type === "generated"
                        ? isLight ? "border-[#C9A84C] bg-[#F7ECD2]" : "border-[#d4af37]/60 bg-[#d4af37]/10"
                        : isLight ? "border-[#C9A84C]/25 bg-white/60" : "border-white/10 bg-black/40"
                    }`}
                  >
                    <p className={`mb-0.5 text-[10px] font-black uppercase tracking-widest ${seg.type === "generated" ? (isLight ? "text-[#7A5A12]" : "text-[#e8c86a]") : muted}`}>
                      {seg.type === "generated" ? t("linkToHit.segGenerated") : t("linkToHit.segSource")}
                    </p>
                    <p className={`text-sm ${isLight ? "text-[#2a1e07]/85" : "text-white/80"}`}>{seg.description}</p>
                    {seg.prompt && (
                      <p className={`mt-1.5 rounded-md px-2 py-1.5 text-[11px] leading-relaxed ${isLight ? "bg-white/70 text-[#6B5B36]" : "bg-black/50 text-white/55"}`}>
                        {seg.prompt}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={`rounded-xl border p-3 ${cardCls}`}>
            <div className="flex items-start justify-between gap-2">
              <p className={`${labelCls} flex items-center gap-1.5`}>
                <Music2 className="h-3.5 w-3.5" /> {t("linkToHit.song")} · {finalGenre}
              </p>
              <button
                type="button"
                onClick={copySong}
                className={`shrink-0 ${muted}`}
                aria-label={t("worldBenches300.copyLabel")}
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className={`mt-1 text-base font-black ${strong}`}>“{pkg.songTitle}”</p>
            <p className={`mt-2 text-[11px] font-bold uppercase tracking-widest ${muted}`}>{t("linkToHit.hook")}</p>
            <p className={`text-sm font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{pkg.hook}</p>
            <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${isLight ? "text-[#2a1e07]/85" : "text-white/80"}`}>
              {pkg.songLyrics}
            </p>
            <p className={`mt-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${isLight ? "border-[#C9A84C]/25 bg-white/60 text-[#6B5B36]" : "border-white/10 bg-black/40 text-white/50"}`}>
              <span className={`font-bold ${strong}`}>{t("linkToHit.musicPrompt")}</span> {pkg.musicPrompt}
            </p>
            <button
              type="button"
              data-testid="world-link-to-hit-make-song"
              onClick={() => onOpenStation?.(LINK_TO_HIT_SONG_STATION_ID)}
              className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target"
            >
              <Sparkles className="h-4 w-4" />
              {t("linkToHit.makeThisSong")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
