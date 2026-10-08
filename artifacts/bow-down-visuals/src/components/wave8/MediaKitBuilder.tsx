import { useEffect, useState } from "react";
import { Loader2, Sparkles, Download, Link2, Check, Copy, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";
import { slugifyHandle } from "@/lib/press-kit";
import jsPDF from "jspdf";

/* ─── Wave 8: AI Media Kit Builder ─────────────────────────────────────────
   Docked on the press kit page. AI writes a punchy 150-word bio in the
   vault's voice + a suggested rate card (100 VB). Renders a gold/black
   one-page preview; PDF is built client-side with jsPDF (black background,
   gold headings). The shareable link follows the /press/:handle pattern —
   it goes live when a press kit is published at that handle. */

interface MediaKitRate {
  tier: string;
  price: string;
}

interface MediaKit {
  artistName: string;
  tagline: string;
  bio: string;
  audience: string;
  rates: MediaKitRate[];
  contact: string;
  stats: { genre: string; artistType: string; visualStyle: string; voiceStyle: string };
  generatedAt: string;
}

interface VaultOption {
  id: string;
  artist_name: string;
  genre?: string | null;
}

const KIT_COST = 100;
const GOLD: [number, number, number] = [212, 175, 55];

/** Build a clean one-page media kit PDF: black background, gold headings. */
function buildMediaKitPdf(kit: MediaKit): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const H = 297;
  const M = 18; // margin
  let y = 0;

  // black page
  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, W, H, "F");

  // top gold rule
  doc.setFillColor(...GOLD);
  doc.rect(0, 0, W, 4, "F");
  y = 18;

  const goldHeading = (text: string, size = 11) => {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(...GOLD);
    doc.text(text.toUpperCase(), M, y);
    y += 2;
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.4);
    doc.line(M, y, M + 40, y);
    y += 6;
  };

  // artist name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(255, 255, 255);
  const nameLines = doc.splitTextToSize(kit.artistName, W - M * 2);
  doc.text(nameLines, M, y);
  y += nameLines.length * 10;

  if (kit.tagline) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(12);
    doc.setTextColor(200, 200, 200);
    const tagLines = doc.splitTextToSize(kit.tagline, W - M * 2);
    doc.text(tagLines, M, y);
    y += tagLines.length * 6;
  }

  // bio
  goldHeading("Bio");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(230, 230, 230);
  const bioLines = doc.splitTextToSize(kit.bio, W - M * 2).slice(0, 18);
  doc.text(bioLines, M, y);
  y += bioLines.length * 5;

  // audience
  if (kit.audience) {
    goldHeading("Audience");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(230, 230, 230);
    const audLines = doc.splitTextToSize(kit.audience, W - M * 2).slice(0, 8);
    doc.text(audLines, M, y);
    y += audLines.length * 5;
  }

  // rate card
  goldHeading("Rate Card");
  kit.rates.slice(0, 5).forEach((r) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(r.tier, M, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GOLD);
    doc.text(r.price, W - M, y, { align: "right" });
    y += 7;
  });

  // contact
  if (kit.contact) {
    goldHeading("Booking Contact");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(kit.contact, M, y);
    y += 8;
  }

  // stats strip
  const statBits = [kit.stats.genre, kit.stats.artistType, kit.stats.visualStyle]
    .filter(Boolean)
    .join("  ·  ");
  if (statBits) {
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(doc.splitTextToSize(statBits, W - M * 2), M, y);
  }

  // footer
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text("Built with Bow Down Visuals — The Content Creation Cheat Code", W / 2, H - 12, {
    align: "center",
  });
  doc.text(new Date(kit.generatedAt).toLocaleDateString(), W / 2, H - 8, { align: "center" });

  return doc;
}

