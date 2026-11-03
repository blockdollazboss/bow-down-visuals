import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Mail, Network, Plus, Send, Sparkles, Trash2, Users, Zap } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { useDeskAuthHeaders, deskInputCls } from "./CreateDeskLeaf";
import {
  EMAIL_LISTS_PATH, EMAIL_NEWSLETTER_COST_VISUAL_BUCS, EMAIL_NEWSLETTER_PATH,
  FAN_GRAPH_SORTS, NEWSLETTER_TONES,
  buildAutomationCopyPatch, buildAutomationToggle, buildCampaignPayload, buildListPayload,
  buildNewsletterPayload, campaignReady, campaignSendable, emailListAutomationItemPath,
  emailListAutomationsPath, emailListCampaignSendPath, emailListCampaignsPath,
  emailListSegmentsPath, emailListSubscribersPath, emailListUnsubscribePath, fanBadges,
  fanGraphPath, fanSpentLabel, listReady, newsletterReady, openRateLabel, parseAutomations,
  parseCampaigns, parseEmailLists, parseFanGraph, parseNewsletterDraft, parseSegments,
  parseSubscribers,
  type AutomationRow, type CampaignRow, type EmailListRow, type FanGraphSummary,
  type FanRecordRow, type ListStats, type NewsletterDraft, type SegmentRow, type SubscriberRow,
} from "@/lib/world/email-list-desk";

/* ─── Email List, in-world (stack1400 world parity, wave #2 item 1) ──
   The Email List family native at the Promote Room, stacked under the
   Promote Desk and the Label Pitch desk — on the 2D page's own rails
   end to end (see lib/world/email-list-desk for the rail map): your
   lists and subscribers with honest stats, saved segments, campaign
   drafts + tracked sends, the AI newsletter writer (100 VB), the four
   email automations with their on/off switches and copy, and the
   read-only Fan Graph. Everything completes here: no page pull-up,
   no exit to /email-list (the frame's one transfer footer is the
   host's).

   CHARGES: the newsletter draft rides useConfirmedApi with its rail
   cost as an explicit override (100 VB — the server constant), so the
   member confirms the exact price before anything is charged, exactly
   as on the website. Everything else is free, as on the website. A
   failed draft is refunded by the rail itself and the desk says so. */

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";

const chipBtn = (isLight: boolean, active = false) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;

const selectCls = (isLight: boolean) =>
  `rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07]"
      : "border-white/10 bg-white/5 text-white/80"
  }`;

function GuestGate({ isLight }: { isLight: boolean }) {
  return (
    <NativeCard isLight={isLight} title="Email List — your fans, your list">
      <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        The email desk works on your own lists, your own subscribers and your own fan graph —
        guests can look around the palace, but this desk only opens for members.{" "}
        <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
          Sign in
        </Link>{" "}
        and the desk is yours, right here in the room.
      </p>
    </NativeCard>
  );
}

type LoadState = "loading" | "failed" | "ready";

