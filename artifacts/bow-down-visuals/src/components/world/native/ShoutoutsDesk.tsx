import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Megaphone, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "@/components/world/native/NativeStates";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import {
  SHOUTOUTS_CREATORS_PATH,
  SHOUTOUTS_REQUESTS_PATH,
  SHOUTOUTS_SETTINGS_PATH,
  SHOUTOUT_PENDING_KEY,
  SHOUTOUT_PLATFORM_FEE_PCT,
  buildShoutoutCheckoutPayload,
  buildShoutoutRequestPayload,
  buildShoutoutSettingsPayload,
  buildShoutoutVerifyPayload,
  parseShoutoutPending,
  shoutoutCheckoutPath,
  shoutoutCreatorsOfResponse,
  shoutoutEmbeddedSecret,
  shoutoutHostedUrl,
  shoutoutRequestDraftReady,
  shoutoutRequestOfResponse,
  shoutoutSessionId,
  shoutoutSettingsDraftOf,
  shoutoutSettingsDraftReady,
  shoutoutSettingsOfResponse,
  shoutoutVerifyConfirmed,
  shoutoutVerifyPath,
  type ShoutoutCreator,
  type ShoutoutRequestDraft,
  type ShoutoutSettings,
  type ShoutoutSettingsDraft,
} from "@/lib/world/shoutouts-desk";

/* ─── Shoutouts desk — World parity wave #4b, census item 27 ──────
   The shoutouts marketplace (pages/shoutouts.tsx), buy-side,
   native at the marketplace square on the page's own rails
   (lib/world/shoutouts-desk carries the seam):
   - browse the creators accepting requests (the public rail —
     guests browse too, like the square itself);
   - the request form in-panel (name / email / occasion / message,
     the page's own fields and bounds);
   - a FREE request reaches the creator the moment it lands;
   - a PRICED request pays the house way: embedded first (the
     shared EmbeddedSessionCheckout mounts right here), the hosted
     page in a NEW TAB only as the fallback at the money moment,
     and a booking counts only when the rail's verify says paid —
     the embedded branch verifies in-World on return/focus; the
     hosted branch settles by webhook and confirms on the 2D
     shoutouts page, and the desk says so rather than pretending;
   - the member's own selling settings (the scope's named rail):
     price, turnaround, guidelines, accepting — free on the rail,
     free here. The platform's flat 5% comes out of the creator's
     side; the fan always pays exactly the listed price. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getAccessToken]);
}

function DeskCard({ isLight, testId, children }: { isLight: boolean; testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId} className={`rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
      {children}
    </div>
  );
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

/** The one way a hosted payment page ever opens from this desk:
 *  a new tab, at the checkout moment, on the walker's click. */
function openCheckoutTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

const EMPTY_DRAFT: ShoutoutRequestDraft = { fanName: "", fanEmail: "", occasion: "", message: "" };

