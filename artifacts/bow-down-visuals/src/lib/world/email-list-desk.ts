/* ─── Email List desk seam (stack1400 world parity, wave #2 item 1) ──
   The Email List family, native in the Promote Room — on the 2D
   page's own rails, the same endpoints pages/email-list.tsx and
   components/FanGraphTab.tsx call:

   LISTS + SUBSCRIBERS (email-list)
     GET    /api/email-list/lists                    → your lists (free)
     POST   /api/email-list/lists                    → create a list (free)
     PATCH  /api/email-list/lists/:id                → rename / re-describe (free)
     GET    /api/email-list/lists/:id/subscribers    → subscribers + stats (free)
     POST   /api/email-list/lists/:id/unsubscribe    → unsubscribe one fan (free)
     GET    /api/email-list/lists/:id/segments       → saved audiences + sizes (free)
     GET    /api/email-list/lists/:id/campaigns      → campaign history (free)
     POST   /api/email-list/lists/:id/campaigns      → draft / queued send (free rail;
                                                       status is server-owned)
     POST   /api/email-list/lists/:id/campaigns/:cid/send → tracked send (free rail)
     POST   /api/email-list/newsletter               → AI newsletter draft
                                                       (100 VB — EMAIL_NEWSLETTER_
                                                       CREDIT_COST in
                                                       routes/generate/email-list-helpers.ts)

   AUTOMATIONS (email-automations)
     GET    /api/email-list/lists/:id/automations    → the four starter
                                                       sequences, lazily
                                                       provisioned OFF (free)
     PATCH  /api/email-list/lists/:id/automations/:kind → toggle / copy /
                                                       delay (free)

   FAN GRAPH (fan-graph)
     GET    /api/email-list/fan-graph                → one merged record per
                                                       fan + summary (free,
                                                       read-only)

   CHARGE / CONFIRMATION LAW: the newsletter draft is the family's
   only paid rail. The desk rides it through useConfirmedApi with the
   cost below as an explicit override — and that cost now READS the
   lib/credit-costs.ts registry row for /api/email-list/newsletter
   (the row landed with the stack1400 registry lane, closing the gap
   this desk's first version named), so the override carries the
   registry's own value and can never drift from it. Everything else
   is free on the server and free here.

   HONESTY: stats render only from the rails' fields. A list with no
   tracked sends reports openRate null — the desk says "not tracked
   yet", never a fabricated 0%. A newsletter answer missing its
   subject or body is a failed read, never a draft painted over a
   broken answer. The fan graph is read-only here exactly as its 2D
   tab is read-only. */

import { getCreditCost } from "../credit-costs";

/** Registry cost for an endpoint; throws if unregistered so a desk
 *  can never silently show (or charge against) an invented price. */
function registryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

export const EMAIL_LISTS_PATH = "/api/email-list/lists";
export const EMAIL_NEWSLETTER_PATH = "/api/email-list/newsletter";
export const EMAIL_NEWSLETTER_COST_VISUAL_BUCS = registryCost(EMAIL_NEWSLETTER_PATH);
export const FAN_GRAPH_PATH = "/api/email-list/fan-graph";
export const FAN_GRAPH_PAGE_SIZE = 25;

export function emailListSubscribersPath(listId: string): string {
  return `${EMAIL_LISTS_PATH}/${encodeURIComponent(listId)}/subscribers`;
}
export function emailListItemPath(listId: string): string {
  return `${EMAIL_LISTS_PATH}/${encodeURIComponent(listId)}`;
}
export function emailListUnsubscribePath(listId: string): string {
  return `${EMAIL_LISTS_PATH}/${encodeURIComponent(listId)}/unsubscribe`;
}
export function emailListSegmentsPath(listId: string): string {
  return `${EMAIL_LISTS_PATH}/${encodeURIComponent(listId)}/segments`;
}
export function emailListCampaignsPath(listId: string): string {
  return `${EMAIL_LISTS_PATH}/${encodeURIComponent(listId)}/campaigns`;
}
export function emailListCampaignSendPath(listId: string, campaignId: string): string {
  return `${EMAIL_LISTS_PATH}/${encodeURIComponent(listId)}/campaigns/${encodeURIComponent(campaignId)}/send`;
}
export function emailListAutomationsPath(listId: string): string {
  return `${EMAIL_LISTS_PATH}/${encodeURIComponent(listId)}/automations`;
}
export function emailListAutomationItemPath(listId: string, kind: string): string {
  return `${EMAIL_LISTS_PATH}/${encodeURIComponent(listId)}/automations/${encodeURIComponent(kind)}`;
}
export function fanGraphPath(opts: { search?: string; sort?: string; page?: number }): string {
  const qs = new URLSearchParams({
    sort: opts.sort ?? "recent",
    page: String(opts.page ?? 1),
    pageSize: String(FAN_GRAPH_PAGE_SIZE),
  });
  const s = (opts.search ?? "").trim();
  if (s) qs.set("search", s);
  return `${FAN_GRAPH_PATH}?${qs.toString()}`;
}

