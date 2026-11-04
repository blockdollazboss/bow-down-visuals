import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  X, Loader2, Play, Pause, SkipForward, XCircle,
  ListMusic, Plus, CalendarDays, ArrowUp, ArrowDown,
} from "lucide-react";
import type { StationPanelProps } from "@/components/world/StationPanel";
import { useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import { jukeboxDeniedCopy } from "@/lib/world/jukebox-sync";
import {
  buildListeningPartyBody,
  listeningPartyErrorCopy,
  movePartyQueueItem,
  normalizeMyParties,
  parsePartyStartInput,
  partyStartInputValue,
  playlistQueueFold,
  togglePartyQueueItem,
  PARTY_DURATION_PRESETS_MIN,
  PARTY_QUEUE_MAX,
  type MyParty,
  type PartyQueueItem,
} from "@/lib/world/listening-party";
import { parseShelfPlaylists, type ShelfPlaylistSummary } from "@/lib/world/shelf";
import { fetchPlaylist } from "@/lib/streaming";
import type { WorldJukeboxState } from "@/lib/world/world-client";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";

/* ─── The Music Hall jukebox panel (world-perf round 4, stack1200) ──
   Extracted VERBATIM from StationPanel.tsx: the jukebox custom
   panel and its listening-party section serve exactly one station
   (the Music Hall jukebox), yet they and their chains (the
   listening-party lib, the shelf playlist parse, the streaming
   playlist fetch) rode the panel frame for every first station
   open. They now ride their own chunk behind the frame's DeskDoor
   lazy door, opened only by the jukebox station. The one internal
   edit the move required: the panel's private useAuthHeaders hook
   is byte-identical to the frame kit's useDeskAuthHeaders
   (CreateDeskLeaf, world-kit chunk), so the extracted panel calls
   the kit hook — same token, same headers, no behaviour change. */

/* ─── The Music Hall jukebox ───────────────────────────────────────── */

interface JukeboxCatalogItem {
  id: string;
  title: string;
  creatorName: string | null;
  durationSec: number;
  artworkUrl: string | null;
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function JukeboxPanel(props: StationPanelProps) {
  const { t, i18n } = useTranslation();
  const { jukebox, jukeboxDenied, isGuest, isLight, myPeerId, isAdmin } = props;
  const authHeaders = useDeskAuthHeaders();
  const [catalog, setCatalog] = useState<{ mine: JukeboxCatalogItem[]; public: JukeboxCatalogItem[] } | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [tick, setTick] = useState(0);
  /* The displayed position advances locally from the last state
     stamp (the same derivation the room audio mirrors). */
  const [anchor, setAnchor] = useState<{ state: WorldJukeboxState | null; at: number }>({
    state: jukebox,
    at: Date.now(),
  });
  useEffect(() => {
    setAnchor({ state: jukebox, at: Date.now() });
  }, [jukebox]);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/world/jukebox-catalog", { headers: await authHeaders() });
        if (!res.ok) throw new Error("catalog");
        const data = (await res.json()) as { catalog: { mine: JukeboxCatalogItem[]; public: JukeboxCatalogItem[] } };
        if (!cancelled) setCatalog(data.catalog);
      } catch {
        if (!cancelled) setCatalogFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const cur = jukebox?.current ?? null;
  const positionNow = cur
    ? cur.playback.positionSec +
      (cur.playback.playing ? Math.max(0, (Date.now() - anchor.at) / 1000) : 0)
    : 0;
  void tick;
  const canDrive = !!cur && (isAdmin || cur.entry.addedByPeerId === myPeerId);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const rowCls = `flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
    isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
  }`;
  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;

  const catalogSection = (label: string, items: JukeboxCatalogItem[]) =>
    items.length === 0 ? null : (
      <div key={label}>
        <p className={`text-[11px] font-bold ${muted}`}>{label}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid="world-jukebox-add"
              onClick={() => props.onJukeboxAdd(item.id)}
              className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                isLight
                  ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                  : "border-white/15 text-white/75 hover:text-white"
              }`}
            >
              <Plus className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
              <span className="truncate">{item.title}</span>
              {item.creatorName ? <span className="opacity-60">· {item.creatorName}</span> : null}
              {item.durationSec > 0 ? <span className="opacity-50">{fmtClock(item.durationSec)}</span> : null}
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-3">
      {jukebox?.party ? (
        <div
          data-testid="world-jukebox-party"
          className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
            isLight ? "border-[#C9A84C]/60 bg-[#d4af37]/15" : "border-[#d4af37]/40 bg-[#d4af37]/10"
          }`}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#d4af37]/20">
            <CalendarDays className="h-5 w-5 text-[#d4af37]" />
          </span>
          <div className="min-w-0">
            <p className={`truncate text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {t("worldAudioDesk.partyBannerTitle", { title: jukebox.party.title })}
            </p>
            <p className={`truncate text-xs ${muted}`}>
              {t("worldAudioDesk.partyBannerHost", { name: jukebox.party.hostName })}
            </p>
          </div>
        </div>
      ) : null}

      {cur ? (
        <div className={rowCls}>
          {cur.entry.track.artworkUrl ? (
            <img src={cur.entry.track.artworkUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
          ) : (
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#d4af37]/15">
              <ListMusic className="h-5 w-5 text-[#d4af37]" />
            </span>
          )}
          <div className="min-w-0">
            <p className={`truncate text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {cur.entry.track.title}
            </p>
            <p className={`truncate text-xs ${muted}`}>
              {t("worldAudioDesk.nowPlayingLine", {
                creatorPart: cur.entry.track.creatorName ? t("worldAudioDesk.creatorPart", { creator: cur.entry.track.creatorName }) : "",
                name: cur.entry.addedByName,
                state: cur.playback.playing ? t("worldAudioDesk.playingWord") : t("worldAudioDesk.pausedWord"),
                position: fmtClock(positionNow),
                durationPart: cur.entry.track.durationSec > 0 ? t("worldAudioDesk.durationPart", { clock: fmtClock(cur.entry.track.durationSec) }) : "",
              })}
            </p>
          </div>
          {canDrive ? (
            <span className="ml-auto inline-flex gap-1.5">
              <button
                type="button"
                data-testid="world-jukebox-playpause"
                onClick={() => props.onJukeboxPlayPause(!cur.playback.playing)}
                className={chipBtn}
              >
                {cur.playback.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {cur.playback.playing ? t("worldAudioDesk.pauseForRoomBtn") : t("worldAudioDesk.playForRoomBtn")}
              </button>
              <button
                type="button"
                data-testid="world-jukebox-skip"
                onClick={() => props.onJukeboxSkip()}
                className={chipBtn}
              >
                <SkipForward className="h-3.5 w-3.5" /> {t("worldAudioDesk.skipBtn")}
              </button>
            </span>
          ) : (
            <span className={`ml-auto text-[11px] font-semibold ${muted}`}>
              {t("worldAudioDesk.transportAnswersTo", { name: cur.entry.addedByName, hostSuffix: isAdmin ? "" : t("worldAudioDesk.hostSuffixPart") })}
            </span>
          )}
        </div>
      ) : (
        <p className={`px-1 text-sm ${muted}`}>
          {t("worldAudioDesk.jukeboxQuietLine")}
        </p>
      )}

      {jukebox && jukebox.queue.length > 0 && (
        <div className="space-y-1.5">
          <p className={`px-1 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("worldAudioDesk.upNextHeading")}
          </p>
          {jukebox.queue.map((entry, i) => (
            <div
              key={entry.entryId}
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
              }`}
            >
              <span className={`text-xs font-black ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{i + 1}</span>
              <span className={`min-w-0 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {entry.track.title}
              </span>
              <span className={`truncate text-xs ${muted}`}>
                {entry.track.creatorName ? t("worldAudioDesk.creatorPart", { creator: entry.track.creatorName }) : ""}{t("worldAudioDesk.byAdderPart", { name: entry.addedByName })}
              </span>
              {(isAdmin || entry.addedByPeerId === myPeerId) && (
                <button
                  type="button"
                  data-testid="world-jukebox-remove"
                  onClick={() => props.onJukeboxRemove(entry.entryId)}
                  className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition bdv-touch-target ${
                    isLight
                      ? "border-red-800/30 text-red-900/80 hover:text-red-900"
                      : "border-red-400/40 text-red-300 hover:text-red-200"
                  }`}
                >
                  <XCircle className="h-3 w-3" /> {t("worldAudioDesk.pullItBtn")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {jukeboxDenied && (
        <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {jukeboxDeniedCopy(jukeboxDenied, {
            guests: t("worldAudioDesk.deniedGuests"),
            unplayable: t("worldAudioDesk.deniedUnplayable"),
            queueFull: t("worldAudioDesk.deniedQueueFull"),
            listeningParty: t("worldAudioDesk.deniedListeningParty"),
            notYours: t("worldAudioDesk.deniedNotYours"),
            fallback: t("worldAudioDesk.deniedFallback"),
          })}
        </p>
      )}

      <div>
        <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("worldAudioDesk.putSongOnHeading")}
        </p>
        {isGuest ? (
          <p className={`mt-1.5 text-sm ${muted}`}>
            {t("worldAudioDesk.jukeboxGuestPrefix")} <Link href={GUEST_SIGN_IN_HREF} className="font-bold text-[#d4af37] underline underline-offset-2">{t("worldAudioDesk.signInLinkWord")}</Link>{" "}
            {t("worldAudioDesk.jukeboxGuestSuffix")}
          </p>
        ) : catalogFailed ? (
          <p className={`mt-1.5 text-sm ${muted}`}>{t("worldAudioDesk.catalogFailedLine")}</p>
        ) : catalog === null ? (
          <p className={`mt-1.5 inline-flex items-center gap-2 text-sm ${muted}`}>
            <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {t("worldAudioDesk.openingCatalog")}
          </p>
        ) : catalog.mine.length + catalog.public.length === 0 ? (
          <p className={`mt-1.5 text-sm ${muted}`}>
            {t("worldAudioDesk.catalogEmptyLine")}
          </p>
        ) : (
          <div className="mt-1.5 space-y-2">
            {catalogSection(t("worldAudioDesk.yoursSectionLabel"), catalog.mine)}
            {catalogSection(t("worldAudioDesk.fromPalaceLabel"), catalog.public)}
          </div>
        )}
      </div>

      <ListeningPartySection
        isLight={isLight}
        isGuest={isGuest}
        catalog={catalog}
        authHeaders={authHeaders}
      />
    </div>
  );
}

/* ─── Listening parties (World Events 3.2) ──────────────────────────
   The booking door for the backbone the server already runs: a
   member books the Music Hall with a queue (their published songs —
   picked here one by one, or folded in from one of their site
   playlists), the palace board carries it, and at the hour the
   scheduler hands the queue to this room's jukebox under the host's
   name. All rules (window, queue cap, one event per room) are the
   server's; lib/world/listening-party mirrors them so the form
   refuses a bad booking in the same words before it round-trips. */

function fmtPartyWhen(iso: string, lang?: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(lang, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function ListeningPartySection(props: {
  isLight: boolean;
  isGuest: boolean;
  catalog: { mine: JukeboxCatalogItem[]; public: JukeboxCatalogItem[] } | null;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const { t, i18n } = useTranslation();
  const { isLight, isGuest, catalog, authHeaders } = props;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [startValue, setStartValue] = useState(() => partyStartInputValue(Date.now()));
  const [durationMin, setDurationMin] = useState<number>(60);
  const [queue, setQueue] = useState<PartyQueueItem[]>([]);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<ShelfPlaylistSummary[] | null>(null);
  const [pickedPlaylist, setPickedPlaylist] = useState("");
  const [playlistNote, setPlaylistNote] = useState<string | null>(null);
  const [mine, setMine] = useState<MyParty[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const headingCls = `text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;
  const chipBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm font-semibold outline-none bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]"
      : "border-white/10 bg-white/5 text-white [color-scheme:dark]"
  }`;

  const refreshMine = async () => {
    try {
      const res = await fetch("/api/world/events/mine", { headers: await authHeaders() });
      if (!res.ok) return;
      setMine(normalizeMyParties(await res.json(), Date.now()));
    } catch {
      /* The list is a courtesy read — a failure leaves the last one. */
    }
  };

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    void refreshMine();
    (async () => {
      try {
        const res = await fetch("/api/playlists/mine", { headers: await authHeaders() });
        if (!res.ok) return;
        const parsed = parseShelfPlaylists(await res.json());
        if (!cancelled) setPlaylists(parsed);
      } catch {
        if (!cancelled) setPlaylists([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  if (isGuest) {
    return (
      <div>
        <p className={headingCls}>{t("worldAudioDesk.partiesHeading")}</p>
        <p className={`mt-1.5 text-sm ${muted}`}>
          {t("worldAudioDesk.guestPartiesPrefix")}{" "}
          <Link href={GUEST_SIGN_IN_HREF} className="font-bold text-[#d4af37] underline underline-offset-2">{t("worldAudioDesk.signInLinkWord")}</Link>{" "}
          {t("worldAudioDesk.guestPartiesSuffix")}
        </p>
      </div>
    );
  }

  const pickFromCatalog = (item: JukeboxCatalogItem) => {
    const result = togglePartyQueueItem(queue, {
      id: item.id,
      title: item.title,
      creatorName: item.creatorName,
      durationSec: item.durationSec,
    });
    if (result.outcome === "full") {
      setError(t("worldAudioDesk.queueFullError", { max: PARTY_QUEUE_MAX }));
      return;
    }
    setError(null);
    setQueue(result.queue);
  };

  const applyPlaylist = async () => {
    if (!pickedPlaylist) return;
    setBusy(true);
    setError(null);
    try {
      const got = await fetchPlaylist(pickedPlaylist);
      if (!got) {
        setError(t("worldAudioDesk.playlistOpenError"));
        return;
      }
      const fold = playlistQueueFold(got.playlist);
      if (fold.items.length === 0) {
        setError(t("worldAudioDesk.playlistNonePlayableError"));
        return;
      }
      setQueue(fold.items);
      setPlaylistId(pickedPlaylist);
      setPlaylistNote(
        t("worldAudioDesk.playlistFoldSongs", { count: fold.items.length, title: got.playlist.title }) +
          (fold.skipped > 0
            ? t("worldAudioDesk.playlistFoldSkipped", { count: fold.skipped })
            : ""),
      );
    } finally {
      setBusy(false);
    }
  };

  const partyStrings = {
    nameFirst: t("worldAudioDesk.partyErrNameFirst"),
    nameTooLong: t("worldAudioDesk.partyErrNameTooLong"),
    queueEmpty: t("worldAudioDesk.partyErrQueueEmpty"),
    queueTooLong: t("worldAudioDesk.partyErrQueueTooLong"),
    notCatalog: t("worldAudioDesk.partyErrNotCatalog"),
    slotTooShort: t("worldAudioDesk.partyErrSlotTooShort"),
    slotTooLong: t("worldAudioDesk.partyErrSlotTooLong"),
    pickStart: t("worldAudioDesk.partyErrPickStart"),
    startPast: t("worldAudioDesk.partyErrStartPast"),
    tooFarAhead: t("worldAudioDesk.partyErrTooFarAhead"),
    slotTaken: t("worldAudioDesk.partyErrSlotTaken"),
    invalidWindow: t("worldAudioDesk.partyErrInvalidWindow"),
    invalidPayload: t("worldAudioDesk.partyErrInvalidPayload"),
    roomMismatch: t("worldAudioDesk.partyErrRoomMismatch"),
    signIn: t("worldAudioDesk.partyErrSignIn"),
    didntLand: t("worldAudioDesk.bookingDidntLand"),
  };

  const submit = async () => {
    setError(null);
    setNotice(null);
    const startsAtMs = parsePartyStartInput(startValue);
    if (startsAtMs === null) {
      setError(t("worldAudioDesk.partyErrPickStart"));
      return;
    }
    const built = buildListeningPartyBody(
      { title, startsAtMs, durationMin, queue, playlistId },
      Date.now(),
      partyStrings,
    );
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/world/events", {
        method: "POST",
        headers: { ...(await authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(listeningPartyErrorCopy(res.status, data, partyStrings));
        return;
      }
      setNotice(t("worldAudioDesk.bookedNotice", { when: fmtPartyWhen(built.body.startsAt, i18n.language) }));
      setOpen(false);
      setTitle("");
      setQueue([]);
      setPlaylistId(null);
      setPlaylistNote(null);
      await refreshMine();
    } catch {
      setError(t("worldAudioDesk.bookingDidntLand"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (party: MyParty) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/world/events/${encodeURIComponent(party.id)}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        setError(t("worldAudioDesk.cancelFailedError"));
        return;
      }
      setNotice(t("worldAudioDesk.partyCancelledNotice", { title: party.title }));
      await refreshMine();
    } catch {
      setError(t("worldAudioDesk.cancelFailedError"));
    } finally {
      setBusy(false);
    }
  };

  const queueIndex = new Map(queue.map((q, i) => [q.id, i]));
  const pickSection = (label: string, items: JukeboxCatalogItem[]) =>
    items.length === 0 ? null : (
      <div key={label}>
        <p className={`text-[11px] font-bold ${muted}`}>{label}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {items.map((item) => {
            const at = queueIndex.get(item.id);
            const picked = at !== undefined;
            return (
              <button
                key={item.id}
                type="button"
                data-testid="world-party-pick"
                onClick={() => pickFromCatalog(item)}
                className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                  picked
                    ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]"
                    : isLight
                      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
                      : "border-white/15 text-white/75 hover:text-white"
                }`}
              >
                {picked ? (
                  <span className="text-[10px] font-black">{at + 1}</span>
                ) : (
                  <Plus className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                )}
                <span className="truncate">{item.title}</span>
                {item.durationSec > 0 ? <span className="opacity-50">{fmtClock(item.durationSec)}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className={headingCls}>{t("worldAudioDesk.partiesHeading")}</p>
        {!open && (
          <button
            type="button"
            data-testid="world-party-open"
            onClick={() => {
              setOpen(true);
              setError(null);
              setNotice(null);
            }}
            className={`${chipBtn} ml-auto`}
          >
            <CalendarDays className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldAudioDesk.bookHallBtn")}
          </button>
        )}
      </div>

      {notice && (
        <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{notice}</p>
      )}

      {mine && mine.length > 0 && (
        <div className="space-y-1.5">
          {mine.map((party) => (
            <div
              key={party.id}
              data-testid="world-party-mine"
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
              }`}
            >
              <span className={`min-w-0 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {party.title}
              </span>
              <span className={`truncate text-xs ${muted}`}>
                {t("worldAudioDesk.partyMetaLine", {
                  when: party.status === "live" ? t("worldAudioDesk.liveNowLabel") : fmtPartyWhen(party.startsAt, i18n.language),
                  songs: t("worldAudioDesk.partySongsCount", { count: party.trackCount }),
                })}
              </span>
              <button
                type="button"
                data-testid="world-party-cancel"
                disabled={busy}
                onClick={() => void cancel(party)}
                className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition bdv-touch-target ${
                  isLight
                    ? "border-red-800/30 text-red-900/80 hover:text-red-900"
                    : "border-red-400/40 text-red-300 hover:text-red-200"
                }`}
              >
                <X className="h-3 w-3" /> {t("worldAudioDesk.cancelBtn")}
              </button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="space-y-3">
          <div>
            <label className={`text-[11px] font-bold ${muted}`} htmlFor="party-title">{t("worldAudioDesk.partyNameLabel")}</label>
            <input
              id="party-title"
              data-testid="world-party-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={t("worldAudioDesk.partyNamePlaceholder")}
              className={`${inputCls} mt-1`}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="min-w-44 flex-1">
              <label className={`text-[11px] font-bold ${muted}`} htmlFor="party-start">{t("worldAudioDesk.startsLabel")}</label>
              <input
                id="party-start"
                data-testid="world-party-start"
                type="datetime-local"
                value={startValue}
                onChange={(e) => setStartValue(e.target.value)}
                className={`${inputCls} mt-1`}
              />
            </div>
            <div>
              <p className={`text-[11px] font-bold ${muted}`}>{t("worldAudioDesk.lengthLabel")}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {PARTY_DURATION_PRESETS_MIN.map((min) => (
                  <button
                    key={min}
                    type="button"
                    data-testid="world-party-duration"
                    onClick={() => setDurationMin(min)}
                    className={`${chipBtn} ${durationMin === min ? "border-[#d4af37] bg-[#d4af37]/20 text-[#d4af37]" : ""}`}
                  >
                    {min >= 60 ? t("worldAudioDesk.durationHour", { hours: min / 60 }) : t("worldAudioDesk.durationMin", { minutes: min })}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {playlists && playlists.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-44 flex-1">
                <label className={`text-[11px] font-bold ${muted}`} htmlFor="party-playlist">
                  {t("worldAudioDesk.fromPlaylistLabel")}
                </label>
                <select
                  id="party-playlist"
                  data-testid="world-party-playlist"
                  value={pickedPlaylist}
                  onChange={(e) => setPickedPlaylist(e.target.value)}
                  className={`${inputCls} mt-1`}
                >
                  <option value="">{t("worldAudioDesk.choosePlaylistOption")}</option>
                  {playlists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.itemCount})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                data-testid="world-party-playlist-use"
                disabled={busy || !pickedPlaylist}
                onClick={() => void applyPlaylist()}
                className={chipBtn}
              >
                {t("worldAudioDesk.useItsSongsBtn")}
              </button>
            </div>
          )}
          {playlistNote && <p className={`px-1 text-xs ${muted}`}>{playlistNote}</p>}

          <div>
            <p className={`text-[11px] font-bold ${muted}`}>
              {t("worldAudioDesk.queueHeadingLine", { count: queue.length, max: PARTY_QUEUE_MAX })}
            </p>
            {queue.length === 0 ? (
              <p className={`mt-1 text-sm ${muted}`}>{t("worldAudioDesk.queueEmptyLine")}</p>
            ) : (
              <div className="mt-1 space-y-1.5">
                {queue.map((item, i) => (
                  <div
                    key={item.id}
                    className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                      isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <span className={`text-xs font-black ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{i + 1}</span>
                    <span className={`min-w-0 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                      {item.title}
                    </span>
                    {item.durationSec > 0 && <span className={`text-xs ${muted}`}>{fmtClock(item.durationSec)}</span>}
                    <span className="ml-auto inline-flex gap-1">
                      <button
                        type="button"
                        aria-label={t("worldAudioDesk.moveUpAria")}
                        disabled={i === 0}
                        onClick={() => setQueue(movePartyQueueItem(queue, i, -1))}
                        className={`${chipBtn} bdv-touch-box`}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("worldAudioDesk.moveDownAria")}
                        disabled={i === queue.length - 1}
                        onClick={() => setQueue(movePartyQueueItem(queue, i, 1))}
                        className={`${chipBtn} bdv-touch-box`}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("worldAudioDesk.removeAria")}
                        onClick={() => setQueue(queue.filter((q) => q.id !== item.id))}
                        className={`${chipBtn} bdv-touch-box`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {catalog === null ? (
              <p className={`inline-flex items-center gap-2 text-sm ${muted}`}>
                <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {t("worldAudioDesk.openingCatalog")}
              </p>
            ) : (
              <>
                {pickSection(t("worldAudioDesk.yoursSectionLabel"), catalog.mine)}
                {pickSection(t("worldAudioDesk.fromPalaceLabel"), catalog.public)}
              </>
            )}
          </div>

          {error && (
            <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{error}</p>
          )}

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              data-testid="world-party-submit"
              disabled={busy}
              onClick={() => void submit()}
              className={`inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37]/20 px-4 py-2 text-xs font-black text-[#d4af37] transition hover:bg-[#d4af37]/30 disabled:opacity-50 bdv-touch-target`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />}
              {t("worldAudioDesk.bookPartyBtn")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={chipBtn}
            >
              {t("worldAudioDesk.notNowBtn")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
