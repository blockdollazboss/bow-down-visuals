/**
 * Wave8BusinessBenches — the Wave8 singles that belong to
 * the business desks (Stack 400 world parity, census B-19):
 * the Media Kit Builder at the Press Kit desk, and the
 * Content Calendar Auto-Fill stacked with the Scheduler
 * family in the Promote Room.
 *
 * Each bench is its page's own flow on its own rail (lib/
 * world/wave8-benches.ts + the calendar section of lib/
 * world/scheduler-desk.ts): the charged post rides the
 * registry-priced spend confirmation, a declined
 * confirmation runs nothing, and results land in the hub
 * project as script assets. The calendar bench drafts the
 * week and shows it grouped by day; rearranging slots stays
 * with the Scheduler Desk's composer in the room and the 2D
 * calendar's drag board — the autofill's slots persist
 * server-side either way. The media kit's page-side extras
 * (the jsPDF build, the public-link check) stay on the page;
 * the bench builds the kit itself on the same rail. Copy
 * rides the twins' own catalog namespace (wave8.*); the few
 * bench-only lines live in worldWave8Bench.*.
 */
import { useEffect, useState } from "react";
import { CalendarRange, Newspaper } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { DeskSelectField, DeskTextField } from "./CreateDeskLeaf";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { BenchNotices, BenchRunButton, BenchShell } from "./Wave8HookBenches";
import {
  WAVE8_MEDIA_KIT_PATH,
  WAVE8_MEDIA_KIT_VAULTS_PATH,
  buildWave8MediaKitPayload,
  wave8MediaKitCost,
  wave8MediaKitOf,
  wave8VaultOptionsOf,
  type Wave8MediaKit,
  type Wave8VaultOption,
} from "@/lib/world/wave8-benches";
import {
  CALENDAR_AUTOFILL_PATH,
  buildCalendarAutofillPayload,
  calendarAutofillCost,
  calendarShiftWeek,
  calendarSlotBestTime,
  calendarSlotNotes,
  calendarSlotsOf,
  calendarSlotsPath,
  calendarWeekMonday,
  parseCalendarPillars,
  type Wave8CalendarSlot,
} from "@/lib/world/scheduler-desk";

/* ─── Media Kit Builder ─────────────────────────────────────── */

