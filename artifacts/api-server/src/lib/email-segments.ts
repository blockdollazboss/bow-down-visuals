/**
 * Email segments (migration 0188).
 *
 * A segment is a saved audience definition over ONE creator list.
 * Membership is computed here — one implementation consumed by the
 * segment-size endpoint, the segment-members endpoint, and campaign
 * dispatch — so the size a creator sees is exactly the audience a
 * send reaches.
 *
 * Rules that never bend:
 *   - Unsubscribed subscribers are excluded FIRST, whatever the
 *     criteria say. Suppression is absolute: no tag, source, or
 *     engagement filter can re-include an unsubscribed address.
 *   - Manual tags are the creator's own labels (email_tags).
 *   - Automatic tags are derived at evaluation time from rows the
 *     house already keeps — never stored, so they can't drift:
 *       presave  — subscriber.source is "presave" (the pre-save follow
 *                  handoff in distribution.ts writes exactly that)
 *       member   — the address is the fan_label of an active/trialing
 *                  fan_members row owned by the list's creator
 *       buyer    — the address appears as buyer_email on a 'sale'
 *                  shop_events row owned by the list's creator
 *       opened / clicked / engaged — engagement events exist for the
 *                  subscriber on this list
 *   - Criteria combine as AND across groups, OR inside `sources`:
 *     every named manual tag, every named auto tag, source in the set
 *     (when non-empty), and the engagement state must all hold.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  emailEngagementEventsTable,
  emailSubscribersTable,
  emailSubscriberTagsTable,
  emailTagsTable,
  fanMembersTable,
  shopEventsTable,
  type EmailList,
  type EmailSubscriber,
} from "@workspace/db";

export const AUTO_TAGS = ["presave", "member", "buyer", "opened", "clicked", "engaged"] as const;
export type AutoTag = (typeof AUTO_TAGS)[number];

export const ENGAGEMENT_STATES = ["any", "opened", "clicked", "engaged", "none"] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];

export interface SegmentCriteria {
  tags: string[];
  autoTags: AutoTag[];
  sources: string[];
  engagement: EngagementState;
}

export const EMPTY_CRITERIA: SegmentCriteria = { tags: [], autoTags: [], sources: [], engagement: "any" };

const KNOWN_SOURCES = new Set(["landing", "embed", "import", "presave"]);

/** Validate + normalize untrusted criteria (route input or stored JSON). */
export function normalizeCriteria(raw: unknown): SegmentCriteria | null {
  if (raw === null || raw === undefined) return { ...EMPTY_CRITERIA };
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const strList = (v: unknown, max: number): string[] | null => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) return null;
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== "string") return null;
      const s = item.trim().toLowerCase();
      if (s.length === 0 || s.length > 60) return null;
      if (!out.includes(s)) out.push(s);
      if (out.length > max) return null;
    }
    return out;
  };
  const tags = strList(r["tags"], 20);
  const autoRaw = strList(r["autoTags"], 10);
  const sources = strList(r["sources"], 10);
  if (!tags || !autoRaw || !sources) return null;
  if (!autoRaw.every((t) => (AUTO_TAGS as readonly string[]).includes(t))) return null;
  if (!sources.every((s) => KNOWN_SOURCES.has(s))) return null;
  const engagement = r["engagement"] === undefined ? "any" : r["engagement"];
  if (typeof engagement !== "string" || !(ENGAGEMENT_STATES as readonly string[]).includes(engagement)) return null;
  return { tags, autoTags: autoRaw as AutoTag[], sources, engagement: engagement as EngagementState };
}

export function parseStoredCriteria(stored: string): SegmentCriteria {
  try {
    return normalizeCriteria(JSON.parse(stored)) ?? { ...EMPTY_CRITERIA };
  } catch {
    return { ...EMPTY_CRITERIA };
  }
}

/* ─── Facts ───────────────────────────────────────────────────────────── */

export interface SubscriberFacts {
  source: string;
  manualTags: Set<string>;
  isMember: boolean;
  isBuyer: boolean;
  hasOpened: boolean;
  hasClicked: boolean;
}

export function autoTagsFor(facts: SubscriberFacts, source: string): AutoTag[] {
  const out: AutoTag[] = [];
  if (source === "presave") out.push("presave");
  if (facts.isMember) out.push("member");
  if (facts.isBuyer) out.push("buyer");
  if (facts.hasOpened) out.push("opened");
  if (facts.hasClicked) out.push("clicked");
  if (facts.hasOpened || facts.hasClicked) out.push("engaged");
  return out;
}

