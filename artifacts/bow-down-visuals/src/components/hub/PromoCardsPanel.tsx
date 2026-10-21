import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Megaphone, Loader2, Check, AlertCircle, Copy, Download,
  CalendarClock, Share2, FolderPlus, Image as ImageIcon, History, Trash2,
} from "lucide-react";
import { useHubProject } from "@/lib/hub-project";
import { buildSchedulerHref } from "@/lib/scheduler-handoff";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { downloadImage } from "@/lib/download-image";
import {
  normalizePromoCardHistory,
  removePromoCard,
  promoCardFileName,
  promoCardShareText,
  promoCardSharePayload,
  promoCardScheduleHref,
  promoCardDateLabel,
  type PromoCardHistoryItem,
} from "@/lib/promo-card-history";

/* ─── PromoCardsPanel ───────────────────────────────────────────────────────
   DistroKid promo-cards parity, docked inside the social-kit flow on
   /promote (right after SocialKitPanel — no new sidebar items).
   AI-designed release promo cards: one style (announcement / out-now /
   pre-save / milestone) × three platform sizes (1:1, 9:16, 16:9) per pack.
   100 Visual Bucs per pack: the credit-cost registry drives the confirm
   popup, the backend does the 402 pre-check → charge → auto-refund.

   Handoffs:
   - /distribute "Make promo cards" and the /presave/:slug page link here
     via /promote?promoTitle=…&promoArtist=…&promoArt=…#promo-cards.
   - Each card: Download, "Schedule" (scheduler prefill deep link), one-click
     Share, and "Add to release assets" (hub project tray). */

const STYLE_IDS = ["announcement", "out-now", "pre-save", "milestone"] as const;
type StyleId = (typeof STYLE_IDS)[number];

const SIZE_IDS = ["1:1", "9:16", "16:9"] as const;
type SizeId = (typeof SIZE_IDS)[number];

interface PromoCard {
  /** History row id once the server has recorded the card (0161);
      null when the record write didn't land — the card still works,
      it just can't be listed or deleted from history later. */
  id?: string | null;
  style: string;
  size: string;
  url: string;
  storageRef?: string;
  width: number;
  height: number;
  platforms: string[];
}

function readQueryParam(name: string): string {
  try {
    return new URLSearchParams(window.location.search).get(name) ?? "";
  } catch {
    return "";
  }
}

