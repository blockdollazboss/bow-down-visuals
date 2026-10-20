/**
 * chat-doors.test.ts — the client half of the Tier 1 door contract
 * (Cloud Operator Phase 2, Lane C).
 *
 * The server attaches doors to a chat reply only when the member's
 * message matched a knowledge-base feature (see api-server
 * lib/operator-chat.ts buildReplyDoors; the HTTP contract is pinned in
 * chat-doors.test.ts on the API side). Here we pin what the drawer
 * does with a payload:
 *  (a) well-formed doors pass through VERBATIM — label and path,
 *      deep links (?tab= / ?panel=) untouched, order preserved;
 *  (b) anything malformed is dropped, never rendered: missing fields,
 *      unknown kinds, blank labels, external or protocol-relative
 *      paths, non-array payloads, error bodies;
 *  (c) at most two doors survive, however many arrive;
 *  (d) doorBase() normalizes exactly like the guide registry, so the
 *      guide-arrival check compares the same strings the tour
 *      resolver will use.
 */
import { describe, expect, it } from "vitest";
import { parseChatDoors, doorBase, type ChatDoor } from "./chat-doors";

const OPEN: ChatDoor = {
  kind: "open",
  label: "Open Thumbnail Maker",
  path: "/thumbnail-studio?tab=generate",
};
const GUIDE: ChatDoor = {
  kind: "guide",
  label: "Walk me through it",
  path: "/thumbnail-studio?tab=generate",
};

describe("parseChatDoors — well-formed doors pass through verbatim", () => {
  it("keeps an open + guide pair, order and deep link intact", () => {
    expect(parseChatDoors({ reply: "…", doors: [OPEN, GUIDE] })).toEqual([OPEN, GUIDE]);
  });

  it("keeps a single open door", () => {
    expect(parseChatDoors({ doors: [{ kind: "open", label: "Open Earnings", path: "/earnings" }] })).toEqual([
      { kind: "open", label: "Open Earnings", path: "/earnings" },
    ]);
  });

  it("returns [] when the payload carries no doors (old server, plain reply)", () => {
    expect(parseChatDoors({ reply: "All good. 🦈" })).toEqual([]);
    expect(parseChatDoors({})).toEqual([]);
    expect(parseChatDoors(null)).toEqual([]);
    expect(parseChatDoors(undefined)).toEqual([]);
    expect(parseChatDoors("doors")).toEqual([]);
  });
});

describe("parseChatDoors — malformed doors never render", () => {
  it("drops an error body outright", () => {
    expect(parseChatDoors({ error: "Something went wrong on my end" })).toEqual([]);
  });

  it("drops doors with an unknown kind, a blank label, or missing fields", () => {
    expect(
      parseChatDoors({
        doors: [
          { kind: "teleport", label: "Open X", path: "/x" },
          { kind: "open", label: "  ", path: "/x" },
          { kind: "open", path: "/x" },
          { kind: "guide", label: "Walk me through it" },
          null,
          "door",
        ],
      }),
    ).toEqual([]);
  });

  it("drops external and protocol-relative paths — doors are site-internal only", () => {
    expect(
      parseChatDoors({
        doors: [
          { kind: "open", label: "Open Evil", path: "https://evil.example/x" },
          { kind: "open", label: "Open Evil", path: "//evil.example/x" },
          { kind: "open", label: "Open Evil", path: "evil.example/x" },
        ],
      }),
    ).toEqual([]);
  });

  it("caps the row at two doors however many arrive", () => {
    const three = [OPEN, GUIDE, { kind: "open", label: "Open Charts", path: "/charts" }];
    expect(parseChatDoors({ doors: three })).toEqual([OPEN, GUIDE]);
  });

  it("a malformed first door does not sink a well-formed second", () => {
    expect(parseChatDoors({ doors: [{ kind: "nope" }, OPEN] })).toEqual([OPEN]);
  });
});

describe("doorBase — the guide registry's normalization", () => {
  it("strips query and hash, and trailing slashes", () => {
    expect(doorBase("/create?panel=song")).toBe("/create");
    expect(doorBase("/thumbnail-studio?tab=generate")).toBe("/thumbnail-studio");
    expect(doorBase("/brand-deals#top")).toBe("/brand-deals");
    expect(doorBase("/dashboard/")).toBe("/dashboard");
    expect(doorBase("/")).toBe("/");
  });
});
