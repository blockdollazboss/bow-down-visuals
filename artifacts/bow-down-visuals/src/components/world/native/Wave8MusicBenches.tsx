/**
 * Wave8MusicBenches — the Wave8 single that belongs to the
 * music family (Stack 400 world parity, census B-19): the
 * Ad-Lib Generator, stacked at the My Studio board with the
 * board's other music desks (DJ Set Prep, Setlist, Tour).
 *
 * The bench is its page's own flow on its own rail (lib/
 * world/wave8-benches.ts): the charged post rides the
 * registry-priced spend confirmation, a declined
 * confirmation runs nothing, and the ad-lib pack lands in
 * the hub project as a script asset — the World's form of
 * the page's send-to-Mix-&-Master handoff. Copy rides the
 * twin's own catalog namespace (wave8.adlib.*); the few
 * bench-only lines live in worldWave8Bench.*.
 */
import { useState } from "react";
import { AudioLines } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { DeskSelectField, DeskTextField } from "./CreateDeskLeaf";
import { NativeEmptyState, NativeLoadingState } from "./NativeStates";
import { BenchNotices, BenchRunButton, BenchShell, BenchTextArea } from "./Wave8HookBenches";
import {
  WAVE8_ADLIB_ENERGIES,
  WAVE8_ADLIB_PATH,
  buildWave8AdlibPayload,
  wave8AdlibCost,
  wave8AdlibOf,
  type Wave8AdlibEnergy,
  type Wave8AdlibResult,
} from "@/lib/world/wave8-benches";

const ADLIB_ENERGY_LABEL_KEYS: Record<Wave8AdlibEnergy, string> = {
  chill: "wave8.adlib.energyChill",
  hype: "wave8.adlib.energyHype",
  dark: "wave8.adlib.energyDark",
};

export function AdLibBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [songTitle, setSongTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [vaultVoice, setVaultVoice] = useState("");
  const [energy, setEnergy] = useState<Wave8AdlibEnergy>("hype");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [result, setResult] = useState<Wave8AdlibResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave8AdlibCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  async function generate() {
    if (busy) return;
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(WAVE8_ADLIB_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Ad-Lib Generator",
        body: JSON.stringify(buildWave8AdlibPayload({ lyrics, songTitle, vaultVoice, energy })),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (
        res.status === 402 ||
        (typeof data === "object" && data !== null && (data as { error?: unknown }).error === "out_of_credits")
      ) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      const parsed = wave8AdlibOf(data);
      if (!res.ok || !parsed) {
        setPhase("idle");
        setError(apiErrorMessage(data, t("wave8.adlib.errorGeneric")));
        return;
      }
      setResult(parsed);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: songTitle.trim() ? `Ad-libs — ${songTitle.trim()}` : "Ad-libs",
          detail: parsed.adlibs.map((a) => a.line).join(" · "),
        });
      } catch { /* non-fatal — the hub tray is a bonus, not the result */ }
    } catch {
      setPhase("idle");
      setError(t("wave8.adlib.errorGeneric"));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave8-adlib-bench"
      icon={<AudioLines className="h-4 w-4" />}
      title={t("wave8.adlib.title")}
      cost={cost}
      subtitle={t("wave8.adlib.subtitle")}
    >
      <DeskTextField
        isLight={isLight}
        label={t("wave8.adlib.titleLabel")}
        value={songTitle}
        onChange={setSongTitle}
        placeholder={t("wave8.adlib.titlePlaceholder")}
      />
      <BenchTextArea
        isLight={isLight}
        label={t("wave8.adlib.lyricsLabel")}
        value={lyrics}
        onChange={setLyrics}
        placeholder={t("wave8.adlib.lyricsPlaceholder")}
        rows={4}
      />
      <DeskTextField
        isLight={isLight}
        label={t("wave8.adlib.vaultVoiceLabel")}
        value={vaultVoice}
        onChange={setVaultVoice}
        placeholder={t("wave8.adlib.vaultVoicePlaceholder")}
      />
      <DeskSelectField
        isLight={isLight}
        label={t("wave8.adlib.energyLabel")}
        value={energy}
        onChange={(v) => setEnergy(v as Wave8AdlibEnergy)}
        options={WAVE8_ADLIB_ENERGIES.map((e) => ({ value: e, label: t(ADLIB_ENERGY_LABEL_KEYS[e]) }))}
      />
      <BenchRunButton
        testId="world-wave8-adlib-run"
        busy={busy}
        busyLabel={t("wave8.adlib.generating")}
        label={t("worldWave8Bench.adlibRun")}
        onClick={generate}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Ad-Lib Generator" error={error} />
      {busy && <NativeLoadingState isLight={isLight} message={t("wave8.adlib.generating")} />}
      {!busy && !result && !error && (
        <NativeEmptyState isLight={isLight} message={t("worldWave8Bench.adlibEmpty")} />
      )}
      {result && (
        <div className="space-y-3" data-testid="world-wave8-adlib-result">
          <div>
            <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("wave8.adlib.adlibsHeading")}
            </p>
            <div className="mt-2 space-y-2">
              {result.adlibs.map((a, i) => (
                <div key={i} className={`rounded-xl border p-3 ${cardCls}`}>
                  <p className={`text-sm font-bold ${strong}`}>{a.line}</p>
                  <p className={`mt-1 text-xs ${muted}`}>
                    {t("wave8.adlib.placement")}: {a.placement} · {t("wave8.adlib.delivery")}: {a.delivery}
                  </p>
                </div>
              ))}
            </div>
          </div>
          {result.stacks.length > 0 && (
            <div>
              <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {t("wave8.adlib.stacksHeading")}
              </p>
              <div className="mt-2 space-y-1.5">
                {result.stacks.map((s, i) => (
                  <p key={i} className={`text-xs ${muted}`}>
                    <span className={`font-bold ${strong}`}>{s.description}</span> — {t("wave8.adlib.voices")}: {s.voices}
                  </p>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {([
              { heading: t("wave8.adlib.takeA"), take: result.takeA },
              { heading: t("wave8.adlib.takeB"), take: result.takeB },
            ] as const).map(({ heading, take }) => (
              <div key={heading} className={`rounded-xl border p-3 ${cardCls}`}>
                <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{heading}</p>
                <p className={`mt-1 text-xs font-bold ${strong}`}>{take.style}</p>
                <p className={`mt-1 text-xs ${muted}`}>{take.notes}</p>
              </div>
            ))}
          </div>
          {result.creditsRemaining !== null && (
            <p className={`text-[11px] ${muted}`}>
              {t("worldWave8Bench.creditsRemaining", { n: result.creditsRemaining })}
            </p>
          )}
        </div>
      )}
    </BenchShell>
  );
}