/* Vocabularies — the server schemas' own enums. */
export const NEWSLETTER_TONES = ["hype", "behind-the-scenes", "personal", "announcement"] as const;
export const EMAIL_AUTOMATION_KINDS = [
  "post_purchase", "abandoned_checkout", "membership_winback", "membership_payment_recovery",
] as const;
export const FAN_GRAPH_SORTS = ["recent", "spent", "name"] as const;

/* ─── Shared shapes ──────────────────────────────────────────────── */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function bool(v: unknown): boolean {
  return v === true;
}
function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

/* ─── Lists + subscribers ────────────────────────────────────────── */

export interface EmailListRow {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  createdAt: string | null;
}

export function parseEmailLists(payload: unknown): EmailListRow[] {
  const rows = asRecord(payload)?.["lists"];
  if (!Array.isArray(rows)) return [];
  const out: EmailListRow[] = [];
  for (const raw of rows) {
    const r = asRecord(raw);
    if (!r || !str(r["id"])) continue;
    out.push({
      id: str(r["id"]), name: str(r["name"]), handle: str(r["handle"]),
      description: strOrNull(r["description"]), createdAt: strOrNull(r["createdAt"]),
    });
  }
  return out;
}

export function buildListPayload(input: { name: string; handle: string; description: string }): Record<string, unknown> {
  return { name: input.name.trim(), handle: input.handle.trim().toLowerCase(), description: input.description.trim() };
}
export function listReady(input: { name: string; handle: string }): boolean {
  return input.name.trim().length > 0 && /^[a-z0-9-]{3,40}$/.test(input.handle.trim().toLowerCase());
}

export interface SubscriberRow {
  id: string;
  email: string;
  name: string | null;
  source: string;
  opens: number;
  clicks: number;
  tags: string[];
  autoTags: string[];
  unsubscribedAt: string | null;
  subscribedAt: string | null;
}

export interface ListStats {
  total: number;
  active: number;
  unsubscribed: number;
  openRate: number | null;
  opensTracked: boolean;
  totalOpens: number;
  totalClicks: number;
  freeLimit: number;
}

export function parseSubscribers(payload: unknown): { subscribers: SubscriberRow[]; stats: ListStats | null } {
  const root = asRecord(payload);
  const rows = root?.["subscribers"];
  const subscribers: SubscriberRow[] = [];
  if (Array.isArray(rows)) {
    for (const raw of rows) {
      const r = asRecord(raw);
      if (!r || !str(r["id"])) continue;
      subscribers.push({
        id: str(r["id"]), email: str(r["email"]), name: strOrNull(r["name"]),
        source: str(r["source"], "landing"), opens: num(r["opens"]), clicks: num(r["clicks"]),
        tags: strArr(r["tags"]), autoTags: strArr(r["autoTags"]),
        unsubscribedAt: strOrNull(r["unsubscribedAt"]), subscribedAt: strOrNull(r["subscribedAt"]),
      });
    }
  }
  const s = asRecord(root?.["stats"]);
  const stats: ListStats | null = s
    ? {
        total: num(s["total"]), active: num(s["active"]), unsubscribed: num(s["unsubscribed"]),
        openRate: typeof s["openRate"] === "number" && Number.isFinite(s["openRate"]) ? s["openRate"] : null,
        opensTracked: bool(s["opensTracked"]), totalOpens: num(s["totalOpens"]),
        totalClicks: num(s["totalClicks"]), freeLimit: num(s["freeLimit"], 1000),
      }
    : null;
  return { subscribers, stats };
}

/** The open-rate copy — the desk passes its catalog strings in;
 *  unbundled calls render the English lines verbatim
 *  (worldScheduleRelease i18n, unit 45). */
export interface OpenRateStrings {
  notTrackedYet: string;
  /** Carries a {{pct}} token the seam fills with the rounded %. */
  openRate: string;
}

export const OPEN_RATE_EN: OpenRateStrings = {
  notTrackedYet: "Not tracked yet",
  openRate: "{{pct}}% open rate",
};

/** The 2D page's honesty rule, in words: no tracked sends yet is
 *  "not tracked", never 0%. */
export function openRateLabel(stats: ListStats | null, strings?: OpenRateStrings): string {
  const s = strings ?? OPEN_RATE_EN;
  if (!stats || !stats.opensTracked || stats.openRate === null) return s.notTrackedYet;
  return s.openRate.split("{{pct}}").join(String(Math.round(stats.openRate * 100)));
}