export function ShoutoutsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const [creators, setCreators] = useState<ShoutoutCreator[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ShoutoutRequestDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [buySecret, setBuySecret] = useState<string | null>(null);
  const [buyCreatorName, setBuyCreatorName] = useState("");

  const [settings, setSettings] = useState<ShoutoutSettings | null | undefined>(undefined);
  const [settingsDraft, setSettingsDraft] = useState<ShoutoutSettingsDraft>(shoutoutSettingsDraftOf(null));
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const verifyingRef = useRef(false);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const noteCls = `text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const loadCreators = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch(SHOUTOUTS_CREATORS_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("creators");
      const parsed = shoutoutCreatorsOfResponse(await res.json().catch(() => ({})));
      if (!parsed) throw new Error("creators");
      setCreators(parsed);
    } catch {
      setFailed(true);
    }
  }, [authHeaders]);

  const loadSettings = useCallback(async () => {
    if (isGuest) return;
    try {
      const res = await fetch(SHOUTOUTS_SETTINGS_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("settings");
      const parsed = shoutoutSettingsOfResponse(await res.json().catch(() => ({})));
      if (parsed === undefined) throw new Error("settings");
      setSettings(parsed);
      setSettingsDraft(shoutoutSettingsDraftOf(parsed));
    } catch {
      /* The selling section degrades alone — browsing never waits on it. */
      setSettings(null);
    }
  }, [authHeaders, isGuest]);

  useEffect(() => { void loadCreators(); }, [loadCreators]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);

  /* Verify a pending EMBEDDED checkout from server truth: paid →
     the confirmation; not yet → an honest pending note, marker
     kept. The webhook settles a paid session even if this never
     runs — verify is the in-World confirmation, not the only path. */
  const verifyPending = useCallback(async () => {
    if (verifyingRef.current) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(SHOUTOUT_PENDING_KEY); } catch { /* storage blocked */ }
    const pending = parseShoutoutPending(raw);
    if (!pending) return;
    verifyingRef.current = true;
    try {
      const res = await fetch(shoutoutVerifyPath(pending.requestId), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(buildShoutoutVerifyPayload(pending.sessionId)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && shoutoutVerifyConfirmed(data)) {
        try { localStorage.removeItem(SHOUTOUT_PENDING_KEY); } catch { /* ignore */ }
        setBuySecret(null);
        setNote("Payment confirmed — your shoutout is booked and the creator has it. It lands within their turnaround below.");
      } else if (res.ok) {
        setNote("A shoutout payment is still confirming — it isn't booked until the payment lands. Finish paying, then come back here and it verifies itself.");
      }
    } catch {
      /* status couldn't refresh — nothing about the booking changed */
    } finally {
      verifyingRef.current = false;
    }
  }, [authHeaders]);

  useEffect(() => { void verifyPending(); }, [verifyPending]);
  useEffect(() => {
    const onFocus = () => void verifyPending();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [verifyPending]);

  const selected = creators?.find((c) => c.id === selectedId) ?? null;

  const submitRequest = async () => {
    if (!selected || busy) return;
    setBusy("request");
    setNote(null);
    setBuySecret(null);
    try {
      const res = await fetch(SHOUTOUTS_REQUESTS_PATH, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(buildShoutoutRequestPayload(selected.id, draft)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, "That request couldn't be sent."));
      const made = shoutoutRequestOfResponse(data);
      if (!made) throw new Error("That request couldn't be sent.");
      if (!made.paymentsLive || made.priceCents === 0) {
        setNote(`Request sent — ${selected.displayName} has it now, and it reaches you within ${selected.turnaroundDays} ${selected.turnaroundDays === 1 ? "day" : "days"}.`);
        setDraft(EMPTY_DRAFT);
        setSelectedId(null);
        return;
      }
      /* Priced: straight to the money moment, embedded first. */
      const co = await fetch(shoutoutCheckoutPath(made.id), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(buildShoutoutCheckoutPayload(hasStripePublishableKey())),
      });
      const coData = (await co.json().catch(() => ({}))) as Record<string, unknown>;
      if (!co.ok) throw new Error(apiErrorMessage(coData, "Checkout didn't start — nothing was charged."));
      const sessionId = shoutoutSessionId(coData);
      if (sessionId) {
        try {
          localStorage.setItem(SHOUTOUT_PENDING_KEY, JSON.stringify({ requestId: made.id, sessionId }));
        } catch { /* storage blocked — the webhook still settles it */ }
      }
      const secret = shoutoutEmbeddedSecret(coData);
      if (secret) {
        setBuySecret(secret);
        setBuyCreatorName(selected.displayName);
        setNote(`Finish paying right here — your shoutout from ${selected.displayName} books the moment the payment lands.`);
        return;
      }
      const url = shoutoutHostedUrl(coData);
      if (url) {
        openCheckoutTab(url);
        setNote("Your checkout opened in a new tab — finish paying there. The payment settles your booking the moment it lands, and it confirms on the shoutouts page when you're back.");
        return;
      }
      throw new Error("Checkout didn't return a payment page — nothing was charged.");
    } catch (err) {
      setNote(plainErrorText(err, "That request couldn't be sent. Try again in a moment."));
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async () => {
    if (busy) return;
    setBusy("settings");
    setSettingsNote(null);
    try {
      const res = await fetch(SHOUTOUTS_SETTINGS_PATH, {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify(buildShoutoutSettingsPayload(settingsDraft)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, "Those settings couldn't be saved."));
      const parsed = shoutoutSettingsOfResponse(data);
      if (parsed === undefined) throw new Error("Those settings couldn't be saved.");
      setSettings(parsed);
      setSettingsDraft(shoutoutSettingsDraftOf(parsed));
      setSettingsNote(parsed?.accepting ? "Saved — you're on the board below, taking requests." : "Saved — you're set to not accepting, so you won't show on the board.");
    } catch (err) {
      setSettingsNote(plainErrorText(err, "Those settings couldn't be saved. Try again in a moment."));
    } finally {
      setBusy(null);
    }
  };

  const setD = (patch: Partial<ShoutoutRequestDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setS = (patch: Partial<ShoutoutSettingsDraft>) => setSettingsDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="space-y-3" data-testid="world-shoutouts-desk">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <Megaphone className="h-4 w-4 text-[#d4af37]" /> Shoutouts — book a creator
      </p>
      <p className={`text-sm ${muted}`}>
        Pick a creator, tell them the occasion, and they record a personal video shoutout.
        You always pay exactly the listed price — the platform&rsquo;s flat {SHOUTOUT_PLATFORM_FEE_PCT}% fee comes out of the creator&rsquo;s side, never on top.
      </p>

      {failed ? (
        <NativeErrorState
          isLight={isLight}
          title="The shoutout board wouldn't load"
          message="The creators taking requests couldn't be reached. Nothing changed — try again."
          onRetry={() => void loadCreators()}
        />
      ) : creators === null ? (
        <NativeLoadingState isLight={isLight} message="Finding creators taking requests…" />
      ) : creators.length === 0 ? (
        <NativeEmptyState
          isLight={isLight}
          message="No creators are taking shoutout requests right now"
          detail="When a creator opens their shoutouts, they appear on this board."
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="world-shoutouts-creators">
          {creators.map((c) => (
            <DeskCard key={c.id} isLight={isLight} testId={`world-shoutouts-creator-${c.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p className={`min-w-0 truncate text-sm font-bold ${strong}`}>{c.displayName}</p>
                <span className="ml-auto shrink-0 text-sm font-black text-[#d4af37]">
                  {c.priceDollars > 0 ? `$${c.priceDollars}` : "Free"}
                </span>
              </div>
              <p className={`mt-0.5 text-xs ${muted}`}>
                Delivered within {c.turnaroundDays} {c.turnaroundDays === 1 ? "day" : "days"}
              </p>
              {c.guidelines ? <p className={`mt-1.5 text-xs ${muted}`}>{c.guidelines}</p> : null}
              <button
                type="button"
                className={`${goldBtn} mt-2.5`}
                data-testid={`world-shoutouts-request-btn-${c.id}`}
                onClick={() => { setSelectedId(selectedId === c.id ? null : c.id); setNote(null); }}
              >
                <Send className="h-3.5 w-3.5" /> {selectedId === c.id ? "Close the form" : "Request a shoutout"}
              </button>
              {selectedId === c.id ? (
                <div className="mt-3 space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-shoutouts-form">
                  <input
                    value={draft.fanName}
                    onChange={(e) => setD({ fanName: e.target.value })}
                    placeholder="Your name"
                    maxLength={80}
                    className={inputCls(isLight)}
                    data-testid="world-shoutouts-fan-name"
                    aria-label="Your name"
                  />
                  <input
                    value={draft.fanEmail}
                    onChange={(e) => setD({ fanEmail: e.target.value })}
                    placeholder="Your email (optional — for the delivery)"
                    maxLength={160}
                    className={inputCls(isLight)}
                    data-testid="world-shoutouts-fan-email"
                    aria-label="Your email"
                  />
                  <input
                    value={draft.occasion}
                    onChange={(e) => setD({ occasion: e.target.value })}
                    placeholder="Occasion — birthday, pep talk, anniversary…"
                    maxLength={120}
                    className={inputCls(isLight)}
                    data-testid="world-shoutouts-occasion"
                    aria-label="Occasion"
                  />
                  <textarea
                    value={draft.message}
                    onChange={(e) => setD({ message: e.target.value })}
                    placeholder="What should they say? Names, details, the whole message."
                    maxLength={1000}
                    rows={3}
                    className={inputCls(isLight)}
                    data-testid="world-shoutouts-message"
                    aria-label="Your message for the creator"
                  />
                  <button
                    type="button"
                    className={goldBtn}
                    data-testid="world-shoutouts-submit"
                    disabled={busy !== null || !shoutoutRequestDraftReady(draft)}
                    onClick={() => void submitRequest()}
                  >
                    {busy === "request" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {c.priceDollars > 0 ? `Send & pay $${c.priceDollars}` : "Send the request"}
                  </button>
                </div>
              ) : null}
            </DeskCard>
          ))}
        </div>
      )}

      {buySecret ? (
        <DeskCard isLight={isLight} testId="world-shoutouts-embedded-checkout">
          <p className={`text-sm font-bold ${strong}`}>Pay for your shoutout from {buyCreatorName}</p>
          <div className="mt-2">
            <EmbeddedSessionCheckout clientSecret={buySecret} />
          </div>
          <button type="button" className={`${chipBtn(isLight)} mt-2`} onClick={() => setBuySecret(null)}>
            Close — nothing is charged until you finish paying
          </button>
        </DeskCard>
      ) : null}

      {note ? <p className={noteCls} data-testid="world-shoutouts-note">{note}</p> : null}

      {/* Your own selling settings — the scope's named rail. */}
      <DeskCard isLight={isLight} testId="world-shoutouts-settings">
        <p className={`text-sm font-bold ${strong}`}>Sell your own shoutouts</p>
        {isGuest ? (
          <p className={`mt-1 text-sm ${muted}`}>
            Sign in to open your own shoutout sales — browsing and booking above work without an account, like the website&rsquo;s fan page.
          </p>
        ) : settings === undefined ? (
          <p className={`mt-1 text-sm ${muted}`}>Loading your settings…</p>
        ) : (
          <>
            <p className={`mt-1 text-sm ${muted}`}>
              {settings
                ? settings.accepting
                  ? `You're on the board at $${settings.priceDollars} with a ${settings.turnaroundDays}-day turnaround. You receive ${100 - SHOUTOUT_PLATFORM_FEE_PCT}% of each sale — the flat ${SHOUTOUT_PLATFORM_FEE_PCT}% platform fee comes out of your side.`
                  : "Your settings are saved but you're set to not accepting, so you don't show on the board."
                : "You're not selling shoutouts yet — set a price (0 makes them free) and switch accepting on to join the board."}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={settingsDraft.displayName}
                onChange={(e) => setS({ displayName: e.target.value })}
                placeholder="Display name fans see"
                maxLength={60}
                className={inputCls(isLight)}
                data-testid="world-shoutouts-settings-name"
                aria-label="Display name"
              />
              <div className="flex gap-2">
                <input
                  value={settingsDraft.priceDollars}
                  onChange={(e) => setS({ priceDollars: e.target.value })}
                  placeholder="Price $"
                  inputMode="decimal"
                  className={inputCls(isLight)}
                  data-testid="world-shoutouts-settings-price"
                  aria-label="Price in dollars"
                />
                <input
                  value={settingsDraft.turnaroundDays}
                  onChange={(e) => setS({ turnaroundDays: e.target.value })}
                  placeholder="Days"
                  inputMode="numeric"
                  className={`${inputCls(isLight)} w-24`}
                  data-testid="world-shoutouts-settings-days"
                  aria-label="Turnaround days"
                />
              </div>
            </div>
            <textarea
              value={settingsDraft.guidelines}
              onChange={(e) => setS({ guidelines: e.target.value })}
              placeholder="Guidelines for fans — what you'll record, what you won't (optional)"
              maxLength={1000}
              rows={2}
              className={`${inputCls(isLight)} mt-2`}
              data-testid="world-shoutouts-settings-guidelines"
              aria-label="Guidelines"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={settingsDraft.accepting}
                className={chipBtn(isLight)}
                data-testid="world-shoutouts-settings-accepting"
                onClick={() => setS({ accepting: !settingsDraft.accepting })}
              >
                {settingsDraft.accepting ? "Accepting requests" : "Not accepting"}
              </button>
              <button
                type="button"
                className={goldBtn}
                data-testid="world-shoutouts-settings-save"
                disabled={busy !== null || !shoutoutSettingsDraftReady(settingsDraft)}
                onClick={() => void saveSettings()}
              >
                {busy === "settings" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save settings
              </button>
            </div>
            {settingsNote ? <p className={`mt-2 ${noteCls}`}>{settingsNote}</p> : null}
          </>
        )}
      </DeskCard>
    </div>
  );
}
