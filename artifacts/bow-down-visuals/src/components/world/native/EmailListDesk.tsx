import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <NativeCard isLight={isLight} title={t("worldScheduleRelease.emailGuestTitle")}>
      <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        {t("worldScheduleRelease.emailGuestBody")}{" "}
        <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
          {t("worldScheduleRelease.emailGuestSignIn")}
        </Link>{" "}
        {t("worldScheduleRelease.emailGuestBodyAfter")}
      </p>
    </NativeCard>
  );
}

type LoadState = "loading" | "failed" | "ready";

export function EmailListDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
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
      setListNote(t("worldScheduleRelease.emailListNeedsName"));
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
        setListNote(t("worldScheduleRelease.emailListCreated"));
      }
    } catch { setListNote(t("worldScheduleRelease.emailListCreateFailed")); }
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
      setSubNote(t("worldScheduleRelease.emailUnsubDone", { email: sub.email }));
    } catch { setSubNote(t("worldScheduleRelease.emailUnsubFailed")); }
  };

  /* ── campaigns ── */
  const createCampaign = async () => {
    if (!activeListId || !campaignReady(campForm) || campBusy) {
      setCampNote(t("worldScheduleRelease.emailCampaignNeeds"));
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
      setCampNote(t("worldScheduleRelease.emailCampaignSaved"));
    } catch { setCampNote(t("worldScheduleRelease.emailCampaignSaveFailed")); }
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
      setCampNote(t("worldScheduleRelease.emailCampaignSent"));
    } catch { setCampNote(t("worldScheduleRelease.emailCampaignSendFailed")); }
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
        setNewsError(t("worldScheduleRelease.emailNewsletterFailed"));
        return;
      }
      setDraft(parsed);
      refreshProfile();
    } catch { setNewsError(t("worldScheduleRelease.emailDeskNoAnswer")); }
    finally { setNewsBusy(false); }
  };

  const useDraftAsCampaign = () => {
    if (!draft) return;
    setCampForm({ subject: draft.subject, body: draft.body });
    setCampNote(t("worldScheduleRelease.emailDraftLoaded"));
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
    } catch { setAutoNote(t("worldScheduleRelease.emailAutoSaveFailed")); }
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
      <NativeCard isLight={isLight} title={t("worldScheduleRelease.emailListsTitle")}>
        {listsState === "loading" ? <NativeLoadingState isLight={isLight} message={t("worldScheduleRelease.emailListsLoading")} /> : null}
        {listsState === "failed" ? (
          <NativeErrorState isLight={isLight} message={t("worldScheduleRelease.emailListsLoadFailed")} onRetry={() => setListsTick((n) => n + 1)} />
        ) : null}
        {listsState === "ready" ? (
          <div className="space-y-3">
            {lists.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldScheduleRelease.emailListsTabsAria")}>
                {lists.map((l) => (
                  <button key={l.id} type="button" className={chipBtn(isLight, l.id === activeListId)} onClick={() => setActiveListId(l.id)}>
                    {l.name || l.handle}
                  </button>
                ))}
              </div>
            ) : (
              <NativeEmptyState isLight={isLight} message={t("worldScheduleRelease.emailNoLists")} />
            )}
            {activeList ? (
              <p className={`text-xs ${muted}`}>
                {t("worldScheduleRelease.emailJoinHandleLabel")} <span className={strong}>/join/{activeList.handle}</span>
                {stats ? <> · {t("worldScheduleRelease.emailStatsLine", { active: stats.active, total: stats.total })} · {openRateLabel(stats, { notTrackedYet: t("worldScheduleRelease.emailOpenRateNotTracked"), openRate: t("worldScheduleRelease.emailOpenRate") })}</> : null}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-3">
              <input aria-label={t("worldScheduleRelease.emailListNameAria")} className={deskInputCls(isLight)} value={newList.name} maxLength={120} onChange={(e) => setNewList({ ...newList, name: e.target.value })} placeholder={t("worldScheduleRelease.emailListNamePlaceholder")} />
              <input aria-label={t("worldScheduleRelease.emailListHandleAria")} className={deskInputCls(isLight)} value={newList.handle} maxLength={40} onChange={(e) => setNewList({ ...newList, handle: e.target.value })} placeholder={t("worldScheduleRelease.emailListHandlePlaceholder")} />
              <input aria-label={t("worldScheduleRelease.emailListDescAria")} className={deskInputCls(isLight)} value={newList.description} maxLength={300} onChange={(e) => setNewList({ ...newList, description: e.target.value })} placeholder={t("worldScheduleRelease.emailListDescPlaceholder")} />
            </div>
            <button type="button" data-testid="world-email-list-create" className={goldBtn} disabled={creatingList} onClick={() => void createList()}>
              {creatingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t("worldScheduleRelease.emailCreateList")}
            </button>
            {listNote ? <p className={`text-xs ${muted}`}>{listNote}</p> : null}

            {activeListId ? (
              <>
                {subsState === "loading" ? <NativeLoadingState isLight={isLight} message={t("worldScheduleRelease.emailSubsLoading")} /> : null}
                {subsState === "failed" ? <NativeErrorState isLight={isLight} message={t("worldScheduleRelease.emailSubsLoadFailed")} onRetry={() => setPanelsTick((n) => n + 1)} /> : null}
                {subsState === "ready" && subscribers.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message={t("worldScheduleRelease.emailNoSubs")} />
                ) : null}
                {subsState === "ready" && subscribers.length > 0 ? (
                  <div className="space-y-1.5" data-testid="world-email-list-subscribers">
                    {subscribers.slice(0, 50).map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-2">
                        <Users className="h-3.5 w-3.5 text-[#d4af37]" />
                        <span className={`text-sm ${strong}`}>{s.name ? `${s.name} · ` : ""}{s.email}</span>
                        <span className={`text-[11px] ${muted}`}>{t("worldScheduleRelease.emailSubMeta", { source: s.source, opens: s.opens, clicks: s.clicks })}</span>
                        {[...s.tags, ...s.autoTags].map((tag) => (
                          <span key={tag} className="rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2 py-0.5 text-[11px] font-semibold text-[#e8c86a]">{tag}</span>
                        ))}
                        {s.unsubscribedAt ? (
                          <span className={`text-[11px] ${muted}`}>{t("worldScheduleRelease.emailUnsubscribed")}</span>
                        ) : (
                          <button type="button" className={chipBtn(isLight, unsubArmed === s.id)} onClick={() => (unsubArmed === s.id ? void unsubscribeFan(s) : setUnsubArmed(s.id))}>
                            {unsubArmed === s.id ? t("worldScheduleRelease.emailUnsubscribeArmed") : t("worldScheduleRelease.emailUnsubscribe")}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {subNote ? <p className={`text-xs ${muted}`}>{subNote}</p> : null}
                {segments.length > 0 ? (
                  <p className={`text-xs ${muted}`} data-testid="world-email-list-segments">
                    {t("worldScheduleRelease.emailSegmentsLine", { list: segments.map((s) => `${s.name} (${s.size})`).join(" · ") })}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldScheduleRelease.emailNewsletterTitle")}>
        <div className="space-y-2">
          <input aria-label={t("worldScheduleRelease.emailTopicAria")} className={deskInputCls(isLight)} value={newsForm.topic} maxLength={500} onChange={(e) => setNewsForm({ ...newsForm, topic: e.target.value })} placeholder={t("worldScheduleRelease.emailTopicPlaceholder")} />
          <div className="flex flex-wrap gap-2">
            <select aria-label={t("worldScheduleRelease.emailToneAria")} className={selectCls(isLight)} value={newsForm.tone} onChange={(e) => setNewsForm({ ...newsForm, tone: e.target.value })}>
              {NEWSLETTER_TONES.map((tone) => (<option key={tone} value={tone}>{tone}</option>))}
            </select>
            <input aria-label={t("worldScheduleRelease.emailCreatorNameAria")} className={`${deskInputCls(isLight)} max-w-56`} value={newsForm.creatorName} maxLength={120} onChange={(e) => setNewsForm({ ...newsForm, creatorName: e.target.value })} placeholder={t("worldScheduleRelease.emailCreatorNamePlaceholder")} />
            <input aria-label={t("worldScheduleRelease.emailCtaAria")} className={`${deskInputCls(isLight)} max-w-56`} value={newsForm.callToAction} maxLength={300} onChange={(e) => setNewsForm({ ...newsForm, callToAction: e.target.value })} placeholder={t("worldScheduleRelease.emailCtaPlaceholder")} />
          </div>
          <button type="button" data-testid="world-email-newsletter-generate" className={goldBtn} disabled={newsBusy || !newsletterReady(newsForm)} onClick={() => void writeNewsletter()}>
            {newsBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {t("worldScheduleRelease.emailWriteNewsletter", { cost: EMAIL_NEWSLETTER_COST_VISUAL_BUCS })}
          </button>
          {outOfCredits ? <p className="text-xs text-red-300">{t("worldScheduleRelease.emailOutOfBucs")}</p> : null}
          {newsError ? <p className="text-xs text-red-300">{newsError}</p> : null}
          {draft ? (
            <div data-testid="world-email-newsletter-result" className="space-y-1">
              <p className={`text-sm font-bold ${strong}`}>{draft.subject}</p>
              <p className={`whitespace-pre-wrap text-sm ${muted}`}>{draft.body}</p>
              <button type="button" className={chipBtn(isLight)} onClick={useDraftAsCampaign}>{t("worldScheduleRelease.emailUseAsCampaign")}</button>
            </div>
          ) : null}
          <input aria-label={t("worldScheduleRelease.emailCampaignSubjectAria")} className={deskInputCls(isLight)} value={campForm.subject} maxLength={200} onChange={(e) => setCampForm({ ...campForm, subject: e.target.value })} placeholder={t("worldScheduleRelease.emailCampaignSubjectPlaceholder")} />
          <textarea aria-label={t("worldScheduleRelease.emailCampaignBodyAria")} className={deskInputCls(isLight)} rows={4} value={campForm.body} maxLength={50000} onChange={(e) => setCampForm({ ...campForm, body: e.target.value })} placeholder={t("worldScheduleRelease.emailCampaignBodyPlaceholder")} />
          <button type="button" data-testid="world-email-campaign-create" className={chipBtn(isLight)} disabled={campBusy || !activeListId} onClick={() => void createCampaign()}>
            <Mail className="h-3.5 w-3.5" /> {t("worldScheduleRelease.emailSaveCampaign")}
          </button>
          {campNote ? <p className={`text-xs ${muted}`}>{campNote}</p> : null}
          {campaigns.length > 0 ? (
            <div className="space-y-1.5">
              {campaigns.slice(0, 20).map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm ${strong}`}>{c.subject}</span>
                  <span className={`text-[11px] ${muted}`}>{t("worldScheduleRelease.emailCampaignMeta", { status: c.status, delivered: c.deliveredCount, total: c.recipientCount, opens: c.openCount, clicks: c.clickCount })}</span>
                  {campaignSendable(c) ? (
                    <button type="button" className={chipBtn(isLight)} disabled={campBusy} onClick={() => void sendCampaign(c)}>
                      <Send className="h-3.5 w-3.5" /> {t("worldScheduleRelease.emailSend")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title={t("email-list.automations")}>
        {autoState === "loading" && activeListId ? <NativeLoadingState isLight={isLight} message={t("worldScheduleRelease.emailAutosLoading")} /> : null}
        {!activeListId ? <NativeEmptyState isLight={isLight} message={t("worldScheduleRelease.emailAutosEmpty")} /> : null}
        {autoState === "failed" ? <NativeErrorState isLight={isLight} message={t("worldScheduleRelease.emailAutosLoadFailed")} onRetry={() => setPanelsTick((n) => n + 1)} /> : null}
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
                    {a.enabled ? t("worldScheduleRelease.emailAutoOn") : t("worldScheduleRelease.emailAutoOff")}
                  </button>
                  <span className={`text-[11px] ${muted}`}>{t("worldScheduleRelease.emailAutoMeta", { sent: a.sent, delivered: a.delivered, opens: a.opens, clicks: a.clicks })}</span>
                </div>
                <p className={`text-xs ${muted}`}>{a.triggerNote}</p>
                <input aria-label={t("worldScheduleRelease.emailAutoSubjectAria", { label: a.label })} className={deskInputCls(isLight)} value={edit.subject} maxLength={200} onChange={(e) => setAutoEdits({ ...autoEdits, [a.kind]: { ...edit, subject: e.target.value } })} placeholder={t("worldScheduleRelease.emailAutoSubjectPlaceholder")} />
                <textarea aria-label={t("worldScheduleRelease.emailAutoBodyAria", { label: a.label })} className={deskInputCls(isLight)} rows={2} value={edit.body} maxLength={50000} onChange={(e) => setAutoEdits({ ...autoEdits, [a.kind]: { ...edit, body: e.target.value } })} placeholder={t("worldScheduleRelease.emailAutoBodyPlaceholder")} />
                <div className="flex flex-wrap items-center gap-2">
                  <label className={`text-[11px] ${muted}`}>{t("worldScheduleRelease.emailAutoDelayLabel")}
                    <input aria-label={t("worldScheduleRelease.emailAutoDelayAria", { label: a.label })} type="number" min={0} max={720} className={`${deskInputCls(isLight)} ml-2 w-24`} value={edit.delayHours} onChange={(e) => setAutoEdits({ ...autoEdits, [a.kind]: { ...edit, delayHours: e.target.value } })} />
                  </label>
                  <button type="button" className={chipBtn(isLight)} onClick={() => void patchAutomation(a, buildAutomationCopyPatch({ subject: edit.subject, body: edit.body, delayHours: Number(edit.delayHours) }))}>
                    {t("worldScheduleRelease.emailAutoSaveCopy")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldScheduleRelease.emailFanTitle")}>
        {fanSummary ? (
          <p className={`text-xs ${muted}`} data-testid="world-fan-graph-summary">
            {t("worldScheduleRelease.emailFanSummary", { fans: fanSummary.totalFans, followers: fanSummary.followers, subscribers: fanSummary.subscribers, members: fanSummary.members, buyers: fanSummary.buyers })}
            {fanSummary.totalSpentUsdCents > 0 || fanSummary.totalSpentVb > 0
              ? t("worldScheduleRelease.emailFanSpentPart", { amount: `$${(fanSummary.totalSpentUsdCents / 100).toFixed(2)}${fanSummary.totalSpentVb > 0 ? ` · ${fanSummary.totalSpentVb.toLocaleString(i18n.language)} VB` : ""}` })
              : ""}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <input aria-label={t("worldScheduleRelease.emailFanSearchAria")} className={`${deskInputCls(isLight)} max-w-64`} value={fanSearch} maxLength={120} onChange={(e) => setFanSearch(e.target.value)} placeholder={t("worldScheduleRelease.emailFanSearchPlaceholder")} />
          <button type="button" className={chipBtn(isLight)} onClick={() => { setFanPage(1); setFanTick((n) => n + 1); }}>{t("worldScheduleRelease.emailFanSearchButton")}</button>
          <select aria-label={t("worldScheduleRelease.emailFanSortAria")} className={selectCls(isLight)} value={fanSort} onChange={(e) => { setFanSort(e.target.value); setFanPage(1); }}>
            {FAN_GRAPH_SORTS.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </div>
        {fanState === "loading" ? <NativeLoadingState isLight={isLight} message={t("worldScheduleRelease.emailFanLoading")} /> : null}
        {fanState === "failed" ? <NativeErrorState isLight={isLight} message={t("worldScheduleRelease.emailFanLoadFailed")} onRetry={() => setFanTick((n) => n + 1)} /> : null}
        {fanState === "ready" && fans.length === 0 ? (
          <NativeEmptyState isLight={isLight} message={t("worldScheduleRelease.emailFanEmpty")} />
        ) : null}
        {fanState === "ready" && fans.length > 0 ? (
          <div className="mt-2 space-y-1.5" data-testid="world-fan-graph-fans">
            {fans.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-2">
                <Network className="h-3.5 w-3.5 text-[#d4af37]" />
                <span className={`text-sm ${strong}`}>{f.displayName ?? f.email ?? f.id}</span>
                {f.displayName && f.email ? <span className={`text-[11px] ${muted}`}>{f.email}</span> : null}
                {fanBadges(f, {
                  follows: t("worldScheduleRelease.emailBadgeFollows"),
                  subscribed: t("email-list.fan_graph_subscribed_badge"),
                  unsubscribed: t("email-list.fan_graph_unsubscribed_badge"),
                  member: t("email-list.fan_graph_member_badge"),
                  memberTier: t("worldScheduleRelease.emailBadgeMemberTier"),
                  purchaseOne: t("worldScheduleRelease.emailBadgePurchaseOne"),
                  purchases: t("worldScheduleRelease.emailBadgePurchases"),
                }).map((b) => (
                  <span key={b} className="rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2 py-0.5 text-[11px] font-semibold text-[#e8c86a]">{b}</span>
                ))}
                {fanSpentLabel(f, i18n.language) ? <span className={`text-[11px] ${muted}`}>{t("worldScheduleRelease.emailFanSpentLabel", { amount: fanSpentLabel(f, i18n.language) })}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {fanTotal > 25 ? (
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className={chipBtn(isLight)} disabled={fanPage <= 1} onClick={() => setFanPage((p) => Math.max(1, p - 1))}>{t("email-list.fan_graph_prev")}</button>
            <span className={`text-xs ${muted}`}>{fanPage} / {fanPages}</span>
            <button type="button" className={chipBtn(isLight)} disabled={fanPage >= fanPages} onClick={() => setFanPage((p) => Math.min(fanPages, p + 1))}>{t("email-list.fan_graph_next")}</button>
          </div>
        ) : null}
        <p className={`mt-2 flex items-center gap-1 text-[11px] ${muted}`}><Trash2 className="hidden" />{t("worldScheduleRelease.emailFanReadOnly")}</p>
      </NativeCard>
    </div>
  );
}

export default EmailListDesk;