/* ─── Segments + campaigns ───────────────────────────────────────── */

export interface SegmentRow {
  id: string;
  name: string;
  size: number;
}

export function parseSegments(payload: unknown): SegmentRow[] {
  const rows = asRecord(payload)?.["segments"];
  if (!Array.isArray(rows)) return [];
  const out: SegmentRow[] = [];
  for (const raw of rows) {
    const r = asRecord(raw);
    if (!r || !str(r["id"])) continue;
    out.push({ id: str(r["id"]), name: str(r["name"]), size: num(r["size"]) });
  }
  return out;
}

export interface CampaignRow {
  id: string;
  subject: string;
  status: string;
  recipientCount: number;
  deliveredCount: number;
  openCount: number;
  clickCount: number;
  createdAt: string | null;
}

export function parseCampaigns(payload: unknown): CampaignRow[] {
  const rows = asRecord(payload)?.["campaigns"];
  if (!Array.isArray(rows)) return [];
  const out: CampaignRow[] = [];
  for (const raw of rows) {
    const r = asRecord(raw);
    if (!r || !str(r["id"])) continue;
    out.push({
      id: str(r["id"]), subject: str(r["subject"]), status: str(r["status"], "draft"),
      recipientCount: num(r["recipientCount"]), deliveredCount: num(r["deliveredCount"]),
      openCount: num(r["openCount"]), clickCount: num(r["clickCount"]),
      createdAt: strOrNull(r["createdAt"]),
    });
  }
  return out;
}

export function buildCampaignPayload(input: { subject: string; body: string }): Record<string, unknown> {
  return { subject: input.subject.trim(), body: input.body.trim(), status: "draft" };
}
export function campaignReady(input: { subject: string; body: string }): boolean {
  return input.subject.trim().length > 0 && input.body.trim().length > 0;
}
export function campaignSendable(c: Pick<CampaignRow, "status">): boolean {
  return c.status === "draft" || c.status === "failed";
}

/* ─── Newsletter draft (the one paid rail) ───────────────────────── */

export function buildNewsletterPayload(input: {
  topic: string; tone: string; creatorName: string; listName: string; callToAction: string;
}): Record<string, unknown> {
  return {
    topic: input.topic.trim(), tone: input.tone,
    creatorName: input.creatorName.trim(), listName: input.listName.trim(),
    callToAction: input.callToAction.trim(),
  };
}
export function newsletterReady(input: { topic: string }): boolean {
  return input.topic.trim().length > 0;
}

export interface NewsletterDraft { subject: string; body: string; creditsRemaining: number | null }

/** A draft missing its subject or body is a failed read (null),
 *  never a draft painted over a broken answer. */
export function parseNewsletterDraft(payload: unknown): NewsletterDraft | null {
  const r = asRecord(payload);
  if (!r) return null;
  const subject = str(r["subject"]).trim();
  const body = str(r["body"]).trim();
  if (!subject || !body) return null;
  return {
    subject, body,
    creditsRemaining: typeof r["creditsRemaining"] === "number" ? r["creditsRemaining"] : null,
  };
}

/* ─── Automations ────────────────────────────────────────────────── */

