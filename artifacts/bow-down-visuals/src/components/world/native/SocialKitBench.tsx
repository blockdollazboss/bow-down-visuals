/**
 * SocialKitBench — the Social Media Kit's native bench in the
 * Post Office desk family (Stack 400 world parity, census
 * Lane B item 9 / manifest item B-09), stacked under the Post
 * Office desk itself: the 2D hub's brand kit now generates
 * where the Social family lives in-World.
 *
 * The panel's own flow on its own rail (lib/world/
 * social-kit-bench.ts): brand + tagline + one of the three
 * styles, the 400-Buc post rides the registry-priced spend
 * confirmation, and every returned asset flows into the hub
 * project exactly as the panel's does (kind "image",
 * sourceAsset "social-kit") so the in-World scheduler and
 * promo tools can grab the kit. A failed generation is
 * refunded server-side; the bench renders the panel's own
 * copy for every state, from hubSpine.socialKit.*.
 */
import { useState } from "react";
import { CheckCircle2, Download, Loader2, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { DeskTextField } from "./CreateDeskLeaf";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  SOCIAL_KIT_BRAND_MAX,
  SOCIAL_KIT_PATH,
  SOCIAL_KIT_STYLE_LABEL_KEYS,
  SOCIAL_KIT_STYLES,
  SOCIAL_KIT_TAGLINE_MAX,
  socialKitAssetsOf,
  socialKitCanRun,
  socialKitCost,
  socialKitPayload,
  type SocialKitAsset,
  type SocialKitStyle,
} from "@/lib/world/social-kit-bench";

type BenchStatus = "idle" | "working" | "done" | "failed";

export function SocialKitBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { project, addAsset } = useHubProject();

  const [brandName, setBrandName] = useState(
    project.name && project.name !== "Untitled Project" ? project.name : "",
  );
  const [tagline, setTagline] = useState(project.concept.slice(0, SOCIAL_KIT_TAGLINE_MAX));
  const [style, setStyle] = useState<SocialKitStyle>("gold-luxury");
  const [status, setStatus] = useState<BenchStatus>("idle");
  const [assets, setAssets] = useState<SocialKitAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const cost = socialKitCost();
  const busy = status === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const chipCls = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-left text-xs transition bdv-touch-target ${
      active
        ? isLight
          ? "border-[#C9A84C] bg-[#F7ECD2] text-[#2a1e07]"
          : "border-amber-400 bg-amber-400/[0.16] text-amber-200"
        : isLight
          ? "border-[#C9A84C]/30 text-[#6B5B36] hover:border-[#C9A84C]/60"
          : "border-white/10 text-white/60 hover:border-white/30"
    }`;

  async function generate() {
    const input = { brandName, tagline, style };
    if (busy || !socialKitCanRun(input)) return;
    setStatus("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(SOCIAL_KIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(socialKitPayload(input)),
        overrideCost: cost,
        overrideFeature: "Social Media Kit",
      });
      if (!res) { setStatus("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      const list = socialKitAssetsOf(data);
      if (!res.ok || !list) {
        setStatus("failed");
        setError(apiErrorMessage(data, t("hubSpine.socialKit.failed")));
        return;
      }
      setAssets(list);
      /* Spine: every kit asset lands in the hub project, exactly
         as the panel saves it. */
      let saved = 0;
      list.forEach((a, i) => {
        if (!a.url) return;
        try {
          addAsset({
            kind: "image",
            url: a.url,
            label: a.label ?? t("hubSpine.socialKit.assetLabel", { n: i + 1 }),
            detail: a.kind ?? brandName.trim(),
            meta: { sourceAsset: "social-kit", handoff: "social-kit", brand: brandName.trim() },
          });
          saved += 1;
        } catch { /* non-fatal — the asset still shows on the bench */ }
      });
      setSavedCount(saved);
      setStatus("done");
    } catch {
      setStatus("failed");
      setError(t("hubSpine.socialKit.failed"));
    }
  }

  return (
    <NativeCard isLight={isLight}>
      <div className="space-y-3" data-testid="world-social-kit-bench">
        <div className="flex items-center gap-2">
          <Palette className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
          <p className={`text-base font-black ${strong}`}>{t("hubSpine.socialKit.title")}</p>
          <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
            {cost} VB
          </span>
        </div>
        <p className={`text-xs ${muted}`}>{t("hubSpine.socialKit.blurb")}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <DeskTextField
            isLight={isLight}
            label={t("hubSpine.socialKit.brandLabel")}
            value={brandName}
            onChange={(v) => setBrandName(v.slice(0, SOCIAL_KIT_BRAND_MAX))}
            placeholder={t("hubSpine.socialKit.brandPlaceholder")}
          />
          <DeskTextField
            isLight={isLight}
            label={t("hubSpine.socialKit.taglineLabel")}
            value={tagline}
            onChange={(v) => setTagline(v.slice(0, SOCIAL_KIT_TAGLINE_MAX))}
            placeholder={t("hubSpine.socialKit.taglinePlaceholder")}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {SOCIAL_KIT_STYLES.map((s) => (
            <button key={s} type="button" onClick={() => setStyle(s)} className={chipCls(style === s)}>
              <span className="text-xs font-bold">{t(SOCIAL_KIT_STYLE_LABEL_KEYS[s])}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="world-social-kit-run"
            onClick={() => void generate()}
            disabled={!socialKitCanRun({ brandName, tagline, style }) || busy}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
            {busy ? t("hubSpine.socialKit.generating") : t("hubSpine.socialKit.generate")}
          </button>
        </div>
        <p className={`text-[11px] ${muted}`}>{t("hubSpine.socialKit.costNote")}</p>

        {outOfCredits && (
          <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
            {t("worldBenches300.outOfBucs", { feature: "Social Media Kit" })}
          </p>
        )}

        {status === "working" && <NativeLoadingState isLight={isLight} message={t("worldBizBenches400.socialKitStateLoading")} />}
        {status === "failed" && (
          <NativeErrorState
            isLight={isLight}
            message={error ?? t("worldBizBenches400.socialKitStateError")}
            onRetry={() => void generate()}
          />
        )}
        {status === "idle" && assets.length === 0 && (
          <NativeEmptyState isLight={isLight} message={t("worldBizBenches400.socialKitStateEmpty")} />
        )}

        {assets.length > 0 && (
          <div data-testid="world-social-kit-result">
            <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
              <CheckCircle2 className="h-4 w-4 text-green-500" /> {t("hubSpine.socialKit.resultsTitle")}
            </p>
            <p className={`mt-1 text-xs ${muted}`}>
              {t("hubSpine.socialKit.doneDesc", { count: savedCount })}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {assets.map((a, i) =>
                a.url ? (
                  <div key={i} className={`overflow-hidden rounded-xl border ${cardCls}`}>
                    <img src={a.url} alt={a.label ?? `Asset ${i + 1}`} className="aspect-square w-full object-cover" loading="lazy" />
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <p className={`truncate text-[11px] ${muted}`}>{a.label ?? a.kind ?? t("hubSpine.socialKit.assetLabel", { n: i + 1 })}</p>
                      <a
                        href={a.url}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-[#d4af37] hover:underline"
                        aria-label={t("hubSpine.socialKit.downloadAria")}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                ) : null,
              )}
            </div>
            {project.attribution && (
              <p className={`mt-3 text-[10px] ${muted}`}>{t("hubSpine.madeWith")}</p>
            )}
          </div>
        )}
      </div>
    </NativeCard>
  );
}