export function MediaKitBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [vaults, setVaults] = useState<Wave8VaultOption[]>([]);
  const [vaultId, setVaultId] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done">("idle");
  const [kit, setKit] = useState<Wave8MediaKit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = wave8MediaKitCost();
  const busy = phase === "working";
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";

  /* The page's free vault read — a plain fetch, never the
   * confirm rail; a failed read just leaves the auto-pick. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(WAVE8_MEDIA_KIT_VAULTS_PATH, { credentials: "include" });
        if (!res.ok) return;
        const data: unknown = await res.json().catch(() => null);
        if (alive) setVaults(wave8VaultOptionsOf(data));
      } catch { /* non-fatal — the server falls back to profile basics */ }
    })();
    return () => { alive = false; };
  }, []);

  async function build() {
    if (busy) return;
    setPhase("working");
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(WAVE8_MEDIA_KIT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        overrideCost: cost,
        overrideFeature: "Media Kit Builder",
        body: JSON.stringify(buildWave8MediaKitPayload(vaultId || null)),
      });
      if (!res) { setPhase("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      if (res.status === 503) {
        setPhase("idle");
        setError(apiErrorMessage(data, "That isn't set up yet — try again later."));
        return;
      }
      const parsed = wave8MediaKitOf(data);
      if (!res.ok || !parsed) {
        setPhase("idle");
        setError(apiErrorMessage(data, t("wave8.mediaKit.errors.buildFailed")));
        return;
      }
      setKit(parsed);
      setPhase("done");
      try {
        addAsset({
          kind: "script",
          url: "",
          label: parsed.artistName ? `Media kit — ${parsed.artistName}` : "Media kit",
          detail: parsed.bio,
        });
      } catch { /* non-fatal — the hub tray is a bonus, not the result */ }
    } catch {
      setPhase("idle");
      setError(t("wave8.mediaKit.errors.network"));
    }
  }

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave8-media-kit-bench"
      icon={<Newspaper className="h-4 w-4" />}
      title={t("wave8.mediaKit.title")}
      cost={cost}
      subtitle={t("wave8.mediaKit.subtitle")}
    >
      <DeskSelectField
        isLight={isLight}
        label={t("wave8.mediaKit.vaultLabel")}
        value={vaultId}
        onChange={setVaultId}
        options={[
          { value: "", label: t("wave8.mediaKit.vaultNone") },
          ...vaults.map((v) => ({
            value: v.id,
            label: v.genre ? `${v.artistName} · ${v.genre}` : v.artistName,
          })),
        ]}
      />
      <BenchRunButton
        testId="world-wave8-media-kit-run"
        busy={busy}
        busyLabel={t("wave8.mediaKit.building")}
        label={kit ? t("wave8.mediaKit.rebuild") : t("wave8.mediaKit.buildButton", { cost })}
        onClick={build}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Media Kit Builder" error={error} />
      {busy && <NativeLoadingState isLight={isLight} message={t("wave8.mediaKit.building")} />}
      {!busy && !kit && !error && (
        <NativeEmptyState isLight={isLight} message={t("worldWave8Bench.mediaKitEmpty")} />
      )}
      {kit && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-wave8-media-kit-result">
          <p className={`text-sm font-black ${strong}`}>{kit.artistName}</p>
          {kit.tagline && <p className={`mt-0.5 text-xs ${muted}`}>{kit.tagline}</p>}
          <p className={`mt-2 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("wave8.mediaKit.bioTitle")}
          </p>
          <p className={`mt-1 text-xs leading-relaxed ${strong}`}>{kit.bio}</p>
          {kit.audience && (
            <>
              <p className={`mt-3 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {t("wave8.mediaKit.audienceTitle")}
              </p>
              <p className={`mt-1 text-xs leading-relaxed ${strong}`}>{kit.audience}</p>
            </>
          )}
          {kit.rates.length > 0 && (
            <>
              <p className={`mt-3 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {t("wave8.mediaKit.ratesTitle")}
              </p>
              <div className="mt-1 space-y-1">
                {kit.rates.map((r, i) => (
                  <p key={i} className={`flex justify-between text-xs ${strong}`}>
                    <span>{r.tier}</span>
                    <span className="font-bold">{r.price}</span>
                  </p>
                ))}
              </div>
            </>
          )}
          <p className={`mt-3 text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("wave8.mediaKit.contactTitle")}
          </p>
          <p className={`mt-1 text-xs ${strong}`}>{kit.contact || t("wave8.mediaKit.contactMissing")}</p>
          {(kit.stats.genre || kit.stats.artistType || kit.stats.visualStyle || kit.stats.voiceStyle) && (
            <p className={`mt-2 text-[11px] ${muted}`}>
              {[kit.stats.genre, kit.stats.artistType, kit.stats.visualStyle, kit.stats.voiceStyle].filter(Boolean).join(" · ")}
            </p>
          )}
          {kit.generatedAt && (
            <p className={`mt-1 text-[11px] ${muted}`}>
              {t("wave8.mediaKit.generatedOn", { date: new Date(kit.generatedAt).toLocaleDateString() })}
            </p>
          )}
        </div>
      )}
    </BenchShell>
  );
}

/* ─── Content Calendar Auto-Fill ────────────────────────────── */

