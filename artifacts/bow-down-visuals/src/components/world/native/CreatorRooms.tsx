import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  Crown,
  DoorOpen,
  Home,
  Loader2,
  Lock,
  Music2,
  Paintbrush,
  Minus,
  Play,
  Plus,
  ShoppingBag,
  Trash2,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildOfficeHoursBooking,
  currentOrNextSession,
  nextHourLocalValue,
  officeHoursCancelPath,
  officeHoursErrorCopy,
  officeHoursMarker,
  officeHoursSessionWhen,
  officeHoursSlatePath,
  parseOfficeHoursEvents,
  plusDaysLocalValue,
  OFFICE_HOURS_BOOK_PATH,
  OFFICE_HOURS_DURATIONS_MIN,
  OFFICE_HOURS_MINE_PATH,
  type OfficeHoursSession,
} from "@/lib/world/office-hours";
import {
  creatorTrackPlayInput,
  creatorVideoPlayInput,
  fetchCreatorRoomDetail,
  fetchCreatorRoomDirectory,
  frontRowCourtMember,
  putCreatorRoomDressing,
  type CreatorRoomDetail,
  type CreatorRoomDressing,
  type CreatorRoomSummary,
} from "@/lib/world/creator-rooms";
import {
  creatorRoomEvolutionLine,
  creatorRoomStars,
  creatorRoomTierDressing,
} from "@/lib/world/creator-room-tier";
import {
  roomDressingBandName,
  roomDressingOptions,
  roomDressingStyleWords,
} from "@/lib/world/creator-room-dressing";
import { useUserMode } from "@/contexts/UserModeContext";
import { centsToDisplay, type CartLine } from "@/lib/shops";
import {
  CHECKOUT_TRANSFER_LABEL,
  addToCartLines,
  checkoutCompletedInWorld,
  detailedMarketCart,
  hostedCheckoutUrl,
  marketCartCount,
  marketCartTotalCents,
  marketOrderFromPayload,
  marketPendingKey,
  setCartLineQty,
  type MarketOrder,
} from "@/lib/world/shop-stands";
import {
  apiErrorLine,
  parseRoomCatalog,
  roomCartKey,
  roomItemRail,
  roomMarketProducts,
  storeCheckoutPayload,
  storefrontCheckoutPayload,
  type RoomStoreItem,
} from "@/lib/world/money-desks";
import { isSameShelfItem } from "@/lib/world/shelf";
import type { ShelfPlayerController } from "./ShelfPlayer";
import { PortraitCard } from "./PortraitCard";

/* ─── Creator Rooms panels (Ring 2, item 3.5) ────────────────────────
   Two surfaces, both fed by the world-shaped reads
   (GET /api/world/creator-rooms[/:slug]):
   - the Courtyard arch's DIRECTORY: every public creator's room,
     with "Your room" pinned first for a signed-in creator — pick
     one and the page walks you through the doorway transfer.
   - the room's own four stations (Their Music / Their Screen /
     Their Store / Their Front Row), all reading the ONE room-data
     fetch (cached per slug below, so walking station to station
     in a room never refetches it).
   The room has no stage and no jukebox and these panels never
   pretend otherwise: music plays on the personal Shelf player,
   the screen piece plays in the panel (and on the room's screen
   mesh), the store rides the profile store rails, and the Front
   Row opens the same Portrait Cards the Court Chamber hangs. */

const detailCache = new Map<string, CreatorRoomDetail>();
const detailInflight = new Map<string, Promise<CreatorRoomDetail | null>>();

function loadRoomDetail(slug: string): Promise<CreatorRoomDetail | null> {
  const cached = detailCache.get(slug);
  if (cached) return Promise.resolve(cached);
  const flying = detailInflight.get(slug);
  if (flying) return flying;
  const p = fetchCreatorRoomDetail(slug).then((detail) => {
    detailInflight.delete(slug);
    if (detail) detailCache.set(slug, detail);
    return detail;
  });
  detailInflight.set(slug, p);
  return p;
}

/** After the host re-dresses their room, the cached read carries
 *  the new dressing so the room's other stations agree with the
 *  walls. */
function patchCachedRoomDressing(slug: string, dressing: CreatorRoomDressing) {
  const cached = detailCache.get(slug);
  if (cached) detailCache.set(slug, { ...cached, dressing });
}

/* ─── The dressing desk: the host's own picker (Ring 4) ─────────────
   Rendered only in the host's own room (the station threads
   isOwnRoom from the walker's slug). The catalog and its gates
   are the pure seam's (lib/world/creator-room-dressing): variants
   at or below the walker's GATE stars — max(earned, grandfather
   floor), the house gate — can be worn; the bands above stand
   visible but locked, each with the honest rung that opens it.
   A pick rides the owner's endpoint; the desk then wears the
   SERVER's resolved dressing (the answer's DTO), patches the
   cached room read, and tells the page to re-dress the scene. */

