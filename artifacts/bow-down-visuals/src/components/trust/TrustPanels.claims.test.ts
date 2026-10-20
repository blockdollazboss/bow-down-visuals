/**
 * ClaimsPanel (TrustPanels.tsx) — the Content ID claim management surface.
 *
 * Ring 4 proof-close pins: the surface already existed end to end —
 * GET /api/content-id/claims renders the symmetric match record (a
 * fingerprint match IS the claim), and the action buttons mirror the
 * server state machine exactly, per viewer role and claim state:
 *   uploader + pending            → Dispute (with note)
 *   owner    + pending            → Accept match
 *   owner    + disputed/accepted  → Resolve with note
 *   resolved                      → no actions (terminal, read-only)
 * These pins keep that wiring from silently regressing — a button
 * offered in a state the server would 409, or an action lost from the
 * panel, fails here first. The server contract itself is pinned over
 * HTTP in the api-server's trust.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const panelsSrc = read("./TrustPanels.tsx");
const hubSrc = read("../../pages/analytics-hub.tsx");

// Slice out just the ClaimsPanel component so pins can't be satisfied
// by a sibling panel's strings.
const start = panelsSrc.indexOf("export function ClaimsPanel");
const end = panelsSrc.indexOf("\nexport function", start + 1);
const claimsPanel = panelsSrc.slice(start, end === -1 ? undefined : end);

describe("ClaimsPanel — the claim management surface", () => {
  it("is the Matches & claims panel, mounted in the Content ID tab beside the monitor", () => {
    expect(start).toBeGreaterThan(-1);
    expect(claimsPanel).toContain("Matches &amp; claims");
    expect(hubSrc).toContain('hubTab === "contentid"');
    expect(hubSrc).toContain("<ContentIdMonitor />");
    expect(hubSrc).toContain("<ClaimsPanel />");
  });

  it("loads the caller's claims and acts through the one claim rail", () => {
    expect(claimsPanel).toContain('api(t, "GET", "/api/content-id/claims")');
    expect(claimsPanel).toContain('api(t, "PATCH", `/api/content-id/claims/${id}`');
    expect(claimsPanel).toContain('note: notes[id] ?? ""');
    // The panel never touches the YouTube partner claim endpoint (that
    // rail lives in ContentIdMonitor and honestly 409s — no CMS partner).
    expect(claimsPanel).not.toContain("/api/content-id/claim/");
  });

  it("shows the symmetric record: role, status, and the evidence both sides see", () => {
    expect(claimsPanel).toContain("you are the {c.youAre}");
    expect(claimsPanel).toContain("{c.status}");
    expect(claimsPanel).toContain("Matched at {c.offsetSeconds}s");
    expect(claimsPanel).toContain("confidence {c.confidence}");
    expect(claimsPanel).toContain("{c.matchedLandmarks} of {c.totalLandmarks} landmarks");
    expect(claimsPanel).toContain("Dispute: {c.disputeNote}");
    expect(claimsPanel).toContain("Resolution: {c.resolutionNote}");
  });

  it("offers exactly the moves the server state machine allows, per role and state", () => {
    // Uploader, pending → dispute.
    expect(claimsPanel).toContain('c.youAre === "uploader" && c.status === "pending"');
    expect(claimsPanel).toContain('act(c.id, "dispute")');
    expect(claimsPanel).toContain(">Dispute</button>");
    // Owner, pending → accept.
    expect(claimsPanel).toContain('c.youAre === "owner" && c.status === "pending"');
    expect(claimsPanel).toContain('act(c.id, "accept")');
    expect(claimsPanel).toContain("Accept match");
    // Owner, disputed or accepted → resolve (note required server-side).
    expect(claimsPanel).toContain('c.youAre === "owner" && (c.status === "disputed" || c.status === "accepted")');
    expect(claimsPanel).toContain('act(c.id, "resolve")');
    expect(claimsPanel).toContain("Resolve with note");
    expect(claimsPanel).toContain("Note (required to resolve; recorded for review)");
    // Resolved is terminal: the whole action row is gated off.
    expect(claimsPanel).toContain('c.status !== "resolved"');
  });

  it("states the money honesty up front and never fakes an empty state as data", () => {
    expect(claimsPanel).toContain("moves no money until it");
    expect(claimsPanel).toContain("every resolution records its reason");
    expect(claimsPanel).toContain("No matches recorded yet.");
  });

  it("a failed load says so with a retry — it never renders as an empty list", () => {
    // The catch records the failure; it must not settle the claims
    // state to an empty array (that rendered "No matches recorded
    // yet." for a load that never happened).
    expect(claimsPanel).toContain("catch { setLoadFailed(true); }");
    expect(claimsPanel).not.toContain("catch { setClaims([]); }");
    expect(claimsPanel).toContain("Couldn't load your matches");
    expect(claimsPanel).toContain("onClick={() => void load()}>Retry</button>");
    // The empty state only renders when the load did not fail.
    expect(claimsPanel).toContain("loadFailed ? (");
  });
});
