/**
 * The Front Row — client logic tests.
 *
 * Profile render contract (components/artist/RoyalCourtSection is a thin
 * shell over courtViewState):
 * - populated Court → "cards" for everyone, in stored rank order
 * - empty Court + viewer → "hidden" (the section does not exist)
 * - empty Court + owner → "owner-empty" (the "Add your Court" state)
 * - failed load → "error" for everyone, never dressed up as empty
 * - still loading → "loading" (renders nothing yet)
 *
 * Picker contract (pages/artist-setup's Front Row picker drives these):
 * - at most 8 seats, no duplicate crowns
 * - up/down moves swap exactly one seat; edges are no-ops
 * - the save flow speaks the real API shape: PUT memberProfileIds in
 *   rank order, and the confirmation reads back the SERVER's court.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  courtViewState,
  canAddToCourt,
  addToCourt,
  removeFromCourt,
  moveInCourt,
  courtSaveSummary,
  saveMyCourt,
  fetchPublicCourt,
  fetchCourtPickerSources,
  MAX_COURT_MEMBERS,
  type CourtMember,
} from "./royal-court";

function member(position: number, name: string): CourtMember {
  return {
    position,
    profileId: `id-${position}`,
    slug: `slug-${position}`,
    displayName: name,
    avatarUrl: null,
    profileUrl: `/artist/slug-${position}`,
    isPublic: true,
  };
}

const populated = [member(1, "First Crowned"), member(2, "Second Crowned")];

describe("courtViewState — profile render populated / empty / error", () => {
  it("populated Court renders cards for a viewer", () => {
    expect(courtViewState({ status: "ready", members: populated, isOwner: false })).toBe("cards");
  });

  it("populated Court renders cards for the owner too", () => {
    expect(courtViewState({ status: "ready", members: populated, isOwner: true })).toBe("cards");
  });

  it("empty Court is hidden from viewers — the section does not exist", () => {
    expect(courtViewState({ status: "ready", members: [], isOwner: false })).toBe("hidden");
  });

  it("empty Court shows the owner the Add your Court state", () => {
    expect(courtViewState({ status: "ready", members: [], isOwner: true })).toBe("owner-empty");
  });

  it("a failed load is an error state, never a fake empty", () => {
    expect(courtViewState({ status: "error", members: [], isOwner: false })).toBe("error");
    expect(courtViewState({ status: "error", members: [], isOwner: true })).toBe("error");
  });

  it("loading renders nothing yet, owner or not", () => {
    expect(courtViewState({ status: "loading", members: [], isOwner: true })).toBe("loading");
    expect(courtViewState({ status: "loading", members: [], isOwner: false })).toBe("loading");
  });
});

describe("picker list ops", () => {
  it("caps the Court at 8 seats", () => {
    const full = Array.from({ length: MAX_COURT_MEMBERS }, (_, i) => `id-${i}`);
    expect(canAddToCourt(full, "id-new")).toBe(false);
    expect(addToCourt(full, "id-new")).toBe(full);
  });

  it("refuses a duplicate crown", () => {
    expect(canAddToCourt(["a"], "a")).toBe(false);
    expect(addToCourt(["a"], "a")).toEqual(["a"]);
    expect(addToCourt(["a"], "b")).toEqual(["a", "b"]);
  });

  it("remove drops exactly that seat and closes the ranks", () => {
    expect(removeFromCourt(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(removeFromCourt(["a"], "zzz")).toEqual(["a"]);
  });

  it("up/down moves swap one seat; the edges are no-ops", () => {
    expect(moveInCourt(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveInCourt(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveInCourt(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveInCourt(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("save flow — driven the way the picker drives it", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs memberProfileIds in rank order and returns the server's court", async () => {
    const serverCourt = [member(1, "Crowned First"), member(2, "Crowned Second")];
    const fetchMock = vi.fn(async (_url: string, _init?: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({ saved: true, court: serverCourt }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const saved = await saveMyCourt(["id-1", "id-2"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, { method: string; body: string }];
    expect(url).toBe("/api/creator-profiles/me/court");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ memberProfileIds: ["id-1", "id-2"] });
    expect(saved).toEqual(serverCourt);
    // The confirmation reads back what the server stored, seat by seat.
    expect(courtSaveSummary(saved)).toBe("Front Row saved: #1 Crowned First · #2 Crowned Second");
  });

  it("a rejected save throws with the server's message and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: "SELF_CROWN", message: "You can't take a seat yourself — the Front Row is for your people." }),
      })),
    );
    await expect(saveMyCourt(["id-self"])).rejects.toMatchObject({
      message: "You can't take a seat yourself — the Front Row is for your people.",
      status: 400,
    });
  });

  it("fetchPublicCourt returns the API's court array untouched (rank order is the server's)", async () => {
    const court = [member(2, "Second Seat"), member(1, "First Seat")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ court, maxMembers: 8 }) })),
    );
    // Even a scrambled payload passes through as-is — the client never
    // re-ranks behind the server's back; order assertions belong to the API.
    expect(await fetchPublicCourt("some-slug")).toEqual(court);
  });

  it("an empty saved Court confirms honestly as empty", () => {
    expect(courtSaveSummary([])).toBe("Your Front Row is empty — no one has a seat right now.");
  });
});

describe("fetchCourtPickerSources — per-source settle (S27-35)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a candidates failure keeps the loaded Court", async () => {
    const court = [member(1, "First Crowned")];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("court-candidates")) throw new Error("network down");
        return { ok: true, status: 200, json: async () => ({ court }) };
      }),
    );
    const r = await fetchCourtPickerSources();
    expect(r.court).toEqual(court);
    expect(r.courtError).toBeNull();
    expect(r.candidates).toBeNull();
    expect(r.candidatesError).toBeInstanceOf(Error);
  });

  it("a Court failure is reported on its own channel while candidates load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("court-candidates")) {
          return { ok: true, status: 200, json: async () => ({ candidates: [] }) };
        }
        return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
      }),
    );
    const r = await fetchCourtPickerSources();
    expect(r.court).toBeNull();
    expect((r.courtError as { status?: number }).status).toBe(500);
    expect(r.candidates).toEqual([]);
    expect(r.candidatesError).toBeNull();
  });
});