export interface AutomationRow {
  id: string;
  kind: string;
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

export function parseAutomations(payload: unknown): AutomationRow[] {
  const rows = asRecord(payload)?.["automations"];
  if (!Array.isArray(rows)) return [];
  const out: AutomationRow[] = [];
  for (const raw of rows) {
    const r = asRecord(raw);
    if (!r || !str(r["id"]) || !str(r["kind"])) continue;
    out.push({
      id: str(r["id"]), kind: str(r["kind"]), label: str(r["label"], str(r["kind"])),
      triggerNote: str(r["triggerNote"]), enabled: bool(r["enabled"]),
      subject: str(r["subject"]), body: str(r["body"]), delayHours: num(r["delayHours"]),
      enabledAt: strOrNull(r["enabledAt"]), lastRunAt: strOrNull(r["lastRunAt"]),
      sent: num(r["sent"]), failed: num(r["failed"]), noProvider: num(r["noProvider"]),
      skippedUnsubscribed: num(r["skippedUnsubscribed"]), delivered: num(r["delivered"]),
      opens: num(r["opens"]), clicks: num(r["clicks"]),
    });
  }
  return out;
}

export function buildAutomationToggle(a: Pick<AutomationRow, "enabled">): Record<string, unknown> {
  return { enabled: !a.enabled };
}
export function buildAutomationCopyPatch(input: { subject: string; body: string; delayHours: number }): Record<string, unknown> {
  return { subject: input.subject.trim(), body: input.body.trim(), delayHours: Math.max(0, Math.min(720, Math.trunc(input.delayHours) || 0)) };
}

/* ─── Fan graph (read-only) ──────────────────────────────────────── */

export interface FanRecordRow {
  id: string;
  email: string | null;
  displayName: string | null;
  follows: boolean;
  subscribed: boolean;
  unsubscribed: boolean;
  memberTier: string | null;
  memberStatus: string | null;
  spentUsdCents: number;
  spentVb: number;
  purchaseCount: number;
  lastActivityAt: string | null;
}

export interface FanGraphSummary {
  totalFans: number;
  followers: number;
  subscribers: number;
  members: number;
  buyers: number;
  totalSpentUsdCents: number;
  totalSpentVb: number;
}

export const EMPTY_FAN_SUMMARY: FanGraphSummary = {
  totalFans: 0, followers: 0, subscribers: 0, members: 0, buyers: 0,
  totalSpentUsdCents: 0, totalSpentVb: 0,
};

export function parseFanGraph(payload: unknown): { fans: FanRecordRow[]; summary: FanGraphSummary; total: number } {
  const root = asRecord(payload);
  const rows = root?.["fans"];
  const fans: FanRecordRow[] = [];
  if (Array.isArray(rows)) {
    for (const raw of rows) {
      const r = asRecord(raw);
      if (!r || !str(r["id"])) continue;
      const m = asRecord(r["member"]);
      fans.push({
        id: str(r["id"]), email: strOrNull(r["email"]), displayName: strOrNull(r["displayName"]),
        follows: bool(r["follows"]), subscribed: bool(r["subscribed"]), unsubscribed: bool(r["unsubscribed"]),
        memberTier: m ? strOrNull(m["tierName"]) : null, memberStatus: m ? strOrNull(m["status"]) : null,
        spentUsdCents: num(r["spentUsdCents"]), spentVb: num(r["spentVb"]),
        purchaseCount: num(r["purchaseCount"]), lastActivityAt: strOrNull(r["lastActivityAt"]),
      });
    }
  }
  const s = asRecord(root?.["summary"]);
  const summary: FanGraphSummary = s
    ? {
        totalFans: num(s["totalFans"]), followers: num(s["followers"]),
        subscribers: num(s["subscribers"]), members: num(s["members"]), buyers: num(s["buyers"]),
        totalSpentUsdCents: num(s["totalSpentUsdCents"]), totalSpentVb: num(s["totalSpentVb"]),
      }
    : { ...EMPTY_FAN_SUMMARY };
  return { fans, summary, total: num(root?.["total"], fans.length) };
}

/** The fan-badge copy — the desk passes its catalog strings in;
 *  unbundled calls render the English lines verbatim
 *  (worldScheduleRelease i18n, unit 45). */
export interface FanBadgeStrings {
  follows: string;
  subscribed: string;
  unsubscribed: string;
  member: string;
  /** Carries a {{tier}} token the seam fills with the tier name. */
  memberTier: string;
  /** Carries a {{count}} token. */
  purchaseOne: string;
  /** Carries a {{count}} token. */
  purchases: string;
}

export const FAN_BADGE_EN: FanBadgeStrings = {
  follows: "Follows",
  subscribed: "Subscribed",
  unsubscribed: "Unsubscribed",
  member: "Member",
  memberTier: "Member · {{tier}}",
  purchaseOne: "{{count}} purchase",
  purchases: "{{count}} purchases",
};

export function fanBadges(f: FanRecordRow, strings?: FanBadgeStrings): string[] {
  const s = strings ?? FAN_BADGE_EN;
  const out: string[] = [];
  if (f.follows) out.push(s.follows);
  if (f.subscribed) out.push(s.subscribed);
  if (f.unsubscribed) out.push(s.unsubscribed);
  if (f.memberStatus) out.push(f.memberTier ? s.memberTier.split("{{tier}}").join(f.memberTier) : s.member);
  if (f.purchaseCount > 0) {
    out.push(
      (f.purchaseCount === 1 ? s.purchaseOne : s.purchases)
        .split("{{count}}")
        .join(String(f.purchaseCount)),
    );
  }
  return out;
}

export function fanSpentLabel(
  f: Pick<FanRecordRow, "spentUsdCents" | "spentVb">,
  locale?: string,
): string {
  const parts: string[] = [];
  if (f.spentUsdCents > 0) parts.push(`$${(f.spentUsdCents / 100).toFixed(2)}`);
  if (f.spentVb > 0) parts.push(`${f.spentVb.toLocaleString(locale)} VB`);
  return parts.join(" · ");
}