export function CalendarAutofillBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();

  const [weekStart, setWeekStart] = useState(() => calendarWeekMonday(new Date()));
  const [pillarsText, setPillarsText] = useState("");
  const [voice, setVoice] = useState("");
  const [slots, setSlots] = useState<Wave8CalendarSlot[]>([]);
  const [loadPhase, setLoadPhase] = useState<"loading" | "ready" | "error">("loading");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cost = calendarAutofillCost();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const dayNames = t("wave8.calendar.dayNames", { returnObjects: true }) as unknown as string[];
  const pillarsReady = parseCalendarPillars(pillarsText).length > 0;

  /* The week's free read — the page's own skip-confirm read,
   * re-run whenever the shown week changes. */
  async function loadWeek(ws: string) {
    setLoadPhase("loading");
    try {
      const res = await confirmedFetch(calendarSlotsPath(ws), { skipConfirm: true });
      if (!res) { setLoadPhase("error"); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json().catch(() => null);
      const parsed = calendarSlotsOf(data);
      if (parsed) {
        setSlots(parsed);
      } else if (typeof data === "object" && data !== null) {
        setSlots([]); // the page's own bar: a slots-less answer is an empty week
      } else {
        throw new Error("bad shape");
      }
      setLoadPhase("ready");
    } catch {
      setLoadPhase("error");
    }
  }

  useEffect(() => {
    void loadWeek(weekStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  async function autofill() {
    if (generating || !pillarsReady) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(CALENDAR_AUTOFILL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: cost,
        overrideFeature: "Content Calendar Auto-Fill",
        body: JSON.stringify(buildCalendarAutofillPayload({ weekStart, pillarsText, voice })),
      });
      if (!res) { setGenerating(false); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setGenerating(false);
        return;
      }
      const parsed = calendarSlotsOf(data);
      if (!res.ok || !parsed) {
        setGenerating(false);
        setError(apiErrorMessage(data, t("wave8.calendar.errorAutofill")));
        return;
      }
      setSlots(parsed);
      setLoadPhase("ready");
      setGenerating(false);
    } catch {
      setGenerating(false);
      setError(t("wave8.calendar.errorAutofill"));
    }
  }

  const navButtonCls = `rounded-full border px-3 py-1.5 text-xs font-bold transition hover:scale-105 bdv-touch-target ${cardCls} ${strong}`;

  return (
    <BenchShell
      isLight={isLight}
      testId="world-wave8-calendar-bench"
      icon={<CalendarRange className="h-4 w-4" />}
      title={t("wave8.calendar.panelTitle")}
      cost={cost}
      subtitle={t("wave8.calendar.panelSub")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={navButtonCls} onClick={() => setWeekStart((ws) => calendarShiftWeek(ws, -1))}>
          {t("wave8.calendar.prevWeek")}
        </button>
        <button type="button" className={navButtonCls} onClick={() => setWeekStart(calendarWeekMonday(new Date()))}>
          {t("wave8.calendar.thisWeek")}
        </button>
        <button type="button" className={navButtonCls} onClick={() => setWeekStart((ws) => calendarShiftWeek(ws, 1))}>
          {t("wave8.calendar.nextWeek")}
        </button>
        <span className={`ml-auto text-xs font-bold ${strong}`}>
          {t("wave8.calendar.weekLabel")}: {weekStart}
        </span>
      </div>
      <DeskTextField
        isLight={isLight}
        label={t("wave8.calendar.pillarsLabel")}
        value={pillarsText}
        onChange={setPillarsText}
        placeholder={t("wave8.calendar.pillarsPlaceholder")}
      />
      <DeskTextField
        isLight={isLight}
        label={t("wave8.calendar.voiceLabel")}
        value={voice}
        onChange={setVoice}
        placeholder={t("wave8.calendar.voicePlaceholder")}
      />
      <BenchRunButton
        testId="world-wave8-calendar-run"
        busy={generating}
        busyLabel={t("wave8.calendar.autofilling")}
        label={t("worldWave8Bench.calendarRun")}
        disabled={!pillarsReady}
        onClick={autofill}
      />
      <BenchNotices isLight={isLight} outOfCredits={outOfCredits} feature="Content Calendar Auto-Fill" error={error} />
      {generating && <NativeLoadingState isLight={isLight} message={t("wave8.calendar.autofilling")} />}
      {loadPhase === "loading" && !generating && <NativeLoadingState isLight={isLight} />}
      {loadPhase === "error" && (
        <NativeErrorState
          isLight={isLight}
          message={t("wave8.calendar.errorLoad")}
          onRetry={() => void loadWeek(weekStart)}
        />
      )}
      {loadPhase === "ready" && slots.length === 0 && (
        <NativeEmptyState isLight={isLight} message={t("wave8.calendar.emptyWeek")} />
      )}
      {loadPhase === "ready" && slots.length > 0 && (
        <div className="space-y-3" data-testid="world-wave8-calendar-result">
          {[0, 1, 2, 3, 4, 5, 6].map((day) => {
            const daySlots = slots
              .filter((s) => s.dayIndex === day)
              .sort((a, b) => a.position - b.position);
            if (daySlots.length === 0) return null;
            return (
              <div key={day}>
                <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                  {Array.isArray(dayNames) ? (dayNames[day] ?? "") : ""}
                </p>
                <div className="mt-1.5 space-y-1.5">
                  {daySlots.map((slot) => {
                    const bestTime = calendarSlotBestTime(slot.notes);
                    const notes = calendarSlotNotes(slot.notes);
                    return (
                      <div key={slot.id} className={`rounded-xl border p-2.5 ${cardCls}`}>
                        <p className={`text-xs font-bold ${strong}`}>
                          {slot.title}
                          {slot.postType && <span className={`ml-2 font-semibold ${muted}`}>{slot.postType}</span>}
                        </p>
                        {bestTime && (
                          <p className={`mt-0.5 text-[11px] ${muted}`}>
                            {t("worldWave8Bench.bestTime", { time: bestTime })}
                          </p>
                        )}
                        {notes && <p className={`mt-0.5 text-[11px] leading-relaxed ${muted}`}>{notes}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </BenchShell>
  );
}
