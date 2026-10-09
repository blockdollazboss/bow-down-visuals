import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  GripVertical,
  Loader2,
  Megaphone,
  Scissors,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { OutOfCredits } from "@/components/OutOfCredits";

/* Wave 8 · AI Week Planner — docks in the Scheduler's calendar tab.
   The AI drafts a full Mon–Sun week into the wave8_calendar_slots table;
   the grid below renders the week's slots as draggable cards (HTML5
   drag-and-drop), persisted via PATCH on drop. */

export interface CalendarSlot {
  id: string;
  week_start: string;
  day_index: number;
  position: number;
  title: string;
  post_type: string;
  notes: string;
  status: string;
}

interface CalendarAutofillProps {
  onOpenComposer: (date: string, time: string, caption: string) => void;
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function currentMonday(): string {
  const n = new Date();
  const dow = (n.getDay() + 6) % 7; /* Monday = 0 */
  n.setDate(n.getDate() - dow);
  return toISODate(n);
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, dd] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function prettyDay(iso: string): string {
  const [y, m, dd] = iso.split("-").map(Number);
  return `${m}/${dd}`;
}

function extractBestTime(notes: string): string | null {
  const match = /^Suggested time:\s*([01]\d|2[0-3]):[0-5]\d/m.exec(notes);
  return match ? match[1] : null;
}

function cleanNotes(notes: string): string {
  return notes.replace(/^Suggested time:\s*\d{2}:\d{2}\s*\n?/m, "").trim();
}

export default function CalendarAutofill({ onOpenComposer }: CalendarAutofillProps) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();

  const [weekStart, setWeekStart] = useState<string>(() => currentMonday());
  const [pillarsText, setPillarsText] = useState("");
  const [voice, setVoice] = useState("");
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [dragSlotId, setDragSlotId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<number | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const pillarsRef = useRef<HTMLInputElement>(null);

  /* Ghost sample week shown when the week is truly empty — sells the future. */
  const GHOST_WEEK: { dayIndex: number; kind: "post" | "video" | "clip" }[] = [
    { dayIndex: 0, kind: "post" },
    { dayIndex: 2, kind: "video" },
    { dayIndex: 3, kind: "clip" },
    { dayIndex: 4, kind: "post" },
    { dayIndex: 5, kind: "clip" },
  ];
  const GHOST_ICON = { post: Megaphone, video: Clapperboard, clip: Scissors } as const;
  const GHOST_KEY = { post: "ghostPost", video: "ghostVideo", clip: "ghostClip" } as const;

  function handlePlanMyWeek() {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => pillarsRef.current?.focus({ preventScroll: true }), 450);
  }

  const isEmptyWeek = slots.length === 0 && !loading;

