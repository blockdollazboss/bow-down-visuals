/**
 * creator-classes.test.ts — UPGRADE delta #153: the class format on
 * ticketed live. Pins: a class is a ticketed stream flagged is_class;
 * the replay lists as a course product EXACTLY ONCE when the
 * recording registers (the stream row's class_course_product_id is
 * the ledger); non-class streams never list; the roster is the
 * active-ticket list in purchase order, honestly named.
 */
import { describe, expect, it } from "vitest";
import {
  buildClassRoster,
  getClassRoster,
  isClassStream,
  listClassReplayAsCourse,
  type ClassStream,
  type CreatorClassStore,
} from "../creator-classes";

const STREAM_ID = "33333333-3333-4333-8333-333333333333";
const BUYER_1 = "11111111-1111-4111-8111-111111111111";
const BUYER_2 = "22222222-2222-4222-8222-222222222222";

function classStream(over: Partial<ClassStream> = {}): ClassStream {
  return {
    id: STREAM_ID,
    user_id: "99999999-9999-4999-8999-999999999999",
    profile_id: "88888888-8888-4888-8888-888888888888",
    title: "Mixing Vocals Live",
    is_class: true,
    ticket_price_vb: 500,
    class_course_product_id: null,
    vod_url: "https://cdn.example/99999999/live/abc.mp4",
    ...over,
  };
}

function memoryStore() {
  const created: Array<{ stream: ClassStream & { vod_url: string } }> = [];
  const links: Array<{ streamId: string; productId: string }> = [];
  let seq = 0;
  const store: CreatorClassStore = {
    async createCourseListing(stream) {
      created.push({ stream });
      seq += 1;
      return `product-${seq}`;
    },
    async linkCourseToStream(streamId, productId) {
      links.push({ streamId, productId });
    },
    async activeTickets() {
      return [
        { buyer_user_id: BUYER_1, price_vb: 500, created_at: new Date("2026-10-27T10:00:00Z") },
        { buyer_user_id: BUYER_2, price_vb: 500, created_at: new Date("2026-10-27T10:05:00Z") },
      ];
    },
    async nameCards(userIds) {
      const out = new Map();
      if (userIds.includes(BUYER_1)) out.set(BUYER_1, { displayName: "Beat Maker B", slug: "beatb" });
      return out;
    },
  };
  return { store, created, links };
}

describe("isClassStream", () => {
  it("requires the flag AND a real ticket price", () => {
    expect(isClassStream(classStream())).toBe(true);
    expect(isClassStream(classStream({ is_class: false }))).toBe(false);
    expect(isClassStream(classStream({ ticket_price_vb: null }))).toBe(false);
    expect(isClassStream(classStream({ ticket_price_vb: 0 }))).toBe(false);
  });
});

describe("listClassReplayAsCourse", () => {
  it("lists the replay and links it back to the stream", async () => {
    const { store, created, links } = memoryStore();
    const id = await listClassReplayAsCourse(store, classStream());
    expect(id).toBe("product-1");
    expect(created).toHaveLength(1);
    expect(created[0]!.stream.vod_url).toContain("/live/");
    expect(links).toEqual([{ streamId: STREAM_ID, productId: "product-1" }]);
  });

  it("is exactly-once: an already-linked stream never lists again", async () => {
    const { store, created } = memoryStore();
    const id = await listClassReplayAsCourse(store, classStream({ class_course_product_id: "product-9" }));
    expect(id).toBe("product-9");
    expect(created).toHaveLength(0);
  });

  it("non-class streams and missing recordings list nothing", async () => {
    const { store, created } = memoryStore();
    expect(await listClassReplayAsCourse(store, classStream({ is_class: false }))).toBeNull();
    expect(await listClassReplayAsCourse(store, classStream({ vod_url: null }))).toBeNull();
    expect(created).toHaveLength(0);
  });
});

describe("class roster", () => {
  it("active tickets are the enrollment, in order, with honest names", async () => {
    const { store } = memoryStore();
    const roster = await getClassRoster(store, classStream());
    expect(roster.enrolled).toBe(2);
    expect(roster.entries[0]).toMatchObject({ user_id: BUYER_1, display_name: "Beat Maker B", slug: "beatb", price_vb: 500 });
    // A buyer with no creator profile is "Someone" — never invented.
    expect(roster.entries[1]).toMatchObject({ user_id: BUYER_2, display_name: "Someone", slug: null });
  });

  it("buildClassRoster is pure over its inputs", () => {
    const roster = buildClassRoster(STREAM_ID, [], new Map());
    expect(roster).toEqual({ stream_id: STREAM_ID, enrolled: 0, entries: [] });
  });
});