export default function MediaKitBuilder() {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();

  const [vaults, setVaults] = useState<VaultOption[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [building, setBuilding] = useState(false);
  const [kit, setKit] = useState<MediaKit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkLive, setLinkLive] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/artist-vaults", { credentials: "include" });
        if (res.ok) {
          const v = await res.json();
          setVaults(v.vaults ?? v ?? []);
        }
      } catch {
        /* non-fatal — the server falls back to profile basics */
      }
    })();
  }, []);

  /* Check whether a public press kit exists at this handle so the
     shareable link can say honestly whether it's live. */
  useEffect(() => {
    if (!kit) { setLinkLive(null); return; }
    const handle = slugifyHandle(kit.artistName);
    if (!handle) { setLinkLive(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/press-kit/public/${encodeURIComponent(handle)}`);
        if (!cancelled) setLinkLive(res.ok);
      } catch {
        if (!cancelled) setLinkLive(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kit]);

  async function handleBuild() {
    setError(null);
    setOutOfCredits(false);
    setBuilding(true);
    try {
      const res = await confirmedFetch("/api/wave8/media-kit/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(vaultId ? { vaultId } : {}),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = await res.json();
      if (res.status === 402) { setOutOfCredits(true); return; }
      if (res.status === 503) { setError(data.message || data.error); return; }
      if (!res.ok) { setError(data.message || data.error || t("wave8.mediaKit.errors.buildFailed")); return; }
      setKit(data.kit as MediaKit);
    } catch {
      setError(t("wave8.mediaKit.errors.network"));
    } finally {
      setBuilding(false);
    }
  }

  function downloadPdf() {
    if (!kit) return;
    const doc = buildMediaKitPdf(kit);
    doc.save(`${slugifyHandle(kit.artistName) || "media-kit"}-media-kit.pdf`);
  }

  const handle = kit ? slugifyHandle(kit.artistName) : "";
  const publicUrl = handle ? `${window.location.origin}/press/${handle}` : "";

  function copyLink() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-neutral-900 via-black to-neutral-900">
      <div className="p-6 md:p-8">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" /> {t("wave8.mediaKit.badge")}
        </div>
        <h2 className="text-2xl font-black">{t("wave8.mediaKit.title")}</h2>
        <p className="mt-2 max-w-2xl text-sm text-white/50">{t("wave8.mediaKit.subtitle")}</p>

        {outOfCredits && (
          <div className="mt-4">
            <OutOfCredits />
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-end gap-4">
          {vaults.length > 0 && (
            <div className="min-w-[220px]">
              <label className="mb-1.5 block text-xs font-semibold text-white/60">{t("wave8.mediaKit.vaultLabel")}</label>
              <select
                value={vaultId}
                onChange={(e) => setVaultId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black px-4 py-2.5 text-sm text-white focus:border-[#d4af37]/60 focus:outline-none"
              >
                <option value="">{t("wave8.mediaKit.vaultNone")}</option>
                {vaults.map((v) => (
                  <option key={v.id} value={v.id}>{v.artist_name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={handleBuild}
            disabled={building}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {building ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("wave8.mediaKit.building")}
              </>
            ) : (
              <>
                {kit ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                {kit ? t("wave8.mediaKit.rebuild") : t("wave8.mediaKit.buildButton", { cost: KIT_COST })}
              </>
            )}
          </button>
        </div>

        {kit && (
          <div className="mt-8">
            {/* one-page kit preview — gold/black */}
            <div className="overflow-hidden rounded-2xl border border-[#d4af37]/30 bg-black">
              <div className="h-1.5 bg-gradient-to-r from-amber-600 via-[#d4af37] to-amber-600" />
              <div className="p-6 md:p-10">
                <p className="mb-2 text-xs uppercase tracking-[0.3em] text-[#d4af37]">{t("wave8.mediaKit.epkLabel")}</p>
                <h3 className="text-3xl font-black text-white md:text-4xl">{kit.artistName}</h3>
                {kit.tagline && <p className="mt-2 text-lg italic text-white/60">{kit.tagline}</p>}

                <h4 className="mt-8 text-sm font-semibold uppercase tracking-wider text-[#d4af37]">
                  {t("wave8.mediaKit.bioTitle")}
                </h4>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/85">{kit.bio}</p>

                {kit.audience && (
                  <>
                    <h4 className="mt-6 text-sm font-semibold uppercase tracking-wider text-[#d4af37]">
                      {t("wave8.mediaKit.audienceTitle")}
                    </h4>
                    <p className="mt-2 text-sm leading-relaxed text-white/70">{kit.audience}</p>
                  </>
                )}

                <h4 className="mt-6 text-sm font-semibold uppercase tracking-wider text-[#d4af37]">
                  {t("wave8.mediaKit.ratesTitle")}
                </h4>
                <div className="mt-2 overflow-hidden rounded-xl border border-white/10">
                  {kit.rates.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-white/5 px-5 py-3 last:border-0"
                    >
                      <span className="text-sm text-white/80">{r.tier}</span>
                      <span className="text-sm font-bold text-[#d4af37]">{r.price}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-xl border border-[#d4af37]/25 bg-[#d4af37]/[0.05] p-5 text-center">
                  <h4 className="text-sm font-semibold uppercase tracking-wider text-[#d4af37]">
                    {t("wave8.mediaKit.contactTitle")}
                  </h4>
                  {kit.contact ? (
                    <p className="mt-2 text-sm font-semibold text-white">{kit.contact}</p>
                  ) : (
                    <p className="mt-2 text-xs text-white/40">{t("wave8.mediaKit.contactMissing")}</p>
                  )}
                  {[kit.stats.genre, kit.stats.artistType, kit.stats.visualStyle].filter(Boolean).length > 0 && (
                    <p className="mt-2 text-xs text-white/40">
                      {[kit.stats.genre, kit.stats.artistType, kit.stats.visualStyle].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <p className="mt-3 text-[11px] text-white/30">
                    {t("wave8.mediaKit.generatedOn", { date: new Date(kit.generatedAt).toLocaleDateString() })}
                  </p>
                </div>
              </div>
            </div>

            {/* actions */}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={downloadPdf}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110"
              >
                <Download className="h-4 w-4" /> {t("wave8.mediaKit.downloadPdf")}
              </button>
              {publicUrl && (
                <button
                  onClick={copyLink}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 transition hover:border-[#d4af37]/50"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  {copied ? t("wave8.mediaKit.copied") : t("wave8.mediaKit.copyLink")}
                </button>
              )}
            </div>

            {/* shareable link */}
            {publicUrl && (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-white/60">
                  <Link2 className="h-3.5 w-3.5 text-[#d4af37]" />
                  {t("wave8.mediaKit.shareTitle")}
                </div>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block truncate text-sm text-[#d4af37] hover:underline"
                >
                  {publicUrl}
                </a>
                <p className="mt-1 text-xs text-white/35">
                  {linkLive === null
                    ? ""
                    : linkLive
                      ? t("wave8.mediaKit.linkLive")
                      : t("wave8.mediaKit.linkPending")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
