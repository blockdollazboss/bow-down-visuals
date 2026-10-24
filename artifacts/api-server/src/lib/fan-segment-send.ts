/**
 * One-click send to a fan segment (Stack-100 #3, fan-graph phase 2).
 *
 * This is the adapter between fan segments and the EXISTING email
 * desk — it is not a sender. The flow, end to end:
 *
 *   1. The target list must belong to the caller (the desk is
 *      list-centric: campaigns, deliveries, tracking, and the
 *      unsubscribe flow all hang off a list).
 *   2. The fan graph is loaded FRESH for the caller and the segment
 *      rules are evaluated at SEND time — the recipients are the
 *      segment's membership now, never a previewed snapshot.
 *   3. Membership resolves to ACTIVE subscriber rows of that list
 *      (lib/fan-segments resolveSegmentAudience). Segment fans the
 *      desk cannot honestly email — no email, not subscribed to
 *      this list, or unsubscribed — are counted and reported,
 *      never emailed and never silently subscribed.
 *   4. A normal campaign row (kind "fan_segment", status "draft")
 *      is created on the list and handed to the desk's tracked
 *      dispatch (dispatchCampaignToAudience), which sends through
 *      the same per-recipient rail as every other campaign: same
 *      provider gate, same tracking, same unsubscribe, same honest
 *      final status. The desk's own guards apply unchanged — this
 *      module adds no sending logic of its own and calls no mail
 *      function directly.
 *
 * Deps are injectable so the handoff contract (recipients passed =
 * live membership; dispatch is the desk's entry point) is testable
 * without a database.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  emailCampaignsTable,
  emailListsTable,
  emailSubscribersTable,
  type EmailCampaign,
  type EmailList,
  type EmailSubscriber,
} from "@workspace/db";
import { loadFanGraph, type FanRecord } from "./fan-graph";
import {
  evaluateFanSegment,
  resolveSegmentAudience,
  type FanSegmentRules,
  type SegmentAudience,
} from "./fan-segments";
import { dispatchCampaignToAudience, type DispatchResult } from "./email-campaign-send";

export interface FanSegmentSendDeps {
  loadFans: (creatorUserId: string) => Promise<FanRecord[]>;
  loadOwnedList: (creatorUserId: string, listId: string) => Promise<EmailList | null>;
  loadSubscribers: (listId: string) => Promise<EmailSubscriber[]>;
  createCampaign: (input: {
    listId: string;
    subject: string;
    body: string;
  }) => Promise<EmailCampaign>;
  dispatch: (
    campaignId: string,
    audience: Array<{ id: string; email: string }>,
  ) => Promise<DispatchResult>;
  loadCampaign: (campaignId: string) => Promise<EmailCampaign | null>;
}

export function defaultFanSegmentSendDeps(): FanSegmentSendDeps {
  return {
    loadFans: async (creatorUserId) => (await loadFanGraph(creatorUserId)).fans,
    loadOwnedList: async (creatorUserId, listId) => {
      const [list] = await db
        .select()
        .from(emailListsTable)
        .where(and(eq(emailListsTable.id, listId), eq(emailListsTable.userId, creatorUserId)))
        .limit(1);
      return list ?? null;
    },
    loadSubscribers: async (listId) =>
      db.select().from(emailSubscribersTable).where(eq(emailSubscribersTable.listId, listId)),
    createCampaign: async ({ listId, subject, body }) => {
      const [campaign] = await db
        .insert(emailCampaignsTable)
        .values({ listId, subject, body, status: "draft", kind: "fan_segment", segmentId: null })
        .returning();
      return campaign!;
    },
    dispatch: (campaignId, audience) => dispatchCampaignToAudience(campaignId, audience),
    loadCampaign: async (campaignId) => {
      const [campaign] = await db
        .select()
        .from(emailCampaignsTable)
        .where(eq(emailCampaignsTable.id, campaignId))
        .limit(1);
      return campaign ?? null;
    },
  };
}

export type FanSegmentSendResult =
  | {
      ok: true;
      campaign: EmailCampaign;
      segment: SegmentAudience;
      dispatch: DispatchResult;
    }
  | { ok: false; code: "list_not_found"; error: string };

export async function sendFanSegmentEmail(
  args: {
    creatorUserId: string;
    listId: string;
    rules: FanSegmentRules;
    subject: string;
    body: string;
    now?: Date;
  },
  deps: FanSegmentSendDeps = defaultFanSegmentSendDeps(),
): Promise<FanSegmentSendResult> {
  const list = await deps.loadOwnedList(args.creatorUserId, args.listId);
  if (!list) {
    return { ok: false, code: "list_not_found", error: "List not found." };
  }

  /* Membership at SEND time: fresh graph, fresh evaluation. */
  const fans = await deps.loadFans(args.creatorUserId);
  const members = evaluateFanSegment(fans, args.rules, args.now);

  const subscribers = await deps.loadSubscribers(list.id);
  const segment = resolveSegmentAudience(members, subscribers);

  const campaign = await deps.createCampaign({
    listId: list.id,
    subject: args.subject,
    body: args.body,
  });
  const dispatch = await deps.dispatch(campaign.id, segment.audience);
  const fresh = (await deps.loadCampaign(campaign.id)) ?? campaign;
  return { ok: true, campaign: fresh, segment, dispatch };
}