  const loadSlots = useCallback(
    async (week: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await confirmedFetch(
          `/api/wave8/calendar/slots?weekStart=${encodeURIComponent(week)}`,
          { skipConfirm: true }
        );
        if (!res) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { slots?: CalendarSlot[] };
        setSlots(Array.isArray(data.slots) ? data.slots : []);
      } catch {
        setError(t("wave8.calendar.errorLoad"));
      } finally {
        setLoading(false);
      }
    },
    [confirmedFetch, t]
  );

  useEffect(() => {
    void loadSlots(weekStart);
  }, [weekStart, loadSlots]);

  async function handleAutofill() {
    const pillars = pillarsText
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 6);
    if (pillars.length === 0) return;
    setGenerating(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch("/api/wave8/calendar/autofill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart, pillars, vaultVoice: voice.trim() || undefined }),
      });
      if (!res) {
        /* User cancelled the credit confirmation. */
        setGenerating(false);
        return;
      }
      if (res.status === 402) {
        setOutOfCredits(true);
        setGenerating(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { slots?: CalendarSlot[] };
      setSlots(Array.isArray(data.slots) ? data.slots : []);
    } catch {
      setError(t("wave8.calendar.errorAutofill"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleDropDay(dayIndex: number) {
    const id = dragSlotId;
    setDragSlotId(null);
    setDropDay(null);
    if (!id) return;
    const slot = slots.find((s) => s.id === id);
    if (!slot || slot.day_index === dayIndex) return;
    const position = slots.filter((s) => s.day_index === dayIndex).length;
    /* Optimistic move. */
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, day_index: dayIndex, position } : s))
    );
    try {
      const res = await confirmedFetch(`/api/wave8/calendar/slots/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayIndex, position }),
        skipConfirm: true,
      });
      if (!res || !res.ok) throw new Error("save failed");
    } catch {
      setError(t("wave8.calendar.errorSave"));
      void loadSlots(weekStart);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("wave8.calendar.deleteConfirm"))) return;
    try {
      const res = await confirmedFetch(`/api/wave8/calendar/slots/${id}`, {
        method: "DELETE",
        skipConfirm: true,
      });
      if (!res || !res.ok) throw new Error("delete failed");
      setSlots((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setError(t("wave8.calendar.errorDelete"));
    }
  }

  function handleOpenComposer(slot: CalendarSlot) {
    const date = addDaysISO(weekStart, slot.day_index);
    const time = extractBestTime(slot.notes) ?? "18:00";
    const brief = cleanNotes(slot.notes);
    const caption = brief ? `${slot.title}\n\n${brief}` : slot.title;
    onOpenComposer(date, time, caption);
  }

  const dayNames: string[] = t("wave8.calendar.dayNames", { returnObjects: true }) as string[];
  const days = Array.from({ length: 7 }, (_, i) => ({
    dayIndex: i,
    date: addDaysISO(weekStart, i),
    label: dayNames[i] ?? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
  }));
  const weekLabel = `${prettyDay(days[0].date)} – ${prettyDay(days[6].date)}`;

  return (
    <div ref={panelRef} className="mb-6 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-bold">{t("wave8.calendar.panelTitle")}</h2>
          <p className="text-sm text-white/45">{t("wave8.calendar.panelSub")}</p>
        </div>
      </div>

      {/* controls */}
      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/40">
            {t("wave8.calendar.pillarsLabel")}
          </label>
          <input
            ref={pillarsRef}
            value={pillarsText}
            onChange={(e) => setPillarsText(e.target.value)}
            placeholder={t("wave8.calendar.pillarsPlaceholder")}
            maxLength={400}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-white/40">
            {t("wave8.calendar.voiceLabel")}
          </label>
          <input
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            placeholder={t("wave8.calendar.voicePlaceholder")}
            maxLength={500}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
          />
        </div>
        <div className="flex items-end">
          <Button
            onClick={handleAutofill}
            disabled={generating || pillarsText.trim().length === 0}
            className="bg-primary font-bold text-black hover:bg-primary/90 disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {generating ? t("wave8.calendar.autofilling") : t("wave8.calendar.autofill")}
          </Button>
        </div>
      </div>

      {outOfCredits && (
        <div className="mx-auto mt-4 max-w-md">
          <OutOfCredits />
        </div>
      )}
      {error && (
        <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* week navigation */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart((w) => addDaysISO(w, -7))}
            className="flex items-center gap-1 rounded-full border border-white/10 px-3.5 py-1.5 text-xs font-bold text-white/60 transition hover:border-primary/40 hover:text-white"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {t("wave8.calendar.prevWeek")}
          </button>
          <button
            onClick={() => setWeekStart(currentMonday())}
            className="rounded-full border border-white/10 px-3.5 py-1.5 text-xs font-bold text-white/60 transition hover:border-primary/40 hover:text-white"
          >
            {t("wave8.calendar.thisWeek")}
          </button>
          <button
            onClick={() => setWeekStart((w) => addDaysISO(w, 7))}
            className="flex items-center gap-1 rounded-full border border-white/10 px-3.5 py-1.5 text-xs font-bold text-white/60 transition hover:border-primary/40 hover:text-white"
          >
            {t("wave8.calendar.nextWeek")}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white/60">
          <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
          {weekLabel}
        </p>
      </div>

      {/* week grid */}
      <div className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-white/40">
            <Loader2 className="mr-3 h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {days.map((day) => {
                const daySlots = slots
                  .filter((s) => s.day_index === day.dayIndex)
                  .sort((a, b) => a.position - b.position);
                const isDropTarget = dropDay === day.dayIndex && dragSlotId;
                return (
                  <div
                    key={day.date}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropDay(day.dayIndex);
                    }}
                    onDragLeave={() => setDropDay((d) => (d === day.dayIndex ? null : d))}
                    onDrop={(e) => {
                      e.preventDefault();
                      void handleDropDay(day.dayIndex);
                    }}
                    className={`min-h-[160px] rounded-2xl border p-2 transition ${
                      isDropTarget
                        ? "border-primary bg-primary/10"
                        : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <p className="px-1 pb-2 text-center">
                      <span className="block text-[11px] font-bold uppercase tracking-widest text-primary/80">
                        {day.label}
                      </span>
                      <span className="block text-xs text-white/40">{prettyDay(day.date)}</span>
                    </p>
                    <div className="space-y-2">
                      {daySlots.map((slot) => {                        const bestTime = extractBestTime(slot.notes);
                        return (
                          <div
                            key={slot.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              setDragSlotId(slot.id);
                            }}
                            onDragEnd={() => {
                              setDragSlotId(null);
                              setDropDay(null);
                            }}
                            className={`group cursor-grab rounded-xl border bg-black/40 p-2.5 transition active:cursor-grabbing ${
                              dragSlotId === slot.id
                                ? "border-primary opacity-60"
                                : "border-white/10 hover:border-primary/40"
                            }`}
                          >
                            <div className="flex items-start gap-1.5">
                              <GripVertical
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/25"
                                aria-hidden="true"
                              />
                              <p className="text-[13px] font-bold leading-snug text-white/90">
                                {slot.title}
                              </p>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
                              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                                {slot.post_type}
                              </span>
                              {bestTime && (
                                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/50">
                                  {bestTime}
                                </span>
                              )}
                            </div>
                            {cleanNotes(slot.notes) && (
                              <p className="mt-1.5 line-clamp-3 pl-5 text-[11px] leading-relaxed text-white/45">
                                {cleanNotes(slot.notes)}
                              </p>
                            )}
                            <div className="mt-2 flex items-center gap-1.5 pl-5">
                              <button
                                onClick={() => handleOpenComposer(slot)}
                                className="flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-[10px] font-bold text-primary transition hover:bg-primary hover:text-black"
                              >
                                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                                {t("wave8.calendar.openInComposer")}
                              </button>
                              <button
                                onClick={() => void handleDelete(slot.id)}
                                aria-label={t("wave8.calendar.deleteSlot")}
                                className="rounded-full p-1 text-white/30 transition hover:bg-red-500/15 hover:text-red-300"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {isEmptyWeek &&
                        GHOST_WEEK.filter((g) => g.dayIndex === day.dayIndex).map((g) => {
                          const GhostIcon = GHOST_ICON[g.kind];
                          return (
                            <div
                              key={`ghost-${g.dayIndex}`}
                              aria-hidden="true"
                              className="pointer-events-none select-none rounded-xl border border-dashed border-primary/30 bg-primary/[0.05] p-2.5 opacity-60"
                            >
                              <div className="flex items-center gap-1.5">
                                <GhostIcon
                                  className="h-3.5 w-3.5 shrink-0 text-primary/70"
                                  aria-hidden="true"
                                />
                                <p className="text-[12px] font-bold leading-snug text-white/55">
                                  {t(`wave8.calendar.${GHOST_KEY[g.kind]}`, { day: day.label })}
                                </p>
                              </div>
                              <span className="mt-1.5 inline-block rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/35">
                                {g.kind}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              })}
            </div>
            {!isEmptyWeek && (
              <p className="mt-3 text-center text-[11px] text-white/30">
                {t("wave8.calendar.dragHint")}
              </p>
            )}
            {isEmptyWeek && (
              <div className="mx-auto mt-6 max-w-md text-center">
                <Button
                  onClick={handlePlanMyWeek}
                  className="bg-primary px-8 py-3 text-base font-black text-black shadow-[0_0_28px_rgba(212,175,55,0.45)] transition hover:bg-primary/90 hover:shadow-[0_0_36px_rgba(212,175,55,0.6)]"
                >
                  <Sparkles className="mr-2 h-5 w-5" aria-hidden="true" />
                  {t("wave8.calendar.planMyWeek")}
                </Button>
                <p className="mt-3 text-sm text-white/45">
                  {t("wave8.calendar.ghostCtaSub")}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
