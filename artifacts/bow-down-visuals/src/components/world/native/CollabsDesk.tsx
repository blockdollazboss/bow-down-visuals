import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Check, HeartHandshake, Loader2, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import { GUEST_SIGN_IN_HREF } from "@/lib/world/guest-honest";
import {
  COLLAB_MATCH_COST_VB,
  COLLAB_MATCH_FEATURE,
  COLLAB_MATCH_PATH,
  COLLAB_NICHE_OPTIONS,
  COLLAB_PLATFORM_OPTIONS,
  COLLAB_PROFILE_ME_PATH,
  COLLAB_PROFILE_PATH,
  COLLAB_REQUESTS_PATH,
  buildProfileBody,
  buildSendRequestBody,
  collabNicheLabel,
  collabRespondPath,
  collabsProfilesPath,
  normalizeCollabProfiles,
  normalizeCollabRequests,
  parseMatchResult,
  parseMyCollabProfile,
  profileFormFrom,
  profileFormReady,
  requestStatusLabel,
  sendRequestReady,
  type CollabMatchResult,
  type CollabProfileCard,
  type CollabProfileForm,
  type CollabRequests,
  type MyCollabProfileRead,
} from "@/lib/world/collabs-desk";

/* ─── Collabs, in-world (stack1100 world parity) ───────────────────
   Creator-to-creator collaboration in the Community Hall, on the
   collabs router's own rails — the same endpoints pages/collabs.tsx
   calls. Your card (free upsert), the public browse, the AI match
   report (100 Bucs, named on the button and in the credit
   confirmation; the rail refunds every failure and says so — the
   desk surfaces its words), requests out, and the inbox where a
   received intro's pitch stays locked until you accept (the rail's
   double opt-in, rendered the rail's way). The match button only
   arms once your own card exists — the rail would charge-then-
   refund that mistake; the desk doesn't make it. Guests get the
   sign-in pitch: every collab rail is members-only. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

const EMPTY_FORM: CollabProfileForm = {
  displayName: "",
  niche: "music",
  platforms: [],
  collabInterests: "",
  bio: "",
  isPublic: true,
};

export function CollabsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const [meRead, setMeRead] = useState<MyCollabProfileRead | null>(null);
  const [form, setForm] = useState<CollabProfileForm>(EMPTY_FORM);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNote, setProfileNote] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [niche, setNiche] = useState("");
  const [profiles, setProfiles] = useState<CollabProfileCard[] | null>(null);
  const [profilesFailed, setProfilesFailed] = useState(false);
  const [profilesTick, setProfilesTick] = useState(0);

  const [match, setMatch] = useState<CollabMatchResult | null>(null);
  const [matchBusyId, setMatchBusyId] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [requests, setRequests] = useState<CollabRequests | null>(null);
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [requestsTick, setRequestsTick] = useState(0);
  const [composeFor, setComposeFor] = useState<string | null>(null);
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);
  const [inboxNote, setInboxNote] = useState<string | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [respondBusyId, setRespondBusyId] = useState<string | null>(null);

  /* ── my card ── */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(COLLAB_PROFILE_ME_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error(`me ${res.status}`);
        const read = parseMyCollabProfile(await res.json());
        if (!cancelled) {
          setMeRead(read);
          if (read.state === "ready") setForm(profileFormFrom(read.profile));
        }
      } catch {
        if (!cancelled) setMeRead({ state: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  /* ── browse ── */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    setProfilesFailed(false);
    (async () => {
      try {
        const res = await fetch(collabsProfilesPath(niche), { headers: await authHeaders() });
        if (!res.ok) throw new Error(`profiles ${res.status}`);
        const parsed = normalizeCollabProfiles(await res.json());
        if (!parsed) throw new Error("profiles shape");
        if (!cancelled) setProfiles(parsed);
      } catch {
        if (!cancelled) setProfilesFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, niche, profilesTick]);

  /* ── requests ── */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    setRequestsFailed(false);
    (async () => {
      try {
        const res = await fetch(COLLAB_REQUESTS_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error(`requests ${res.status}`);
        const parsed = normalizeCollabRequests(await res.json());
        if (!parsed) throw new Error("requests shape");
        if (!cancelled) setRequests(parsed);
      } catch {
        if (!cancelled) setRequestsFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, requestsTick]);

  async function saveProfile() {
    if (!profileFormReady(form) || savingProfile) return;
    setSavingProfile(true);
    setProfileError(null);
    setProfileNote(null);
    try {
      const res = await fetch(COLLAB_PROFILE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildProfileBody(form)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't save your card (${res.status})`));
      setMeRead((prev) =>
        prev?.state === "ready" || prev?.state === "none" ? { state: "ready", profile: {
          displayName: form.displayName.trim(),
          niche: form.niche,
          platforms: form.platforms.map((r) => ({ platform: r.platform, followers: Number(r.followersText) })),
          collabInterests: form.collabInterests.trim(),
          bio: form.bio.trim(),
          isPublic: form.isPublic,
        } } : prev,
      );
      setProfileNote("Your card is saved — creators browsing your niche can find you now.");
      setProfilesTick((t) => t + 1);
    } catch (err) {
      setProfileError(plainErrorText(err, "Couldn't save your card — try again."));
    } finally {
      setSavingProfile(false);
    }
  }

  async function runMatch(card: CollabProfileCard) {
    setMatchBusyId(card.userId);
    setMatchError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(COLLAB_MATCH_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        overrideCost: COLLAB_MATCH_COST_VB,
        overrideFeature: COLLAB_MATCH_FEATURE,
        body: JSON.stringify({ targetUserId: card.userId }),
      });
      if (!res) return; // declined the confirmation — nothing charged
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, `The matcher hiccupped (${res.status})`));
      const parsed = parseMatchResult(data);
      if (!parsed) throw new Error("The matcher answered in a shape the desk can't read — the rail refunds failed generations; if Bucs left your balance, the refund lands on its own.");
      setMatch(parsed);
    } catch (err) {
      setMatchError(plainErrorText(err, "The matcher hiccupped — try again."));
    } finally {
      setMatchBusyId(null);
    }
  }

  async function sendRequest(card: CollabProfileCard) {
    if (!sendRequestReady(composeText) || sending) return;
    setSending(true);
    setInboxError(null);
    try {
      const res = await fetch(COLLAB_REQUESTS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildSendRequestBody(card.userId, composeText)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't send the request (${res.status})`));
      setComposeFor(null);
      setComposeText("");
      setInboxNote(`Request sent to ${card.displayName} — if they reach back, you both unlock the intro.`);
      setRequestsTick((t) => t + 1);
    } catch (err) {
      setInboxError(plainErrorText(err, "Couldn't send the request — try again."));
    } finally {
      setSending(false);
    }
  }

  async function respond(id: string, action: "accepted" | "declined") {
    setRespondBusyId(id);
    setInboxError(null);
    try {
      const res = await fetch(collabRespondPath(id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't answer (${res.status})`));
      setInboxNote(action === "accepted" ? "Accepted — the intro is unlocked for you both." : "Declined — the request is closed.");
      setRequestsTick((t) => t + 1);
    } catch (err) {
      setInboxError(plainErrorText(err, "Couldn't answer — try again."));
    } finally {
      setRespondBusyId(null);
    }
  }

  const myCardReady = meRead?.state === "ready";

  return (
    <NativeCard isLight={isLight} title="Collabs — find your people">
      <div data-testid="world-collabs-desk" className="space-y-4">
        {isGuest ? (
          <p className={`text-sm ${muted}`}>
            Collabs are members&rsquo; business — creator cards, match reports and requests all ride
            your account.{" "}
            <Link href={GUEST_SIGN_IN_HREF} className="font-bold text-[#d4af37] underline">
              Sign in
            </Link>{" "}
            and your card takes thirty seconds.
          </p>
        ) : (
          <>
            {/* ── Your card ── */}
            <div className="space-y-2">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Your collab card</p>
              {meRead === null ? (
                <NativeLoadingState isLight={isLight} message="Reading your card…" />
              ) : meRead.state === "failed" ? (
                <p className={`text-xs ${muted}`}>
                  Your card didn&rsquo;t answer just now — the browse and inbox below still stand;
                  reopen the Hall to try your card again.
                </p>
              ) : (
                <>
                  {meRead.state === "none" ? (
                    <p className={`text-xs ${muted}`}>
                      No card yet — make yours so creators can find you, match with you, and reach out.
                    </p>
                  ) : null}
                  <input
                    className={deskInputCls(isLight)}
                    placeholder="Display name"
                    maxLength={60}
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                    aria-label="Display name"
                  />
                  <div className="flex flex-wrap gap-2">
                    <select
                      className={deskInputCls(isLight)}
                      value={form.niche}
                      onChange={(e) => setForm({ ...form, niche: e.target.value })}
                      aria-label="Your niche"
                    >
                      {COLLAB_NICHE_OPTIONS.map((n) => (
                        <option key={n.key} value={n.key}>
                          {n.label}
                        </option>
                      ))}
                    </select>
                    <label className={`inline-flex cursor-pointer items-center gap-2 text-xs font-bold ${strong}`}>
                      <input
                        type="checkbox"
                        checked={form.isPublic}
                        onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
                        className="h-4 w-4 accent-[#d4af37]"
                      />
                      Public — creators can find this card
                    </label>
                  </div>
                  {form.platforms.map((row, i) => (
                    <div key={i} className="flex gap-2">
                      <select
                        className={deskInputCls(isLight)}
                        value={row.platform}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            platforms: form.platforms.map((r, j) => (j === i ? { ...r, platform: e.target.value } : r)),
                          })
                        }
                        aria-label={`Platform ${i + 1}`}
                      >
                        {COLLAB_PLATFORM_OPTIONS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className={deskInputCls(isLight)}
                        placeholder="Followers"
                        inputMode="numeric"
                        value={row.followersText}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            platforms: form.platforms.map((r, j) => (j === i ? { ...r, followersText: e.target.value } : r)),
                          })
                        }
                        aria-label={`Followers on platform ${i + 1}`}
                      />
                      <button
                        type="button"
                        className={chipBtn(isLight)}
                        aria-label={`Remove platform ${i + 1}`}
                        onClick={() => setForm({ ...form, platforms: form.platforms.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {form.platforms.length < 6 ? (
                    <button
                      type="button"
                      className={chipBtn(isLight)}
                      onClick={() =>
                        setForm({ ...form, platforms: [...form.platforms, { platform: "tiktok", followersText: "0" }] })
                      }
                    >
                      <Plus className="h-3.5 w-3.5" /> Add a platform
                    </button>
                  ) : null}
                  <textarea
                    className={deskInputCls(isLight)}
                    placeholder="What collabs are you after? (duets, remixes, co-streams…)"
                    rows={2}
                    maxLength={500}
                    value={form.collabInterests}
                    onChange={(e) => setForm({ ...form, collabInterests: e.target.value })}
                    aria-label="Collab interests"
                  />
                  <textarea
                    className={deskInputCls(isLight)}
                    placeholder="A line or two about you"
                    rows={2}
                    maxLength={500}
                    value={form.bio}
                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                    aria-label="Bio"
                  />
                  {profileError ? (
                    <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{profileError}</p>
                  ) : null}
                  {profileNote ? <p className={`text-xs font-semibold ${strong}`}>{profileNote}</p> : null}
                  <button
                    type="button"
                    className={goldBtn}
                    disabled={!profileFormReady(form) || savingProfile}
                    onClick={() => void saveProfile()}
                  >
                    {savingProfile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Save my card — free
                  </button>
                </>
              )}
            </div>

            {/* ── Browse + match ── */}
            <div className="space-y-2">
              <p className={`text-xs font-black uppercase tracking-[0.12em] ${muted}`}>Find creators</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={niche === "" ? goldBtn : chipBtn(isLight)} onClick={() => setNiche("")}>
                  All
                </button>
                {COLLAB_NICHE_OPTIONS.map((n) => (
                  <button
                    key={n.key}
                    type="button"
                    className={niche === n.key ? goldBtn : chipBtn(isLight)}
                    onClick={() => setNiche(n.key)}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
              {profilesFailed ? (
                <NativeErrorState
                  isLight={isLight}
                  title="The browse wouldn't open"
                  message="Creators are still out there — the directory just didn't answer. Try again."
                  onRetry={() => setProfilesTick((t) => t + 1)}
                />
              ) : profiles === null ? (
                <NativeLoadingState isLight={isLight} message="Reading the directory…" />
              ) : profiles.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message="No public cards in this niche yet."
                  detail="Yours could be the first — the card form above takes thirty seconds."
                />
              ) : (
                profiles.map((card) => (
                  <div
                    key={card.userId}
                    data-testid="world-collab-card"
                    className={`space-y-1.5 rounded-xl border px-3 py-2.5 ${
                      isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                    }`}
                  >
                    <p className={`text-sm font-bold ${strong}`}>
                      {card.displayName}{" "}
                      <span className={`text-xs font-semibold ${muted}`}>· {card.nicheLabel || collabNicheLabel(card.niche)}</span>
                      {card.isOwn ? <span className={`text-xs ${muted}`}> · your card</span> : null}
                    </p>
                    {card.platforms.length > 0 ? (
                      <p className={`text-xs ${muted}`}>
                        {card.platforms.map((p) => `${p.label} ${p.followersLabel}`).join(" · ")}
                      </p>
                    ) : null}
                    {card.bio ? <p className={`text-xs ${muted}`}>{card.bio}</p> : null}
                    {card.collabInterests ? (
                      <p className={`text-xs ${muted}`}>
                        <span className="font-bold">After:</span> {card.collabInterests}
                      </p>
                    ) : null}
                    {!card.isOwn ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {myCardReady ? (
                          <button
                            type="button"
                            className={goldBtn}
                            disabled={matchBusyId === card.userId}
                            onClick={() => void runMatch(card)}
                          >
                            {matchBusyId === card.userId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5" />
                            )}
                            Match us — {COLLAB_MATCH_COST_VB} Bucs
                          </button>
                        ) : (
                          <span className={`inline-flex items-center text-xs ${muted}`}>
                            Save your card above and the matcher can read you both.
                          </span>
                        )}
                        <button
                          type="button"
                          className={chipBtn(isLight)}
                          onClick={() => {
                            setComposeFor(composeFor === card.userId ? null : card.userId);
                            setComposeText("");
                          }}
                        >
                          <Send className="h-3.5 w-3.5" /> Send a request — free
                        </button>
                      </div>
                    ) : null}
                    {composeFor === card.userId ? (
                      <div className="space-y-2 pt-1">
                        <textarea
                          className={deskInputCls(isLight)}
                          placeholder={`Your pitch to ${card.displayName} — it stays locked until they accept`}
                          rows={3}
                          maxLength={1000}
                          value={composeText}
                          onChange={(e) => setComposeText(e.target.value)}
                          aria-label={`Request message to ${card.displayName}`}
                        />
                        <button
                          type="button"
                          className={goldBtn}
                          disabled={!sendRequestReady(composeText) || sending}
                          onClick={() => void sendRequest(card)}
                        >
                          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                          Send the request
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
              {outOfCredits ? (
                <p className={`text-xs font-semibold ${strong}`}>
                  Not enough Visual Bucs for a match — it costs {COLLAB_MATCH_COST_VB}. Top up at the
                  Treasury; nothing was charged.
                </p>
              ) : null}
              {matchError ? (
                <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{matchError}</p>
              ) : null}
              {match ? (
                <div
                  data-testid="world-collab-match-result"
                  className={`space-y-1.5 rounded-xl border p-3 ${
                    isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                  }`}
                >
                  <p className={`text-sm font-black ${strong}`}>
                    You × {match.report.targetDisplayName} — {match.report.score}/100
                  </p>
                  <p className={`text-sm ${strong}`}>{match.report.verdict}</p>
                  {match.report.strengths.length > 0 ? (
                    <p className={`text-xs ${muted}`}>
                      <span className="font-bold">Why it works:</span> {match.report.strengths.join(" · ")}
                    </p>
                  ) : null}
                  {match.report.risks.length > 0 ? (
                    <p className={`text-xs ${muted}`}>
                      <span className="font-bold">Watch for:</span> {match.report.risks.join(" · ")}
                    </p>
                  ) : null}
                  {match.report.ideas.length > 0 ? (
                    <p className={`text-xs ${muted}`}>
                      <span className="font-bold">Ideas:</span> {match.report.ideas.join(" · ")}
                    </p>
                  ) : null}
                  <p className={`text-xs ${muted}`}>
                    {match.creditsUsed} Bucs used · {match.creditsRemaining.toLocaleString()} left.
                  </p>
                </div>
              ) : null}
            </div>

            {/* ── Requests ── */}
            <div className="space-y-2">
              <p className={`inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] ${muted}`}>
                <HeartHandshake className="h-3.5 w-3.5" /> Requests
              </p>
              {inboxNote ? <p className={`text-xs font-semibold ${strong}`}>{inboxNote}</p> : null}
              {inboxError ? (
                <p className={`text-xs ${isLight ? "text-[#8a2f1b]" : "text-red-300"}`}>{inboxError}</p>
              ) : null}
              {requestsFailed ? (
                <NativeErrorState
                  isLight={isLight}
                  title="Your requests wouldn't open"
                  message="Requests are safe on the real rails — the inbox just didn't answer. Try again."
                  onRetry={() => setRequestsTick((t) => t + 1)}
                />
              ) : requests === null ? (
                <NativeLoadingState isLight={isLight} message="Reading your requests…" />
              ) : requests.received.length === 0 && requests.sent.length === 0 ? (
                <NativeEmptyState
                  isLight={isLight}
                  message="No requests yet, either way."
                  detail="Send one from a creator's card above — the intro unlocks when you both say yes."
                />
              ) : (
                <>
                  {requests.received.map((r) => (
                    <div
                      key={r.id}
                      className={`space-y-1 rounded-xl border px-3 py-2 ${
                        isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                      }`}
                    >
                      <p className={`text-xs font-bold ${strong}`}>
                        From {r.fromDisplayName ?? "A creator"}
                        {r.fromNiche ? ` · ${collabNicheLabel(r.fromNiche)}` : ""} —{" "}
                        {requestStatusLabel(r.status)}
                      </p>
                      {r.introLocked ? (
                        <p className={`text-xs ${muted}`}>
                          {r.lockedReason ?? "Their pitch unlocks when you accept."}
                        </p>
                      ) : (
                        <p className={`text-xs ${muted}`}>{r.message}</p>
                      )}
                      {r.status === "pending" ? (
                        <div className="flex gap-2 pt-0.5">
                          <button
                            type="button"
                            className={goldBtn}
                            disabled={respondBusyId === r.id}
                            onClick={() => void respond(r.id, "accepted")}
                          >
                            <Check className="h-3.5 w-3.5" /> Accept
                          </button>
                          <button
                            type="button"
                            className={chipBtn(isLight)}
                            disabled={respondBusyId === r.id}
                            onClick={() => void respond(r.id, "declined")}
                          >
                            <X className="h-3.5 w-3.5" /> Decline
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {requests.sent.map((r) => (
                    <div
                      key={r.id}
                      className={`space-y-1 rounded-xl border px-3 py-2 ${
                        isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                      }`}
                    >
                      <p className={`text-xs font-bold ${strong}`}>
                        To {r.toDisplayName ?? "A creator"}
                        {r.toNiche ? ` · ${collabNicheLabel(r.toNiche)}` : ""} — {requestStatusLabel(r.status)}
                      </p>
                      <p className={`text-xs ${muted}`}>{r.message}</p>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </NativeCard>
  );
}
