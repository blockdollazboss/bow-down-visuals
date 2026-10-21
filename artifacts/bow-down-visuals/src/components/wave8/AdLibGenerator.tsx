import { useEffect, useState } from "react";
import { Mic2, Loader2, AlertTriangle, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

interface AdLibItem {
  line: string;
  placement: string;
  delivery: string;
}

interface Stack {
  description: string;
  voices: string;
}

interface Take {
  style: string;
  notes: string;
}

interface AdLibResult {
  adlibs: AdLibItem[];
  stacks: Stack[];
  takeA: Take;
  takeB: Take;
  creditsUsed?: number;
  creditsRemaining?: number;
}

interface AdLibGeneratorProps {
  lyrics?: string | null;
  songTitle?: string | null;
  artistName?: string | null;
  vaultVoice?: string | null;
}

type Energy = "chill" | "hype" | "dark";

const ENERGIES: Energy[] = ["chill", "hype", "dark"];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export function AdLibGenerator({ lyrics, songTitle, artistName, vaultVoice }: AdLibGeneratorProps) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();

  const [open, setOpen] = useState(true);
  const [lyricsText, setLyricsText] = useState(lyrics ?? "");
  const [titleText, setTitleText] = useState(songTitle ?? "");
  const [voiceText, setVoiceText] = useState(vaultVoice ?? "");
  const [energy, setEnergy] = useState<Energy>("hype");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<AdLibResult | null>(null);
  const [activeTake, setActiveTake] = useState<"A" | "B">("A");
  const [sent, setSent] = useState(false);

  /* Sync props when the project/transcript loads after mount. */
  useEffect(() => {
    if (lyrics && !lyricsText) setLyricsText(lyrics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyrics]);
  useEffect(() => {
    if (songTitle && !titleText) setTitleText(songTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songTitle]);
  useEffect(() => {
    if (vaultVoice && !voiceText) setVoiceText(vaultVoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultVoice]);

  async function generate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setSent(false);
    try {
      const res = await confirmedFetch("/api/wave8/adlib/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lyrics: lyricsText.trim(),
          songTitle: titleText.trim(),
          vaultVoice: voiceText.trim(),
          energy,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as AdLibResult & { error?: string; message?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.adlibs) || data.adlibs.length === 0) {
        throw new Error(data.message || data.error || t("wave8.adlib.errorGeneric"));
      }
      setResult(data);
      setActiveTake("A");
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave8.adlib.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  function sendToMixMaster() {
    if (!result) return;
    const take = activeTake === "A" ? result.takeA : result.takeB;
    localStorage.setItem(
      "wave8_adlibs",
      JSON.stringify({
        take: activeTake,
        takeStyle: take.style,
        takeNotes: take.notes,
        adlibs: result.adlibs,
        stacks: result.stacks,
        energy,
        songTitle: titleText.trim(),
        artistName: artistName?.trim() ?? "",
        createdAt: new Date().toISOString(),
      })
    );
    setSent(true);
  }

  const take = result ? (activeTake === "A" ? result.takeA : result.takeB) : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden" data-testid="adlib-generator">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Mic2 className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-black text-white">{t("wave8.adlib.title")}</p>
          <p className="text-[11px] text-white/40">{t("wave8.adlib.subtitle")}</p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-white/30 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-white/30 shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.06]">
          <div className="pt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
                {t("wave8.adlib.titleLabel")}
              </label>
              <input
                className={inputClass}
                placeholder={t("wave8.adlib.titlePlaceholder")}
                value={titleText}
                onChange={(e) => setTitleText(e.target.value)}
              />
            </div>
            <div>
              <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
                {t("wave8.adlib.energyLabel")}
              </label>
              <div className="flex gap-2">
                {ENERGIES.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEnergy(e)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-xs font-black uppercase tracking-wide transition ${
                      energy === e
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-white/10 bg-black/40 text-white/55 hover:border-white/25"
                    }`}
                  >
                    {t(`wave8.adlib.energy${e.charAt(0).toUpperCase()}${e.slice(1)}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
              {t("wave8.adlib.lyricsLabel")}
              {lyrics && lyricsText.trim().length > 10 && (
                <span className="ml-2 text-primary/70 normal-case tracking-normal">
                  {t("wave8.adlib.lyricsUsedFromProject")}
                </span>
              )}
            </label>
            <textarea
              className={`${inputClass} min-h-[110px] resize-y`}
              placeholder={t("wave8.adlib.lyricsPlaceholder")}
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
            />
          </div>

          <div>
            <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
              {t("wave8.adlib.vaultVoiceLabel")}
              {vaultVoice && voiceText.trim() === vaultVoice.trim() && (
                <span className="ml-2 text-primary/70 normal-case tracking-normal">
                  {t("wave8.adlib.prefilledFromVault")}
                </span>
              )}
            </label>
            <input
              className={inputClass}
              placeholder={t("wave8.adlib.vaultVoicePlaceholder")}
              value={voiceText}
              onChange={(e) => setVoiceText(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
            {loading
              ? t("wave8.adlib.generating")
              : result
                ? t("wave8.adlib.regenerate")
                : t("wave8.adlib.generate")}
          </button>

          {outOfCredits && <OutOfCredits />}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {result && take && (
            <div className="pt-1 space-y-4">
              {/* A/B toggle */}
              <div className="flex p-1 rounded-xl bg-black border border-white/10 gap-1">
                {(["A", "B"] as const).map((tk) => (
                  <button
                    key={tk}
                    type="button"
                    onClick={() => setActiveTake(tk)}
                    className={`flex-1 h-10 rounded-lg text-xs font-black uppercase tracking-widest transition-colors border ${
                      activeTake === tk
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "text-white/40 hover:text-white/70 border-transparent"
                    }`}
                    data-testid={`adlib-take-${tk}`}
                  >
                    {t(tk === "A" ? "wave8.adlib.takeA" : "wave8.adlib.takeB")}
                  </button>
                ))}
              </div>

              {/* Active take direction */}
              <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/70">
                  {t("wave8.adlib.style")}
                </p>
                <p className="mt-1 text-sm font-black text-white">{take.style}</p>
                <p className="mt-1.5 text-[13px] text-white/55 leading-relaxed">{take.notes}</p>
              </div>

              {/* Ad-libs */}
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-widest text-white/50">
                  {t("wave8.adlib.adlibsHeading")}
                </p>
                <div className="space-y-2">
                  {result.adlibs.map((a, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-3">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-black text-primary">“{a.line}”</span>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                          {t("wave8.adlib.placement")}: {a.placement}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-white/50">
                        <span className="font-bold text-white/65">{t("wave8.adlib.delivery")}: </span>
                        {a.delivery}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stacks */}
              {result.stacks.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-black uppercase tracking-widest text-white/50">
                    {t("wave8.adlib.stacksHeading")}
                  </p>
                  <div className="space-y-2">
                    {result.stacks.map((s, i) => (
                      <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-3">
                        <p className="text-[13px] font-bold text-white/85">{s.description}</p>
                        <p className="mt-0.5 text-xs text-primary/80">
                          {t("wave8.adlib.voices")}: {s.voices}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Handoff */}
              {sent ? (
                <p className="text-center text-xs text-emerald-300">{t("wave8.adlib.sendHint")}</p>
              ) : null}
              <Link
                href="/mix-master"
                onClick={sendToMixMaster}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-6 py-3.5 text-sm font-black text-primary transition hover:bg-primary/20"
                data-testid="adlib-send-to-mix"
              >
                {t("wave8.adlib.sendToMix")} <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
