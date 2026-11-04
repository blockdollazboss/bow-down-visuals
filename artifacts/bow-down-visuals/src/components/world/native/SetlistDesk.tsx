/**
 * SetlistDesk — the My Studio board's native Setlist desk
 * (stack1500 world parity wave #3, census item 35).
 *
 * Build the set without leaving the World: add songs by hand or
 * from your library, set durations and energy, order them
 * yourself — all free, like the website's builder — then ask
 * for the AI flow (100 Visual Bucs, confirmed here first; the
 * page's unconfirmed post is not copied) and apply it or keep
 * yours.
 *
 * The flow answer renders as slot badges + stage directions on
 * your own list (the page's applyFlowOrder, verbatim logic from
 * lib/setlist.ts) plus the flow notes. The set lives for the
 * sitting, exactly like the page — the desk says so and never
 * dresses it up as saved.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import {
  ENERGY_LABELS,
  SLOT_LABELS,
  applyFlowOrder,
  clearFlowAnnotations,
  formatDuration,
  knownDurationCount,
  moveSong,
  newSongId,
  parseDurationInput,
  totalRuntime,
  type SetSong,
} from "@/lib/setlist";
import {
  SETLIST_FEATURE,
  SETLIST_FLOW_COST,
  SETLIST_FLOW_PATH,
  SETLIST_MAX_SONGS,
  SETLIST_SONGS_PATH,
  buildFlowPayload,
  flowOfResponse,
  flowReady,
  libraryOfResponse,
  libraryPicks,
  type SetlistFlow,
  type SetlistLibrarySong,
} from "@/lib/world/setlist-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

/* Slot/energy words key-mapped to the family catalog; the shared
   lib tables stay the fallback for unknown tokens. */
const SLOT_KEYS: Record<string, string> = {
  opener: "worldScheduleRelease.setSlotOpener",
  build: "worldScheduleRelease.setSlotBuild",
  peak: "worldScheduleRelease.setSlotPeak",
  breather: "worldScheduleRelease.setSlotBreather",
  closer: "worldScheduleRelease.setSlotCloser",
  encore: "worldScheduleRelease.setSlotEncore",
};
const ENERGY_KEYS: Record<number, string> = {
  1: "worldScheduleRelease.setEnergyBallad",
  2: "worldScheduleRelease.setEnergyMellow",
  3: "worldScheduleRelease.setEnergyMid",
  4: "worldScheduleRelease.setEnergyHigh",
  5: "worldScheduleRelease.setEnergyBanger",
};

