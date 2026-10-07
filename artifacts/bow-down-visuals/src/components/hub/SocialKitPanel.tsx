import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Palette, Loader2, Check, AlertCircle, Copy, Download } from "lucide-react";
import { useHubProject } from "@/lib/hub-project";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";

/* ─── SocialKitPanel ────────────────────────────────────────────────────────
   Frontend for the orphaned POST /api/social-kit backend: generates a full
   social brand kit (profile picture, YouTube banner, X header, Instagram
   highlight covers) in the project's gold-luxury style. Brand name and
   tagline prefill from the hub project — no re-typing. Every asset saves
   back into the project so the scheduler and promo tools can grab them. */

const STYLES = [
  { id: "gold-luxury", labelKey: "hubSpine.socialKit.styleGold" },
  { id: "neon-pop", labelKey: "hubSpine.socialKit.styleNeon" },
  { id: "minimal", labelKey: "hubSpine.socialKit.styleMinimal" },
] as const;

interface KitAsset {
  url?: string;
  kind?: string;
  label?: string;
}

export function SocialKitPanel() {
  const { t } = useTranslation();
  const { project, addAsset, getShareLink } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [brandName, setBrandName] = useState(project.name && project.name !== "Untitled Project" ? project.name : "");
  const [tagline, setTagline] = useState(project.concept.slice(0, 120));
  const [style, setStyle] = useState<string>("gold-luxury");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<KitAsset[]>([]);
  const [copied, setCopied] = useState(false);

  async function generate() {
    if (!brandName.trim() || !tagline.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/social-kit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandName: brandName.trim(), tagline: tagline.trim(), style }),
      });
      if (!res) {
        setLoading(false); // user cancelled the credit confirmation
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        assets?: KitAsset[];
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error ?? data.message ?? t("hubSpine.socialKit.failed"));
      const list = Array.isArray(data.assets) ? data.assets : [];
      if (list.length === 0) throw new Error(t("hubSpine.handoffs.noOutput"));
      setAssets(list);
      /* Spine: every kit asset lands in the hub project. */
      list.forEach((a, i) => {
        if (!a.url) return;
        addAsset({
          kind: "image",
          url: a.url,
          label: a.label ?? t("hubSpine.socialKit.assetLabel", { n: i + 1 }),
          detail: a.kind ?? brandName.trim(),
          meta: { sourceAsset: "social-kit", handoff: "social-kit", brand: brandName.trim() },
        });
      });
      toast({ title: t("hubSpine.socialKit.doneTitle"), description: t("hubSpine.socialKit.doneDesc", { count: list.length }) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("hubSpine.socialKit.failed");
      setError(msg === "out_of_credits" ? t("hubSpine.handoffs.outOfCredits") : msg);
    } finally {
      setLoading(false);
    }
  }

  function copyShareLink() {
    navigator.clipboard.writeText(getShareLink()).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast({ title: t("hubSpine.handoffs.copyFailedTitle"), variant: "destructive" })
    );
  }

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-transparent p-6 md:p-8">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
          <Palette className="h-4 w-4" /> {t("hubSpine.socialKit.title")}
        </p>
        <button
          type="button"
          onClick={copyShareLink}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-white/50 hover:text-primary transition-colors"
          title={t("hubSpine.handoffs.copyShareTitle")}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("hubSpine.handoffs.copied") : t("hubSpine.handoffs.copyShare")}
        </button>
      </div>
      <p className="text-xs text-white/40 mb-5">{t("hubSpine.socialKit.blurb")}</p>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-white/45 mb-2">
            {t("hubSpine.socialKit.brandLabel")}
          </label>
          <input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder={t("hubSpine.socialKit.brandPlaceholder")}
            maxLength={60}
            className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60"
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-white/45 mb-2">
            {t("hubSpine.socialKit.taglineLabel")}
          </label>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder={t("hubSpine.socialKit.taglinePlaceholder")}
            maxLength={120}
            className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStyle(s.id)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              style === s.id
                ? "bg-primary text-black"
                : "bg-white/5 text-white/60 hover:bg-white/10 border border-white/10"
            }`}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-red-300/90 mb-4">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" /> {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void generate()}
        disabled={!brandName.trim() || !tagline.trim() || loading}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
      >
        {loading ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> {t("hubSpine.socialKit.generating")}</>
        ) : (
          <><Palette className="h-4 w-4" /> {t("hubSpine.socialKit.generate")}</>
        )}
      </button>
      <p className="text-[11px] text-white/30 mt-2">{t("hubSpine.socialKit.costNote")}</p>

      {assets.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-widest text-white/45 mb-3">
            {t("hubSpine.socialKit.resultsTitle")}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {assets.map((a, i) =>
              a.url ? (
                <div key={i} className="rounded-xl overflow-hidden border border-white/10 bg-black/40">
                  <img src={a.url} alt={a.label ?? `Asset ${i + 1}`} className="w-full aspect-square object-cover" loading="lazy" />
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <p className="text-[11px] text-white/60 truncate">{a.label ?? a.kind ?? `Asset ${i + 1}`}</p>
                    <a href={a.url} download target="_blank" rel="noreferrer" className="text-primary hover:underline shrink-0" aria-label={t("hubSpine.socialKit.downloadAria")}>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              ) : null
            )}
          </div>
          {project.attribution && (
            <p className="mt-3 text-[10px] text-white/30">{t("hubSpine.madeWith")}</p>
          )}
        </div>
      )}
    </div>
  );
}