export function EmailListDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const { refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  const [lists, setLists] = useState<EmailListRow[]>([]);
  const [listsState, setListsState] = useState<LoadState>("loading");
  const [activeListId, setActiveListId] = useState("");
  const [newList, setNewList] = useState({ name: "", handle: "", description: "" });
  const [listNote, setListNote] = useState<string | null>(null);
  const [listsTick, setListsTick] = useState(0);
  const [panelsTick, setPanelsTick] = useState(0);
  const [creatingList, setCreatingList] = useState(false);

  const [subscribers, setSubscribers] = useState<SubscriberRow[]>([]);
  const [stats, setStats] = useState<ListStats | null>(null);
  const [subsState, setSubsState] = useState<LoadState>("loading");
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [unsubArmed, setUnsubArmed] = useState<string | null>(null);
  const [subNote, setSubNote] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campForm, setCampForm] = useState({ subject: "", body: "" });
  const [campNote, setCampNote] = useState<string | null>(null);
  const [campBusy, setCampBusy] = useState(false);

  const [newsForm, setNewsForm] = useState({ topic: "", tone: "hype", creatorName: "", callToAction: "" });
  const [draft, setDraft] = useState<NewsletterDraft | null>(null);
  const [newsBusy, setNewsBusy] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [autoState, setAutoState] = useState<LoadState>("loading");
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [autoEdits, setAutoEdits] = useState<Record<string, { subject: string; body: string; delayHours: string }>>({});

  const [fans, setFans] = useState<FanRecordRow[]>([]);
  const [fanSummary, setFanSummary] = useState<FanGraphSummary | null>(null);
  const [fanTotal, setFanTotal] = useState(0);
  const [fanState, setFanState] = useState<LoadState>("loading");
  const [fanSearch, setFanSearch] = useState("");
  const [fanSort, setFanSort] = useState<string>("recent");
  const [fanPage, setFanPage] = useState(1);
  const [fanTick, setFanTick] = useState(0);

  const activeList = lists.find((l) => l.id === activeListId) ?? null;

  /* ── lists ── */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(EMAIL_LISTS_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error("lists");
        const parsed = parseEmailLists(await res.json());
        if (cancelled) return;
        setLists(parsed);
        setListsState("ready");
        setActiveListId((prev) => (prev && parsed.some((l) => l.id === prev) ? prev : (parsed[0]?.id ?? "")));
      } catch { if (!cancelled) setListsState("failed"); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, listsTick]);

  const createList = async () => {
    if (!listReady(newList) || creatingList) {
      setListNote("A list needs a name and a handle (3–40 letters, numbers or dashes).");
      return;
    }
    setCreatingList(true);
    setListNote(null);
    try {
      const res = await fetch(EMAIL_LISTS_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildListPayload(newList)),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("create");
      const created = parseEmailLists({ lists: [(data as { list?: unknown }).list] });
      if (created[0]) {
        setLists((prev) => [created[0]!, ...prev]);
        setActiveListId(created[0].id);
        setNewList({ name: "", handle: "", description: "" });
        setListNote("Your list is live — fans can join it from your join page and embeds.");
      }
    } catch { setListNote("Couldn't create that list — the handle may already be taken."); }
    finally { setCreatingList(false); }
  };

  /* ── per-list loads: subscribers, segments, campaigns, automations ── */
  const loadListPanels = async (listId: string) => {
    setSubsState("loading");
    setAutoState("loading");
    try {
      const res = await fetch(emailListSubscribersPath(listId), { headers: await authHeaders() });
      if (!res.ok) throw new Error("subs");
      const parsed = parseSubscribers(await res.json());
      setSubscribers(parsed.subscribers);
      setStats(parsed.stats);
      setSubsState("ready");
    } catch { setSubsState("failed"); }
    try {
      const res = await fetch(emailListSegmentsPath(listId), { headers: await authHeaders() });
      if (res.ok) setSegments(parseSegments(await res.json()));
    } catch { /* segments are a readout — the desk stands without them */ }
    try {
      const res = await fetch(emailListCampaignsPath(listId), { headers: await authHeaders() });
      if (res.ok) setCampaigns(parseCampaigns(await res.json()));
    } catch { /* campaign history is a readout — the desk stands without it */ }
    try {
      const res = await fetch(emailListAutomationsPath(listId), { headers: await authHeaders() });
      if (!res.ok) throw new Error("autos");
      const parsed = parseAutomations(await res.json());
      setAutomations(parsed);
      setAutoEdits(Object.fromEntries(parsed.map((a) => [a.kind, { subject: a.subject, body: a.body, delayHours: String(a.delayHours) }])));
      setAutoState("ready");
    } catch { setAutoState("failed"); }
  };

  useEffect(() => {
    if (isGuest || !activeListId) return;
    void loadListPanels(activeListId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, activeListId, panelsTick]);

  const unsubscribeFan = async (sub: SubscriberRow) => {
    if (!activeListId) return;
    setSubNote(null);
    try {
      const res = await fetch(emailListUnsubscribePath(activeListId), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ email: sub.email }),
      });
      if (!res.ok) throw new Error("unsub");
      setSubscribers((prev) => prev.map((s) => (s.id === sub.id ? { ...s, unsubscribedAt: new Date().toISOString() } : s)));
      setUnsubArmed(null);
      setSubNote(`${sub.email} is unsubscribed — they won't get campaign or welcome emails from this list anymore.`);
    } catch { setSubNote("Couldn't unsubscribe that fan. Try again."); }
  };

  /* ── campaigns ── */
  const createCampaign = async () => {
    if (!activeListId || !campaignReady(campForm) || campBusy) {
      setCampNote("A campaign needs a subject and a body.");
      return;
    }
    setCampBusy(true);
    setCampNote(null);
    try {
      const res = await fetch(emailListCampaignsPath(activeListId), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildCampaignPayload(campForm)),
      });
      if (!res.ok) throw new Error("camp");
      const data: unknown = await res.json().catch(() => ({}));
      const row = parseCampaigns({ campaigns: [(data as { campaign?: unknown }).campaign] })[0];
      if (row) setCampaigns((prev) => [row, ...prev]);
      setCampForm({ subject: "", body: "" });
      setCampNote("Draft saved — send it from the history below when you're ready.");
    } catch { setCampNote("Couldn't save that campaign draft."); }
    finally { setCampBusy(false); }
  };

  const sendCampaign = async (c: CampaignRow) => {
    if (!activeListId || campBusy) return;
    setCampBusy(true);
    setCampNote(null);
    try {
      const res = await fetch(emailListCampaignSendPath(activeListId, c.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("send");
      const fresh = parseCampaigns({ campaigns: [(data as { campaign?: unknown }).campaign] })[0];
      if (fresh) setCampaigns((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)));
      setCampNote("Send handed to the tracked email rail — the status above is stamped by the server, never by this desk.");
    } catch { setCampNote("That campaign couldn't be sent from here — check its status and try again."); }
    finally { setCampBusy(false); }
  };

  /* ── newsletter (the one paid rail) ── */
  const writeNewsletter = async () => {
    if (!newsletterReady(newsForm) || newsBusy) return;
    setNewsBusy(true);
    setNewsError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(EMAIL_NEWSLETTER_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        overrideCost: EMAIL_NEWSLETTER_COST_VISUAL_BUCS,
        overrideFeature: "AI Newsletter Draft",
        body: JSON.stringify(buildNewsletterPayload({
          topic: newsForm.topic, tone: newsForm.tone, creatorName: newsForm.creatorName,
          listName: activeList?.name ?? "", callToAction: newsForm.callToAction,
        })),
      });
      if (!res) return; /* declined the confirmation — nothing charged */
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 402) { setOutOfCredits(true); refreshProfile(); return; }
      const parsed = parseNewsletterDraft(data);
      if (!res.ok || !parsed) {
        setNewsError("The newsletter draft didn't come together — a failed draft is refunded by the rail. Try again.");
        return;
      }
      setDraft(parsed);
      refreshProfile();
    } catch { setNewsError("The email desk didn't answer. Try again."); }
    finally { setNewsBusy(false); }
  };

  const useDraftAsCampaign = () => {
    if (!draft) return;
    setCampForm({ subject: draft.subject, body: draft.body });
    setCampNote("Draft loaded into the campaign form below — save it, then send when ready.");
  };

  /* ── automations ── */
  const patchAutomation = async (a: AutomationRow, patch: Record<string, unknown>) => {
    if (!activeListId) return;
    setAutoNote(null);
    try {
      const res = await fetch(emailListAutomationItemPath(activeListId, a.kind), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(patch),
      });
      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("patch");
      const fresh = parseAutomations({ automations: [(data as { automation?: unknown }).automation] })[0];
      if (fresh) {
        setAutomations((prev) => prev.map((x) => (x.kind === fresh.kind ? fresh : x)));
        setAutoEdits((prev) => ({ ...prev, [fresh.kind]: { subject: fresh.subject, body: fresh.body, delayHours: String(fresh.delayHours) } }));
      }
    } catch { setAutoNote("Couldn't save that automation. Try again."); }
  };

  /* ── fan graph ── */
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    setFanState("loading");
    (async () => {
      try {
        const res = await fetch(fanGraphPath({ search: fanSearch, sort: fanSort, page: fanPage }), { headers: await authHeaders() });
        if (!res.ok) throw new Error("fans");
        const parsed = parseFanGraph(await res.json());
        if (cancelled) return;
        setFans(parsed.fans);
        setFanSummary(parsed.summary);
        setFanTotal(parsed.total);
        setFanState("ready");
      } catch { if (!cancelled) setFanState("failed"); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, fanSort, fanPage, fanTick]);

  if (isGuest) return <GuestGate isLight={isLight} />;

  const fanPages = Math.max(1, Math.ceil(fanTotal / 25));

  return (
    <div data-testid="world-email-list-desk" className="space-y-4">
      <NativeCard isLight={isLight} title="Email List — subscribers">
        {listsState === "loading" ? <NativeLoadingState isLight={isLight} message="Loading your lists…" /> : null}
        {listsState === "failed" ? (
          <NativeErrorState isLight={isLight} message="Your lists couldn't load — the rest of the room is unaffected." onRetry={() => setListsTick((t) => t + 1)} />
        ) : null}
        {listsState === "ready" ? (
          <div className="space-y-3">
            {lists.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Your email lists">
                {lists.map((l) => (
                  <button key={l.id} type="button" className={chipBtn(isLight, l.id === activeListId)} onClick={() => setActiveListId(l.id)}>
                    {l.name || l.handle}
                  </button>
                ))}
              </div>
            ) : (
              <NativeEmptyState isLight={isLight} message="No list yet — create your first one below and fans can start joining." />
            )}
            {activeList ? (
              <p className={`text-xs ${muted}`}>
                Join handle: <span className={strong}>/join/{activeList.handle}</span>
                {stats ? <> · {stats.active} active of {stats.total} signups · {openRateLabel(stats)}</> : null}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-3">
              <input aria-label="New list name" className={deskInputCls(isLight)} value={newList.name} maxLength={120} onChange={(e) => setNewList({ ...newList, name: e.target.value })} placeholder="List name" />
              <input aria-label="New list handle" className={deskInputCls(isLight)} value={newList.handle} maxLength={40} onChange={(e) => setNewList({ ...newList, handle: e.target.value })} placeholder="handle (e.g. my-fans)" />
              <input aria-label="New list description" className={deskInputCls(isLight)} value={newList.description} maxLength={300} onChange={(e) => setNewList({ ...newList, description: e.target.value })} placeholder="What fans get" />
            </div>
            <button type="button" data-testid="world-email-list-create" className={goldBtn} disabled={creatingList} onClick={() => void createList()}>
              {creatingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create list
            </button>
            {listNote ? <p className={`text-xs ${muted}`}>{listNote}</p> : null}

            {activeListId ? (
              <>
                {subsState === "loading" ? <NativeLoadingState isLight={isLight} message="Loading subscribers…" /> : null}
                {subsState === "failed" ? <NativeErrorState isLight={isLight} message="Subscribers couldn't load for this list." onRetry={() => setPanelsTick((t) => t + 1)} /> : null}
                {subsState === "ready" && subscribers.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message="No subscribers yet — share your join handle and this board fills in." />
                ) : null}
                {subsState === "ready" && subscribers.length > 0 ? (
                  <div className="space-y-1.5" data-testid="world-email-list-subscribers">
                    {subscribers.slice(0, 50).map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-[#d4af37]" />
                        <span className={`text-sm ${strong}`}>{s.name ? `${s.name} · ` : ""}{s.email}</span>
                        <span className={`text-[11px] ${muted}`}>{s.source} · {s.opens} opens · {s.clicks} clicks</span>
                        {[...s.tags, ...s.autoTags].map((t) => (
                          <span key={t} className="rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2 py-0.5 text-[11px] font-semibold text-[#e8c86a]">{t}</span>
                        ))}
                        {s.unsubscribedAt ? (
                          <span className={`text-[11px] ${muted}`}>Unsubscribed</span>
                        ) : (
                          <button type="button" className={chipBtn(isLight, unsubArmed === s.id)} onClick={() => (unsubArmed === s.id ? void unsubscribeFan(s) : setUnsubArmed(s.id))}>
                            {unsubArmed === s.id ? "Tap again to unsubscribe" : "Unsubscribe"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {subNote ? <p className={`text-xs ${muted}`}>{subNote}</p> : null}
                {segments.length > 0 ? (
                  <p className={`text-xs ${muted}`} data-testid="world-email-list-segments">
                    Saved audiences: {segments.map((s) => `${s.name} (${s.size})`).join(" · ")}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </NativeCard>

      <NativeCard isLight={isLight} title="Newsletter + campaigns">
        <div className="space-y-2">
          <input aria-label="Newsletter topic" className={deskInputCls(isLight)} value={newsForm.topic} maxLength={500} onChange={(e) => setNewsForm({ ...newsForm, topic: e.target.value })} placeholder="What's the newsletter about?" />
          <div className="flex flex-wrap gap-2">
            <select aria-label="Newsletter tone" className={selectCls(isLight)} value={newsForm.tone} onChange={(e) => setNewsForm({ ...newsForm, tone: e.target.value })}>
              {NEWSLETTER_TONES.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
            <input aria-label="Your creator name" className={`${deskInputCls(isLight)} max-w-56`} value={newsForm.creatorName} maxLength={120} onChange={(e) => setNewsForm({ ...newsForm, creatorName: e.target.value })} placeholder="Your creator name" />
            <input aria-label="Call to action" className={`${deskInputCls(isLight)} max-w-56`} value={newsForm.callToAction} maxLength={300} onChange={(e) => setNewsForm({ ...newsForm, callToAction: e.target.value })} placeholder="Call to action (optional)" />
          </div>
          <button type="button" data-testid="world-email-newsletter-generate" className={goldBtn} disabled={newsBusy || !newsletterReady(newsForm)} onClick={() => void writeNewsletter()}>
            {newsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Write my newsletter · {EMAIL_NEWSLETTER_COST_VISUAL_BUCS} VB
          </button>
          {outOfCredits ? <p className="text-xs text-red-300">You&apos;re out of Visual Bucs — top up to keep writing newsletters.</p> : null}
          {newsError ? <p className="text-xs text-red-300">{newsError}</p> : null}
          {draft ? (
            <div data-testid="world-email-newsletter-result" className="space-y-1">
              <p className={`text-sm font-bold ${strong}`}>{draft.subject}</p>
              <p className={`whitespace-pre-wrap text-sm ${muted}`}>{draft.body}</p>
              <button type="button" className={chipBtn(isLight)} onClick={useDraftAsCampaign}>Use as a campaign</button>
            </div>
          ) : null}
          <input aria-label="Campaign subject" className={deskInputCls(isLight)} value={campForm.subject} maxLength={200} onChange={(e) => setCampForm({ ...campForm, subject: e.target.value })} placeholder="Campaign subject" />
          <textarea aria-label="Campaign body" className={deskInputCls(isLight)} rows={4} value={campForm.body} maxLength={50000} onChange={(e) => setCampForm({ ...campForm, body: e.target.value })} placeholder="Campaign body" />
          <button type="button" data-testid="world-email-campaign-create" className={chipBtn(isLight)} disabled={campBusy || !activeListId} onClick={() => void createCampaign()}>
            <Mail className="h-3.5 w-3.5" /> Save campaign draft
          </button>
          {campNote ? <p className={`text-xs ${muted}`}>{campNote}</p> : null}
          {campaigns.length > 0 ? (
            <div className="space-y-1.5">
              {campaigns.slice(0, 20).map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm ${strong}`}>{c.subject}</span>
                  <span className={`text-[11px] ${muted}`}>{c.status} · {c.deliveredCount}/{c.recipientCount} delivered · {c.openCount} opens · {c.clickCount} clicks</span>
                  {campaignSendable(c) ? (
                    <button type="button" className={chipBtn(isLight)} disabled={campBusy} onClick={() => void sendCampaign(c)}>
                      <Send className="h-3.5 w-3.5" /> Send
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title="Automations">
        {autoState === "loading" && activeListId ? <NativeLoadingState isLight={isLight} message="Loading automations…" /> : null}
        {!activeListId ? <NativeEmptyState isLight={isLight} message="Pick or create a list above — its automations live here." /> : null}
        {autoState === "failed" ? <NativeErrorState isLight={isLight} message="Automations couldn't load for this list." onRetry={() => setPanelsTick((t) => t + 1)} /> : null}
        {autoNote ? <p className="text-xs text-red-300">{autoNote}</p> : null}
        <div className="space-y-3" data-testid="world-email-automations">
          {automations.map((a) => {
            const edit = autoEdits[a.kind] ?? { subject: a.subject, body: a.body, delayHours: String(a.delayHours) };
            return (
              <div key={a.kind} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-[#d4af37]" />
                  <span className={`text-sm font-bold ${strong}`}>{a.label}</span>
                  <button type="button" data-testid={`world-email-automation-toggle-${a.kind}`} className={chipBtn(isLight, a.enabled)} onClick={() => void patchAutomation(a, buildAutomationToggle(a))}>
                    {a.enabled ? "On — tap to switch off" : "Off — tap to switch on"}
                  </button>
                  <span className={`text-[11px] ${muted}`}>{a.sent} sent · {a.delivered} delivered · {a.opens} opens · {a.clicks} clicks</span>
                </div>
                <p className={`text-xs ${muted}`}>{a.triggerNote}</p>
                <input aria-label={`${a.label} subject`} className={deskInputCls(isLight)} value={edit.subject} maxLength={200} onChange={(e) => setAutoEdits({ ...autoEdits, [a.kind]: { ...edit, subject: e.target.value } })} placeholder="Subject" />
                <textarea aria-label={`${a.label} body`} className={deskInputCls(isLight)} rows={2} value={edit.body} maxLength={50000} onChange={(e) => setAutoEdits({ ...autoEdits, [a.kind]: { ...edit, body: e.target.value } })} placeholder="Body" />
                <div className="flex flex-wrap items-center gap-2">
                  <label className={`text-[11px] ${muted}`}>Delay (hours)
                    <input aria-label={`${a.label} delay hours`} type="number" min={0} max={720} className={`${deskInputCls(isLight)} ml-2 w-24`} value={edit.delayHours} onChange={(e) => setAutoEdits({ ...autoEdits, [a.kind]: { ...edit, delayHours: e.target.value } })} />
                  </label>
                  <button type="button" className={chipBtn(isLight)} onClick={() => void patchAutomation(a, buildAutomationCopyPatch({ subject: edit.subject, body: edit.body, delayHours: Number(edit.delayHours) }))}>
                    Save copy
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title="Fan Graph — every fan, one view">
        {fanSummary ? (
          <p className={`text-xs ${muted}`} data-testid="world-fan-graph-summary">
            {fanSummary.totalFans} fans · {fanSummary.followers} followers · {fanSummary.subscribers} subscribers ·{" "}
            {fanSummary.members} members · {fanSummary.buyers} buyers
            {fanSummary.totalSpentUsdCents > 0 || fanSummary.totalSpentVb > 0
              ? ` · spent $${(fanSummary.totalSpentUsdCents / 100).toFixed(2)}${fanSummary.totalSpentVb > 0 ? ` · ${fanSummary.totalSpentVb.toLocaleString()} VB` : ""}`
              : ""}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <input aria-label="Search fans" className={`${deskInputCls(isLight)} max-w-64`} value={fanSearch} maxLength={120} onChange={(e) => setFanSearch(e.target.value)} placeholder="Search fans" />
          <button type="button" className={chipBtn(isLight)} onClick={() => { setFanPage(1); setFanTick((t) => t + 1); }}>Search</button>
          <select aria-label="Sort fans" className={selectCls(isLight)} value={fanSort} onChange={(e) => { setFanSort(e.target.value); setFanPage(1); }}>
            {FAN_GRAPH_SORTS.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>
        {fanState === "loading" ? <NativeLoadingState isLight={isLight} message="Loading your fan graph…" /> : null}
        {fanState === "failed" ? <NativeErrorState isLight={isLight} message="Your fan graph couldn't load." onRetry={() => setFanTick((t) => t + 1)} /> : null}
        {fanState === "ready" && fans.length === 0 ? (
          <NativeEmptyState isLight={isLight} message="No fans in the graph yet — followers, subscribers, members and buyers merge here as they arrive." />
        ) : null}
        {fanState === "ready" && fans.length > 0 ? (
          <div className="mt-2 space-y-1.5" data-testid="world-fan-graph-fans">
            {fans.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-2">
                <Network className="h-3.5 w-3.5 text-[#d4af37]" />
                <span className={`text-sm ${strong}`}>{f.displayName ?? f.email ?? f.id}</span>
                {f.displayName && f.email ? <span className={`text-[11px] ${muted}`}>{f.email}</span> : null}
                {fanBadges(f).map((b) => (
                  <span key={b} className="rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2 py-0.5 text-[11px] font-semibold text-[#e8c86a]">{b}</span>
                ))}
                {fanSpentLabel(f) ? <span className={`text-[11px] ${muted}`}>Spent {fanSpentLabel(f)}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {fanTotal > 25 ? (
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className={chipBtn(isLight)} disabled={fanPage <= 1} onClick={() => setFanPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span className={`text-xs ${muted}`}>{fanPage} / {fanPages}</span>
            <button type="button" className={chipBtn(isLight)} disabled={fanPage >= fanPages} onClick={() => setFanPage((p) => Math.min(fanPages, p + 1))}>Next</button>
          </div>
        ) : null}
        <p className={`mt-2 flex items-center gap-1 text-[11px] ${muted}`}><Trash2 className="hidden" />Read-only — the graph displays your fans; it never writes them.</p>
      </NativeCard>
    </div>
  );
}

export default EmailListDesk;
