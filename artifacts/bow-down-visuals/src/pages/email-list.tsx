import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useEffect, useCallback, useRef } from "react";
import {
 Mail, Users, TrendingUp, PenLine, Loader2, Copy, Check, Plus,
 Download, Trash2, Code2, ExternalLink, AlertTriangle, Sparkles,
 Inbox, Send, FileText, RotateCcw, Zap, Network,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import FanGraphTab from "@/components/FanGraphTab";
import { useTranslation } from "react-i18next";

/* ─── Thy Cheat Code's Email List Builder ────────────────────────────────
 Own your audience: hosted landing pages (/join/:handle), embeddable
 signup forms, AI newsletter drafts (1 credit each), subscriber
 dashboard, welcome-email automation, CSV export.

 Pricing rule: lists, subscribers, dashboard, and export are pure
 interface/data — free. Only the AI newsletter writer burns compute
 (1 credit per draft, charged before generation, refunded on failure).

 Sending: campaigns and welcome emails are delivered through our
 email service from our own verified domain (server-side sender,
 status stamped by the server — never by the client), with
 best-effort delivery — disclosed below, never promised. Opens and
 link clicks are tracked on tracked sends (recorded engagement
 only — a list with no tracked sends yet says exactly that),
 subscribers carry tags, saved segments aim campaigns, and
 unsubscribed fans are never emailed again. */

type TabKey = "dashboard" | "lists" | "fans" | "newsletter" | "forms";

interface EmailList {
 id: string;
 name: string;
 handle: string;
 description?: string | null;
 welcomeSubject?: string | null;
 welcomeBody?: string | null;
 welcome2Subject?: string | null;
 welcome2Body?: string | null;
 welcome3Subject?: string | null;
 welcome3Body?: string | null;
 createdAt: string;
}

interface Subscriber {
 id: string;
 email: string;
 name?: string | null;
 source: string;
 opens: number;
 clicks: number;
 /* Manual labels the creator applied + tags derived from house data
    (presave / member / buyer / opened / clicked / engaged). */
 tags: string[];
 autoTags: string[];
 unsubscribedAt?: string | null;
 subscribedAt: string;
}

interface ListStats {
 total: number;
 active: number;
 unsubscribed: number;
 /* null = no tracked sends yet for this list — the card must say so
    instead of rendering a measured-looking 0. Once campaigns send,
    the rate is computed from recorded opens only. */
 openRate: number | null;
 opensTracked: boolean;
 totalOpens: number;
 totalClicks: number;
 freeLimit: number;
}

interface EmailTagRow {
 id: string;
 name: string;
 subscriberCount: number;
}

interface SegmentCriteria {
 tags: string[];
 autoTags: string[];
 sources: string[];
 engagement: string;
}

interface SegmentRow {
 id: string;
 name: string;
 criteria: SegmentCriteria;
 size: number;
}

interface CampaignRow {
 id: string;
 subject: string;
 status: string;
 segmentId?: string | null;
 sentAt?: string | null;
 recipientCount: number;
 deliveredCount: number;
 openCount: number;
 clickCount: number;
 createdAt: string;
}

/* Automations (migration 0198): one row per kind, counts measured
   from real sends only. triggerNote is the server's plain-language
   statement of what fires it — including its blind spots. */
interface AutomationRow {
 id: string;
 kind: "post_purchase" | "abandoned_checkout" | "membership_winback" | "membership_payment_recovery";
 label: string;
 triggerNote: string;
 enabled: boolean;
 subject: string;
 body: string;
 delayHours: number;
 enabledAt: string | null;
 lastRunAt: string | null;
 sent: number;
 failed: number;
 noProvider: number;
 skippedUnsubscribed: number;
 delivered: number;
 opens: number;
 clicks: number;
}

const AUTO_TAG_KEYS = ["presave", "member", "buyer", "opened", "clicked", "engaged"] as const;
const SOURCE_KEYS = ["landing", "embed", "import", "presave"] as const;

const TONES = [
 { key: "hype", label: "Hype", blurb: "Big-news energy" },
 { key: "behind-the-scenes", label: "Behind the Scenes", blurb: "Studio-diary voice" },
 { key: "personal", label: "Personal", blurb: "Letter to a friend" },
 { key: "announcement", label: "Announcement", blurb: "Facts up front" },
] as const;

const inputClass =
 "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const cardClass =
 "rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur";

const tabBtn = (active: boolean) =>
 `flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
 active
 ? "bg-gradient-to-r from-primary to-amber-500 text-black"
 : "border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/20"
 }`;

export default function EmailListBuilder() {
  usePageTitle("Email List", "Own your audience: hosted signup pages, embeddable forms, AI newsletter drafts, and subscriber tools.");
  const isLight = useIsLightTheme();
 const { t, i18n } = useTranslation();
 const { user, getAccessToken, refreshProfile } = useAuth();
 const [tab, setTab] = useState<TabKey>("dashboard");

 const [lists, setLists] = useState<EmailList[]>([]);
 const [activeListId, setActiveListId] = useState<string>("");
 const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
 const [stats, setStats] = useState<ListStats | null>(null);
 const [loading, setLoading] = useState(true);
 /* Lists-load failures are NOT "no lists yet" — the lists load gates
  every tab (dashboard, my lists, forms), so its failure gets its own
  error state with a retry instead of rendering the genuine empty
  states. listsLoadedRef guards the gate: once lists have loaded
  successfully, a later failed reload must NOT blank them. */
 const [loadError, setLoadError] = useState(false);
 const [retryNonce, setRetryNonce] = useState(0);
 const listsLoadedRef = useRef(false);
 /* Subscriber-load failures are NOT "no subscribers yet" — a failed
  subscribers load leaves stats null, so the dashboard would render
  fake zeros (0 active, 0 signups, 0 opens) and the nobody-here
  empty state as if they were real. The subscribers section gets its
  own error state with a retry, scoped to the dashboard.
  subsLoadedForRef guards it the way listsLoadedRef guards the lists
  gate: once a list's subscribers have loaded, a later failed reload
  must NOT blank the data already on screen. */
 const [subsLoadError, setSubsLoadError] = useState(false);
 const [subsRetryNonce, setSubsRetryNonce] = useState(0);
 const subsLoadedForRef = useRef<string | null>(null);

 /* list creation */
 const [showNewList, setShowNewList] = useState(false);
 const [newName, setNewName] = useState("");
 const [newHandle, setNewHandle] = useState("");
 const [newDesc, setNewDesc] = useState("");
 const [creating, setCreating] = useState(false);

 /* list delete — inline two-step confirm. The old flow called the
  native confirm() dialog OUTSIDE its try/catch: in browser contexts
  that suppress native dialogs (automation, embedded webviews) the
  click died silently — no dialog, no error, no delete. The confirm
  now lives in the card itself and every failure surfaces. */
 const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
 const [deletingId, setDeletingId] = useState<string | null>(null);

 /* list-details settings (name + description) for the selected list.
  Until now an existing list's name/description could not be edited
  anywhere — fixing a typo meant delete + recreate, which torched the
  list's subscribers. The PATCH endpoint already accepted both fields;
  this is the missing affordance. */
 const [editName, setEditName] = useState("");
 const [editDesc, setEditDesc] = useState("");
 const [savingDetails, setSavingDetails] = useState(false);
 const [detailsSaved, setDetailsSaved] = useState(false);

 useEffect(() => {
   const l = lists.find((x) => x.id === activeListId);
   setEditName(l?.name ?? "");
   setEditDesc(l?.description ?? "");
   setDetailsSaved(false);
 }, [activeListId, lists]);

 /* welcome-sequence settings (steps 1–3) for the selected list */
 const [w1Subject, setW1Subject] = useState("");
 const [w1Body, setW1Body] = useState("");
 const [w2Subject, setW2Subject] = useState("");
 const [w2Body, setW2Body] = useState("");
 const [w3Subject, setW3Subject] = useState("");
 const [w3Body, setW3Body] = useState("");
 const [savingWelcome, setSavingWelcome] = useState(false);
 const [welcomeSaved, setWelcomeSaved] = useState(false);

 /* Seed the welcome form whenever the selected list changes (or its
  stored templates change after a save). */
 useEffect(() => {
   const l = lists.find((x) => x.id === activeListId);
   setW1Subject(l?.welcomeSubject ?? "");
   setW1Body(l?.welcomeBody ?? "");
   setW2Subject(l?.welcome2Subject ?? "");
   setW2Body(l?.welcome2Body ?? "");
   setW3Subject(l?.welcome3Subject ?? "");
   setW3Body(l?.welcome3Body ?? "");
   setWelcomeSaved(false);
 }, [activeListId, lists]);

 /* newsletter writer */
 const [nlTopic, setNlTopic] = useState("");
 const [nlTone, setNlTone] = useState<string>("hype");
 const [nlCta, setNlCta] = useState("");
 const [nlDraft, setNlDraft] = useState<{ subject: string; body: string } | null>(null);
 const [nlLoading, setNlLoading] = useState(false);

 /* tags + segments + campaigns (migration 0189) */
 const [emailTags, setEmailTags] = useState<EmailTagRow[]>([]);
 const [segments, setSegments] = useState<SegmentRow[]>([]);
 const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
 const [newTagName, setNewTagName] = useState("");
 const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
 const [draftTagIds, setDraftTagIds] = useState<string[]>([]);
 const [segName, setSegName] = useState("");
 const [segTags, setSegTags] = useState<string[]>([]);
 const [segAutoTags, setSegAutoTags] = useState<string[]>([]);
 const [segSources, setSegSources] = useState<string[]>([]);
 const [segEngagement, setSegEngagement] = useState<string>("any");
 const [segCreating, setSegCreating] = useState(false);
 /* campaign composer (newsletter tab) */
 const [campSubject, setCampSubject] = useState("");
 const [campBody, setCampBody] = useState("");
 const [campAudience, setCampAudience] = useState<string>("");
 const [campSending, setCampSending] = useState(false);
 const [campResult, setCampResult] = useState<string | null>(null);
 /* automations (migration 0198) — drafts keyed by automation row id
    so switching lists never leaks one list's edits into another's */
 const [automations, setAutomations] = useState<AutomationRow[]>([]);
/* Stack-28 #31 / A3-F10: each engagement panel loads and fails on its
   own — a failed panel shows an error note instead of a silent empty
   state, and never discards a healthy sibling panel's data. */
const [panelFailed, setPanelFailed] = useState<{ tags: boolean; segments: boolean; campaigns: boolean; automations: boolean }>({ tags: false, segments: false, campaigns: false, automations: false });
const [engagementNonce, setEngagementNonce] = useState(0);
 const [autoDrafts, setAutoDrafts] = useState<Record<string, { subject: string; body: string; delayHours: number }>>({});
 const [autoSaving, setAutoSaving] = useState<string | null>(null);
 const [autoSavedKind, setAutoSavedKind] = useState<string | null>(null);

 /* Drafts are paid — never let a refresh eat one. Persist per list. */
 const DRAFT_KEY = "bdv_email_nl_draft";
 useEffect(() => {
   try {
     const raw = localStorage.getItem(DRAFT_KEY);
     if (raw) {
       const d = JSON.parse(raw) as { subject: string; body: string; at?: number };
       if (d.subject && d.body) setNlDraft({ subject: d.subject, body: d.body });
     }
   } catch { /* ignore */ }
 }, []);

 /* shared */
 const [error, setError] = useState<string | null>(null);
 const [outOfCredits, setOutOfCredits] = useState(false);
 const [copied, setCopied] = useState<string | null>(null);

 async function authedFetch(path: string, opts: RequestInit = {}) {
 const token = await getAccessToken();
 return fetch(path, {
 ...opts,
 headers: {
 "Content-Type": "application/json",
 ...(token ? { Authorization: `Bearer ${token}` } : {}),
 ...(opts.headers ?? {}),
 },
 });
 }

 const loadLists = useCallback(async () => {
 setLoading(true);
 setError(null);
 setLoadError(false);
 try {
 const res = await authedFetch("/api/email-list/lists");
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't load your lists.");
 setLists(data.lists ?? []);
 listsLoadedRef.current = true;
 if (data.lists?.length && !activeListId) setActiveListId(data.lists[0].id);
 } catch {
 /* List-load failure gets the scoped error state, not the shared
  mutation error banner — and never the fake-empty states. */
 if (!listsLoadedRef.current) setLoadError(true);
 } finally {
 setLoading(false);
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 const loadSubscribers = useCallback(async (listId: string) => {
 if (!listId) return;
 setSubsLoadError(false);
 try {
 const res = await authedFetch(`/api/email-list/lists/${listId}/subscribers`);
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't load subscribers.");
 setSubscribers(data.subscribers ?? []);
 setStats(data.stats ?? null);
 subsLoadedForRef.current = listId;
 } catch {
 /* Scoped error state for the subscribers section — NOT the shared
  mutation banner, and never the fake-zero stats: the dashboard shows
  the error + retry unless this list's subscribers already loaded. */
 if (subsLoadedForRef.current !== listId) setSubsLoadError(true);
 }
 }, []);

 useEffect(() => {
 if (user) loadLists();
 }, [user, loadLists, retryNonce]);

 useEffect(() => {
 if (activeListId) loadSubscribers(activeListId);
 }, [activeListId, loadSubscribers, subsRetryNonce]);

 /* Tags, segments, and campaign history ride along with the active
    list. A failure here leaves the panels empty — it never blocks
    the subscriber dashboard above them. */
 const loadEngagement = useCallback(async (listId: string) => {
 if (!listId) return;
 /* Four independent loaders (Stack-28 #31): each panel fetches,
    settles and flags its own failure. The old single Promise.all of
    raw fetches discarded ALL FOUR panels' data when any one fetch
    rejected at transport level, and every panel then rendered its
    silent empty state. */
 const loadTags = async () => {
 try {
 const res = await authedFetch(`/api/email-list/lists/${listId}/tags`);
 if (!res.ok) throw new Error("tags failed");
 setEmailTags((await res.json()).tags ?? []);
 setPanelFailed((f) => ({ ...f, tags: false }));
 } catch { setPanelFailed((f) => ({ ...f, tags: true })); }
 };
 const loadSegments = async () => {
 try {
 const res = await authedFetch(`/api/email-list/lists/${listId}/segments`);
 if (!res.ok) throw new Error("segments failed");
 setSegments((await res.json()).segments ?? []);
 setPanelFailed((f) => ({ ...f, segments: false }));
 } catch { setPanelFailed((f) => ({ ...f, segments: true })); }
 };
 const loadCampaigns = async () => {
 try {
 const res = await authedFetch(`/api/email-list/lists/${listId}/campaigns`);
 if (!res.ok) throw new Error("campaigns failed");
 setCampaigns((await res.json()).campaigns ?? []);
 setPanelFailed((f) => ({ ...f, campaigns: false }));
 } catch { setPanelFailed((f) => ({ ...f, campaigns: true })); }
 };
 const loadAutomations = async () => {
 try {
 const res = await authedFetch(`/api/email-list/lists/${listId}/automations?locale=${encodeURIComponent(i18n.language)}`);
 if (!res.ok) throw new Error("automations failed");
 const rows = ((await res.json()).automations ?? []) as AutomationRow[];
 setAutomations(rows);
 setAutoDrafts((prev) => {
 const next = { ...prev };
 for (const a of rows) {
 if (!next[a.id]) next[a.id] = { subject: a.subject, body: a.body, delayHours: a.delayHours };
 }
 return next;
 });
 setPanelFailed((f) => ({ ...f, automations: false }));
 } catch { setPanelFailed((f) => ({ ...f, automations: true })); }
 };
 await Promise.allSettled([loadTags(), loadSegments(), loadCampaigns(), loadAutomations()]);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 useEffect(() => {
 if (activeListId) loadEngagement(activeListId);
 }, [activeListId, loadEngagement, i18n.language, engagementNonce]);

 /* Automations: one PATCH door for the switch and the copy. The
    server stamps enabled_at on switch-on, so nothing that happened
    before can ever fire — the UI never promises otherwise. */
 async function patchAutomation(a: AutomationRow, patch: Record<string, unknown>) {
 if (!activeListId) return;
 setAutoSaving(a.kind);
 setAutoSavedKind(null);
 try {
 const res = await authedFetch(`/api/email-list/lists/${activeListId}/automations/${a.kind}`, {
 method: "PATCH",
 body: JSON.stringify({ ...patch, locale: i18n.language }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't save that automation.");
 const fresh = data.automation as AutomationRow;
 setAutomations((rows) => rows.map((r) => (r.kind === fresh.kind ? fresh : r)));
 setAutoDrafts((d) => ({
 ...d,
 [fresh.id]: { subject: fresh.subject, body: fresh.body, delayHours: fresh.delayHours },
 }));
 setAutoSavedKind(fresh.kind);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't save that automation.");
 } finally {
 setAutoSaving(null);
 }
 }

 async function createTag() {
 if (!activeListId || !newTagName.trim()) return;
 try {
 const res = await authedFetch(`/api/email-list/lists/${activeListId}/tags`, {
 method: "POST",
 body: JSON.stringify({ name: newTagName.trim() }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't create the tag.");
 setNewTagName("");
 loadEngagement(activeListId);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't create the tag.");
 }
 }

 async function deleteTag(tagId: string) {
 if (!activeListId) return;
 try {
 const res = await authedFetch(`/api/email-list/lists/${activeListId}/tags/${tagId}`, { method: "DELETE" });
 if (!res.ok) throw new Error("Couldn't delete the tag.");
 loadEngagement(activeListId);
 loadSubscribers(activeListId);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't delete the tag.");
 }
 }

 async function saveSubscriberTags(subId: string) {
 if (!activeListId) return;
 try {
 const res = await authedFetch(`/api/email-list/lists/${activeListId}/subscribers/${subId}/tags`, {
 method: "PUT",
 body: JSON.stringify({ tagIds: draftTagIds }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't save tags.");
 setEditingTagsFor(null);
 loadSubscribers(activeListId);
 loadEngagement(activeListId);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't save tags.");
 }
 }

 async function createSegment() {
 if (!activeListId || !segName.trim()) return;
 setSegCreating(true);
 setError(null);
 try {
 const res = await authedFetch(`/api/email-list/lists/${activeListId}/segments`, {
 method: "POST",
 body: JSON.stringify({
 name: segName.trim(),
 criteria: { tags: segTags, autoTags: segAutoTags, sources: segSources, engagement: segEngagement },
 }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't create the segment.");
 setSegName(""); setSegTags([]); setSegAutoTags([]); setSegSources([]); setSegEngagement("any");
 loadEngagement(activeListId);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't create the segment.");
 } finally {
 setSegCreating(false);
 }
 }

 async function deleteSegment(segId: string) {
 if (!activeListId) return;
 try {
 const res = await authedFetch(`/api/email-list/lists/${activeListId}/segments/${segId}`, { method: "DELETE" });
 if (!res.ok) throw new Error("Couldn't delete the segment.");
 loadEngagement(activeListId);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't delete the segment.");
 }
 }

 async function sendCampaignNow() {
 if (!activeListId || !campSubject.trim() || !campBody.trim()) return;
 setCampSending(true);
 setCampResult(null);
 setError(null);
 try {
 const res = await authedFetch(`/api/email-list/lists/${activeListId}/campaigns`, {
 method: "POST",
 body: JSON.stringify({
 subject: campSubject.trim(),
 body: campBody.trim(),
 status: "queued",
 ...(campAudience ? { segmentId: campAudience } : {}),
 }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't send the campaign.");
 const c = data.campaign;
 if (c?.status === "sent") {
 setCampResult(`${t("email-list.campaign_sent_msg")}: ${c.deliveredCount}/${c.recipientCount} ${t("email-list.delivered_word")}`);
 } else {
 setCampResult(`${t("email-list.campaign_failed_msg")}${data.dispatch?.reason ? ` (${data.dispatch.reason})` : ""}`);
 }
 loadEngagement(activeListId);
 loadSubscribers(activeListId);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't send the campaign.");
 } finally {
 setCampSending(false);
 }
 }

 const activeList = lists.find((l) => l.id === activeListId);

 async function createList() {
 if (!newName.trim() || !newHandle.trim()) {
 setError(t("email-list.give_your_list_a_name_and_a_hand"));
 return;
 }
 setCreating(true);
 setError(null);
 try {
 const res = await authedFetch("/api/email-list/lists", {
 method: "POST",
 body: JSON.stringify({
 name: newName.trim(),
 handle: newHandle.trim().toLowerCase(),
 description: newDesc.trim() || undefined,
 }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't create the list.");
 setLists((prev) => [data.list, ...prev]);
 setActiveListId(data.list.id);
 setNewName(""); setNewHandle(""); setNewDesc("");
 setShowNewList(false);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't create the list.");
 } finally {
 setCreating(false);
 }
 }

 async function deleteList(id: string) {
 setDeletingId(id);
 setError(null);
 try {
 const res = await authedFetch(`/api/email-list/lists/${id}`, { method: "DELETE" });
 const data = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(data.error ?? "Couldn't delete the list.");
 setLists((prev) => prev.filter((l) => l.id !== id));
 if (activeListId === id) setActiveListId("");
 setConfirmDeleteId(null);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't delete the list.");
 } finally {
 setDeletingId(null);
 }
 }

 async function saveListDetails() {
 if (!activeListId) return;
 if (!editName.trim()) {
 setError("Give your list a name first.");
 return;
 }
 setSavingDetails(true);
 setError(null);
 setDetailsSaved(false);
 try {
 const res = await authedFetch(`/api/email-list/lists/${activeListId}`, {
 method: "PATCH",
 body: JSON.stringify({
 name: editName.trim(),
 description: editDesc.trim(),
 }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't save the list details.");
 setLists((prev) => prev.map((l) => (l.id === activeListId ? { ...l, ...data.list } : l)));
 setDetailsSaved(true);
 setTimeout(() => setDetailsSaved(false), 3000);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't save the list details.");
 } finally {
 setSavingDetails(false);
 }
 }

 async function saveWelcome() {
 if (!activeListId) return;
 setSavingWelcome(true);
 setError(null);
 setWelcomeSaved(false);
 try {
 const res = await authedFetch(`/api/email-list/lists/${activeListId}`, {
 method: "PATCH",
 body: JSON.stringify({
 welcomeSubject: w1Subject,
 welcomeBody: w1Body,
 welcome2Subject: w2Subject,
 welcome2Body: w2Body,
 welcome3Subject: w3Subject,
 welcome3Body: w3Body,
 }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error ?? "Couldn't save the welcome emails.");
 setLists((prev) => prev.map((l) => (l.id === activeListId ? { ...l, ...data.list } : l)));
 setWelcomeSaved(true);
 setTimeout(() => setWelcomeSaved(false), 3000);
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't save the welcome emails.");
 } finally {
 setSavingWelcome(false);
 }
 }

 async function generateNewsletter() {
 if (!nlTopic.trim()) {
 setError(t("email-list.tell_the_ai_what_the_newsletter"));
 return;
 }
 setNlLoading(true);
 setError(null);
 setOutOfCredits(false);
 try {
 const res = await authedFetch("/api/email-list/newsletter", {
 method: "POST",
 body: JSON.stringify({
 topic: nlTopic.trim(),
 tone: nlTone,
 creatorName: user?.email?.split("@")[0] ?? "",
 listName: activeList?.name ?? "",
 callToAction: nlCta.trim() || undefined,
 }),
 });
 const data = await res.json();
 if (res.status === 402 || data.error === "out_of_credits") {
 setOutOfCredits(true);
 refreshProfile();
 return;
 }
 if (!res.ok) throw new Error(data.error ?? "Couldn't write the newsletter.");
 setNlDraft({ subject: data.subject, body: data.body });
 try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ subject: data.subject, body: data.body, at: Date.now() })); } catch { /* ignore */ }
 refreshProfile();
 } catch (e) {
 setError(e instanceof Error ? e.message : "Couldn't write the newsletter.");
 } finally {
 setNlLoading(false);
 }
 }

 function copyText(key: string, text: string) {
 navigator.clipboard.writeText(text).then(() => {
 setCopied(key);
 setTimeout(() => setCopied(null), 2000);
 });
 }

 const embedSnippet = activeList
 ? `<!-- ${activeList.name} — email signup (Bow Down Visuals) -->\n<form action="https://bowdownvisuals.com/api/email-list/subscribe" method="POST" style="display:flex;gap:8px;max-width:420px">\n <input type="hidden" name="handle" value="${activeList.handle}" />\n <input type="email" name="email" required placeholder="you@example.com" style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid #3a2f12;background:#0a0a0a;color:#fff" />\n <button type="submit" style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#d4af37,#8a6d1b);color:#000;font-weight:700;cursor:pointer">Join</button>\n</form>`
 : "";

 const loadErrorBox = (
 <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
 <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
 <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your lists.</p>
 <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
 Something went wrong on our end — your lists and subscribers are safe, this page just couldn't load them.
 </p>
 <button
 type="button"
 onClick={() => setRetryNonce((n) => n + 1)}
 className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
 >
 <RotateCcw className="h-4 w-4" /> Try again
 </button>
 </div>
 );

 const subsErrorBox = (
 <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
 <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
 <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your subscribers.</p>
 <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
 Something went wrong on our end — your subscribers are safe, this page just couldn't load them.
 </p>
 <button
 type="button"
 onClick={() => setSubsRetryNonce((n) => n + 1)}
 className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
 >
 <RotateCcw className="h-4 w-4" /> Try again
 </button>
 </div>
 );

 return (
 <div className="min-h-screen bg-black text-white">

 <main className="mx-auto max-w-6xl px-5 md:px-8 py-10">
 {/* hero */}
 <div className="text-center">
 <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
 <Mail className="h-3.5 w-3.5" />{t("email-list.own_your_audience")}</p>
 <h1 className="mt-4 font-display text-4xl md:text-5xl font-black">{t("email-list.email_list")}<span className="bg-gradient-to-r from-primary to-amber-300 bg-clip-text text-transparent">{t("email-list.builder")}</span>
 </h1>
 <p className="mx-auto mt-3 max-w-2xl text-white/55">{t("email-list.algorithms_change_your_list_does")}</p>
 </div>

 {/* tabs */}
 <div className="mt-8 flex flex-wrap justify-center gap-2">
 <button className={tabBtn(tab === "dashboard")} onClick={() => setTab("dashboard")}>
 <TrendingUp className="h-4 w-4" />{t("email-list.dashboard")}</button>
 <button className={tabBtn(tab === "lists")} onClick={() => setTab("lists")}>
 <Users className="h-4 w-4" />{t("email-list.my_lists")}</button>
 <button className={tabBtn(tab === "fans")} onClick={() => setTab("fans")}>
 <Network className="h-4 w-4" />{t("email-list.fan_graph")}</button>
 <button className={tabBtn(tab === "newsletter")} onClick={() => setTab("newsletter")}>
 <PenLine className="h-4 w-4" />{t("email-list.ai_newsletter_100_visual_bucs")}</button>
 <button className={tabBtn(tab === "forms")} onClick={() => setTab("forms")}>
 <Code2 className="h-4 w-4" />{t("email-list.signup_forms")}</button>
 </div>

 {error && (
 <div className="mx-auto mt-6 flex max-w-2xl items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
 <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
 <span>{error}</span>
 </div>
 )}

 {outOfCredits && (
 <div className="mx-auto mt-6 max-w-2xl">
 <OutOfCredits />
 </div>
 )}

 {/* ── dashboard ── */}
 {tab === "dashboard" && (
 <div className="mt-8">
 {loading ? (
 <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
 ) : loadError ? (
 loadErrorBox
 ) : !activeList ? (
 <div className={`${cardClass} text-center`}>
 <Inbox className="mx-auto h-10 w-10 text-white/25" />
 <p className="mt-3 font-semibold">{t("email-list.no_lists_yet")}</p>
 <p className="mt-1 text-sm text-white/50">{t("email-list.create_your_first_list_to_start")}</p>
 <button className={tabBtn(true) + " mt-4"} onClick={() => setTab("lists")}>
 <Plus className="h-4 w-4" />{t("email-list.create_a_list")}</button>
 </div>
 ) : (
 <>
 <div className="mb-4 flex flex-wrap items-center gap-3">
 <label className="text-sm text-white/50">{t("email-list.list")}</label>
 <select
 value={activeListId}
 onChange={(e) => setActiveListId(e.target.value)}
 className="rounded-xl border border-white/10 bg-black/60 px-4 py-2 text-sm text-white outline-none focus:border-primary/60"
 >
 {lists.map((l) => (
 <option key={l.id} value={l.id}>{l.name} (@{l.handle})</option>
 ))}
 </select>
 </div>

 {subsLoadError ? (
 subsErrorBox
 ) : (
 <>
 <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
 <div className={cardClass}>
 <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40"><Users className="h-3.5 w-3.5" />{t("email-list.active_subscribers")}</p>
 <p className="mt-2 font-display text-3xl font-black text-primary">{stats?.active ?? 0}</p>
 <p className="mt-1 text-xs text-white/40">of {stats?.freeLimit ?? 1000} free</p>
 </div>
 <div className={cardClass}>
 <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40"><TrendingUp className="h-3.5 w-3.5" />{t("email-list.total_signups")}</p>
 <p className="mt-2 font-display text-3xl font-black">{stats?.total ?? 0}</p>
 <p className="mt-1 text-xs text-white/40">{stats?.unsubscribed ?? 0} unsubscribed</p>
 </div>
 <div className={cardClass}>
 <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40"><Mail className="h-3.5 w-3.5" />{t("email-list.avg_opens_subscriber")}</p>
 {stats && !stats.opensTracked ? (
 <>
 <p className="mt-2 font-display text-3xl font-black">{t("email-list.opens_not_tracked")}</p>
 <p className="mt-1 text-xs text-white/40">{t("email-list.opens_not_tracked_note")}</p>
 </>
 ) : (
 <>
 <p className="mt-2 font-display text-3xl font-black">{stats ? Math.round((stats.openRate ?? 0) * 10) / 10 : 0}%</p>
 <p className="mt-1 text-xs text-white/40">{stats?.totalOpens ?? 0} {t("email-list.opens_total")} · {stats?.totalClicks ?? 0} {t("email-list.clicks_total")}</p>
 <p className="mt-1 text-xs text-white/40">{t("email-list.best_effort_pixel_tracking")}</p>
 </>
 )}
 </div>
 <div className={cardClass}>
 <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40"><Download className="h-3.5 w-3.5" />{t("email-list.export")}</p>
 <a
 href={`/api/email-list/lists/${activeListId}/export`}
 className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
 >
 <Download className="h-4 w-4" />{t("email-list.csv_free")}</a>
 <p className="mt-1 text-xs text-white/40">{t("email-list.your_data_yours_to_keep")}</p>
 </div>
 </div>

 <div className={`${cardClass} mt-4`}>
 <h3 className="font-semibold">{t("email-list.recent_subscribers")}</h3>
 {subscribers.length === 0 ? (
 <p className="mt-2 text-sm text-white/45">{t("email-list.nobody_here_yet_share_your_landi")}</p>
 ) : (
 <div className="mt-3 divide-y divide-white/5">
 {subscribers.slice(0, 10).map((s) => (
 <div key={s.id} className="py-2.5 text-sm">
 <div className="flex items-center justify-between">
 <div>
 <p className="font-medium">{s.name || s.email}</p>
 {s.name && <p className="text-xs text-white/40">{s.email}</p>}
 </div>
 <div className="flex items-center gap-3 text-xs text-white/40">
 <span className="rounded-full border border-white/10 px-2 py-0.5">{s.source}</span>
 {s.unsubscribedAt && <span className="text-red-300/70">{t("email-list.unsubscribed")}</span>}
 <span>{new Date(s.subscribedAt).toLocaleDateString()}</span>
 <button
 type="button"
 className="rounded-full border border-primary/40 px-2 py-0.5 font-semibold text-primary hover:bg-primary/10"
 onClick={() => {
 if (editingTagsFor === s.id) { setEditingTagsFor(null); return; }
 setEditingTagsFor(s.id);
 setDraftTagIds(emailTags.filter((tg) => s.tags.includes(tg.name)).map((tg) => tg.id));
 }}
 >
 {t("email-list.tags")}
 </button>
 </div>
 </div>
 {(s.tags.length > 0 || s.autoTags.length > 0) && (
 <div className="mt-1.5 flex flex-wrap gap-1.5">
 {s.tags.map((tg) => (
 <span key={tg} className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">{tg}</span>
 ))}
 {s.autoTags.map((tg) => (
 <span key={tg} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/55">{t(`email-list.at_${tg}`)}</span>
 ))}
 </div>
 )}
 {editingTagsFor === s.id && (
 <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/40 p-3">
 {emailTags.length === 0 && <span className="text-xs text-white/40">{t("email-list.add_tag")} ↓</span>}
 {emailTags.map((tg) => (
 <label key={tg.id} className="flex items-center gap-1.5 text-xs text-white/70">
 <input
 type="checkbox"
 checked={draftTagIds.includes(tg.id)}
 onChange={(e) => setDraftTagIds((prev) => e.target.checked ? [...prev, tg.id] : prev.filter((x) => x !== tg.id))}
 />
 {tg.name}
 </label>
 ))}
 <button type="button" className={tabBtn(true) + " px-3 py-1.5 text-xs"} onClick={() => saveSubscriberTags(s.id)}>
 {t("email-list.save_tags")}
 </button>
 </div>
 )}
 </div>
 ))}
 </div>
 )}
 </div>

 {/* ── tags + segments ── */}
 <div className={`${cardClass} mt-4`}>
 <h3 className="font-semibold">{t("email-list.tags")} & {t("email-list.segments")}</h3>
 {(panelFailed.tags || panelFailed.segments) && (
 <p className="mt-2 text-sm text-red-300" data-testid="email-tags-segments-error">
 {panelFailed.tags ? "Tags" : "Segments"} couldn&apos;t load — the rest of this page is unaffected.{" "}
 <button type="button" className="font-bold underline" onClick={() => setEngagementNonce((n) => n + 1)}>Try again</button>
 </p>
 )}
 <div className="mt-3 flex flex-wrap items-center gap-2">
 {emailTags.map((tg) => (
 <span key={tg.id} className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
 {tg.name} · {tg.subscriberCount}
 <button type="button" aria-label={`delete ${tg.name}`} className="text-primary/60 hover:text-primary" onClick={() => deleteTag(tg.id)}>×</button>
 </span>
 ))}
 <input
 className="w-44 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-white placeholder:text-white/25 outline-none focus:border-primary/60"
 placeholder={t("email-list.tag_name_placeholder")}
 value={newTagName}
 onChange={(e) => setNewTagName(e.target.value)}
 onKeyDown={(e) => { if (e.key === "Enter") createTag(); }}
 />
 <button type="button" className={tabBtn(true) + " px-3 py-1.5 text-xs"} onClick={createTag}>
 <Plus className="h-3.5 w-3.5" />{t("email-list.add_tag")}
 </button>
 </div>
 <p className="mt-2 text-xs text-white/35">{t("email-list.tag_subscribers_hint")}</p>

 {segments.length > 0 && (
 <div className="mt-4 divide-y divide-white/5">
 {segments.map((seg) => (
 <div key={seg.id} className="flex items-center justify-between py-2 text-sm">
 <div>
 <p className="font-medium">{seg.name}</p>
 <p className="text-xs text-white/40">
 {seg.criteria.tags.join(", ")}
 {seg.criteria.autoTags.length > 0 && ` · ${seg.criteria.autoTags.map((a) => t(`email-list.at_${a}`)).join(", ")}`}
 {seg.criteria.sources.length > 0 && ` · ${seg.criteria.sources.join(", ")}`}
 {seg.criteria.engagement !== "any" && ` · ${t(`email-list.eng_${seg.criteria.engagement}`)}`}
 </p>
 </div>
 <div className="flex items-center gap-3">
 <span className="text-xs font-semibold text-primary">{seg.size} {t("email-list.members_word")}</span>
 <button type="button" aria-label={`delete ${seg.name}`} className="rounded-lg p-1.5 text-white/30 hover:bg-red-500/10 hover:text-red-300" onClick={() => deleteSegment(seg.id)}>
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </div>
 </div>
 ))}
 </div>
 )}

 <div className="mt-4 rounded-xl border border-white/10 bg-black/40 p-3">
 <input
 className={inputClass}
 placeholder={t("email-list.segment_name_placeholder")}
 value={segName}
 onChange={(e) => setSegName(e.target.value)}
 />
 <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.manual_tags_all")}</p>
 <div className="mt-1.5 flex flex-wrap gap-2">
 {emailTags.map((tg) => (
 <label key={tg.id} className="flex items-center gap-1.5 text-xs text-white/70">
 <input
 type="checkbox"
 checked={segTags.includes(tg.name)}
 onChange={(e) => setSegTags((prev) => e.target.checked ? [...prev, tg.name] : prev.filter((x) => x !== tg.name))}
 />
 {tg.name}
 </label>
 ))}
 {emailTags.length === 0 && <span className="text-xs text-white/35">—</span>}
 </div>
 <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.automatic_tags_all")}</p>
 <div className="mt-1.5 flex flex-wrap gap-2">
 {AUTO_TAG_KEYS.map((k) => (
 <label key={k} className="flex items-center gap-1.5 text-xs text-white/70">
 <input
 type="checkbox"
 checked={segAutoTags.includes(k)}
 onChange={(e) => setSegAutoTags((prev) => e.target.checked ? [...prev, k] : prev.filter((x) => x !== k))}
 />
 {t(`email-list.at_${k}`)}
 </label>
 ))}
 </div>
 <div className="mt-3 grid gap-3 sm:grid-cols-2">
 <div>
 <p className="text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.sources_any")}</p>
 <div className="mt-1.5 flex flex-wrap gap-2">
 {SOURCE_KEYS.map((k) => (
 <label key={k} className="flex items-center gap-1.5 text-xs capitalize text-white/70">
 <input
 type="checkbox"
 checked={segSources.includes(k)}
 onChange={(e) => setSegSources((prev) => e.target.checked ? [...prev, k] : prev.filter((x) => x !== k))}
 />
 {k}
 </label>
 ))}
 </div>
 </div>
 <div>
 <p className="text-xs font-semibold uppercase tracking-widest text-white/40">{t("email-list.engagement_label")}</p>
 <select
 value={segEngagement}
 onChange={(e) => setSegEngagement(e.target.value)}
 className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
 >
 {["any", "opened", "clicked", "engaged", "none"].map((k) => (
 <option key={k} value={k}>{t(`email-list.eng_${k}`)}</option>
 ))}
 </select>
 </div>
 </div>
 <button type="button" className={tabBtn(true) + " mt-3"} onClick={createSegment} disabled={segCreating}>
 {segCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
 {t("email-list.create_segment")}
 </button>
 <p className="mt-2 text-xs text-white/35">{t("email-list.segments_suppression_note")}</p>
 </div>
 </div>
 </>
 )}
 </>
 )}
 </div>
 )}

 {/* ── lists ── */}
 {tab === "lists" && (
 <div className="mt-8">
 <div className="flex justify-end">
 <button className={tabBtn(true)} onClick={() => setShowNewList((v) => !v)}>
 <Plus className="h-4 w-4" />{t("email-list.new_list")}</button>
 </div>

 {showNewList && (
 <div className={`${cardClass} mt-4`}>
 <h3 className="font-semibold">{t("email-list.create_a_list")}</h3>
 <div className="mt-3 grid gap-3 md:grid-cols-2">
 <input className={inputClass} placeholder={t("email-list.list_name_e_g_fin_fam")} value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} />
 <div>
 <div className="flex items-center">
 <span className="rounded-l-xl border border-r-0 border-white/10 bg-white/5 px-3 py-3 text-sm text-white/40">{t("email-list.join_2")}</span>
 <input className={inputClass + " rounded-l-none"} placeholder={t("email-list.your_handle")} value={newHandle} onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
 </div>
 <p className="mt-1 text-xs text-white/35">{t("email-list.lowercase_letters_numbers_hyphen")}</p>
 </div>
 </div>
 <textarea className={inputClass + " mt-3"} rows={4} maxLength={2000} placeholder={t("email-list.what_do_subscribers_get_optional")} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
 <p className="mt-1 text-xs text-white/35">This is the offer copy on your join page — up to 2,000 characters, line breaks kept.</p>
 <button className={tabBtn(true) + " mt-3"} onClick={createList} disabled={creating}>
 {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
 Create list — free
 </button>
 </div>
 )}

 {loadError && <div className="mt-4">{loadErrorBox}</div>}

 <div className="mt-4 grid gap-4 md:grid-cols-2">
 {lists.map((l) => (
 <div key={l.id} className={cardClass}>
 <div className="flex items-start justify-between">
 <div>
 <p className="font-semibold">{l.name}</p>
 <a href={`/join/${l.handle}`} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-sm text-primary hover:underline">
 bowdownvisuals.com/join/{l.handle} <ExternalLink className="h-3 w-3" />
 </a>
 {l.description && <p className="mt-2 whitespace-pre-wrap text-sm text-white/50">{l.description}</p>}
 </div>
 {confirmDeleteId !== l.id && (
 <button
 onClick={() => setConfirmDeleteId(l.id)}
 className="rounded-lg p-2 text-white/30 hover:bg-red-500/10 hover:text-red-300"
 title={t("email-list.delete_list")}
 >
 <Trash2 className="h-4 w-4" />
 </button>
 )}
 </div>
 {confirmDeleteId === l.id && (
 <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3">
 <p className="text-sm text-red-200">Delete this list and all its subscribers? This can't be undone.</p>
 <div className="mt-2 flex gap-2">
 <button
 onClick={() => deleteList(l.id)}
 disabled={deletingId === l.id}
 className="inline-flex items-center gap-2 rounded-lg bg-red-500/80 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
 >
 {deletingId === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
 Delete it
 </button>
 <button
 onClick={() => setConfirmDeleteId(null)}
 className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:text-white"
 >
 Cancel
 </button>
 </div>
 </div>
 )}
 </div>
 ))}
 </div>
 {lists.length === 0 && !showNewList && !loadError && (
 <p className="mt-6 text-center text-sm text-white/45">{t("email-list.no_lists_yet_hit_new_list_to_cre")}</p>
 )}

 {/* list-details settings for the selected list — name + the offer
  copy on its join page, editable in place (no more delete +
  recreate to fix wording). The handle is the list's address and
  stays fixed. */}
 {activeList && (
 <div className={`${cardClass} mt-6`}>
 <div className="flex flex-wrap items-center justify-between gap-3">
 <h3 className="flex items-center gap-2 font-semibold"><PenLine className="h-4 w-4 text-primary" />List details — {activeList.name}</h3>
 <select
 value={activeListId}
 onChange={(e) => setActiveListId(e.target.value)}
 className="rounded-xl border border-white/10 bg-black/60 px-4 py-2 text-sm text-white outline-none focus:border-primary/60"
 >
 {lists.map((l) => (
 <option key={l.id} value={l.id}>{l.name} (@{l.handle})</option>
 ))}
 </select>
 </div>
 <p className="mt-1 text-sm text-white/50">
 The name and offer copy for this list. The description is what visitors read on the join page — line breaks are kept.
 </p>
 <p className="mt-2 text-xs text-white/35">Join page: bowdownvisuals.com/join/{activeList.handle} — the handle is the list's address and can't be changed.</p>
 <input className={inputClass + " mt-3"} placeholder="List name" value={editName} maxLength={120} onChange={(e) => setEditName(e.target.value)} />
 <textarea className={inputClass + " mt-3"} rows={4} maxLength={2000} placeholder="What do subscribers get?" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
 <p className="mt-1 text-xs text-white/35">Up to 2,000 characters. Leave empty to show no offer copy on the join page.</p>
 <button className={tabBtn(true) + " mt-4"} onClick={saveListDetails} disabled={savingDetails}>
 {savingDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
 Save list details
 </button>
 {detailsSaved && <span className="ml-3 text-sm font-semibold text-emerald-400">Saved ✓</span>}
 </div>
 )}

 {/* welcome-sequence settings for the selected list */}
 {activeList && (
 <div className={`${cardClass} mt-6`}>
 <div className="flex flex-wrap items-center justify-between gap-3">
 <h3 className="flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-primary" />Welcome emails — {activeList.name}</h3>
 <select
 value={activeListId}
 onChange={(e) => setActiveListId(e.target.value)}
 className="rounded-xl border border-white/10 bg-black/60 px-4 py-2 text-sm text-white outline-none focus:border-primary/60"
 >
 {lists.map((l) => (
 <option key={l.id} value={l.id}>{l.name} (@{l.handle})</option>
 ))}
 </select>
 </div>
 <p className="mt-1 text-sm text-white/50">
 Every new subscriber gets these automatically: Step 1 on signup, Step 2 after 24 hours, Step 3 after 72 hours.
 Leave a step's subject and body empty to skip that step.
 </p>

 {([
 { n: 1, subject: w1Subject, setSubject: setW1Subject, body: w1Body, setBody: setW1Body },
 { n: 2, subject: w2Subject, setSubject: setW2Subject, body: w2Body, setBody: setW2Body },
 { n: 3, subject: w3Subject, setSubject: setW3Subject, body: w3Body, setBody: setW3Body },
 ] as const).map((s) => (
 <div key={s.n} className="mt-4 rounded-xl border border-white/10 bg-black/40 p-4">
 <p className="text-xs font-semibold uppercase tracking-widest text-white/40">Step {s.n}{s.n === 1 ? " — on signup" : s.n === 2 ? " — +24 hours" : " — +72 hours after step 2"}</p>
 <input className={inputClass + " mt-2"} placeholder={`Step ${s.n} subject`} value={s.subject} maxLength={200} onChange={(e) => s.setSubject(e.target.value)} />
 <textarea className={inputClass + " mt-2"} rows={5} placeholder={`Step ${s.n} body — write it like you'd text a friend. Line breaks are kept.`} value={s.body} maxLength={20000} onChange={(e) => s.setBody(e.target.value)} />
 </div>
 ))}

 <button className={tabBtn(true) + " mt-4"} onClick={saveWelcome} disabled={savingWelcome}>
 {savingWelcome ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
 Save welcome emails
 </button>
 {welcomeSaved && <span className="ml-3 text-sm font-semibold text-emerald-400">Saved ✓</span>}
 </div>
 )}
 </div>
 )}

 {/* ── newsletter ── */}
 {tab === "newsletter" && (
 <div className="mt-8 mx-auto max-w-3xl">
 <div className={cardClass}>
 <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" />{t("email-list.ai_newsletter_writer")}</h3>
 <p className="mt-1 text-sm text-white/50">{t("email-list.topic_in_full_newsletter_draft_o")}<span className="text-primary font-semibold">{t("email-list.100_visual_bucs")}</span>{t("email-list.per_draft")}</p>

 <textarea className={inputClass + " mt-4"} rows={3} placeholder={t("email-list.what_s_the_newsletter_about_e_g")} value={nlTopic} onChange={(e) => setNlTopic(e.target.value)} />

 <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
 {TONES.map((t) => (
 <button
 key={t.key}
 onClick={() => setNlTone(t.key)}
 className={`rounded-xl border p-3 text-left transition ${nlTone === t.key ? "border-primary/60 bg-primary/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"}`}
 >
 <p className="text-sm font-semibold">{t.label}</p>
 <p className="text-xs text-white/40">{t.blurb}</p>
 </button>
 ))}
 </div>

 <input className={inputClass + " mt-3"} placeholder={t("email-list.call_to_action_optional_e_g_pre")} value={nlCta} onChange={(e) => setNlCta(e.target.value)} />

 <button className={tabBtn(true) + " mt-4"} onClick={generateNewsletter} disabled={nlLoading}>
 {nlLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
 Write my newsletter · 100 Visual Bucs
 </button>
 </div>

 {nlDraft && (
 <div className={`${cardClass} mt-4`}>
 <div className="flex items-start justify-between gap-3">
 <div>
 <p className="text-xs uppercase tracking-widest text-white/40">{t("email-list.subject")}</p>
 <p className="mt-1 font-semibold text-primary">{nlDraft.subject}</p>
 </div>
 <button onClick={() => copyText("subject", nlDraft.subject)} className="rounded-lg border border-white/10 p-2 text-white/50 hover:text-white" title={t("email-list.copy_subject")}>
 {copied === "subject" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
 </button>
 </div>
 <div className="mt-4 flex items-start justify-between gap-3">
 <p className="text-xs uppercase tracking-widest text-white/40">{t("email-list.body")}</p>
 <button onClick={() => copyText("body", nlDraft.body)} className="rounded-lg border border-white/10 p-2 text-white/50 hover:text-white" title={t("email-list.copy_body")}>
 {copied === "body" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
 </button>
 </div>
 <div className={`mt-2 whitespace-pre-wrap rounded-xl p-4 text-sm leading-relaxed ${isLight ? "bg-[#F7ECD2]/70 text-[#2A1E07]" : "bg-black/50 text-white/80"}`}>
 {nlDraft.body}
 </div>
 <p className="mt-3 text-xs text-white/35">{t("email-list.ai_draft_read_it_make_it_yours_t")}</p>
 </div>
 )}

 {/* ── send a campaign (tracked, segment-aware) ── */}
 {activeList && (
 <>
 <div className={`${cardClass} mt-4`}>
 <h3 className="flex items-center gap-2 font-semibold"><Send className="h-4 w-4 text-primary" />{t("email-list.send_a_campaign")}</h3>
 <div className="mt-3 flex flex-wrap items-center gap-3">
 <label className="text-sm text-white/50">{t("email-list.list")}</label>
 <select
 value={activeListId}
 onChange={(e) => setActiveListId(e.target.value)}
 className="rounded-xl border border-white/10 bg-black/60 px-4 py-2 text-sm text-white outline-none focus:border-primary/60"
 >
 {lists.map((l) => (
 <option key={l.id} value={l.id}>{l.name} (@{l.handle})</option>
 ))}
 </select>
 <label className="text-sm text-white/50">{t("email-list.audience")}</label>
 <select
 value={campAudience}
 onChange={(e) => setCampAudience(e.target.value)}
 className="rounded-xl border border-white/10 bg-black/60 px-4 py-2 text-sm text-white outline-none focus:border-primary/60"
 >
 <option value="">{t("email-list.whole_list")}</option>
 {segments.map((seg) => (
 <option key={seg.id} value={seg.id}>{seg.name} ({seg.size})</option>
 ))}
 </select>
 {nlDraft && (
 <button
 type="button"
 className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20"
 onClick={() => { setCampSubject(nlDraft.subject); setCampBody(nlDraft.body); }}
 >
 {t("email-list.use_ai_draft")}
 </button>
 )}
 </div>
 <input
 className={inputClass + " mt-3"}
 placeholder={t("email-list.subject")}
 value={campSubject}
 onChange={(e) => setCampSubject(e.target.value)}
 />
 <textarea
 className={inputClass + " mt-3"}
 rows={6}
 placeholder={t("email-list.body")}
 value={campBody}
 onChange={(e) => setCampBody(e.target.value)}
 />
 <button className={tabBtn(true) + " mt-3"} onClick={sendCampaignNow} disabled={campSending || !campSubject.trim() || !campBody.trim()}>
 {campSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
 {t("email-list.send_campaign_btn")}
 </button>
 {campResult && <p className="mt-2 text-sm text-primary">{campResult}</p>}
 <p className="mt-2 text-xs text-white/35">{t("email-list.segments_suppression_note")}</p>
 </div>

 <div className={`${cardClass} mt-4`}>
 <h3 className="font-semibold">{t("email-list.campaign_history")}</h3>
 {panelFailed.campaigns ? (
 <p className="mt-2 text-sm text-red-300" data-testid="email-campaigns-error">
 Campaign history couldn&apos;t load.{" "}
 <button type="button" className="font-bold underline" onClick={() => setEngagementNonce((n) => n + 1)}>Try again</button>
 </p>
 ) : campaigns.length === 0 ? (
 <p className="mt-2 text-sm text-white/45">{t("email-list.no_campaigns_yet")}</p>
 ) : (
 <div className="mt-3 divide-y divide-white/5">
 {campaigns.map((c) => (
 <div key={c.id} className="flex items-center justify-between py-2.5 text-sm">
 <div>
 <p className="font-medium">{c.subject}</p>
 <p className="text-xs text-white/40">{new Date(c.sentAt ?? c.createdAt).toLocaleDateString()}</p>
 </div>
 <div className="flex items-center gap-3 text-xs text-white/50">
 <span className={`rounded-full border px-2 py-0.5 font-semibold ${c.status === "sent" ? "border-emerald-400/40 text-emerald-300" : c.status === "failed" ? "border-red-400/40 text-red-300" : "border-white/15 text-white/50"}`}>{c.status}</span>
 <span>{c.deliveredCount} {t("email-list.delivered_word")}</span>
 <span>{c.openCount} {t("email-list.opens_word")}</span>
 <span>{c.clickCount} {t("email-list.clicks_word")}</span>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>

 {/* ── automations (migration 0198): off until switched on ── */}
 <div className={`${cardClass} mt-4`}>
 <h3 className="flex items-center gap-2 font-semibold"><Zap className="h-4 w-4 text-primary" />{t("email-list.automations")}</h3>
 <p className="mt-1 text-sm text-white/50">{t("email-list.automations_intro")}</p>
 {panelFailed.automations ? (
 <p className="mt-2 text-sm text-red-300" data-testid="email-automations-error">
 Automations couldn&apos;t load.{" "}
 <button type="button" className="font-bold underline" onClick={() => setEngagementNonce((n) => n + 1)}>Try again</button>
 </p>
 ) : automations.length === 0 ? (
 <p className="mt-2 text-sm text-white/45">{t("email-list.automations_loading")}</p>
 ) : (
 <div className="mt-3 space-y-4">
 {automations.map((a) => {
 const draft = autoDrafts[a.id] ?? { subject: a.subject, body: a.body, delayHours: a.delayHours };
 const dirty = draft.subject !== a.subject || draft.body !== a.body || draft.delayHours !== a.delayHours;
 return (
 <div key={a.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
 <div className="flex items-center justify-between gap-3">
 <p className="font-semibold">{a.label}</p>
 <button
 type="button"
 onClick={() => patchAutomation(a, { enabled: !a.enabled })}
 disabled={autoSaving === a.kind}
 className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${a.enabled ? "border-emerald-400/40 text-emerald-300" : "border-white/15 text-white/50 hover:text-white"}`}
 >
 {autoSaving === a.kind ? <Loader2 className="h-3 w-3 animate-spin" /> : a.enabled ? t("email-list.automation_on") : t("email-list.automation_off")}
 </button>
 </div>
 <p className="mt-1 text-xs leading-relaxed text-white/40">{a.triggerNote}</p>
 {a.enabled ? (
 <p className="mt-2 text-xs text-white/50">
 {t("email-list.automations_last_checked")}{a.lastRunAt ? new Date(a.lastRunAt).toLocaleString() : t("email-list.automations_never_checked")}
 {" · "}{a.sent} {t("email-list.automations_sent_word")} · {a.opens} {t("email-list.opens_word")} · {a.clicks} {t("email-list.clicks_word")}
 {a.skippedUnsubscribed > 0 && <> · {a.skippedUnsubscribed} {t("email-list.automations_skipped_word")}</>}
 {a.noProvider > 0 && <> · {a.noProvider} {t("email-list.automations_no_provider_word")}</>}
 </p>
 ) : (
 <p className="mt-2 text-xs text-white/40">{t("email-list.automation_off_note")}{a.sent > 0 && <> · {a.sent} {t("email-list.automations_sent_word")}</>}</p>
 )}
 <input
 className={inputClass + " mt-3"}
 placeholder={t("email-list.subject")}
 value={draft.subject}
 onChange={(e) => setAutoDrafts((d) => ({ ...d, [a.id]: { ...draft, subject: e.target.value } }))}
 />
 <textarea
 className={inputClass + " mt-2"}
 rows={5}
 placeholder={t("email-list.body")}
 value={draft.body}
 onChange={(e) => setAutoDrafts((d) => ({ ...d, [a.id]: { ...draft, body: e.target.value } }))}
 />
 <div className="mt-2 flex flex-wrap items-center gap-3">
 <label className="text-xs text-white/50">{t("email-list.automations_delay_label")}</label>
 <input
 type="number"
 min={0}
 max={720}
 className="w-24 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
 value={draft.delayHours}
 onChange={(e) => setAutoDrafts((d) => ({ ...d, [a.id]: { ...draft, delayHours: Math.max(0, Math.min(720, Number(e.target.value) || 0)) } }))}
 />
 <button
 type="button"
 className={tabBtn(true) + " px-3 py-1.5 text-xs"}
 onClick={() => patchAutomation(a, { subject: draft.subject, body: draft.body, delayHours: draft.delayHours })}
 disabled={autoSaving === a.kind || !dirty || !draft.subject.trim() || !draft.body.trim()}
 >
 {autoSaving === a.kind ? <Loader2 className="h-3 w-3 animate-spin" /> : t("email-list.automation_save")}
 </button>
 {autoSavedKind === a.kind && !dirty && <span className="text-xs text-emerald-300">{t("email-list.automation_saved")}</span>}
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>
 </>
 )}
 </div>
 )}

 {/* ── forms ── */}
 {tab === "forms" && (
 <div className="mt-8 mx-auto max-w-3xl">
 {!activeList ? (
 loadError ? loadErrorBox : (
 <div className={`${cardClass} text-center`}>
 <p className="text-sm text-white/50">{t("email-list.create_a_list_first_then_grab_yo")}</p>
 </div>
 )
 ) : (
 <>
 <div className="mb-4 flex items-center gap-3">
 <label className="text-sm text-white/50">{t("email-list.list")}</label>
 <select
 value={activeListId}
 onChange={(e) => setActiveListId(e.target.value)}
 className="rounded-xl border border-white/10 bg-black/60 px-4 py-2 text-sm text-white outline-none focus:border-primary/60"
 >
 {lists.map((l) => (
 <option key={l.id} value={l.id}>{l.name} (@{l.handle})</option>
 ))}
 </select>
 </div>

 <div className={cardClass}>
 <h3 className="flex items-center gap-2 font-semibold"><ExternalLink className="h-4 w-4 text-primary" />{t("email-list.hosted_landing_page")}</h3>
 <p className="mt-1 text-sm text-white/50">{t("email-list.send_fans_here_no_website_needed")}</p>
 <div className="mt-3 flex items-center gap-2">
 <code className={`flex-1 min-w-0 truncate rounded-xl px-4 py-3 text-sm ${isLight ? "bg-[#F7ECD2]/80 text-[#7A5A12]" : "bg-black/60 text-primary"}`}>bowdownvisuals.com/join/{activeList.handle}</code>
 <button onClick={() => copyText("landing", `https://bowdownvisuals.com/join/${activeList.handle}`)} className="rounded-xl border border-white/10 p-3 text-white/60 hover:text-white" title={t("email-list.copy_link")}>
 {copied === "landing" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
 </button>
 <a href={`/join/${activeList.handle}`} target="_blank" rel="noreferrer" className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-primary hover:bg-primary/20" title={t("email-list.open_landing_page")}>
 <Send className="h-4 w-4" />
 </a>
 </div>
 </div>

 <div className={`${cardClass} mt-4`}>
 <h3 className="flex items-center gap-2 font-semibold"><Code2 className="h-4 w-4 text-primary" />{t("email-list.embed_on_your_own_site")}</h3>
 <p className="mt-1 text-sm text-white/50">{t("email-list.paste_this_anywhere_signups_land")}</p>
 <div className="relative mt-3">
 <pre className={`overflow-x-auto rounded-xl p-4 text-xs leading-relaxed ${isLight ? "bg-[#F7ECD2]/80 text-[#2A1E07]" : "bg-black/60 text-white/70"}`}>{embedSnippet}</pre>
 <button onClick={() => copyText("embed", embedSnippet)} className={`absolute right-3 top-3 rounded-lg border p-2 ${isLight ? "border-[#C9A84C]/40 bg-white text-[#6B5B36] hover:text-[#2A1E07]" : "border-white/10 bg-black/60 text-white/60 hover:text-white"}`} title={t("email-list.copy_embed_code")}>
 {copied === "embed" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
 </button>
 </div>
 </div>
 </>
 )}
 </div>
 )}

 {/* ── fan graph (One Fan Graph: followers + subscribers + members + buyers, one record per fan) ── */}
 {tab === "fans" && <FanGraphTab />}

 {/* honesty footer */}
 <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-xs leading-relaxed text-white/40">
 <p className="flex items-start gap-2">
 <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
 <span>
 <span className="font-semibold text-white/60">{t("email-list.how_sending_works_v1")}</span>{t("email-list.campaigns_queue_through_our_simp")}</span>
 </p>
 </div>

 <p className="relative mt-8 text-center text-sm text-white/40">{t("email-list.list_built_ask")}<span className="font-semibold text-primary">{t("email-list.thy_cheat_code")}</span>{t("email-list.in_the_chat_bubble_for_newslette")}</p>
 </main>


 </div>
 );
}
