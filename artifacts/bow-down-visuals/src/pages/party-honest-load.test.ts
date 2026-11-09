/**
 * Party lobby — honest load states (Stack 400 C-28: the honest-load
 * pin layer completing the "empty lie" audit).
 *
 * loadLobby() settles the rooms / me / leaderboard fetches
 * independently (Promise.allSettled): a rooms leg that is rejected
 * or non-ok sets roomsFailed instead of an empty room list, and a
 * leaderboard leg that fails sets boardFailed instead of an empty
 * board. While a list is in flight its state is still null, which
 * renders the loading copy; the empty copy for each list renders
 * only once that list has actually loaded empty. The rooms error
 * branch carries a retry wired to loadLobby itself; the board
 * error branch is copy-only (no retry) — pinned as it is.
 *
 * This file pins that shape in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM). All copy
 * on this surface is hardcoded English in the page, so the
 * literals are pinned and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./party.tsx");
const loadAt = page.indexOf("const loadLobby = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("useEffect(() => {", loadAt));

describe("rooms — failure path: a failed rooms load never reads as no rooms", () => {
  it("the three lists settle independently and a failed rooms leg records its failed flag", () => {
    expect(loader).toContain("await Promise.allSettled([");
    expect(loader).toContain('fetch("/api/party/rooms", { headers })');
    expect(loader).toContain('if (roomsRes.status === "fulfilled" && roomsRes.value.ok) {');
    expect(loader).toContain("setRoomsFailed(true);");
  });

  it("a successful rooms load records the rooms and clears the failed flag", () => {
    expect(loader).toContain("setOpenRooms(");
    expect(loader).toContain("setRoomsFailed(false);");
  });

  it("the lists start unloaded (null), which is the loading state", () => {
    expect(page).toContain("const [openRooms, setOpenRooms] = useState<OpenRoom[] | null>(null);");
    expect(page).toContain("const [roomsFailed, setRoomsFailed] = useState(false);");
  });

  it("failure renders the error copy with a retry wired to the real loader", () => {
    expect(page).toContain('data-testid="party-rooms-error"');
    expect(page).toContain("Open rooms couldn&apos;t load just now.");
    expect(page).toContain("onClick={() => void loadLobby()}");
  });

  it("the loading and empty copy render only in order after the error branch", () => {
    const errorAt = page.indexOf('data-testid="party-rooms-error"');
    const loadingAt = page.indexOf("Looking for open rooms…");
    const emptyAt = page.indexOf("No rooms are open right now — be the first host.");
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
  });
});

describe("leaderboard — failure path: a failed board load never reads as an empty board", () => {
  it("a failed leaderboard leg records its failed flag; success records the board and clears it", () => {
    expect(loader).toContain('fetch("/api/party/leaderboard", { headers })');
    expect(loader).toContain("setBoard({ rows: data.rows ?? [], viewerRank: data.viewerRank ?? null });");
    expect(loader).toContain("setBoardFailed(false);");
    expect(loader).toContain("setBoardFailed(true);");
  });

  it("the board starts unloaded (null), which is the loading state", () => {
    expect(page).toContain("const [board, setBoard] = useState<{ rows: PartyBoardRow[]; viewerRank: number | null } | null>(null);");
    expect(page).toContain("const [boardFailed, setBoardFailed] = useState(false);");
  });

  it("the loading, error and empty copy render in that order", () => {
    const loadingAt = page.indexOf("Reading the board…");
    const errorAt = page.indexOf("The board wouldn't load just now — matches still count.");
    const emptyAt = page.indexOf("No crowns claimed yet — the first finished match writes history.");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
  });
});
