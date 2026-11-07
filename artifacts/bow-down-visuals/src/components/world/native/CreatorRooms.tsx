import { plainErrorText } from "../../../lib/api-error";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarClock,
  Check,
  Crown,
  DoorOpen,
  Gift,
  Home,
  Loader2,
  Lock,
  Mail,
  Music2,
  Paintbrush,
  Minus,
  Play,
  Plus,
  ShoppingBag,
  Trash2,
  UserPlus,
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
  officeHoursStrings,
  parseOfficeHoursEvents,
  plusDaysLocalValue,
  OFFICE_HOURS_BOOK_PATH,
  OFFICE_HOURS_DURATIONS_MIN,
  OFFICE_HOURS_MINE_PATH,
  type OfficeHoursSession,
} from "@/lib/world/office-hours";
import {
  answerRoomInvite,
  creatorRoomsStrings,
  creatorTrackPlayInput,
  creatorVideoPlayInput,
  fetchCreatorRoomDetail,
  fetchCreatorRoomDirectory,
  fetchRoomInviteCandidates,
  fetchRoomInvitesMine,
  frontRowCourtMember,
  putCreatorRoomDressing,
  sendRoomInvite,
  type CreatorRoomDetail,
  type CreatorRoomDressing,
  type CreatorRoomSummary,
  type RoomInviteCandidate,
  type WorldRoomInvite,
} from "@/lib/world/creator-rooms";
import {
  creatorRoomEvolutionLine,
  creatorRoomEvolutionStrings,
  creatorRoomStars,
  creatorRoomTierDressing,
} from "@/lib/world/creator-room-tier";
import {
  roomDressingBandName,
  roomDressingOptions,
  roomDressingStrings,
  roomDressingStyleWords,
} from "@/lib/world/creator-room-dressing";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import { useUserMode } from "@/contexts/UserModeContext";
import { centsToDisplay, type CartLine } from "@/lib/shops";
import {
  checkoutTransferLabel,
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
import {
  emptyGiftCardForm,
  giftCardCheckoutPayload,
  giftCardFormAmount,
  giftCardFormProblem,
  giftCardPendingKey,
  giftCardVerifyState,
  paidWithGiftCard,
  parseGiftCardPending,
  parseGiftCardVerify,
  type GiftCardFormState,
  type GiftCardVerifyResult,
} from "@/lib/world/gift-cards";
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

function loadRoomDetail(
  slug: string,
  strings?: ReturnType<typeof creatorRoomsStrings>,
): Promise<CreatorRoomDetail | null> {
  const cached = detailCache.get(slug);
  if (cached) return Promise.resolve(cached);
  const flying = detailInflight.get(slug);
  if (flying) return flying;
  const p = fetchCreatorRoomDetail(slug, undefined, strings).then((detail) => {
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
  const { t } = useTranslation();
  const roomsStrings = creatorRoomsStrings((k) => t(k));
  const dressingStrings = roomDressingStrings((k) => t(k));
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

  const options = roomDressingOptions(gateStars, dressingStrings);
  const currentId = dressing?.variantId ?? null;

  const pick = async (variantId: string) => {
    if (variantId === currentId || savingId) return;
    setSavingId(variantId);
    setError(null);
    setSaved(false);
    try {
      const token = await getAccessToken();
      const resolved = await putCreatorRoomDressing(slug, variantId, gateStars, token, roomsStrings);
      setDressing(resolved);
      patchCachedRoomDressing(slug, resolved);
      setSaved(true);
      onDressingChanged?.(slug);
    } catch (err) {
      setError(plainErrorText(err, t("worldCreatorRooms.dressingSaveFallback")));
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
        <Paintbrush className="h-4 w-4 text-[#d4af37]" /> {t("worldCreatorRooms.dressingTitle")}
      </p>
      <p className={`pt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        {dressing
          ? dressing.picked
            ? t("worldCreatorRooms.dressingWearingPicked", { name: dressing.name })
            : t("worldCreatorRooms.dressingWearingDefault", { name: dressing.name })
          : t("worldCreatorRooms.dressingNone")}
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
                      {roomDressingStyleWords(variant, dressingStrings)}
                    </span>
                    {isCurrent && (
                      <span className="text-[11px] font-black uppercase tracking-wide text-[#e8c86a]">
                        {t("worldCreatorRooms.dressingWearing")}
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
          {t("worldCreatorRooms.dressingSaveError", { error })}
        </p>
      )}
      {saved && !error && (
        <p className={`pt-2 text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          {t("worldCreatorRooms.dressingSaved")}
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
  const { t } = useTranslation();
  const roomsStrings = creatorRoomsStrings((k) => t(k));
  const [detail, setDetail] = useState<CreatorRoomDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setFailed(false);
    loadRoomDetail(slug, roomsStrings).then((d) => {
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

/* ─── Room invites (stack900 Lane B4) ───────────────────────────────
   The recorded invitation, docked in the directory — the surface
   where members already manage rooms. Three parts, each shown
   only when it has something to say:
   - "Invites for you": a host named YOU (never an anonymous
     link) — Accept records the yes and the room joins "Rooms
     you're in"; Decline records the no and the row simply leaves.
   - "Rooms you're in": the invites you accepted, each with the
     same Enter the directory's own rows ride — walking in stays
     the palace's one doorway transfer, no second door.
   - "Invite to your room" (hosts only): pick a person from the
     member list (search by name) and the invite goes out under
     your name; the server's plain words answer a refusal (a
     duplicate already out reads exactly as it is).
   Every control is a native button or input, so the panel's
   controller navigation (usePanelPadNav) walks them like every
   other control in the panel. Guests see none of it: an invite
   names a member, and a guest is nobody yet. */

function CreatorRoomInvitesBlock({
  isLight,
  mySlug,
  onEnterCreatorRoom,
}: {
  isLight: boolean;
  mySlug: string | null;
  onEnterCreatorRoom: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const roomsStrings = creatorRoomsStrings((k) => t(k));
  const { user, getAccessToken } = useAuth();
  const [mine, setMine] = useState<{ pending: WorldRoomInvite[]; accepted: WorldRoomInvite[] } | null>(null);
  const [mineFailed, setMineFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [answerDone, setAnswerDone] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<RoomInviteCandidate[] | null>(null);
  const [candidatesFailed, setCandidatesFailed] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<ReadonlySet<string>>(new Set());
  const [sendError, setSendError] = useState<string | null>(null);

  /* My standing invites — refetched after every answer, so the
   * sections always show the server's record, never a local
   * guess at it. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setMineFailed(false);
    (async () => {
      try {
        const token = await getAccessToken();
        const standing = await fetchRoomInvitesMine(token, roomsStrings);
        if (!cancelled) setMine(standing);
      } catch {
        if (!cancelled) setMineFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken, tick]);

  /* The member list for the picker — hosts only, debounced on the
   * search so each keystroke doesn't fire its own read. */
  useEffect(() => {
    if (!user || !mySlug) return;
    let cancelled = false;
    const t = setTimeout(() => {
      (async () => {
        try {
          const token = await getAccessToken();
          const members = await fetchRoomInviteCandidates(token, query, roomsStrings);
          if (!cancelled) {
            setCandidates(members);
            setCandidatesFailed(false);
          }
        } catch {
          if (!cancelled) setCandidatesFailed(true);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user, mySlug, query, getAccessToken]);

  if (!user) return null;

  const answer = async (invite: WorldRoomInvite, which: "accept" | "decline") => {
    if (answeringId) return;
    setAnsweringId(invite.id);
    setAnswerError(null);
    setAnswerDone(null);
    try {
      const token = await getAccessToken();
      await answerRoomInvite(invite.id, which, token, roomsStrings);
      setAnswerDone(
        which === "accept"
          ? t("worldCreatorRooms.inviteAcceptedDone", { room: invite.roomName })
          : t("worldCreatorRooms.inviteDeclinedDone"),
      );
      setTick((n) => n + 1);
    } catch (err) {
      setAnswerError(plainErrorText(err, t("worldCreatorRooms.inviteAnswerFallback")));
    } finally {
      setAnsweringId(null);
    }
  };

  const send = async (candidate: RoomInviteCandidate) => {
    if (!mySlug || sendingId) return;
    setSendingId(candidate.userId);
    setSendError(null);
    try {
      const token = await getAccessToken();
      await sendRoomInvite(mySlug, candidate.userId, token, roomsStrings);
      setSentIds((prev) => new Set(prev).add(candidate.userId));
    } catch (err) {
      setSendError(plainErrorText(err, t("worldCreatorRooms.inviteSendFallback")));
    } finally {
      setSendingId(null);
    }
  };

  const cardClass = `rounded-2xl border px-3 py-3 ${
    isLight ? "border-[#C9A84C]/50 bg-white/60" : "border-[#d4af37]/25 bg-white/5"
  }`;
  const headingClass = `inline-flex items-center gap-2 text-xs font-black uppercase tracking-wide ${
    isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
  }`;
  const subClass = `text-xs ${isLight ? "text-[#6B5B36]" : "text-white/55"}`;
  const errorClass = `text-xs font-semibold ${isLight ? "text-[#9A3412]" : "text-red-300"}`;
  const doneClass = `text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`;
  const avatar = (url: string | null, name: string) =>
    url ? (
      <img src={url} alt={name} className="h-9 w-9 shrink-0 rounded-full border-2 border-[#d4af37]/60 object-cover" />
    ) : (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-[#d4af37]/60 bg-gradient-to-br from-[#f0d488] to-[#d4af37] text-sm font-black text-black">
        {name.slice(0, 1).toUpperCase()}
      </span>
    );

  const showMine = mineFailed || (mine !== null && (mine.pending.length > 0 || mine.accepted.length > 0));

  return (
    <>
      {showMine && (
        <div className={cardClass} data-testid="world-room-invites-for-you">
          <p className={headingClass}>
            <Mail className="h-4 w-4 text-[#d4af37]" /> {t("worldCreatorRooms.inviteForYouTitle")}
          </p>
          {mineFailed ? (
            <div className="flex flex-col items-start gap-2 pt-2">
              <p className={subClass}>{t("worldCreatorRooms.inviteLoadFailed")}</p>
              <button
                type="button"
                onClick={() => setTick((n) => n + 1)}
                className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
              >
                {t("worldCreatorRooms.inviteTryAgain")}
              </button>
            </div>
          ) : (
            <>
              {mine!.pending.length > 0 && (
                <div className="space-y-2 pt-2">
                  {mine!.pending.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex flex-wrap items-center gap-2.5"
                      data-testid="world-room-invite-pending"
                    >
                      {avatar(invite.hostAvatarUrl, invite.hostName)}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                          {t("worldCreatorRooms.inviteInvitedYou", { host: invite.hostName })}
                        </span>
                        <span className={`block truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                          {t("worldCreatorRooms.inviteRoomTagline", { room: invite.roomName })}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={answeringId !== null}
                        onClick={() => void answer(invite, "accept")}
                        className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                        data-testid="world-room-invite-accept"
                      >
                        {answeringId === invite.id ? t("worldCreatorRooms.inviteAnswering") : t("worldCreatorRooms.inviteAccept")}
                      </button>
                      <button
                        type="button"
                        disabled={answeringId !== null}
                        onClick={() => void answer(invite, "decline")}
                        className={`rounded-full border px-4 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                          isLight
                            ? "border-[#C9A84C]/60 text-[#7A5A12] hover:border-[#7A5A12]"
                            : "border-[#d4af37]/30 text-white/70 hover:border-[#d4af37]/70"
                        }`}
                        data-testid="world-room-invite-decline"
                      >
                        {t("worldCreatorRooms.inviteDecline")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {mine!.accepted.length > 0 && (
                <div className="space-y-2 pt-2">
                  <p className={subClass}>{t("worldCreatorRooms.inviteRoomsYours")}</p>
                  {mine!.accepted.map((invite) => (
                    <div
                      key={invite.id}
                      className="flex flex-wrap items-center gap-2.5"
                      data-testid="world-room-invite-accepted"
                    >
                      {avatar(invite.hostAvatarUrl, invite.hostName)}
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                          {invite.roomName}
                        </span>
                        <span className={`block truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                          {t("worldCreatorRooms.inviteHostInvitedYou", { host: invite.hostName })}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onEnterCreatorRoom(invite.slug)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                        data-testid="world-room-invite-enter"
                      >
                        <DoorOpen className="h-3.5 w-3.5" /> {t("worldCreatorRooms.inviteEnter")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {answerError && (
                <p className={`${errorClass} pt-2`} data-testid="world-room-invite-answer-error">
                  {answerError}
                </p>
              )}
              {answerDone && (
                <p className={`${doneClass} pt-2`} data-testid="world-room-invite-answer-done">
                  {answerDone}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {mySlug && (
        <div className={cardClass} data-testid="world-room-invites-send">
          <p className={headingClass}>
            <UserPlus className="h-4 w-4 text-[#d4af37]" /> {t("worldCreatorRooms.inviteSendTitle")}
          </p>
          <p className={`${subClass} pt-1`}>
            {t("worldCreatorRooms.inviteSendIntro")}
          </p>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("worldCreatorRooms.inviteSearchPlaceholder")}
            aria-label={t("worldCreatorRooms.inviteSearchAria")}
            className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
              isLight
                ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#7A5A12]"
                : "border-[#d4af37]/25 bg-white/5 text-white placeholder:text-white/35 focus:border-[#d4af37]/70"
            }`}
            data-testid="world-room-invite-search"
          />
          <div className="space-y-2 pt-2">
            {candidatesFailed ? (
              <p className={subClass}>{t("worldCreatorRooms.inviteListFailed")}</p>
            ) : candidates === null ? (
              <p className={`inline-flex items-center gap-2 ${subClass}`}>
                <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {t("worldCreatorRooms.inviteListLoading")}
              </p>
            ) : candidates.length === 0 ? (
              <p className={subClass}>
                {query.trim()
                  ? t("worldCreatorRooms.inviteNoMatch")
                  : t("worldCreatorRooms.inviteListEmpty")}
              </p>
            ) : (
              candidates.map((candidate) => {
                const sent = sentIds.has(candidate.userId);
                return (
                  <div
                    key={candidate.userId}
                    className="flex flex-wrap items-center gap-2.5"
                    data-testid="world-room-invite-candidate"
                  >
                    {avatar(candidate.avatarUrl, candidate.displayName)}
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                        {candidate.displayName}
                      </span>
                      <span className={`block truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                        /artist/{candidate.slug}
                      </span>
                    </span>
                    {sent ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                        <Check className="h-3.5 w-3.5" /> {t("worldCreatorRooms.inviteSent")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={sendingId !== null}
                        onClick={() => void send(candidate)}
                        className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                        data-testid="world-room-invite-send-button"
                      >
                        {sendingId === candidate.userId ? t("worldCreatorRooms.inviteSending") : t("worldCreatorRooms.inviteSend")}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {sendError && (
            <p className={`${errorClass} pt-2`} data-testid="world-room-invite-send-error">
              {sendError}
            </p>
          )}
        </div>
      )}
    </>
  );
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
  const { t, i18n } = useTranslation();
  const roomsStrings = creatorRoomsStrings((k) => t(k));
  const evoStrings = creatorRoomEvolutionStrings((k) => t(k));
  const [rooms, setRooms] = useState<CreatorRoomSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetchCreatorRoomDirectory(undefined, roomsStrings)
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
          {t("worldCreatorRooms.dirLoadFailed")}
        </p>
        <button
          type="button"
          onClick={() => setTick((n) => n + 1)}
          className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
        >
          {t("worldCreatorRooms.inviteTryAgain")}
        </button>
      </div>
    );
  }
  if (rooms === null) {
    return (
      <p className={`inline-flex items-center gap-2 px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {t("worldCreatorRooms.dirOpening")}
      </p>
    );
  }
  if (rooms.length === 0) {
    return (
      <p className={`px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        {t("worldCreatorRooms.dirEmpty")}
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
          {isMine ? t("worldCreatorRooms.dirYourRoom") : r.roomName}
        </span>
        <span className={`block truncate text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          {isMine ? t("worldCreatorRooms.dirMinePrefix", { name: r.displayName }) : ""}
          {r.hasContent
            ? t("worldCreatorRooms.dirHasContent")
            : t("worldCreatorRooms.dirNoContent")}
        </span>
        {creatorRoomEvolutionLine(r.evolution, evoStrings, i18n.language) && (
          <span
            className="block truncate text-[11px] font-bold"
            style={{
              color: r.evolution
                ? creatorRoomTierDressing(r.evolution.stars).trimHex
                : undefined,
            }}
            data-testid="world-creator-room-evolution"
          >
            {creatorRoomEvolutionLine(r.evolution, evoStrings, i18n.language)}
          </span>
        )}
      </span>
      {r.occupantCount > 0 && (
        <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          <Users className="h-3.5 w-3.5" /> {t("worldCreatorRooms.dirOccupants", { count: r.occupantCount.toLocaleString(i18n.language) })}
        </span>
      )}
      <DoorOpen className="h-4 w-4 shrink-0 text-[#d4af37]" />
    </button>
  );
  return (
    <div className="space-y-2">
      {mine && row(mine, true)}
      <CreatorRoomInvitesBlock
        isLight={isLight}
        mySlug={mySlug}
        onEnterCreatorRoom={onEnterCreatorRoom}
      />
      {others.map((r) => row(r, false))}
      <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        {t("worldCreatorRooms.dirFooter")}
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
  const { t, i18n } = useTranslation();
  const officeStrings = officeHoursStrings((k) => t(k));
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
  const marker = officeHoursMarker(fromSlate ?? seed, detail.displayName, now, officeStrings, i18n.language);
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
      officeStrings,
    );
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    setBusy(true);
    try {
      const token = await getAccessToken().catch(() => null);
      if (!token) {
        setFormError(t("worldCreatorRooms.officeSignInBook"));
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
        setFormError(officeHoursErrorCopy(res.status, payload, officeStrings));
        return;
      }
      setFormDone(t("worldCreatorRooms.officeBookedDone"));
      /* One tap books the same slot next week. */
      setStartLocal((v) => plusDaysLocalValue(v, 7));
      setTick((n) => n + 1);
    } catch {
      setFormError(t("worldCreatorRooms.officeBookFailed"));
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
        setFormError(t("worldCreatorRooms.officeSignInManage"));
        return;
      }
      const res = await fetch(officeHoursCancelPath(id), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(officeHoursErrorCopy(res.status, payload, officeStrings));
        return;
      }
      setFormDone(t("worldCreatorRooms.officeCancelledDone"));
      setTick((n) => n + 1);
    } catch {
      setFormError(t("worldCreatorRooms.officeCancelFailed"));
    } finally {
      setBusy(false);
    }
  }

  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${
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
                {t("worldCreatorRooms.officeOnNow")}
              </span>
            )}
          </p>
          <p className={`pt-1 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
            {marker.detail}
          </p>
          <p className={`pt-0.5 text-[11px] ${isLight ? "text-[#6B5B36]/80" : "text-white/35"}`}>
            {t("worldCreatorRooms.officeMarkerNote")}
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
              <span>{officeHoursSessionWhen(s, now, officeStrings, i18n.language)}</span>
            </p>
          ))}
        </div>
      )}
      {isOwnRoom && (
        <div className="pt-3" data-testid="world-creator-room-office-hours-host">
          <p className={`text-xs font-black uppercase tracking-wide ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("worldCreatorRooms.officeYoursTitle")}
          </p>
          <p className={`pb-2 pt-0.5 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("worldCreatorRooms.officeYoursIntro")}
          </p>
          <div className="space-y-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("worldCreatorRooms.officeTitlePlaceholder")}
              maxLength={120}
              className={inputCls}
              data-testid="world-office-hours-title"
              aria-label={t("worldCreatorRooms.officeTitleAria")}
            />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("worldCreatorRooms.officeNotePlaceholder")}
              maxLength={140}
              className={inputCls}
              data-testid="world-office-hours-note"
              aria-label={t("worldCreatorRooms.officeNoteAria")}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                className={`rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${
                  isLight
                    ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]"
                    : "border-[#d4af37]/25 bg-white/5 text-white"
                }`}
                data-testid="world-office-hours-start"
                aria-label={t("worldCreatorRooms.officeStartAria")}
              />
              <span className="inline-flex gap-1">
                {OFFICE_HOURS_DURATIONS_MIN.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDurationMin(m)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition bdv-touch-target ${
                      durationMin === m
                        ? "bg-[#d4af37] text-black"
                        : isLight
                          ? "border border-[#C9A84C]/60 text-[#7A5A12]"
                          : "border border-[#d4af37]/30 text-white/60"
                    }`}
                    data-testid={`world-office-hours-duration-${m}`}
                  >
                    {t("worldCreatorRooms.officeDurationMin", { count: m })}
                  </button>
                ))}
              </span>
              <button
                type="button"
                onClick={book}
                disabled={busy}
                className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
                data-testid="world-office-hours-book"
              >
                {busy ? t("worldCreatorRooms.officeBooking") : t("worldCreatorRooms.officeBook")}
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
                    · {officeHoursSessionWhen(s, now, officeStrings, i18n.language)}
                    {s.status === "live" ? t("worldCreatorRooms.officeInSessionSuffix") : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => cancel(s.id)}
                    disabled={busy}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition disabled:opacity-50 bdv-touch-target ${
                      isLight
                        ? "border border-[#C9A84C]/60 text-[#7A5A12]"
                        : "border border-[#d4af37]/30 text-white/60"
                    }`}
                    data-testid="world-office-hours-cancel"
                  >
                    {t("worldCreatorRooms.officeCancel")}
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
  const { t: tr, i18n } = useTranslation();
  const evoStrings = creatorRoomEvolutionStrings((k) => tr(k));
  const { detail, failed, retry } = useRoomDetail(slug);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  if (failed) {
    return (
      <div className="flex flex-col items-start gap-2 px-1 py-3">
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          {tr("worldCreatorRooms.stationLoadFailed")}
        </p>
        <button
          type="button"
          onClick={retry}
          className="rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
        >
          {tr("worldCreatorRooms.inviteTryAgain")}
        </button>
      </div>
    );
  }
  if (!detail) {
    return (
      <p className={`inline-flex items-center gap-2 px-1 py-3 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {tr("worldCreatorRooms.stationSteppingIn", { slug })}
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
  const evoLine = creatorRoomEvolutionLine(detail.evolution, evoStrings, i18n.language);
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
      {evoLine}{tr("worldCreatorRooms.stationEvoSuffix")}
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
            {tr("worldCreatorRooms.stationFrontRowEmpty", { name: detail.displayName })}
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
                <Crown className="h-3 w-3" /> {tr("worldCreatorRooms.stationSeat", { position: m.position })}
              </span>
              <span className={`text-[11px] font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]/80"}`}>
                {tr("worldCreatorRooms.stationSeeCard")}
              </span>
            </button>
          ))}
        </div>
        <p className={`px-1 pt-2 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {tr("worldCreatorRooms.stationFrontRowFooter", { name: detail.displayName })}
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
            {tr("worldCreatorRooms.stationMusicEmpty", { name: detail.displayName })}
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
                      {tr("worldCreatorRooms.stationFeatured")}
                    </span>
                  )}
                </span>
                <span className={`block text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                  {tr("worldCreatorRooms.stationPlaysLine", { name: detail.displayName, count: t.playCount.toLocaleString(i18n.language) })}
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
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
              >
                <Play className="h-3.5 w-3.5" />
                {isCurrent && shelfPlayer.playing ? tr("worldCreatorRooms.stationPause") : tr("worldCreatorRooms.stationPlay")}
              </button>
            </div>
          );
        })}
        <p className={`px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {tr("worldCreatorRooms.stationMusicFooter")}
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
            {tr("worldCreatorRooms.stationScreenEmpty", { name: detail.displayName })}
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
                {tr("worldCreatorRooms.stationViewsLine", { name: detail.displayName, count: video.viewCount.toLocaleString(i18n.language) })}
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
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
            >
              <Play className="h-3.5 w-3.5" />
              {isCurrent && shelfPlayer.playing ? tr("worldCreatorRooms.stationPause") : tr("worldCreatorRooms.stationWatch")}
            </button>
          </div>
        </div>
        <p className={`px-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
          {tr("worldCreatorRooms.stationScreenFooter")}
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
     order records PENDING and the payment completes EMBEDDED
     right here in the room (stack800 lane 6: uiMode "embedded"
     when this device can mount it, the shared
     EmbeddedSessionCheckout at the foot of this panel), and only
     a server-confirmed paid order (verify on focus/reopen) ever
     renders as paid. The hosted page in a new tab remains only
     as the no-publishable-key fallback. The fee line is the
     stand's: sellers keep 95%, the 5% platform fee comes out
     of the seller's cut, never on top.
   - tracks and videos ride the profile store rail
     (POST /api/store/checkout, the store-buy page's exact body,
     name-your-price honored against the creator's minimum) —
     embedded checkout in this panel on the same terms, members
     only (the rail is auth-required; guests get the sign-in
     pitch, never a doomed button);
   - store products ride POST /api/storefront/checkout with the
     product page's quantity — same treatment;
   - a kind no rail sells keeps the website buy door, labelled as
     what it is.
   The old panel's blanket "Buy on the website" is gone: buying
   completes from this room now. */

/** The FALLBACK way a hosted payment page opens from the room
 *  store: a new tab, at the checkout moment, on the walker's
 *  click. The money moment itself is embedded in this panel
 *  (stack800 lane 6) — this seam remains only for the device
 *  that cannot mount the embedded form (no publishable key) or
 *  a server answer that comes back hosted. */
function openCheckoutTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function CreatorStorePanel({ detail, isLight, isGuest }: { detail: CreatorRoomDetail; isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  /* The gift form's problem sentences, from the catalogs (Stack 200
     E-3 — the lib/world/gift-cards strings table). */
  const giftFormStrings = {
    noAmounts: t("worldCreatorRooms.giftProblemNoAmounts"),
    pickAmount: t("worldCreatorRooms.giftProblemPickAmount"),
    pickOffered: t("worldCreatorRooms.giftProblemPickOffered"),
    recipientEmail: t("worldCreatorRooms.giftProblemRecipientEmail"),
  };
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
  /* stack800 lane 6: the embedded checkout's clientSecret, when a
     buy moment answered one — the shared EmbeddedSessionCheckout
     mounts at the foot of this panel and the walker pays without
     leaving the room. Any new buy attempt clears it. */
  const [embeddedSecret, setEmbeddedSecret] = useState<string | null>(null);
  const [refreshingOrder, setRefreshingOrder] = useState(false);

  /* ── Gift cards — this creator's cards, bought and spent here ──
     The tender code riders product buys and the cart below (the
     product page's own code box, on this creator's rails); the buy
     form under the grid sells the creator's gift-card product on
     the gift-card checkout rail — the only rail that can sell it,
     since delivery goes to a recipient's email. Issuance is
     confirmed by the verify rail alone, on mount and on focus,
     from the stashed session — never assumed from "paid here". */
  const [giftCode, setGiftCode] = useState("");
  const [giftItem, setGiftItem] = useState<RoomStoreItem | null>(null);
  const [giftForm, setGiftForm] = useState<GiftCardFormState>(emptyGiftCardForm());
  const [giftBusy, setGiftBusy] = useState(false);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [giftEmbedded, setGiftEmbedded] = useState<{ clientSecret: string; sessionId: string } | null>(null);
  const [giftIssued, setGiftIssued] = useState<GiftCardVerifyResult | null>(null);
  const [giftRefreshing, setGiftRefreshing] = useState(false);
  const giftScope = giftCardPendingKey(detail.slug);

  const verifyGiftSession = async (sessionId: string) => {
    setGiftRefreshing(true);
    try {
      const res = await fetch("/api/gift-cards/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const state = giftCardVerifyState(res.status, data);
      if (state === "issued") {
        setGiftIssued(parseGiftCardVerify(data));
        setGiftEmbedded(null);
        try { localStorage.removeItem(giftScope); } catch { /* ignore */ }
      } else if (state === "pending") {
        setNote(t("worldCreatorRooms.giftVerifyPending"));
      } else {
        setGiftEmbedded(null);
        try { localStorage.removeItem(giftScope); } catch { /* ignore */ }
        setNote(t("worldCreatorRooms.giftVerifyClosed"));
      }
    } catch {
      setNote(t("worldCreatorRooms.giftVerifyUnknown"));
    } finally {
      setGiftRefreshing(false);
    }
  };
  const verifyGiftRef = useRef(verifyGiftSession);
  verifyGiftRef.current = verifyGiftSession;
  useEffect(() => {
    let pending: { sessionId: string } | null = null;
    try { pending = parseGiftCardPending(localStorage.getItem(giftScope)); } catch { /* storage blocked */ }
    if (pending) void verifyGiftRef.current(pending.sessionId);
    const onFocus = () => {
      let p: { sessionId: string } | null = null;
      try { p = parseGiftCardPending(localStorage.getItem(giftScope)); } catch { /* storage blocked */ }
      if (p) void verifyGiftRef.current(p.sessionId);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giftScope]);

  const startGiftCheckout = async () => {
    if (!giftItem || giftBusy) return;
    if (isGuest) {
      setNote(t("worldCreatorRooms.storeGuestNote"));
      return;
    }
    const problem = giftCardFormProblem(giftForm, giftItem.giftCardDenominationsCents, giftFormStrings);
    if (problem) {
      setGiftError(problem);
      return;
    }
    const payload = giftCardCheckoutPayload(giftItem.id, giftForm, giftItem.giftCardDenominationsCents, hasStripePublishableKey());
    if (!payload) {
      setGiftError(t("worldCreatorRooms.giftFormIncomplete"));
      return;
    }
    setGiftBusy(true);
    setGiftError(null);
    setGiftIssued(null);
    setGiftEmbedded(null);
    try {
      const res = await fetch("/api/gift-cards/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldCreatorRooms.giftCheckoutNoStart")));
      const sessionId = typeof data.sessionId === "string" ? data.sessionId : "";
      if (sessionId) {
        try {
          localStorage.setItem(giftScope, JSON.stringify({ sessionId, productId: giftItem.id, title: giftItem.title }));
        } catch { /* storage blocked — the room just can't resume the receipt */ }
      }
      if (typeof data.clientSecret === "string" && data.clientSecret) {
        setGiftEmbedded({ clientSecret: data.clientSecret, sessionId });
        setNote(t("worldCreatorRooms.giftPayNote", { email: giftForm.recipientEmail.trim() }));
        return;
      }
      const url = hostedCheckoutUrl(data);
      if (!url) throw new Error(t("worldCreatorRooms.giftCheckoutNoPage"));
      openCheckoutTab(url);
      setNote(t("worldCreatorRooms.giftHostedNote"));
    } catch (e) {
      setGiftError(plainErrorText(e, t("worldCreatorRooms.giftCheckoutNoStart")));
    } finally {
      setGiftBusy(false);
    }
  };

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
        setPendingNote(t("worldCreatorRooms.orderExpired"));
        try { localStorage.removeItem(marketPendingKey(handle)); } catch { /* ignore */ }
      } else {
        setPendingNote(t("worldCreatorRooms.orderPendingRefresh"));
      }
    } catch {
      setPendingNote(t("worldCreatorRooms.orderPendingUnknown"));
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
    setEmbeddedSecret(null);
    try {
      const res = await fetch("/api/storefronts/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId,
          items: detailed.map((l) => ({ productId: l.productId, quantity: l.qty })),
          buyerEmail: buyerEmail.trim() || undefined,
          /* This creator's gift card pays here too (the shop page's
             own cart tender): it covers what it can, the rest rides
             the payment, and a wrong-store code fails honestly. */
          giftCardCode: giftCode.trim() || undefined,
          /* stack800 lane 6: ask for the embedded presentation when
             this device can mount it — the server answers a
             clientSecret instead of a hosted URL and the buyer
             pays right here in the room, exactly the Marketplace
             stand's own ask. Otherwise the hosted rail below
             remains the fallback. */
          uiMode: hasStripePublishableKey() ? "embedded" : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldCreatorRooms.cartCheckoutNoStart")));
      /* A gift card covering the whole cart answers paid with NO
         payment page (paidWithGiftCard) — a completed purchase,
         not a missing URL. */
      if (checkoutCompletedInWorld(data) || paidWithGiftCard(data)) {
        const order = marketOrderFromPayload(data);
        if (order?.paid) setPaidOrder(order);
        setCart([]);
        return;
      }
      if (typeof data.clientSecret === "string" && data.clientSecret) {
        if (typeof data.sessionId === "string" && handle) {
          try { localStorage.setItem(marketPendingKey(handle), data.sessionId); } catch { /* storage blocked */ }
        }
        setEmbeddedSecret(data.clientSecret);
        setPendingNote(t("worldCreatorRooms.orderPendingEmbedded"));
        return;
      }
      const url = hostedCheckoutUrl(data);
      if (url) {
        if (typeof data.sessionId === "string" && handle) {
          try { localStorage.setItem(marketPendingKey(handle), data.sessionId); } catch { /* storage blocked */ }
        }
        openCheckoutTab(url);
        setPendingNote(t("worldCreatorRooms.orderPendingHosted"));
        return;
      }
      throw new Error(t("worldCreatorRooms.giftCheckoutNoPage"));
    } catch (e) {
      setOrderError(plainErrorText(e, t("worldCreatorRooms.cartCheckoutFailedCart")));
    } finally {
      setPlacing(false);
    }
  };

  /* ── The single-item rails (store + storefront products) ── */
  const buySingle = async (item: RoomStoreItem) => {
    if (busyId) return;
    if (isGuest) {
      setNote(t("worldCreatorRooms.storeGuestNote"));
      return;
    }
    const rail = roomItemRail(item);
    setBusyId(item.id);
    setBuyError(null);
    setNote(null);
    setEmbeddedSecret(null);
    try {
      if (rail === "store") {
        const shaped = storeCheckoutPayload(item, pwywInputs[item.id] ?? "");
        if (!shaped.ok) throw new Error(shaped.problem);
        const res = await fetch("/api/store/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          /* stack800 lane 6: the store-buy page's exact body plus
             the embedded ask — the rail answers a clientSecret and
             the form mounts at the foot of this panel. */
          body: JSON.stringify({ ...shaped.body, uiMode: hasStripePublishableKey() ? "embedded" : undefined }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) throw new Error(apiErrorLine(data, t("worldCreatorRooms.buyCheckoutFailedPlain")));
        if (data.paid === true) {
          /* Gift-card tender covered it in full — the server
             already recorded the sale and delivered; there is no
             card form to mount (the store-buy page's own answer). */
          setNote(t("worldCreatorRooms.storePaidFullGift", { title: item.title }));
          return;
        }
        if (typeof data.clientSecret === "string" && data.clientSecret) {
          setEmbeddedSecret(data.clientSecret);
          setNote(t("worldCreatorRooms.storePayHereNote", { title: item.title }));
          return;
        }
        const url = hostedCheckoutUrl(data);
        if (!url) throw new Error(t("worldCreatorRooms.giftCheckoutNoPage"));
        openCheckoutTab(url);
        setNote(t("worldCreatorRooms.storeHostedNote", { title: item.title }));
        return;
      }
      if (rail === "storefront") {
        const res = await fetch("/api/storefront/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          /* stack800 lane 6: the product page's exact body plus
             the embedded ask, same as the store rail above — with
             this creator's gift-card tender riding when one was
             pasted above, exactly as the product page's box does. */
          body: JSON.stringify({ ...storefrontCheckoutPayload(item, qtyInputs[item.id] ?? 1, giftCode), uiMode: hasStripePublishableKey() ? "embedded" : undefined }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) throw new Error(apiErrorLine(data, t("worldCreatorRooms.buyCheckoutFailedPlain")));
        if (paidWithGiftCard(data)) {
          /* The card covered it in full — the rail recorded the
             order and answers with no payment page at all. */
          setNote(typeof data.note === "string" && data.note ? data.note : t("worldCreatorRooms.storefrontPaidFullGift", { title: item.title }));
          return;
        }
        if (typeof data.clientSecret === "string" && data.clientSecret) {
          setEmbeddedSecret(data.clientSecret);
          setNote(t("worldCreatorRooms.storePayHereNote", { title: item.title }));
          return;
        }
        const url = hostedCheckoutUrl(data);
        if (!url) throw new Error(t("worldCreatorRooms.giftCheckoutNoPage"));
        openCheckoutTab(url);
        setNote(t("worldCreatorRooms.storeHostedNotePlain", { title: item.title }));
        return;
      }
    } catch (e) {
      setBuyError(plainErrorText(e, t("worldCreatorRooms.buyCheckoutFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const mutedCls = isLight ? "text-[#6B5B36]" : "text-white/55";
  const cardCls = isLight ? "border-[#C9A84C]/50 bg-white/60" : "border-[#d4af37]/25 bg-white/5";
  const chipCls = `inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold transition bdv-touch-target ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`;

  return (
    <div className="space-y-2">
      <p className={`inline-flex items-center gap-2 px-1 text-xs font-semibold ${mutedCls}`}>
        <ShoppingBag className="h-4 w-4 text-[#d4af37]" />
        {detail.storefront
          ? t("worldCreatorRooms.storeIntroShop", { name: detail.displayName, shop: detail.storefront.name })
          : t("worldCreatorRooms.storeIntroProfile", { name: detail.displayName })}
      </p>
      {failed ? (
        <p className={`px-1 py-2 text-sm ${mutedCls}`}>
          {t("worldCreatorRooms.storeOpenFailed")}
        </p>
      ) : items === null ? (
        <p className={`inline-flex items-center gap-2 px-1 py-2 text-sm ${mutedCls}`}>
          <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> {t("worldCreatorRooms.storeSettingOut")}
        </p>
      ) : items.length === 0 ? (
        <p className={`px-1 py-2 text-sm ${mutedCls}`}>
          {t("worldCreatorRooms.storeEmpty", { name: detail.displayName })}
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
                      {rail === "gift" ? t("worldCreatorRooms.storeFromPrice", { price: item.price }) : item.price}
                    </span>
                  )}
                  {rail === "market" ? (
                    <button
                      type="button"
                      data-testid="world-room-store-add"
                      onClick={() => setCart((c) => addToCartLines(c, item.id))}
                      className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                    >
                      <Plus className="h-3.5 w-3.5" /> {t("worldCreatorRooms.storeAddToCart")}
                    </button>
                  ) : rail === "store" ? (
                    <>
                      {item.pwyw?.enabled && (
                        <input
                          value={pwywInputs[item.id] ?? ""}
                          onChange={(e) => setPwywInputs((m) => ({ ...m, [item.id]: e.target.value }))}
                          inputMode="decimal"
                          placeholder={t("worldCreatorRooms.storePwywPlaceholder", { min: `$${(item.pwyw.minCents / 100).toFixed(2)}` })}
                          aria-label={t("worldCreatorRooms.storePwywAria", { title: item.title })}
                          className={`w-full rounded-xl border px-2.5 py-1.5 text-xs outline-none bdv-touch-target ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black/50 text-white"}`}
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
                        {checkoutTransferLabel(t)}
                      </button>
                    </>
                  ) : rail === "storefront" ? (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <button type="button" aria-label={t("worldCreatorRooms.storeOneLess")} onClick={() => setQtyInputs((m) => ({ ...m, [item.id]: Math.max(1, (m[item.id] ?? 1) - 1) }))} className={chipCls}><Minus className="h-3 w-3" /></button>
                        <span className="w-5 text-center text-xs font-bold">{qtyInputs[item.id] ?? 1}</span>
                        <button type="button" aria-label={t("worldCreatorRooms.storeOneMore")} onClick={() => setQtyInputs((m) => ({ ...m, [item.id]: Math.min(99, (m[item.id] ?? 1) + 1) }))} className={chipCls}><Plus className="h-3 w-3" /></button>
                      </span>
                      <button
                        type="button"
                        data-testid="world-room-store-buy"
                        onClick={() => void buySingle(item)}
                        disabled={busyId === item.id}
                        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                      >
                        {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />}
                        {checkoutTransferLabel(t)}
                      </button>
                    </>
                  ) : rail === "gift" ? (
                    <>
                      <span className={`text-[11px] ${mutedCls}`}>
                        {t("worldCreatorRooms.storeGiftBlurb")}
                      </span>
                      <button
                        type="button"
                        data-testid="world-room-store-gift"
                        onClick={() => {
                          setGiftItem(item);
                          setGiftForm(emptyGiftCardForm());
                          setGiftError(null);
                          setGiftIssued(null);
                          setGiftEmbedded(null);
                        }}
                        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                      >
                        <Gift className="h-3.5 w-3.5" /> {t("worldCreatorRooms.storeBuyGiftCard")}
                      </button>
                    </>
                  ) : item.buyUrl ? (
                    <a
                      href={item.buyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                    >
                      {t("worldCreatorRooms.storeBuyOnWebsite")}
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>

          {giftItem && (
            <div className={`rounded-2xl border px-3 py-3 ${cardCls}`} data-testid="world-room-store-gift-form">
              <p className={`flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                <Gift className="h-4 w-4 text-[#d4af37]" /> {t("worldCreatorRooms.giftFormTitle", { title: giftItem.title })}
              </p>
              <p className={`mt-1 text-xs ${mutedCls}`}>
                {t("worldCreatorRooms.giftIntro", { name: detail.displayName })}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t("worldCreatorRooms.giftAmountGroupAria")}>
                {(giftItem.giftCardDenominationsCents ?? []).map((d) => {
                  const picked = (giftForm.amountCents ?? giftItem.giftCardDenominationsCents?.[0]) === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      data-testid="world-room-store-gift-amount"
                      aria-pressed={picked}
                      onClick={() => setGiftForm((f) => ({ ...f, amountCents: d }))}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                        picked
                          ? "border-[#d4af37] bg-[#d4af37] text-black"
                          : isLight
                            ? "border-[#7A5A12]/30 text-[#6B5B36]"
                            : "border-white/15 text-white/75"
                      }`}
                    >
                      {centsToDisplay(d, i18n.language)}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 space-y-2">
                <input
                  value={giftForm.recipientEmail}
                  onChange={(e) => setGiftForm((f) => ({ ...f, recipientEmail: e.target.value }))}
                  type="email"
                  placeholder={t("worldCreatorRooms.giftRecipientPlaceholder")}
                  aria-label={t("worldCreatorRooms.giftRecipientAria")}
                  data-testid="world-room-store-gift-recipient"
                  className={`w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black/50 text-white"}`}
                />
                <input
                  value={giftForm.recipientName}
                  onChange={(e) => setGiftForm((f) => ({ ...f, recipientName: e.target.value }))}
                  placeholder={t("worldCreatorRooms.giftRecipientNamePlaceholder")}
                  aria-label={t("worldCreatorRooms.giftRecipientNameAria")}
                  className={`w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black/50 text-white"}`}
                />
                <input
                  value={giftForm.message}
                  onChange={(e) => setGiftForm((f) => ({ ...f, message: e.target.value }))}
                  placeholder={t("worldCreatorRooms.giftMessagePlaceholder")}
                  aria-label={t("worldCreatorRooms.giftMessageAria")}
                  className={`w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black/50 text-white"}`}
                />
              </div>
              {giftError && <p className="mt-2 text-xs font-semibold text-red-400">{giftError}</p>}
              {!giftIssued && !giftEmbedded && (
                <button
                  type="button"
                  data-testid="world-room-store-gift-checkout"
                  onClick={() => void startGiftCheckout()}
                  disabled={giftBusy}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
                >
                  {giftBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                  {checkoutTransferLabel(t)}
                  {giftCardFormAmount(giftForm, giftItem.giftCardDenominationsCents) !== null &&
                    ` · ${centsToDisplay(giftCardFormAmount(giftForm, giftItem.giftCardDenominationsCents)!, i18n.language)}`}
                </button>
              )}
              {giftEmbedded && (
                <div className="mt-3 space-y-2" data-testid="world-room-store-gift-embedded">
                  <EmbeddedSessionCheckout clientSecret={giftEmbedded.clientSecret} />
                  <span className="inline-flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => giftEmbedded.sessionId && void verifyGiftSession(giftEmbedded.sessionId)}
                      disabled={giftRefreshing || !giftEmbedded.sessionId}
                      className={chipCls}
                    >
                      {giftRefreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {t("worldCreatorRooms.giftCheckStatus")}
                    </button>
                    <button type="button" onClick={() => setGiftEmbedded(null)} className={chipCls}>
                      {t("worldCreatorRooms.giftCloseStillIssues")}
                    </button>
                  </span>
                </div>
              )}
              {giftIssued && (
                <div className="mt-3 space-y-1.5" data-testid="world-room-store-gift-issued">
                  <p className={`flex items-start gap-2 text-xs font-bold ${isLight ? "text-[#4a6b1f]" : "text-emerald-300"}`}>
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {giftIssued.duplicate
                        ? t("worldCreatorRooms.giftIssuedDuplicate")
                        : giftIssued.card
                          ? t("worldCreatorRooms.giftIssuedFor", {
                              amount: centsToDisplay(giftIssued.card.initialCents, i18n.language),
                              store: giftIssued.card.storeName ?? t("worldCreatorRooms.giftStoreFallback", { name: detail.displayName }),
                              email: giftIssued.card.recipientEmail || t("worldCreatorRooms.giftRecipientFallback"),
                            })
                          : t("worldCreatorRooms.giftIssuedPlain", {
                              /* No card read back — the original line's
                                 recipient was always the fallback here. */
                              email: t("worldCreatorRooms.giftRecipientFallback"),
                            })}
                    </span>
                  </p>
                  {giftIssued.code && (
                    <p className={`rounded-xl border px-3 py-2 font-mono text-sm font-bold tracking-wider ${cardCls}`}>
                      {giftIssued.code}
                    </p>
                  )}
                  {giftIssued.codeNote && <p className={`text-[11px] ${mutedCls}`}>{giftIssued.codeNote}</p>}
                </div>
              )}
            </div>
          )}

          <div className={`rounded-2xl border px-3 py-3 ${cardCls}`} data-testid="world-room-store-gift-code">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {t("worldCreatorRooms.giftHaveTitle", { name: detail.displayName })}
            </p>
            <input
              value={giftCode}
              onChange={(e) => setGiftCode(e.target.value)}
              placeholder={t("worldCreatorRooms.giftCodePlaceholder")}
              aria-label={t("worldCreatorRooms.giftCodeAria")}
              data-testid="world-room-store-gift-code-input"
              className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black/50 text-white"}`}
            />
            <p className={`mt-1.5 text-[11px] ${mutedCls}`}>
              {t("worldCreatorRooms.giftTenderLine")}
            </p>
          </div>

          {(detailed.length > 0 || paidOrder || pendingNote) && shopId && (
            <div className={`rounded-2xl border px-3 py-3 ${cardCls}`} data-testid="world-room-store-cart">
              <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                {count > 0 ? t("worldCreatorRooms.cartTitleCount", { count }) : t("worldCreatorRooms.cartTitle")}
              </p>
              {detailed.map((l) => (
                <div key={l.productId} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{l.product.name}</span>
                  <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(l.product.price_cents * l.qty, i18n.language)}</span>
                  <span className="inline-flex items-center gap-1.5">
                    <button type="button" aria-label={t("worldCreatorRooms.storeOneLess")} onClick={() => setCart((c) => setCartLineQty(c, l.productId, l.qty - 1))} className={chipCls}><Minus className="h-3 w-3" /></button>
                    <span className="w-5 text-center text-sm font-bold">{l.qty}</span>
                    <button type="button" aria-label={t("worldCreatorRooms.storeOneMore")} onClick={() => setCart((c) => setCartLineQty(c, l.productId, l.qty + 1))} className={chipCls}><Plus className="h-3 w-3" /></button>
                    <button type="button" aria-label={t("worldCreatorRooms.storeRemoveFromCart")} onClick={() => setCart((c) => setCartLineQty(c, l.productId, 0))} className={chipCls}><Trash2 className="h-3 w-3" /></button>
                  </span>
                </div>
              ))}
              {detailed.length > 0 && !paidOrder && (
                <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className={mutedCls}>{t("worldCreatorRooms.cartTotal")}</span>
                    <span className="text-lg font-black">{centsToDisplay(total, i18n.language)}</span>
                  </div>
                  <input
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                    type="email"
                    placeholder={t("worldCreatorRooms.cartEmailPlaceholder")}
                    aria-label={t("worldCreatorRooms.cartEmailAria")}
                    className={`w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${isLight ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black/50 text-white"}`}
                  />
                  {orderError && <p className="text-xs font-semibold text-red-400">{orderError}</p>}
                  <button type="button" data-testid="world-room-store-checkout" onClick={() => void checkoutCart()} disabled={placing} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target">
                    {placing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                    {checkoutTransferLabel(t)} · {centsToDisplay(total, i18n.language)}
                  </button>
                  <p className={`text-[11px] ${mutedCls}`}>
                    {t("worldCreatorRooms.storeFeeLine")}
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
                    {t("worldCreatorRooms.orderPendingHonest")}
                  </p>
                  <button type="button" onClick={() => void refreshOrder()} disabled={refreshingOrder} className={chipCls}>
                    {t("worldCreatorRooms.orderCheckAgain")}
                  </button>
                </div>
              )}
              {paidOrder && (
                <div className="mt-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-room-store-paid">
                  <p className={`flex items-start gap-2 text-xs font-bold ${isLight ? "text-[#4a6b1f]" : "text-emerald-300"}`}>
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {t("worldCreatorRooms.storePaidLine", { amount: centsToDisplay(paidOrder.gross_cents, i18n.language) })}
                      {paidOrder.lines.length > 0 && <>{t("worldCreatorRooms.storePaidYoursSuffix", { items: paidOrder.lines.map((l) => l.productName ?? t("worldCreatorRooms.storePaidItemFallback")).join(", ") })}</>}
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {embeddedSecret && (
        <div className="space-y-2" data-testid="world-room-store-embedded-checkout">
          <EmbeddedSessionCheckout clientSecret={embeddedSecret} />
          <button type="button" onClick={() => setEmbeddedSecret(null)} className={chipCls}>
            {t("worldCreatorRooms.embeddedCloseNote")}
          </button>
        </div>
      )}
      {note && <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
      {buyError && <p className="px-1 text-xs font-semibold text-red-400">{buyError}</p>}
      <p className={`inline-flex items-center gap-1.5 px-1 pt-1 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        <Home className="h-3.5 w-3.5 text-[#d4af37]" />
        {t("worldCreatorRooms.storeFooter")}
      </p>
    </div>
  );
}