function CreatorRoomDressingPicker({
  slug,
  detail,
  isLight,
  onDressingChanged,
}: {
  slug: string;
  detail: CreatorRoomDetail;
  isLight: boolean;
  onDressingChanged?: (slug: string) => void;
}) {
  const { getAccessToken } = useAuth();
  const { gateStars } = useUserMode();
  const [dressing, setDressing] = useState<CreatorRoomDressing | null>(detail.dressing);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /* A fresher room read (a re-entry) re-words the desk from the
   * server's resolution. */
  useEffect(() => {
    setDressing(detail.dressing);
  }, [detail.dressing]);

  const options = roomDressingOptions(gateStars);
  const currentId = dressing?.variantId ?? null;

  const pick = async (variantId: string) => {
    if (variantId === currentId || savingId) return;
    setSavingId(variantId);
    setError(null);
    setSaved(false);
    try {
      const token = await getAccessToken();
      const resolved = await putCreatorRoomDressing(slug, variantId, gateStars, token);
      setDressing(resolved);
      patchCachedRoomDressing(slug, resolved);
      setSaved(true);
      onDressingChanged?.(slug);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't save your room's dressing. Try again.",
      );
    } finally {
      setSavingId(null);
    }
  };

  const bands = [1, 2, 3, 4, 5, 6].map((band) => ({
    band,
    options: options.filter((o) => o.variant.band === band),
  }));

  return (
    <div
      className={`mb-3 rounded-2xl border px-3 py-3 ${
        isLight ? "border-[#C9A84C]/50 bg-white/60" : "border-[#d4af37]/25 bg-white/5"
      }`}
      data-testid="world-creator-room-dressing-desk"
    >
      <p
        className={`inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide ${
          isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
        }`}
      >
        <Paintbrush className="h-4 w-4 text-[#d4af37]" /> Your room&rsquo;s dressing
      </p>
      <p className={`pt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        {dressing
          ? dressing.picked
            ? `Wearing: ${dressing.name}. Pick any look at or below your rung — your visitors see the one you choose.`
            : `Wearing the ${dressing.name} default — your room's rung look, until you pick one of your own.`
          : "Your room wears its classic look. Pick any look at or below your rung — your visitors see the one you choose."}
      </p>
      <div className="space-y-2.5 pt-2.5">
        {bands.map(({ band, options: bandOptions }) => (
          <div key={band}>
            <p
              className="pb-1 text-[11px] font-black uppercase tracking-wide"
              style={{ color: creatorRoomTierDressing(band).trimHex }}
            >
              {creatorRoomStars(band)} {roomDressingBandName(band)}
            </p>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {bandOptions.map(({ variant, locked, lockReason }) => {
                const isCurrent = variant.id === currentId;
                const isSaving = savingId === variant.id;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={locked || isCurrent || savingId !== null}
                    onClick={() => void pick(variant.id)}
                    data-testid={
                      locked
                        ? "world-creator-room-dressing-locked"
                        : "world-creator-room-dressing-option"
                    }
                    className={`flex flex-col items-start gap-1 rounded-xl border px-2.5 py-2 text-left transition ${
                      isCurrent
                        ? isLight
                          ? "border-[#7A5A12] bg-[#d4af37]/20"
                          : "border-[#d4af37] bg-[#d4af37]/15"
                        : locked
                          ? isLight
                            ? "border-[#C9A84C]/30 bg-white/30 opacity-70"
                            : "border-white/10 bg-white/[0.02] opacity-60"
                          : isLight
                            ? "border-[#C9A84C]/50 bg-white/60 hover:border-[#7A5A12]"
                            : "border-[#d4af37]/25 bg-white/5 hover:border-[#d4af37]/70"
                    }`}
                  >
                    <span
                      className="h-1.5 w-full rounded-full"
                      style={{ background: creatorRoomTierDressing(band).trimHex }}
                    />
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-bold ${
                        isLight ? "text-[#2a1e07]" : "text-white"
                      }`}
                    >
                      {variant.name.replace(`${roomDressingBandName(band)} `, "")}
                      {isSaving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" />
                      ) : isCurrent ? (
                        <Check className="h-3.5 w-3.5 text-[#d4af37]" />
                      ) : locked ? (
                        <Lock className="h-3.5 w-3.5" />
                      ) : null}
                    </span>
                    <span className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                      {roomDressingStyleWords(variant)}
                    </span>
                    {isCurrent && (
                      <span className="text-[11px] font-black uppercase tracking-wide text-[#e8c86a]">
                        Wearing
                      </span>
                    )}
                    {locked && lockReason && (
                      <span className={`text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>
                        {lockReason}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p className={`pt-2 text-xs font-semibold ${isLight ? "text-[#9a3412]" : "text-red-300"}`}>
          That dressing wouldn&rsquo;t save — {error}
        </p>
      )}
      {saved && !error && (
        <p className={`pt-2 text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          Saved — your walls wear it now, and every visitor sees it.
        </p>
      )}
    </div>
  );
}

function useRoomDetail(slug: string | null): {
  detail: CreatorRoomDetail | null;
  failed: boolean;
  retry: () => void;
} {
  const [detail, setDetail] = useState<CreatorRoomDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setFailed(false);
    loadRoomDetail(slug).then((d) => {
      if (cancelled) return;
      if (d) setDetail(d);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, tick]);
  return { detail, failed, retry: () => setTick((n) => n + 1) };
}

/* ─── The directory (the Courtyard arch's panel) ──────────────────── */

export function CreatorRoomsDirectory({
  isLight,
  mySlug,
  onEnterCreatorRoom,
}: {
  isLight: boolean;
  /** The signed-in walker's own profile slug (null for guests and
   *  members without a profile): their room pins to the top. */
  mySlug: string | null;
  onEnterCreatorRoom: (slug: string) => void;
}) {
  const [rooms, setRooms] = useState<CreatorRoomSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchCreatorRoomDirectory()
      .then((list) => {
        if (!cancelled) setRooms(list);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (failed) {
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-3">
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          The rooms wouldn&rsquo;t list — the doors are fine, the directory slipped.
        </p>
        <button
          type="button"
          onClick={() => setTick((n) => n + 1)}
          className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
        >
          Try again
        </button>
      </div>
    );
  }
  if (rooms === null) {
    return (
      <p className={`inline-flex items-center gap-2 px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Opening the arch…
      </p>
    );
  }
  if (rooms.length === 0) {
    return (
      <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        No creator has opened a room yet — the arch stands ready for the first host.
      </p>
    );
  }
  const mine = mySlug ? rooms.find((r) => r.slug === mySlug) ?? null : null;
  const others = mine ? rooms.filter((r) => r.slug !== mine.slug) : rooms;
  const row = (r: CreatorRoomSummary, isMine: boolean) => (
    <button
      key={r.slug}
      type="button"
      data-testid={isMine ? "world-creator-room-mine" : "world-creator-room-row"}
      onClick={() => onEnterCreatorRoom(r.slug)}
      className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
        isLight
          ? "border-[#C9A84C]/50 bg-white/60 hover:border-[#7A5A12]"
          : "border-[#d4af37]/25 bg-white/5 hover:border-[#d4af37]/70"
      }`}
    >
      {r.avatarUrl ? (
        <img
          src={r.avatarUrl}
          alt={r.displayName}
          className="h-11 w-11 shrink-0 rounded-full border-2 object-cover"
          style={{ borderColor: r.theme.accent }}
        />
      ) : (
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-lg font-black text-black"
          style={{
            borderColor: r.theme.accent,
            background: `linear-gradient(135deg, ${r.theme.accent}, ${r.theme.primary})`,
          }}
        >
          {r.displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
          {isMine ? "Your room" : r.roomName}
        </span>
        <span className={`block truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          {isMine ? `${r.displayName} — your place in the palace. ` : ""}
          {r.hasContent
            ? "Their music and featured work are on the walls."
            : "A quiet room — its host is still moving in."}
        </span>
        {creatorRoomEvolutionLine(r.evolution) && (
          <span
            className="block truncate text-[11px] font-bold"
            style={{
              color: r.evolution
                ? creatorRoomTierDressing(r.evolution.stars).trimHex
                : undefined,
            }}
            data-testid="world-creator-room-evolution"
          >
            {creatorRoomEvolutionLine(r.evolution)}
          </span>
        )}
      </span>
      {r.occupantCount > 0 && (
        <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          <Users className="h-3.5 w-3.5" /> {r.occupantCount} in
        </span>
      )}
      <DoorOpen className="h-4 w-4 shrink-0 text-[#d4af37]" />
    </button>
  );
  return (
    <div className="space-y-2">
      {mine && row(mine, true)}
      {others.map((r) => row(r, false))}
      <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        Every room is its creator&rsquo;s place — their screen, their music rail, their Front Row,
        their store door. Pick one and the palace walks you through the arch.
      </p>
    </div>
  );
}

/* ─── Office hours (UPGRADE-PROGRAM 3.7) ──────────────────────────────
   The room's standing invitation, riding the palace calendar
   (world_events kind "office_hours"): the banner names the current
   or next booked session for EVERYONE in the room — the hours are
   the schedule's truth, and no copy here claims the host's body is
   present (who's standing in the room is the roster's read). The
   room's owner additionally gets the booking form and their
   sessions with cancel, right here in their own room. */

type OfficeHoursRow = OfficeHoursSession & { status: string };

function OfficeHoursBlock({
  detail,
  isLight,
  isOwnRoom,
}: {
  detail: CreatorRoomDetail;
  isLight: boolean;
  /** The walker owns this room (their slug == the room's slug):
   *  only the host sees the booking form — the server re-checks
   *  ownership on every write regardless. */
  isOwnRoom: boolean;
}) {
  const { getAccessToken } = useAuth();
  const [sessions, setSessions] = useState<OfficeHoursRow[] | null>(null);
  const [mine, setMine] = useState<OfficeHoursRow[]>([]);
  const [tick, setTick] = useState(0);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [startLocal, setStartLocal] = useState(() => nextHourLocalValue(Date.now()));
  const [durationMin, setDurationMin] = useState<number>(60);
  const [formError, setFormError] = useState<string | null>(null);
  const [formDone, setFormDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* The room's public calendar read — the same slate the Kingdom
   * Board reads palace-wide, narrowed to this room. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(officeHoursSlatePath(detail.roomId));
        if (!res.ok) throw new Error("slate");
        const parsed = parseOfficeHoursEvents(await res.json());
        if (!cancelled) setSessions(parsed);
      } catch {
        /* The room's own DTO seed still speaks for the marker. */
        if (!cancelled) setSessions((prev) => prev ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.roomId, tick]);

  /* The host's own bookings (auth) — the cancel list. */
  useEffect(() => {
    if (!isOwnRoom) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        if (!token) return;
        const res = await fetch(OFFICE_HOURS_MINE_PATH, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("mine");
        const parsed = parseOfficeHoursEvents(await res.json()).filter(
          (s) => s.status === "scheduled" || s.status === "live",
        );
        if (!cancelled) setMine(parsed);
      } catch {
        /* The form still works; the list keeps its last truth. */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwnRoom, tick, detail.roomId]);

  const now = Date.now();
  const fromSlate = sessions ? currentOrNextSession(sessions, now) : null;
  const seed = detail.officeHours
    ? {
        title: detail.officeHours.title,
        note: detail.officeHours.note,
        startsAt: detail.officeHours.startsAt,
        endsAt: detail.officeHours.endsAt,
      }
    : null;
  const marker = officeHoursMarker(fromSlate ?? seed, detail.displayName, now);
  const open = (sessions ?? []).filter(
    (s) =>
      (s.status === "scheduled" || s.status === "live") && Date.parse(s.endsAt) > now,
  );

  if (!marker && !isOwnRoom) return null;

  async function book() {
    setFormError(null);
    setFormDone(null);
    const built = buildOfficeHoursBooking(
      detail.slug,
      { title, note, startLocal, durationMin },
      Date.now(),
    );
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    setBusy(true);
    try {
      const token = await getAccessToken().catch(() => null);
      if (!token) {
        setFormError("Sign in to book your office hours.");
        return;
      }
      const res = await fetch(OFFICE_HOURS_BOOK_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(built.body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(officeHoursErrorCopy(res.status, payload));
        return;
      }
      setFormDone("Booked — it's on the palace calendar, and this room carries the hours.");
      /* One tap books the same slot next week. */
      setStartLocal((v) => plusDaysLocalValue(v, 7));
      setTick((n) => n + 1);
    } catch {
      setFormError("The booking wouldn't land — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setFormError(null);
    setFormDone(null);
    setBusy(true);
    try {
      const token = await getAccessToken().catch(() => null);
      if (!token) {
        setFormError("Sign in to manage your office hours.");
        return;
      }
      const res = await fetch(officeHoursCancelPath(id), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(officeHoursErrorCopy(res.status, payload));
        return;
      }
      setFormDone("Session cancelled — the calendar and the room read it already.");
      setTick((n) => n + 1);
    } catch {
      setFormError("The cancellation wouldn't land — try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]"
      : "border-[#d4af37]/25 bg-white/5 text-white"
  }`;

  return (
    <div
      className={`mb-3 rounded-2xl border px-3 py-3 ${
        isLight ? "border-[#C9A84C]/60 bg-[#FBF3DC]" : "border-[#d4af37]/35 bg-[#d4af37]/[0.06]"
      }`}
      data-testid="world-creator-room-office-hours"
    >
      {marker && (
        <div>
          <p
            className={`inline-flex flex-wrap items-center gap-2 text-sm font-black ${
              isLight ? "text-[#2a1e07]" : "text-white"
            }`}
          >
            <CalendarClock className="h-4 w-4 text-[#d4af37]" />
            {marker.headline}
            {marker.inSession && (
              <span className="rounded-full bg-[#d4af37] px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-black">
                On now
              </span>
            )}
          </p>
          <p className={`pt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            {marker.detail}
          </p>
          <p className={`pt-0.5 text-[11px] ${isLight ? "text-[#6B5B36]/80" : "text-white/35"}`}>
            Booked hours on the palace calendar — who&rsquo;s standing in the room is on its
            roster, not this card.
          </p>
        </div>
      )}
      {open.length > 0 && (
        <div className="pt-2" data-testid="world-creator-room-office-hours-upcoming">
          {open.slice(0, 4).map((s) => (
            <p
              key={s.id}
              className={`flex flex-wrap items-baseline justify-between gap-2 py-0.5 text-xs ${
                isLight ? "text-[#6B5B36]" : "text-white/50"
              }`}
            >
              <span className={`font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                {s.title}
              </span>
              <span>{officeHoursSessionWhen(s, now)}</span>
            </p>
          ))}
        </div>
      )}
      {isOwnRoom && (
        <div className="pt-3" data-testid="world-creator-room-office-hours-host">
          <p className={`text-xs font-black uppercase tracking-wide ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            Your office hours
          </p>
          <p className={`pb-2 pt-0.5 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Hold court in this room: book the hour, and fans find it on the palace calendar
            and on this room&rsquo;s door.
          </p>
          <div className="space-y-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Office hours — ask me anything"
              maxLength={120}
              className={inputCls}
              data-testid="world-office-hours-title"
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What the hour is for (optional) — e.g. mixing questions, beat feedback"
              maxLength={140}
              className={inputCls}
              data-testid="world-office-hours-note"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className={`rounded-xl border px-3 py-2 text-sm outline-none ${
                  isLight
                    ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]"
                    : "border-[#d4af37]/25 bg-white/5 text-white"
                }`}
                data-testid="world-office-hours-start"
              />
              <span className="inline-flex gap-1">
                {OFFICE_HOURS_DURATIONS_MIN.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDurationMin(m)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                      durationMin === m
                        ? "bg-[#d4af37] text-black"
                        : isLight
                          ? "border border-[#C9A84C]/60 text-[#7A5A12]"
                          : "border border-[#d4af37]/30 text-white/60"
                    }`}
                    data-testid={`world-office-hours-duration-${m}`}
                  >
                    {m}m
                  </button>
                ))}
              </span>
              <button
                type="button"
                onClick={book}
                disabled={busy}
                className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                data-testid="world-office-hours-book"
              >
                {busy ? "Booking…" : "Book the hour"}
              </button>
            </div>
            {formError && (
              <p className={`text-xs font-semibold ${isLight ? "text-[#9A3412]" : "text-red-300"}`} data-testid="world-office-hours-error">
                {formError}
              </p>
            )}
            {formDone && (
              <p className={`text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} data-testid="world-office-hours-done">
                {formDone}
              </p>
            )}
          </div>
          {mine.length > 0 && (
            <div className="pt-2" data-testid="world-office-hours-mine">
              {mine.map((s) => (
                <p
                  key={s.id}
                  className={`flex flex-wrap items-center justify-between gap-2 py-0.5 text-xs ${
                    isLight ? "text-[#6B5B36]" : "text-white/50"
                  }`}
                >
                  <span>
                    <span className={`font-semibold ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                      {s.title}
                    </span>{" "}
                    · {officeHoursSessionWhen(s, now)}
                    {s.status === "live" ? " · in session" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => cancel(s.id)}
                    disabled={busy}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition disabled:opacity-50 ${
                      isLight
                        ? "border border-[#C9A84C]/60 text-[#7A5A12]"
                        : "border border-[#d4af37]/30 text-white/60"
                    }`}
                    data-testid="world-office-hours-cancel"
                  >
                    Cancel
                  </button>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Inside a creator's room: the four stations ──────────────────── */

export function CreatorRoomStation({
  stationId,
  slug,
  isLight,
  isGuest,
  isOwnRoom,
  onDressingChanged,
  mySlug,
  shelfPlayer,
  onPlayTrack,
}: {
  stationId: string;
  slug: string;
  isLight: boolean;
  isGuest: boolean;
  /** True when the walker hosts this room — the dressing desk
   *  (Ring 4) hangs only in the host's own room. Guests and other
   *  members never see it: redressing is the owner's action. */
  isOwnRoom?: boolean;
  /** The host picked a new dressing — the page re-dresses the
   *  scene from a fresh room read. */
  onDressingChanged?: (slug: string) => void;
  /** The signed-in walker's own profile slug (null for guests):
   *  when it matches the room's slug, the walker is the host and
   *  the office-hours booking form rides the room (3.7). */
  mySlug: string | null;
  shelfPlayer: ShelfPlayerController;
  /** Portrait Card Play seam: the host's jukebox.add intent (the
   *  card's own contract — a card press in ANY room offers the
   *  track to the Music Hall jukebox; the room's own rail below
   *  plays on the Shelf player instead). */
  onPlayTrack: (trackId: string) => void;
}) {
  const { detail, failed, retry } = useRoomDetail(slug);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  if (failed) {
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-3">
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          This room&rsquo;s things wouldn&rsquo;t load — the room is here, its shelves slipped.
        </p>
        <button
          type="button"
          onClick={retry}
          className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
        >
          Try again
        </button>
      </div>
    );
  }
  if (!detail) {
    return (
      <p className={`inline-flex items-center gap-2 px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Stepping into {slug}&rsquo;s room…
      </p>
    );
  }

  /* The dressing desk (Ring 4): the host's own picker, at the
   * head of their room's stations. Only the host ever sees it —
   * isOwnRoom comes from the walker's own slug, and the pick
   * itself is enforced again server-side. */
  const dressingDesk = isOwnRoom ? (
    <CreatorRoomDressingPicker
      slug={slug}
      detail={detail}
      isLight={isLight}
      onDressingChanged={onDressingChanged}
    />
  ) : null;

  /* The room's evolution (Ring 3, Phase 5): the owner's earned
   * rung + what stands next, off the room DTO — shown at the head
   * of the room's stations. Unmeasured rooms show nothing. */
  const evoLine = creatorRoomEvolutionLine(detail.evolution);
  const evoHeader = evoLine ? (
    <p
      className="px-1 pb-2 text-xs font-bold"
      style={{
        color: detail.evolution
          ? creatorRoomTierDressing(detail.evolution.stars).trimHex
          : undefined,
      }}
      data-testid="world-creator-room-station-evolution"
    >
      {evoLine} — this room levels with its host.
    </p>
  ) : null;

  /* Office hours (3.7): the room's calendar card — marker for
   * everyone, the booking form for the room's own host — standing
   * at the head of every station, like the evolution line. */
  const officeBlock = (
    <OfficeHoursBlock
      detail={detail}
      isLight={isLight}
      isOwnRoom={!!mySlug && mySlug === slug}
    />
  );

  if (stationId === "creator-front-row") {
    const selected = detail.frontRow.find((m) => m.slug === selectedSlug) ?? null;
    if (selected) {
      return (
        <PortraitCard
          member={frontRowCourtMember(selected)}
          isLight={isLight}
          isGuest={isGuest}
          onPlayTrack={onPlayTrack}
          onBack={() => setSelectedSlug(null)}
        />
      );
    }
    if (detail.frontRow.length === 0) {
      return (
        <div>
          {dressingDesk}
          {officeBlock}
          <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            {detail.displayName} hasn&rsquo;t seated a Front Row yet — the chairs are here, the
            portraits come when they crown their court.
          </p>
        </div>
      );
    }
    return (
      <div>
        {evoHeader}
        {dressingDesk}
        {officeBlock}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {detail.frontRow.map((m) => (
            <button
              key={m.profileId}
              type="button"
              data-testid="world-creator-room-portrait"
              onClick={() => setSelectedSlug(m.slug)}
              className={`group flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-3 text-center transition ${
                isLight
                  ? "border-[#C9A84C]/50 bg-white/60 hover:border-[#7A5A12]"
                  : "border-[#d4af37]/25 bg-white/5 hover:border-[#d4af37]/70"
              }`}
            >
              {m.avatarUrl ? (
                <img
                  src={m.avatarUrl}
                  alt={m.displayName}
                  className="h-14 w-14 rounded-full border-2 border-[#d4af37] object-cover"
                />
              ) : (
                <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-[#d4af37] bg-gradient-to-br from-amber-300 to-amber-600 text-xl font-black text-black">
                  {m.displayName.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className={`w-full truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {m.displayName}
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-[#e8c86a]">
                <Crown className="h-3 w-3" /> Seat #{m.position}
              </span>
              <span className={`text-[11px] font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]/80"}`}>
                See their card →
              </span>
            </button>
          ))}
        </div>
        <p className={`px-1 pt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {detail.displayName}&rsquo;s Front Row — the creators they keep closest. A portrait
          opens that creator&rsquo;s card, right here in the room.
        </p>
      </div>
    );
  }

  if (stationId === "creator-music") {
    if (detail.tracks.length === 0) {
      return (
        <div>
          {dressingDesk}
          {officeBlock}
          <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            {detail.displayName} hasn&rsquo;t put any music on the rail yet — the shelf is here,
            waiting for their first published song.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        {evoHeader}
        {dressingDesk}
        {officeBlock}
        {detail.tracks.map((t) => {
          const isCurrent =
            !!shelfPlayer.current &&
            isSameShelfItem(shelfPlayer.current, { kind: "track", id: t.id });
          const isFeatured = detail.featuredTrack?.id === t.id;
          return (
            <div
              key={t.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
              }`}
            >
              {t.artworkUrl ? (
                <img src={t.artworkUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#d4af37]/15">
                  <Music2 className="h-5 w-5 text-[#d4af37]" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {t.title}
                  {isFeatured && (
                    <span className="ml-2 align-middle text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">
                      Featured
                    </span>
                  )}
                </span>
                <span className={`block text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                  {detail.displayName} · {t.playCount.toLocaleString("en-US")} plays
                </span>
              </span>
              <button
                type="button"
                data-testid="world-creator-room-track-play"
                onClick={() =>
                  isCurrent
                    ? shelfPlayer.toggle()
                    : shelfPlayer.play(creatorTrackPlayInput(t, detail))
                }
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105"
              >
                <Play className="h-3.5 w-3.5" />
                {isCurrent && shelfPlayer.playing ? "Pause" : "Play"}
              </button>
            </div>
          );
        })}
        <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          Plays here, for you, on the palace player — the room has no jukebox (that&rsquo;s the
          Music Hall&rsquo;s, two doors west of the hall).
        </p>
      </div>
    );
  }

  if (stationId === "creator-screen") {
    const video = detail.featuredVideo;
    if (!video) {
      return (
        <div>
          {dressingDesk}
          {officeBlock}
          <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            {detail.displayName} hasn&rsquo;t put a video on the screen yet — the screen wears
            their name until their first featured piece.
          </p>
        </div>
      );
    }
    const isCurrent =
      !!shelfPlayer.current &&
      isSameShelfItem(shelfPlayer.current, { kind: "video", id: video.id });
    return (
      <div className="space-y-2">
        {evoHeader}
        {dressingDesk}
        {officeBlock}
        <div
          className={`overflow-hidden rounded-2xl border ${isLight ? "border-[#C9A84C]/50" : "border-[#d4af37]/25"}`}
        >
          {video.thumbnailUrl ? (
            <img src={video.thumbnailUrl} alt={video.title} className="aspect-video w-full object-cover" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center bg-black/60">
              <Play className="h-10 w-10 text-[#d4af37]" />
            </div>
          )}
          <div className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${isLight ? "bg-white/60" : "bg-white/5"}`}>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {video.title}
              </span>
              <span className={`block text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                {detail.displayName} · {video.viewCount.toLocaleString("en-US")} views
              </span>
            </span>
            <button
              type="button"
              data-testid="world-creator-room-screen-play"
              onClick={() =>
                isCurrent
                  ? shelfPlayer.toggle()
                  : shelfPlayer.play(creatorVideoPlayInput(video, detail))
              }
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
            >
              <Play className="h-3.5 w-3.5" />
              {isCurrent && shelfPlayer.playing ? "Pause" : "Watch"}
            </button>
          </div>
        </div>
        <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          The same piece plays on the room&rsquo;s big screen behind you — turn around. Watching
          here gives you the sound and the transport; the screen on the wall is the room&rsquo;s
          ambient showing.
        </p>
      </div>
    );
  }

  /* creator-store */
  return (
    <div>
      {evoHeader}
      {dressingDesk}
      {officeBlock}
      <CreatorStorePanel detail={detail} isLight={isLight} isGuest={isGuest} />
    </div>
  );
}

/* ─── Their Store: the profile store catalog, sold in the room ─────
   Stack-100 #64. The catalog is the profile store DTO
   (GET /api/creator-profiles/:slug/store-catalog) — every item is
   sold on the rail that sells it on the website, classified by
   lib/world/money-desks roomItemRail:
   - the creator's SHOP products ride the Marketplace rails, with
     the Marketplace stand's own cart: local lines persisted under
     the shop page's cart key (the room cart and the stand cart
     for this shop are ONE cart), quantities, and ONE
     POST /api/storefronts/checkout for the whole cart — the
     order records PENDING, the hosted payment page opens in a
     NEW TAB (the sanctioned transfer), and only a server-confirmed
     paid order (verify on focus/reopen) ever renders as paid.
     The fee line is the stand's: sellers keep 95%, the 5%
     platform fee comes out of the seller's cut, never on top.
   - tracks and videos ride the profile store rail
     (POST /api/store/checkout, the store-buy page's exact body,
     name-your-price honored against the creator's minimum) —
     hosted checkout in a new tab, members only (the rail is
     auth-required; guests get the sign-in pitch, never a doomed
     button);
   - store products ride POST /api/storefront/checkout with the
     product page's quantity — same treatment;
   - a kind no rail sells keeps the website buy door, labelled as
     what it is.
   The old panel's blanket "Buy on the website" is gone: buying
   completes from this room now. */

/** The one way a hosted payment page opens from the room store:
 *  a new tab, at the checkout moment, on the walker's click — the
 *  stands' uniform seam (§3.9). */
function openCheckoutTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function CreatorStorePanel({ detail, isLight, isGuest }: { detail: CreatorRoomDetail; isLight: boolean; isGuest: boolean }) {
  const { getAccessToken } = useAuth();
  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
  const [items, setItems] = useState<RoomStoreItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pwywInputs, setPwywInputs] = useState<Record<string, string>>({});
  const [qtyInputs, setQtyInputs] = useState<Record<string, number>>({});

  const handle = detail.storefront?.handle ?? null;
  const shopId = detail.storefront?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/creator-profiles/${encodeURIComponent(detail.slug)}/store-catalog`,
        );
        if (!res.ok) throw new Error("catalog");
        const parsed = parseRoomCatalog(await res.json());
        if (!cancelled) setItems(parsed);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.slug]);

  /* ── The market cart (the Marketplace stand's own discipline) ── */
  const marketProducts = useMemo(() => (items ? roomMarketProducts(items) : []), [items]);
  const cartStorageKey = roomCartKey(handle, detail.slug);
  const [cart, setCart] = useState<CartLine[]>([]);
  const cartLoaded = useRef(false);
  useEffect(() => {
    cartLoaded.current = false;
    try {
      const raw = localStorage.getItem(cartStorageKey);
      const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
      setCart(Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.productId === "string") : []);
    } catch {
      setCart([]);
    }
    cartLoaded.current = true;
  }, [cartStorageKey]);
  useEffect(() => {
    if (!cartLoaded.current) return;
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    } catch { /* storage blocked — the cart just won't persist */ }
  }, [cart, cartStorageKey]);

  const detailed = useMemo(() => detailedMarketCart(cart, marketProducts), [cart, marketProducts]);
  const total = marketCartTotalCents(detailed);
  const count = marketCartCount(detailed);
  const [buyerEmail, setBuyerEmail] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [paidOrder, setPaidOrder] = useState<MarketOrder | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [refreshingOrder, setRefreshingOrder] = useState(false);

  const refreshOrder = async () => {
    if (!handle || refreshingOrder) return;
    let sessionId: string | null = null;
    try { sessionId = localStorage.getItem(marketPendingKey(handle)); } catch { /* storage blocked */ }
    if (!sessionId) return;
    setRefreshingOrder(true);
    try {
      const res = await fetch("/api/storefronts/checkout/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error("verify");
      const order = marketOrderFromPayload(data["order"] ?? data);
      if (order?.paid) {
        setPaidOrder(order);
        setPendingNote(null);
        setCart([]);
        try { localStorage.removeItem(marketPendingKey(handle)); } catch { /* ignore */ }
      } else if (order?.status === "expired") {
        setPendingNote("That checkout expired before payment — the order was never charged. Your cart is still here whenever you're ready.");
        try { localStorage.removeItem(marketPendingKey(handle)); } catch { /* ignore */ }
      } else {
        setPendingNote("Your order is saved as pending — payment hasn't confirmed yet. Finish at the hosted checkout, then check again here.");
      }
    } catch {
      setPendingNote("Your order is saved as pending — its status couldn't be refreshed just now. Nothing about it was changed.");
    } finally {
      setRefreshingOrder(false);
    }
  };
  const refreshOrderRef = useRef(refreshOrder);
  refreshOrderRef.current = refreshOrder;
  useEffect(() => {
    if (!handle) return;
    void refreshOrderRef.current();
    const onFocus = () => void refreshOrderRef.current();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  const checkoutCart = async () => {
    if (!shopId || detailed.length === 0 || placing) return;
    setPlacing(true);
    setOrderError(null);
    setPendingNote(null);
    try {
      const res = await fetch("/api/storefronts/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId,
          items: detailed.map((l) => ({ productId: l.productId, quantity: l.qty })),
          buyerEmail: buyerEmail.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Checkout didn't start — nothing was charged."));
      if (checkoutCompletedInWorld(data)) {
        const order = marketOrderFromPayload(data);
        if (order?.paid) setPaidOrder(order);
        setCart([]);
        return;
      }
      const url = hostedCheckoutUrl(data);
      if (url) {
        if (typeof data.sessionId === "string" && handle) {
          try { localStorage.setItem(marketPendingKey(handle), data.sessionId); } catch { /* storage blocked */ }
        }
        openCheckoutTab(url);
        setPendingNote("Your checkout opened in a new tab — finish paying there. This room keeps your place and your cart, and confirms the order here when the payment lands.");
        return;
      }
      throw new Error("Checkout didn't return a payment page — nothing was charged.");
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : "Checkout didn't start — nothing was charged, and your cart is untouched.");
    } finally {
      setPlacing(false);
    }
  };

  /* ── The single-item rails (store + storefront products) ── */
  const buySingle = async (item: RoomStoreItem) => {
    if (busyId) return;
    if (isGuest) {
      setNote("Buying rides your account — sign in on the website (the footer below) and come back through this door; the goods will be waiting.");
      return;
    }
    const rail = roomItemRail(item);
    setBusyId(item.id);
    setBuyError(null);
    setNote(null);
    try {
      if (rail === "store") {
        const shaped = storeCheckoutPayload(item, pwywInputs[item.id] ?? "");
        if (!shaped.ok) throw new Error(shaped.problem);
        const res = await fetch("/api/store/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(shaped.body),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) throw new Error(apiErrorLine(data, "Checkout failed."));
        const url = hostedCheckoutUrl(data);
        if (!url) throw new Error("Checkout didn't return a payment page — nothing was charged.");
        openCheckoutTab(url);
        setNote(`Checkout for “${item.title}” opened in a new tab — finish paying there; your download lands with the payment.`);
        return;
      }
      if (rail === "storefront") {
        const res = await fetch("/api/storefront/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(storefrontCheckoutPayload(item, qtyInputs[item.id] ?? 1)),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) throw new Error(apiErrorLine(data, "Checkout failed."));
        const url = hostedCheckoutUrl(data);
        if (!url) throw new Error("Checkout didn't return a payment page — nothing was charged.");
        openCheckoutTab(url);
        setNote(`Checkout for “${item.title}” opened in a new tab — finish paying there.`);
        return;
      }
    } catch (e) {
      setBuyError(e instanceof Error ? e.message : "Checkout failed — nothing was charged.");
    } finally {
      setBusyId(null);
    }
  };

  const mutedCls = isLight ? "text-[#6B5B36]" : "text-white/55";
  const cardCls = isLight ? "border-[#C9A84C]/50 bg-white/60" : "border-[#d4af37]/25 bg-white/5";
  const chipCls = `inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold transition ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`;

  return (
    <div className="space-y-2">
      <p className={`inline-flex items-center gap-2 px-1 text-xs font-semibold ${mutedCls}`}>
        <ShoppingBag className="h-4 w-4 text-[#d4af37]" />
        {detail.storefront
          ? `${detail.displayName} also runs ${detail.storefront.name} — its goods cart and check out right here, on the Marketplace rails.`
          : `${detail.displayName}'s store, on their profile's own rails — bought right here in the room.`}
      </p>
      {failed ? (
        <p className={`px-1 py-2 text-sm ${mutedCls}`}>
          The store wouldn&rsquo;t open — the goods are fine, the stand slipped.
        </p>
      ) : items === null ? (
        <p className={`inline-flex items-center gap-2 px-1 py-2 text-sm ${mutedCls}`}>
          <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Setting out the goods…
        </p>
      ) : items.length === 0 ? (
        <p className={`px-1 py-2 text-sm ${mutedCls}`}>
          Nothing is for sale here yet — the stand is built, the shelves fill when{" "}
          {detail.displayName} lists their first piece.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {items.map((item) => {
              const rail = roomItemRail(item);
              return (
                <div
                  key={`${item.kind}-${item.id}`}
                  data-testid="world-room-store-item"
                  className={`flex flex-col gap-1.5 rounded-2xl border px-3 py-3 ${cardCls}`}
                >
                  {item.artworkUrl ? (
                    <img src={item.artworkUrl} alt="" className="aspect-square w-full rounded-xl object-cover" />
                  ) : (
                    <span className="flex aspect-square w-full items-center justify-center rounded-xl bg-[#d4af37]/10">
                      <ShoppingBag className="h-7 w-7 text-[#d4af37]" />
                    </span>
                  )}
                  <span className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    {item.title}
                  </span>
                  {item.price && (
                    <span className={`text-xs font-black ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                      {item.price}
                    </span>
                  )}
                  {rail === "market" ? (
                    <button
                      type="button"
                      data-testid="world-room-store-add"
                      onClick={() => setCart((c) => addToCartLines(c, item.id))}
                      className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add to cart
                    </button>
                  ) : rail === "store" ? (
                    <>
                      {item.pwyw?.enabled && (
                        <input
                          value={pwywInputs[item.id] ?? ""}
                          onChange={(e) => setPwywInputs((m) => ({ ...m, [item.id]: e.target.value }))}
                          inputMode="decimal"
                          placeholder={`Your price — min $${(item.pwyw.minCents / 100).toFixed(2)}`}
                          aria-label={`Your price for ${item.title}`}
                          className={`w-full rounded-xl border px-2.5 py-1.5 text-xs outline-none ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black/50 text-white"}`}
                        />
                      )}
                      <button
                        type="button"
                        data-testid="world-room-store-buy"
                        onClick={() => void buySingle(item)}
                        disabled={busyId === item.id}
                        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                      >
                        {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />}
                        {CHECKOUT_TRANSFER_LABEL}
                      </button>
                    </>
                  ) : rail === "storefront" ? (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <button type="button" aria-label="One less" onClick={() => setQtyInputs((m) => ({ ...m, [item.id]: Math.max(1, (m[item.id] ?? 1) - 1) }))} className={chipCls}><Minus className="h-3 w-3" /></button>
                        <span className="w-5 text-center text-xs font-bold">{qtyInputs[item.id] ?? 1}</span>
                        <button type="button" aria-label="One more" onClick={() => setQtyInputs((m) => ({ ...m, [item.id]: Math.min(99, (m[item.id] ?? 1) + 1) }))} className={chipCls}><Plus className="h-3 w-3" /></button>
                      </span>
                      <button
                        type="button"
                        data-testid="world-room-store-buy"
                        onClick={() => void buySingle(item)}
                        disabled={busyId === item.id}
                        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                      >
                        {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />}
                        {CHECKOUT_TRANSFER_LABEL}
                      </button>
                    </>
                  ) : item.buyUrl ? (
                    <a
                      href={item.buyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                    >
                      Buy on the website
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>

          {(detailed.length > 0 || paidOrder || pendingNote) && shopId && (
            <div className={`rounded-2xl border px-3 py-3 ${cardCls}`} data-testid="world-room-store-cart">
              <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                Your cart{count > 0 ? ` (${count})` : ""}
              </p>
              {detailed.map((l) => (
                <div key={l.productId} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{l.product.name}</span>
                  <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(l.product.price_cents * l.qty)}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <button type="button" aria-label="One less" onClick={() => setCart((c) => setCartLineQty(c, l.productId, l.qty - 1))} className={chipCls}><Minus className="h-3 w-3" /></button>
                    <span className="w-5 text-center text-sm font-bold">{l.qty}</span>
                    <button type="button" aria-label="One more" onClick={() => setCart((c) => setCartLineQty(c, l.productId, l.qty + 1))} className={chipCls}><Plus className="h-3 w-3" /></button>
                    <button type="button" aria-label="Remove from cart" onClick={() => setCart((c) => setCartLineQty(c, l.productId, 0))} className={chipCls}><Trash2 className="h-3 w-3" /></button>
                  </span>
                </div>
              ))}
              {detailed.length > 0 && !paidOrder && (
                <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className={mutedCls}>Total</span>
                    <span className="text-lg font-black">{centsToDisplay(total)}</span>
                  </div>
                  <input
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    type="email"
                    placeholder="Email for your receipt (optional)"
                    className={`w-full rounded-xl border px-3 py-2 text-sm outline-none ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black/50 text-white"}`}
                  />
                  {orderError && <p className="text-xs font-semibold text-red-400">{orderError}</p>}
                  <button type="button" data-testid="world-room-store-checkout" onClick={() => void checkoutCart()} disabled={placing} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
                    {placing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                    {CHECKOUT_TRANSFER_LABEL} · {centsToDisplay(total)}
                  </button>
                  <p className={`text-[11px] ${mutedCls}`}>
                    Sellers keep 95% — the 5% platform fee comes out of the seller&rsquo;s cut, never on top of your price.
                  </p>
                </div>
              )}
              {pendingNote && !paidOrder && (
                <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-room-store-pending">
                  <p className="flex items-start gap-2 text-xs font-semibold text-amber-300">
                    <Loader2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${refreshingOrder ? "animate-spin" : ""}`} />
                    <span>{pendingNote}</span>
                  </p>
                  <p className={`text-[11px] ${mutedCls}`}>
                    This order is pending — it is not paid yet, and it will never be shown as paid until the payment confirms.
                  </p>
                  <button type="button" onClick={() => void refreshOrder()} disabled={refreshingOrder} className={chipCls}>
                    Check again
                  </button>
                </div>
              )}
              {paidOrder && (
                <div className="mt-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-room-store-paid">
                  <p className={`flex items-start gap-2 text-xs font-bold ${isLight ? "text-[#4a6b1f]" : "text-emerald-300"}`}>
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Paid — {centsToDisplay(paidOrder.gross_cents)} confirmed by the payment rail.
                      {paidOrder.lines.length > 0 && <> Yours: {paidOrder.lines.map((l) => l.productName ?? "your piece").join(", ")}.</>}
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {note && <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
      {buyError && <p className="px-1 text-xs font-semibold text-red-400">{buyError}</p>}
      <p className={`inline-flex items-center gap-1.5 px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        <Home className="h-3.5 w-3.5 text-[#d4af37]" />
        Buying finishes at the hosted checkout, in a new tab — the room keeps your place, and the
        cart here is the same cart as this creator&rsquo;s Marketplace stand.
      </p>
    </div>
  );
}
