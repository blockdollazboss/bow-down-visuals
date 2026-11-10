/**
 * TrophyShelf — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The public creator profile's
 * trophy shelf merges THREE independent sources (milestone
 * achievements, challenge wins, arcade/party game stats), each with
 * its own failed flag, under a rule the file states outright: a
 * failed source is NOT an empty shelf.
 *
 * - Each list source records its data only on an ok response; a
 *   non-ok response or a throw empties that source AND raises its
 *   flag; a success clears the flag.
 * - Game stats carry the documented nuance: a non-ok there can be
 *   the creator's legitimate leaderboard opt-out hide, so only a
 *   5xx (or a throw) raises its flag — a 4xx hide is absence, not
 *   failure.
 * - When everything is empty AND at least one source failed, the
 *   shelf renders its error+retry block (data-testid
 *   "trophy-shelf-error") instead of vanishing; the retry nonce
 *   re-runs all three loads. Genuinely-empty (all sources loaded,
 *   nothing earned) stays hidden BY DESIGN — a public shelf with
 *   no trophies shows nothing, and never an error it didn't earn.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const shelf = read("./TrophyShelf.tsx");

describe("each source owns its failed flag", () => {
  it("the three sources start unloaded with per-source flags down", () => {
    expect(shelf).toContain("const [failed, setFailed] = useState({ achievements: false, wins: false, games: false });");
    expect(shelf).toContain("const [achievements, setAchievements] = useState<MilestoneAchievement[] | null>(null);");
  });

  it("a failed achievements load empties the source AND raises its flag", () => {
    expect(shelf).toContain("if (!cancelled) { setAchievements([]); setFailed((f) => ({ ...f, achievements: true })); }");
    expect(shelf).toContain("if (!cancelled) { setAchievements(data.achievements ?? []); setFailed((f) => ({ ...f, achievements: false })); }");
  });

  it("a failed wins load does the same for its own flag", () => {
    expect(shelf).toContain("if (!cancelled) { setWins([]); setFailed((f) => ({ ...f, wins: true })); }");
    expect(shelf).toContain("if (!cancelled) { setWins(data.wins ?? []); setFailed((f) => ({ ...f, wins: false })); }");
  });

  it("game stats flag failure only on a 5xx or a throw — a 4xx hide is a legitimate opt-out", () => {
    expect(shelf).toContain("if (res.status >= 500) setFailed((f) => ({ ...f, games: true }));");
    expect(shelf).toContain("if (!cancelled) { setGameStats(null); setFailed((f) => ({ ...f, games: true })); }");
  });
});

describe("empty-from-failure renders the error; genuine empty stays hidden", () => {
  it("the file states the rule outright", () => {
    expect(shelf).toContain("a failed source is NOT an empty shelf");
  });

  it("when all sources are empty and any failed, the error+retry block renders", () => {
    expect(shelf).toContain("if (failed.achievements || failed.wins || failed.games) {");
    expect(shelf).toContain('data-testid="trophy-shelf-error"');
    expect(shelf).toContain("couldn&apos;t load just now.");
  });

  it("the retry re-runs all three loads through the effect's nonce dep", () => {
    expect(shelf).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(shelf).toContain("}, [slug, retryNonce]);");
  });

  it("genuinely empty (loaded, nothing earned, no failure) renders nothing by design", () => {
    expect(shelf).toContain("silently falsifying the public record. Genuinely-empty stays");
  });
});
