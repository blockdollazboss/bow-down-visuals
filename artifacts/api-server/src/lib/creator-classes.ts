/* ─── Creator Classes (UPGRADE delta #153) ──────────────────────────────
   The class FORMAT on ticketed live. The delta, per the dedupe audit:
   no new ticketing rail — a class is a ticketed stream (lib/live-
   tickets owns the door, the charge, the refunds) whose buyer list IS
   the enrollment roster, plus one automatic step when the session's
   replay registers: the replay is listed as a course product.

   Posture, stated plainly: the listing is created as a DRAFT in the
   creator's course builder (the same posture lib/courses createCourse
   uses for every new course) with the replay attached as its first
   lesson. Automation proposes, the creator disposes — they set the
   price and publish. The live session's ticket terms (Visual Bucs)
   are recorded in the listing's description so nothing about the
   session's terms is lost or silently converted: the store's price
   is the creator's to set, in the store's own unit. */

import {
  db,
  liveStreamsTable,
  liveStreamTicketsTable,
  storeProductsTable,
  courseSectionsTable,
  courseLessonsTable,
  creatorProfilesTable,
  type LiveStream,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

/** The slice of a stream row the class logic reads. */
export type ClassStream = Pick<
  LiveStream,
  "id" | "user_id" | "profile_id" | "title" | "is_class" | "ticket_price_vb" | "class_course_product_id" | "vod_url"
>;

/** A class is a ticketed stream the creator marked as a class. */
export function isClassStream(stream: Pick<LiveStream, "is_class" | "ticket_price_vb">): boolean {
  return stream.is_class === true && typeof stream.ticket_price_vb === "number" && stream.ticket_price_vb > 0;
}

export interface ClassRosterEntry {
  user_id: string;
  display_name: string;
  slug: string | null;
  enrolled_at: string;
  price_vb: number;
}

export interface ClassRoster {
  stream_id: string;
  enrolled: number;
  entries: ClassRosterEntry[];
}

interface TicketRow {
  buyer_user_id: string;
  price_vb: number;
  created_at: Date | string;
}

interface NameCard {
  displayName: string;
  slug: string | null;
}

/** Pure roster build: active tickets in purchase order, named from
 *  the buyers' profile cards ("Someone" when a buyer has no creator
 *  profile — never an invented name). */
export function buildClassRoster(
  streamId: string,
  tickets: TicketRow[],
  cards: Map<string, NameCard>,
): ClassRoster {
  const entries = tickets.map((t) => {
    const card = cards.get(t.buyer_user_id);
    return {
      user_id: t.buyer_user_id,
      display_name: card?.displayName ?? "Someone",
      slug: card?.slug ?? null,
      enrolled_at: new Date(t.created_at).toISOString(),
      price_vb: t.price_vb,
    };
  });
  return { stream_id: streamId, enrolled: entries.length, entries };
}

/** Storage seam for the replay-listing step (drizzle in production,
 *  in-memory in tests). */
export interface CreatorClassStore {
  createCourseListing(stream: ClassStream & { vod_url: string }): Promise<string>;
  linkCourseToStream(streamId: string, productId: string): Promise<void>;
  activeTickets(streamId: string): Promise<TicketRow[]>;
  nameCards(userIds: string[]): Promise<Map<string, NameCard>>;
}

export const drizzleCreatorClassStore: CreatorClassStore = {
  async createCourseListing(stream) {
    const [product] = await db
      .insert(storeProductsTable)
      .values({
        profileId: stream.profile_id,
        kind: "course",
        title: stream.title,
        description:
          `Replay of the live class "${stream.title}", listed automatically when the ` +
          `session's recording registered. Live seats were ${stream.ticket_price_vb} Visual Bucs ` +
          `on the ticket rail; set your price here and publish when you're ready.`,
        priceCents: 0,
        inventory: -1,
        mediaUrls: [],
        relatedLinks: [],
        /* Draft — the creator publishes from the course builder. */
        isActive: false,
      })
      .returning();
    const productId = product!.id;
    const [section] = await db
      .insert(courseSectionsTable)
      .values({ productId, title: "Live class replay", position: 0 })
      .returning();
    await db.insert(courseLessonsTable).values({
      sectionId: section!.id,
      title: stream.title,
      position: 0,
      kind: "video",
      videoId: null,
      body: "The replay of your live class session. The recording is attached below.",
      attachmentTitle: "Class replay",
      attachmentUrl: stream.vod_url,
      dripDayOffset: 0,
      isPreview: false,
    });
    return productId;
  },
  async linkCourseToStream(streamId, productId) {
    await db
      .update(liveStreamsTable)
      .set({ class_course_product_id: productId, updated_at: new Date() })
      .where(eq(liveStreamsTable.id, streamId));
  },
  async activeTickets(streamId) {
    const rows = await db
      .select({
        buyer_user_id: liveStreamTicketsTable.buyer_user_id,
        price_vb: liveStreamTicketsTable.price_vb,
        created_at: liveStreamTicketsTable.created_at,
      })
      .from(liveStreamTicketsTable)
      .where(
        and(
          eq(liveStreamTicketsTable.stream_id, streamId),
          eq(liveStreamTicketsTable.status, "active"),
        ),
      )
      .orderBy(asc(liveStreamTicketsTable.created_at));
    return rows;
  },
  async nameCards(userIds) {
    const out = new Map<string, NameCard>();
    const uniq = [...new Set(userIds.filter(Boolean))];
    if (!uniq.length) return out;
    const rows = await db
      .select({
        userId: creatorProfilesTable.userId,
        slug: creatorProfilesTable.slug,
        displayName: creatorProfilesTable.displayName,
      })
      .from(creatorProfilesTable)
      .where(inArray(creatorProfilesTable.userId, uniq));
    for (const r of rows) out.set(r.userId, { displayName: r.displayName, slug: r.slug ?? null });
    return out;
  },
};

/**
 * The VOD-registration hook: when a class stream's recording lands,
 * list the replay as a course product — exactly once. The stream
 * row's class_course_product_id is the ledger: set means listed, and
 * a re-registration (or a retry of this hook) is a no-op. Non-class
 * streams and streams without a recording never list anything.
 * Returns the course product id, or null when nothing was listed.
 */
export async function listClassReplayAsCourse(
  store: CreatorClassStore,
  stream: ClassStream,
): Promise<string | null> {
  if (!isClassStream(stream)) return null;
  if (!stream.vod_url) return null;
  if (stream.class_course_product_id) return stream.class_course_product_id;
  const productId = await store.createCourseListing({ ...stream, vod_url: stream.vod_url });
  await store.linkCourseToStream(stream.id, productId);
  return productId;
}

/** The teacher's roster for a class stream: every active ticket is an
 *  enrollment (refunded tickets are out — the house refund legs
 *  already unwound them). */
export async function getClassRoster(
  store: CreatorClassStore,
  stream: ClassStream,
): Promise<ClassRoster> {
  const tickets = await store.activeTickets(stream.id);
  const cards = await store.nameCards(tickets.map((t) => t.buyer_user_id));
  return buildClassRoster(stream.id, tickets, cards);
}