export function SetlistDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const deskHeaders = useDeskAuthHeaders();

  const [songs, setSongs] = useState<SetSong[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newArtist, setNewArtist] = useState("");
  const [showNotes, setShowNotes] = useState("");
  const [flow, setFlow] = useState<SetlistFlow | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [library, setLibrary] = useState<SetlistLibrarySong[] | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const picks = useMemo(() => (library ? libraryPicks(library, songs) : []), [library, songs]);
  const annotated = songs.some((s) => s.slot);

  function addSong(title: string, artist = "", durationSec = 0, energy = 0) {
    const t = title.trim();
    if (!t || songs.length >= SETLIST_MAX_SONGS) return;
    setSongs((prev) => [
      ...prev,
      { id: newSongId(), title: t, artist: artist.trim(), durationSec, energy, stageNote: "" },
    ]);
    setFlow(null);
  }

  function patchSong(id: string, patch: Partial<SetSong>) {
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function loadLibrary() {
    if (libraryBusy) return;
    setLibraryBusy(true);
    setLibraryError(null);
    try {
      const headers = await deskHeaders();
      const res = await fetch(SETLIST_SONGS_PATH, { headers });
      if (!res.ok) throw new Error("library failed");
      const parsed = libraryOfResponse(await res.json().catch(() => ({})));
      if (!parsed) throw new Error("library failed");
      setLibrary(parsed);
    } catch {
      setLibraryError(t("worldScheduleRelease.setLibraryFailed"));
    } finally {
      setLibraryBusy(false);
    }
  }

  async function suggestFlow() {
    if (flowBusy || !flowReady(songs)) return;
    setFlowBusy(true);
    setFlowError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(SETLIST_FLOW_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildFlowPayload(songs, showNotes)),
        overrideCost: SETLIST_FLOW_COST,
        overrideFeature: SETLIST_FEATURE,
      });
      if (!res) return;
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, t("worldScheduleRelease.setFlowFailedRefund")));
      }
      const built = flowOfResponse(data, songs.length);
      if (!built) throw new Error(t("worldScheduleRelease.setFlowUnusable"));
      setFlow(built);
      refreshProfile();
    } catch (e) {
      setFlowError(plainErrorText(e, t("worldScheduleRelease.setFlowFailedFallback")));
    } finally {
      setFlowBusy(false);
    }
  }

  function applyFlow() {
    if (!flow) return;
    setSongs((prev) => applyFlowOrder(prev, flow.order));
    setFlow(null);
  }

  return (
    <div className="space-y-3" data-testid="world-setlist-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>{t("worldScheduleRelease.setTitle")}</p>
        <p className={`text-xs ${muted}`}>
          {t("worldScheduleRelease.setIntro", { cost: SETLIST_FLOW_COST.toLocaleString(i18n.language) })}
        </p>
      </div>

      <div className="flex gap-2">
        <input
          data-testid="world-setlist-desk-new-title"
          aria-label={t("worldScheduleRelease.setSongTitleAria")}
          className={inputCls}
          value={newTitle}
          maxLength={200}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={t("worldScheduleRelease.setSongTitlePlaceholder")}
        />
        <input
          data-testid="world-setlist-desk-new-artist"
          aria-label={t("setlist.artistPlaceholder")}
          className={inputCls}
          value={newArtist}
          maxLength={200}
          onChange={(e) => setNewArtist(e.target.value)}
          placeholder={t("setlist.artistPlaceholder")}
        />
        <button
          type="button"
          data-testid="world-setlist-desk-add"
          className={goldBtn}
          disabled={!newTitle.trim() || songs.length >= SETLIST_MAX_SONGS}
          onClick={() => {
            addSong(newTitle, newArtist);
            setNewTitle("");
            setNewArtist("");
          }}
        >
          {t("setlist.addButton")}
        </button>
      </div>

      <div>
        {library === null ? (
          <button
            type="button"
            data-testid="world-setlist-desk-library-open"
            className={chipCls(false)}
            disabled={libraryBusy}
            onClick={() => void loadLibrary()}
          >
            {libraryBusy ? t("worldScheduleRelease.setLibraryLoading") : t("worldScheduleRelease.setLibraryOpen")}
          </button>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="world-setlist-desk-library">
            {picks.length === 0 ? (
              <span className={`text-xs ${muted}`}>{t("worldScheduleRelease.setLibraryAllIn")}</span>
            ) : (
              picks.map((pick) => (
                <button
                  key={pick.id}
                  type="button"
                  className={chipCls(false)}
                  onClick={() =>
                    addSong(pick.title, "", pick.durationSecRaw ? parseDurationInput(pick.durationSecRaw) : 0, 0)
                  }
                >
                  + {pick.title}
                </button>
              ))
            )}
          </div>
        )}
        {libraryError ? <p className={`mt-1 ${errCls}`}>{libraryError}</p> : null}
      </div>

      {songs.length === 0 ? (
        <p className={`text-sm ${muted}`} data-testid="world-setlist-desk-empty">
          {t("worldScheduleRelease.setEmpty")}
        </p>
      ) : (
        <>
          <ol className="space-y-1.5">
            {songs.map((song, i) => (
              <li key={song.id} className={`rounded-xl border px-3 py-2 ${cardCls}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-black ${muted}`}>{i + 1}</span>
                  <span className={`text-sm font-bold ${strong}`}>{song.title}</span>
                  {song.artist ? <span className={`text-xs ${muted}`}>{song.artist}</span> : null}
                  {song.slot ? (
                    <span className={chipCls(true)} data-testid={`world-setlist-desk-slot-${song.id}`}>
                      {SLOT_KEYS[song.slot] ? t(SLOT_KEYS[song.slot]) : (SLOT_LABELS[song.slot] ?? song.slot)}
                    </span>
                  ) : null}
                  <span className="ml-auto flex gap-1.5">
                    <button
                      type="button"
                      aria-label={t("worldScheduleRelease.setMoveUpAria", { title: song.title })}
                      className={chipCls(false)}
                      disabled={i === 0}
                      onClick={() => setSongs((prev) => moveSong(prev, i, i - 1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={t("worldScheduleRelease.setMoveDownAria", { title: song.title })}
                      className={chipCls(false)}
                      disabled={i === songs.length - 1}
                      onClick={() => setSongs((prev) => moveSong(prev, i, i + 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={chipCls(false)}
                      onClick={() => setSongs((prev) => prev.filter((s) => s.id !== song.id))}
                    >
                      {t("setlist.removeSong")}
                    </button>
                  </span>
                </div>
                {song.aiNote ? <p className={`mt-1 text-xs ${muted}`}>{song.aiNote}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className={`text-xs ${muted}`}>
                    {t("worldScheduleRelease.setLengthLabel")}
                    <input
                      className={`${inputCls} ml-1 w-20`}
                      defaultValue={song.durationSec > 0 ? formatDuration(song.durationSec) : ""}
                      placeholder="3:30"
                      onBlur={(e) => patchSong(song.id, { durationSec: parseDurationInput(e.target.value) })}
                    />
                  </label>
                  <span className="flex items-center gap-1" role="radiogroup" aria-label={t("worldScheduleRelease.setEnergyAria", { title: song.title })}>
                    {[0, 1, 2, 3, 4, 5].map((level) => (
                      <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={song.energy === level}
                        data-testid={`world-setlist-desk-energy-${song.id}-${level}`}
                        className={chipCls(song.energy === level)}
                        onClick={() => patchSong(song.id, { energy: level })}
                      >
                        {level === 0 ? "—" : `${level} ${ENERGY_KEYS[level] ? t(ENERGY_KEYS[level]) : ENERGY_LABELS[level]}`}
                      </button>
                    ))}
                  </span>
                  <input
                    className={`${inputCls} min-w-32 flex-1`}
                    value={song.stageNote}
                    maxLength={200}
                    onChange={(e) => patchSong(song.id, { stageNote: e.target.value })}
                    placeholder={t("worldScheduleRelease.setStageNotePlaceholder")}
                    aria-label={t("worldScheduleRelease.setStageNoteAria", { title: song.title })}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className={`text-xs ${muted}`} data-testid="world-setlist-desk-runtime">
            {t("worldScheduleRelease.setRuntimeLine", { count: songs.length, runtime: formatDuration(totalRuntime(songs)) })}
            {knownDurationCount(songs) < songs.length
              ? t("worldScheduleRelease.setRuntimeTimedSuffix", { known: knownDurationCount(songs), total: songs.length })
              : ""}
          </p>
        </>
      )}

      <label className={`block text-xs ${muted}`}>
        {t("worldScheduleRelease.setShowNotesLabel")}
        <textarea
          data-testid="world-setlist-desk-show-notes"
          className={`${inputCls} mt-1`}
          rows={2}
          maxLength={500}
          value={showNotes}
          onChange={(e) => setShowNotes(e.target.value)}
          placeholder={t("worldScheduleRelease.setShowNotesPlaceholder")}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="world-setlist-desk-flow"
          className={goldBtn}
          disabled={flowBusy || !flowReady(songs)}
          onClick={() => void suggestFlow()}
        >
          {flowBusy ? t("worldScheduleRelease.setFlowBusy") : t("worldScheduleRelease.setFlowButton", { cost: SETLIST_FLOW_COST.toLocaleString(i18n.language) })}
        </button>
        {annotated ? (
          <button
            type="button"
            className={chipCls(false)}
            onClick={() => setSongs((prev) => clearFlowAnnotations(prev))}
          >
            {t("worldScheduleRelease.setClearFlow")}
          </button>
        ) : null}
      </div>
      {outOfCredits ? (
        <p className={errCls}>
          {t("worldScheduleRelease.setOutOfCredits")}
        </p>
      ) : null}
      {flowError ? (
        <p className={errCls} data-testid="world-setlist-desk-flow-error">{flowError}</p>
      ) : null}

      {flow ? (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-setlist-desk-flow-result">
          <p className={`text-sm font-bold ${strong}`}>{t("worldScheduleRelease.setFlowResultTitle")}</p>
          <p className={`mt-1 whitespace-pre-wrap text-sm ${muted}`}>{flow.flowNotes}</p>
          <ol className={`mt-2 list-decimal space-y-0.5 pl-5 text-sm ${muted}`}>
            {flow.order.map((item) => (
              <li key={item.index}>
                <span className={`font-bold ${strong}`}>{songs[item.index]?.title ?? t("worldScheduleRelease.setSongFallback")}</span> —{" "}
                {SLOT_KEYS[item.slot] ? t(SLOT_KEYS[item.slot]) : (SLOT_LABELS[item.slot] ?? item.slot)}: {item.note}
              </li>
            ))}
          </ol>
          <div className="mt-2 flex gap-1.5">
            <button type="button" data-testid="world-setlist-desk-apply" className={goldBtn} onClick={applyFlow}>
              {t("worldScheduleRelease.setApplyFlow")}
            </button>
            <button type="button" className={chipCls(false)} onClick={() => setFlow(null)}>
              {t("worldScheduleRelease.setKeepOrder")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