export function matchesCriteria(
  sub: { source: string },
  facts: SubscriberFacts,
  criteria: SegmentCriteria,
): boolean {
  for (const t of criteria.tags) if (!facts.manualTags.has(t)) return false;
  const autos = autoTagsFor(facts, sub.source);
  for (const t of criteria.autoTags) if (!autos.includes(t)) return false;
  if (criteria.sources.length > 0 && !criteria.sources.includes(sub.source)) return false;
  switch (criteria.engagement) {
    case "any": return true;
    case "opened": return facts.hasOpened;
    case "clicked": return facts.hasClicked;
    case "engaged": return facts.hasOpened || facts.hasClicked;
    case "none": return !facts.hasOpened && !facts.hasClicked;
  }
}

/** Load the derived-fact map for every subscriber of a list. */
export async function loadListFacts(
  list: EmailList,
  subscribers: EmailSubscriber[],
): Promise<Map<string, SubscriberFacts>> {
  const facts = new Map<string, SubscriberFacts>();
  for (const s of subscribers) {
    facts.set(s.id, {
      source: s.source,
      manualTags: new Set<string>(),
      isMember: false,
      isBuyer: false,
      hasOpened: s.opens > 0,
      hasClicked: s.clicks > 0,
    });
  }
  if (subscribers.length === 0) return facts;

  const tagRows = await db
    .select({ subscriberId: emailSubscriberTagsTable.subscriberId, name: emailTagsTable.name })
    .from(emailSubscriberTagsTable)
    .innerJoin(emailTagsTable, eq(emailSubscriberTagsTable.tagId, emailTagsTable.id))
    .where(eq(emailTagsTable.listId, list.id));
  for (const r of tagRows) facts.get(r.subscriberId)?.manualTags.add(r.name.toLowerCase());

  const memberRows = await db
    .select({ fanLabel: fanMembersTable.fan_label })
    .from(fanMembersTable)
    .where(and(eq(fanMembersTable.user_id, list.userId), inArray(fanMembersTable.status, ["active", "trialing"])));
  const memberEmails = new Set(
    memberRows.map((r) => r.fanLabel.trim().toLowerCase()).filter((e) => e.includes("@")),
  );

  const buyerRows = await db
    .select({ buyerEmail: shopEventsTable.buyer_email })
    .from(shopEventsTable)
    .where(and(eq(shopEventsTable.user_id, list.userId), eq(shopEventsTable.event_type, "sale")));
  const buyerEmails = new Set(
    buyerRows.map((r) => (r.buyerEmail ?? "").trim().toLowerCase()).filter((e) => e.includes("@")),
  );

  /* Engagement facts come from the counters the recorder maintains
     (seeded above from opens/clicks) AND the event rows, so a signal
     recorded before a counter existed still counts. */
  const eventRows = await db
    .select({ subscriberId: emailEngagementEventsTable.subscriberId, kind: emailEngagementEventsTable.kind })
    .from(emailEngagementEventsTable)
    .where(eq(emailEngagementEventsTable.listId, list.id));
  for (const r of eventRows) {
    const f = facts.get(r.subscriberId);
    if (!f) continue;
    if (r.kind === "open") f.hasOpened = true;
    if (r.kind === "click") f.hasClicked = true;
  }

  for (const s of subscribers) {
    const f = facts.get(s.id);
    if (!f) continue;
    const email = s.email.trim().toLowerCase();
    f.isMember = memberEmails.has(email);
    f.isBuyer = buyerEmails.has(email);
  }
  return facts;
}

/**
 * The members of a segment: ACTIVE subscribers only (suppression is
 * absolute and applied before any criteria), matching the criteria.
 */
export async function evaluateSegment(
  list: EmailList,
  criteria: SegmentCriteria,
): Promise<EmailSubscriber[]> {
  const subscribers = await db
    .select()
    .from(emailSubscribersTable)
    .where(eq(emailSubscribersTable.listId, list.id));
  const active = subscribers.filter((s) => !s.unsubscribedAt);
  const facts = await loadListFacts(list, active);
  return active.filter((s) => matchesCriteria(s, facts.get(s.id)!, criteria));
}
