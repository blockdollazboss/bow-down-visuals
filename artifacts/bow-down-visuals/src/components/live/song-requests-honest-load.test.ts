/**
 * SongRequests — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The live song-request queue polls
 * every 10 seconds while the stream is live, and its failure
 * contract is the C-30 SUSTAINED-FAILURE rule, stated in the file:
 * a blip stays silent — the next poll retries — but sustained
 * failure is an outage, not an empty queue. A consecutive-failure
 * counter raises the panel's unreachable state once it crosses
 * QUEUE_LOAD_FAILURE_LIMIT with nothing ever loaded ("the queue
 * isn't empty; it's unreachable"), and any success resets the
 * counter to zero. A loaded payload's available:false is the
 * genuine not-switched-on state — a server verdict, distinct from
 * both failure and from an open-but-empty queue.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const panel = read("./SongRequests.tsx");

describe("the queue poll counts consecutive failures — a blip is silent, an outage is loud", () => {
  it("the failure counter starts at zero and the load throws on a non-ok response", () => {
    expect(panel).toContain("const [queueLoadFailures, setQueueLoadFailures] = useState(0);");
    expect(panel).toContain('if (!res.ok) throw new Error("queue load");');
  });

  it("success records the payload and resets the counter", () => {
    expect(panel).toContain("setData(d);\n      setQueueLoadFailures(0);");
  });

  it("failure increments the counter and records nothing", () => {
    expect(panel).toContain("setQueueLoadFailures((n) => n + 1);");
  });

  it("sustained failure with nothing loaded renders the unreachable state", () => {
    expect(panel).toContain("if (!data && queueLoadFailures >= QUEUE_LOAD_FAILURE_LIMIT) {");
    expect(panel).toContain("The request queue couldn't load — we're still retrying. If it stays down, the queue isn't");
    expect(panel).toContain("empty; it's unreachable.");
  });

  it("before the limit, an unloaded panel renders nothing — the next poll is the retry", () => {
    expect(panel).toContain("if (!data) return null;");
  });
});

describe("a loaded payload's own verdicts stay distinct from failure", () => {
  it("available:false renders the not-switched-on state, reachable only behind loaded data", () => {
    expect(panel).toContain("if (!data.available) {");
    expect(panel).toContain("Song requests aren't switched on yet.");
    expect(panel.indexOf("Song requests aren't switched on yet.")).toBeGreaterThan(
      panel.indexOf("if (!data) return null;"),
    );
  });
});