export function PromoCardsPanel() {
  const { t } = useTranslation();
  const { project, addAsset } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();

  const queryTitle = useMemo(() => readQueryParam("promoTitle"), []);
  const queryArtist = useMemo(() => readQueryParam("promoArtist"), []);
  const queryArt = useMemo(() => readQueryParam("promoArt"), []);

  const projectImages = useMemo(
    () => project.assets.filter((a) => a.kind === "image" && a.url && !a.url.startsWith("blob:")),
    [project.assets]
  );

  const [releaseTitle, setReleaseTitle] = useState(
    queryTitle || (project.name && project.name !== "Untitled Project" ? project.name : "")
  );
  const [artistName, setArtistName] = useState(queryArtist);
  const [style, setStyle] = useState<StyleId>("out-now");
  const [sizes, setSizes] = useState<SizeId[]>(["1:1", "9:16", "16:9"]);
  const [coverArt, setCoverArt] = useState<string>(
    queryArt || projectImages[0]?.url || ""
  );
  const [milestoneLabel, setMilestoneLabel] = useState("1M STREAMS");
  const [attribution, setAttribution] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<PromoCard[]>([]);
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);
  const [sharedIdx, setSharedIdx] = useState<number | null>(null);

  /* ─── History (STACK-20 R2 #17) ───────────────────────────────────────
     Every pack the server recorded for this creator (GET /api/promo-
     cards), docked under the maker that produces them. The list is
     the server's truth: loading / failed-with-retry / truly-empty are
     distinct states, and a card leaves the list only after the server
     confirms its delete. */
  const [history, setHistory] = useState<PromoCardHistoryItem[]>([]);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "failed">("loading");
  const [historyLimit, setHistoryLimit] = useState<number | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [historySharedId, setHistorySharedId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryState("loading");
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/promo-cards", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error("history");
      const page = normalizePromoCardHistory(await res.json().catch(() => null));
      setHistory(page.cards);
      setHistoryLimit(page.limit);
      setHistoryHasMore(page.hasMore);
      setHistoryState("ready");
    } catch {
      setHistoryState("failed");
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function deleteHistoryCard(card: PromoCardHistoryItem) {
    if (deletingId) return;
    setDeletingId(card.id);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/promo-cards/${card.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error("delete");
      /* Only a server-confirmed delete removes the card on screen. */
      setHistory((prev) => removePromoCard(prev, card.id));
      setConfirmDeleteId(null);
      toast({ title: t("hubSpine.promoCards.historyDeleted") });
    } catch {
      toast({ title: t("hubSpine.promoCards.historyDeleteFailed"), variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  async function shareHistoryCard(card: PromoCardHistoryItem) {
    const text = promoCardShareText(card);
    const channel = typeof navigator !== "undefined" && "share" in navigator ? "native" : "copy";
    try {
      if (channel === "native") {
        await navigator.share({ title: `${card.releaseTitle} — ${card.artistName}`, text, url: card.url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${card.url}`);
      }
      setHistorySharedId(card.id);
      setTimeout(() => setHistorySharedId(null), 2000);
    } catch {
      /* user dismissed — and a dismissed share is not a share, so
         nothing is tracked for it below */
      return;
    }
    /* Ride the share rail so the action counts like every other
       share on the site. The card is an image with a server record,
       so it rides the rail's "image" type with its history id as
       the content id — the same shape cover-art shares use.
       Fire-and-forget: tracking never blocks or breaks sharing. */
    try {
      const token = await getAccessToken();
      await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify(promoCardSharePayload(card, channel)),
      });
    } catch { /* tracking is a passenger, never the driver */ }
  }

  /* The history card's own scheduler handoff: the card is the post's
     media (an image, declared as one), captioned with the words that
     travel with the card, on the platforms it was sized for. */
  function scheduleHistoryCard(card: PromoCardHistoryItem) {
    window.location.href = promoCardScheduleHref(card);
  }

  /* The history card joins the release assets exactly as a fresh card
     does — from the card's OWN recorded title/artist, not the maker
     form's current values. */
  function addHistoryCardToAssets(card: PromoCardHistoryItem) {
    addAsset({
      kind: "image",
      url: card.url,
      label: t("hubSpine.promoCards.assetLabel", { style: t(`hubSpine.promoCards.styles.${card.style}`), size: card.size }),
      detail: `${card.releaseTitle} — ${card.artistName}`,
      meta: { sourceAsset: "promo-cards", handoff: "promo-cards", style: card.style, size: card.size },
    });
  }

  /* Deep-link: /promote#promo-cards scrolls straight to this panel. */
  useEffect(() => {
    try {
      if (window.location.hash === "#promo-cards") {
        document.getElementById("promo-cards")?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    } catch { /* non-browser — ignore */ }
  }, []);

  function toggleSize(id: SizeId) {
    setSizes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function generate() {
    if (!releaseTitle.trim() || !artistName.trim() || sizes.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/promo-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseTitle: releaseTitle.trim(),
          artistName: artistName.trim(),
          style,
          sizes,
          coverArtUrl: coverArt.trim() || undefined,
          milestoneLabel: style === "milestone" ? milestoneLabel.trim() || "1M STREAMS" : undefined,
          attribution,
        }),
      });
      if (!res) {
        setLoading(false); // user cancelled the credit confirmation
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        cards?: PromoCard[];
        suggestedCaption?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error ?? data.message ?? t("hubSpine.promoCards.failed"));
      const list = Array.isArray(data.cards) ? data.cards : [];
      if (list.length === 0) throw new Error(t("hubSpine.handoffs.noOutput"));
      setCards(list);
      setCaption(data.suggestedCaption ?? "");
      toast({ title: t("hubSpine.promoCards.doneTitle"), description: t("hubSpine.promoCards.doneDesc", { count: list.length }) });
      /* The pack was recorded server-side in the same request — pull
         the history list back so the new cards stand in it too. */
      void loadHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("hubSpine.promoCards.failed");
      setError(msg === "out_of_credits" ? t("hubSpine.handoffs.outOfCredits") : msg);
    } finally {
      setLoading(false);
    }
  }

  function scheduleCard(card: PromoCard) {
    window.location.href = buildSchedulerHref({
      caption: caption || `${releaseTitle} — ${artistName}`,
      media: card.url,
      /* A promo card is an image — without this the handoff's
         default labels the post's media as a video. */
      mediaType: "image",
      platforms: card.platforms,
    });
  }

  function addCardToAssets(card: PromoCard) {
    addAsset({
      kind: "image",
      url: card.url,
      label: t("hubSpine.promoCards.assetLabel", { style: t(`hubSpine.promoCards.styles.${card.style}`), size: card.size }),
      detail: `${releaseTitle} — ${artistName}`,
      meta: { sourceAsset: "promo-cards", handoff: "promo-cards", style: card.style, size: card.size },
    });
  }

  function addAllToAssets() {
    cards.forEach(addCardToAssets);
    toast({ title: t("hubSpine.promoCards.addedTitle"), description: t("hubSpine.promoCards.addedDesc", { count: cards.length }) });
  }

  async function shareCard(card: PromoCard, idx: number) {
    const text = caption || `${releaseTitle} — ${artistName}`;
    const channel = typeof navigator !== "undefined" && "share" in navigator ? "native" : "copy";
    try {
      if (channel === "native") {
        await navigator.share({ title: `${releaseTitle} — ${artistName}`, text, url: card.url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${card.url}`);
      }
      setSharedIdx(idx);
      setTimeout(() => setSharedIdx(null), 2000);
    } catch {
      /* user dismissed — and a dismissed share is not a share, so
         nothing is tracked for it below */
      return;
    }
    /* Ride the share rail like the history share below does — a
       fresh pack's share counts the same as any other. The card
       rides as "image"; its content id is its history record id,
       or null when the record write didn't land.
       Fire-and-forget: tracking never blocks or breaks sharing. */
    try {
      const token = await getAccessToken();
      await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify(promoCardSharePayload(card, channel)),
      });
    } catch { /* tracking is a passenger, never the driver */ }
  }

  function copyCaption() {
    if (!caption) return;
    navigator.clipboard.writeText(caption).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast({ title: t("hubSpine.handoffs.copyFailedTitle"), variant: "destructive" })
    );
  }

  const canGenerate = releaseTitle.trim().length >= 2 && artistName.trim().length >= 2 && sizes.length > 0 && !loading;
  const styleLabel = (id: string) => t(`hubSpine.promoCards.styles.${id}`, { defaultValue: id });

  return (
    <div id="promo-cards" className="scroll-mt-24 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-transparent p-6 md:p-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary">
          <Megaphone className="h-4 w-4" /> {t("hubSpine.promoCards.title")}
        </p>
        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[11px] font-bold text-primary">
          {t("hubSpine.promoCards.priceBadge")}
        </span>
      </div>
      <p className="mb-6 max-w-2xl text-sm text-white/55">{t("hubSpine.promoCards.blurb")}</p>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">
            {t("hubSpine.promoCards.releaseLabel")}
          </label>
          <input
            value={releaseTitle}
            onChange={(e) => setReleaseTitle(e.target.value)}
            placeholder={t("hubSpine.promoCards.releasePlaceholder")}
            maxLength={60}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">
            {t("hubSpine.promoCards.artistLabel")}
          </label>
          <input
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
            placeholder={t("hubSpine.promoCards.artistPlaceholder")}
            maxLength={60}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/50">{t("hubSpine.promoCards.styleLabel")}</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {STYLE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setStyle(id)}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${
                style === id
                  ? "border-primary bg-primary/15 shadow-[0_0_18px_rgba(232,182,76,0.25)]"
                  : "border-white/10 bg-black/30 hover:border-primary/40"
              }`}
            >
              <span className={`block text-sm font-black ${style === id ? "text-primary" : "text-white/80"}`}>
                {styleLabel(id)}
              </span>
              <span className="mt-0.5 block text-[11px] leading-tight text-white/40">
                {t(`hubSpine.promoCards.styleBlurb.${id}`)}
              </span>
            </button>
          ))}
        </div>
        {style === "milestone" && (
          <div className="mt-3 max-w-xs">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">
              {t("hubSpine.promoCards.milestoneLabel")}
            </label>
            <input
              value={milestoneLabel}
              onChange={(e) => setMilestoneLabel(e.target.value.toUpperCase())}
              maxLength={24}
              placeholder="1M STREAMS"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm font-black uppercase text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
            />
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/50">{t("hubSpine.promoCards.sizesLabel")}</p>
          <div className="flex flex-wrap gap-2">
            {SIZE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleSize(id)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
                  sizes.includes(id)
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-white/10 bg-black/30 text-white/50 hover:border-primary/40"
                }`}
              >
                {sizes.includes(id) && <Check className="h-3.5 w-3.5" />}
                {id}
                <span className="font-normal opacity-60">{t(`hubSpine.promoCards.sizeHint.${id.replace(":", "x")}`)}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/50">
            {t("hubSpine.promoCards.coverLabel")}
          </label>
          {projectImages.length > 0 ? (
            <select
              value={coverArt}
              onChange={(e) => setCoverArt(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white focus:border-primary/60 focus:outline-none"
            >
              <option value="">{t("hubSpine.promoCards.coverNone")}</option>
              {projectImages.map((a) => (
                <option key={a.id} value={a.url}>{a.label || a.url.slice(-32)}</option>
              ))}
            </select>
          ) : (
            <input
              value={coverArt}
              onChange={(e) => setCoverArt(e.target.value)}
              placeholder={t("hubSpine.promoCards.coverPlaceholder")}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
            />
          )}
          {coverArt && (
            <div className="mt-2 flex items-center gap-2">
              <img src={coverArt} alt="" className="h-10 w-10 rounded-lg border border-white/10 object-cover" />
              <span className="text-xs text-white/40">{t("hubSpine.promoCards.coverPreview")}</span>
            </div>
          )}
        </div>
      </div>

      <label className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-4 py-3">
        <input
          type="checkbox"
          checked={attribution}
          onChange={(e) => setAttribution(e.target.checked)}
          className="h-4 w-4 accent-[#E8B64C]"
        />
        <span className="text-sm text-white/70">{t("hubSpine.promoCards.attributionLabel")}</span>
      </label>

      <button
        onClick={generate}
        disabled={!canGenerate}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
        {loading ? t("hubSpine.promoCards.generating") : t("hubSpine.promoCards.generate")}
      </button>
      <p className="mt-2 text-xs text-white/35">{t("hubSpine.promoCards.costNote")}</p>

      {error && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {cards.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black uppercase tracking-widest text-white/70">
              {t("hubSpine.promoCards.resultsTitle")}
            </p>
            <button
              onClick={addAllToAssets}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/10"
            >
              <FolderPlus className="h-3.5 w-3.5" /> {t("hubSpine.promoCards.addAll")}
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card, i) => (
              <div key={`${card.style}-${card.size}`} className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                <img src={card.url} alt={t("hubSpine.promoCards.cardAlt", { style: styleLabel(card.style), size: card.size })} className="aspect-square w-full object-cover" loading="lazy" />
                <div className="p-3">
                  <p className="mb-2 text-xs font-bold text-white/60">
                    {styleLabel(card.style)} · {card.size} · {card.width}×{card.height}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => downloadImage(card.url, `promo-card-${card.style}-${card.size.replace(":", "x")}.png`)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-2 text-xs font-black text-black transition hover:brightness-110"
                    >
                      <Download className="h-3.5 w-3.5" /> {t("hubSpine.promoCards.download")}
                    </button>
                    <button
                      onClick={() => scheduleCard(card)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 py-2 text-xs font-bold text-white/75 transition hover:border-primary/50 hover:text-primary"
                    >
                      <CalendarClock className="h-3.5 w-3.5" /> {t("hubSpine.promoCards.schedule")}
                    </button>
                    <button
                      onClick={() => shareCard(card, i)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 py-2 text-xs font-bold text-white/75 transition hover:border-primary/50 hover:text-primary"
                    >
                      {sharedIdx === i ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Share2 className="h-3.5 w-3.5" />}
                      {t("hubSpine.promoCards.share")}
                    </button>
                    <button
                      onClick={() => addCardToAssets(card)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 py-2 text-xs font-bold text-white/75 transition hover:border-primary/50 hover:text-primary"
                    >
                      <ImageIcon className="h-3.5 w-3.5" /> {t("hubSpine.promoCards.addToAssets")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-widest text-white/50">
                {t("hubSpine.promoCards.captionLabel")}
              </p>
              <button
                onClick={copyCaption}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs font-bold text-white/70 transition hover:border-primary/50 hover:text-primary"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("hubSpine.promoCards.copied") : t("hubSpine.promoCards.copy")}
              </button>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              maxLength={280}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
            />
            <p className="mt-1 text-right text-[11px] text-white/30">{caption.length}/280</p>
          </div>
        </div>
      )}

      {/* ─── History: every recorded pack, newest first ─────────────── */}
      <div className="mt-10 border-t border-white/10 pt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-white/70">
            <History className="h-4 w-4 text-primary" /> {t("hubSpine.promoCards.historyTitle")}
          </p>
          {historyState === "ready" && history.length > 0 && (
            <span className="text-xs font-bold text-white/40">{history.length}</span>
          )}
        </div>

        {historyState === "loading" && (
          <p className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("hubSpine.promoCards.historyLoading")}
          </p>
        )}

        {historyState === "failed" && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="flex items-center gap-2 text-sm text-red-200">
              <AlertCircle className="h-4 w-4 shrink-0" /> {t("hubSpine.promoCards.historyFailed")}
            </p>
            <button
              onClick={() => void loadHistory()}
              className="rounded-lg border border-red-300/40 px-3 py-1.5 text-xs font-bold text-red-100 transition hover:bg-red-500/10"
            >
              {t("hubSpine.promoCards.historyRetry")}
            </button>
          </div>
        )}

        {historyState === "ready" && history.length === 0 && (
          <p className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/45">
            {t("hubSpine.promoCards.historyEmpty")}
          </p>
        )}

        {historyState === "ready" && history.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {history.map((card) => (
                <div key={card.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                  <a
                    href={card.url}
                    target="_blank"
                    rel="noreferrer"
                    title={t("hubSpine.promoCards.historyOpen")}
                    className="block"
                  >
                    <img
                      src={card.url}
                      alt={t("hubSpine.promoCards.cardAlt", { style: styleLabel(card.style), size: card.size })}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                  </a>
                  <div className="p-3">
                    <p className="truncate text-sm font-bold text-white/85">
                      {t("hubSpine.promoCards.historyForRelease", { title: card.releaseTitle, artist: card.artistName })}
                    </p>
                    <p className="mb-2 mt-0.5 text-xs font-bold text-white/50">
                      {styleLabel(card.style)} · {card.size} · {card.width}×{card.height}
                      {promoCardDateLabel(card.createdAt) ? ` · ${promoCardDateLabel(card.createdAt)}` : ""}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => downloadImage(card.url, promoCardFileName(card))}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-2 py-2 text-xs font-black text-black transition hover:brightness-110"
                      >
                        <Download className="h-3.5 w-3.5" /> {t("hubSpine.promoCards.download")}
                      </button>
                      <button
                        onClick={() => scheduleHistoryCard(card)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 py-2 text-xs font-bold text-white/75 transition hover:border-primary/50 hover:text-primary"
                      >
                        <CalendarClock className="h-3.5 w-3.5" /> {t("hubSpine.promoCards.schedule")}
                      </button>
                      <button
                        onClick={() => void shareHistoryCard(card)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 py-2 text-xs font-bold text-white/75 transition hover:border-primary/50 hover:text-primary"
                      >
                        {historySharedId === card.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Share2 className="h-3.5 w-3.5" />}
                        {t("hubSpine.promoCards.share")}
                      </button>
                      <button
                        onClick={() => addHistoryCardToAssets(card)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 py-2 text-xs font-bold text-white/75 transition hover:border-primary/50 hover:text-primary"
                      >
                        <ImageIcon className="h-3.5 w-3.5" /> {t("hubSpine.promoCards.addToAssets")}
                      </button>
                      {confirmDeleteId === card.id ? (
                        <button
                          onClick={() => void deleteHistoryCard(card)}
                          disabled={deletingId === card.id}
                          className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-400/60 bg-red-500/15 px-2 py-2 text-xs font-black text-red-200 transition hover:bg-red-500/25 disabled:opacity-50"
                        >
                          {deletingId === card.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          {t("hubSpine.promoCards.historyConfirmDelete")}
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(card.id)}
                          className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-2 py-2 text-xs font-bold text-white/75 transition hover:border-red-400/50 hover:text-red-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t("hubSpine.promoCards.historyDelete")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {historyHasMore && historyLimit !== null && (
              <p className="mt-3 text-xs text-white/35">
                {t("hubSpine.promoCards.historyMoreNote", { limit: historyLimit })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
