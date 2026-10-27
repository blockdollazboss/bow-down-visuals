/**
 * auto-highlights.test.ts — UPGRADE delta #172: best-3 proposals from
 * the stream's OWN signals. Pins: bucket scoring from chat/tips/
 * viewer samples; picks never overlap and never come from a silent
 * bucket; the reason string is rendered from the numbers; generation
 * is gated on the creator's on/off and is exactly-once per window;
 * approve starts the cut through the rail seam and only for the
 * owner; a finished cut settles the proposal to 'posted', a failed
 * one returns it to 'proposed'.
 */
import { describe, expect, it } from "vitest";
import {
  bucketizeSignals,
  decideHighlightProposal,
  generateHighlightProposals,
  pickHighlightCandidates,
  refreshHighlightProposal,
  ProposalError,
  type AutoHighlightsStore,
  type HighlightCutRail,
  type ProposalDraft,
  type StreamSignals,
} from "../auto-highlights";
import type { StreamHighlightProposal } from "@workspace/db";

const STREAM_ID = "33333333-3333-4333-8333-333333333333";
const CREATOR = "99999999-9999-4999-8999-999999999999";
const OTHER = "11111111-1111-4111-8111-111111111111";

function signals(over: Partial<StreamSignals> = {}): StreamSignals {
  return { durationSec: 600, chatAtSec: [], tips: [], viewerSamples: [], ...over };
}

describe("signal math", () => {
  it("buckets chat, tips, and viewer peaks by 30s", () => {
    const buckets = bucketizeSignals(
      signals({
        chatAtSec: [10, 12, 14, 200],
        tips: [{ atSec: 15, amountVb: 500 }],
        viewerSamples: [
          { atSec: 11, count: 40 },
          { atSec: 20, count: 55 },
        ],
      }),
    );
    expect(buckets[0]).toMatchObject({ chatCount: 3, tipVb: 500, tipCount: 1, viewerPeak: 55 });
    expect(buckets[0]!.score).toBe(3 * 10 + 500 + 55);
    expect(buckets[6]).toMatchObject({ chatCount: 1 });
  });

  it("picks the best 3 windows without overlaps, honestly titled", () => {
    const picks = pickHighlightCandidates(
      signals({
        chatAtSec: [...Array(20)].map((_, i) => 300 + i), // chat storm at 5:00
        tips: [{ atSec: 60, amountVb: 1000 }], // big tip at 1:00
        viewerSamples: [{ atSec: 500, count: 300 }], // crowd peak at 8:20
      }),
    );
    expect(picks).toHaveLength(3);
    const windows = picks.map((p) => [p.startSec, p.endSec] as const);
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        const a = windows[i]!;
        const b = windows[j]!;
        expect(a[0] >= b[1] || b[0] >= a[1]).toBe(true);
      }
    }
    const tipPick = picks.find((p) => p.signals.tipVb === 1000);
    expect(tipPick?.title).toContain("Big tip moment");
    expect(tipPick?.reason).toContain("a 1000 VB tip");
    const chatPick = picks.find((p) => p.signals.chatPeak === 20);
    expect(chatPick?.reason).toContain("chat spike (20 messages in 30s)");
  });

  it("a silent stream gets no proposals — quiet is not a highlight", () => {
    expect(pickHighlightCandidates(signals())).toEqual([]);
    expect(pickHighlightCandidates(signals({ durationSec: 0 }))).toEqual([]);
  });

  it("clip windows clamp to the recording", () => {
    const picks = pickHighlightCandidates(
      signals({ durationSec: 50, chatAtSec: [1, 2, 3, 4, 5, 6] }),
    );
    expect(picks).toHaveLength(1);
    expect(picks[0]!.startSec).toBe(0);
    expect(picks[0]!.endSec).toBeLessThanOrEqual(50);
  });
});

/* ── orchestration against a memory store + fake rail ────────────────── */

function proposalRow(over: Partial<StreamHighlightProposal> = {}): StreamHighlightProposal {
  return {
    id: "prop-1",
    stream_id: STREAM_ID,
    creator_user_id: CREATOR,
    start_sec: 60,
    end_sec: 105,
    title: "Big tip moment — 01:00",
    reason: "House pick from a 1000 VB tip",
    signals: { chatPeak: 0, tipVb: 1000, viewerPeak: 0 },
    score: 1000,
    status: "proposed",
    cut_job_id: null,
    output_ref: null,
    output_url: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  } as StreamHighlightProposal;
}

function memoryStore() {
  const proposals = new Map<string, StreamHighlightProposal>();
  const insertedKeys = new Set<string>();
  let seq = 0;
  const store: AutoHighlightsStore = {
    async signalsFor() {
      return signals({
        chatAtSec: [...Array(20)].map((_, i) => 300 + i),
        tips: [{ atSec: 60, amountVb: 1000 }],
        viewerSamples: [{ atSec: 500, count: 300 }],
      });
    },
    async insertProposal(draft: ProposalDraft) {
      const key = `${draft.stream_id}:${draft.start_sec}`;
      if (insertedKeys.has(key)) return false;
      insertedKeys.add(key);
      seq += 1;
      proposals.set(`prop-${seq}`, proposalRow({
        id: `prop-${seq}`,
        stream_id: draft.stream_id,
        creator_user_id: draft.creator_user_id,
        start_sec: draft.start_sec,
        end_sec: draft.end_sec,
        title: draft.title,
        reason: draft.reason,
        signals: draft.signals,
        score: draft.score,
      }));
      return true;
    },
    async listProposals(streamId) {
      return [...proposals.values()].filter((p) => p.stream_id === streamId);
    },
    async getProposal(id) {
      return proposals.get(id) ?? null;
    },
    async updateProposal(id, patch) {
      const row = proposals.get(id);
      if (row) Object.assign(row, patch);
    },
    async streamVodUrl() {
      return "https://cdn.example/creator/live/stream.mp4";
    },
  };
  return { store, proposals };
}

const streamRow = {
  id: STREAM_ID,
  user_id: CREATOR,
  started_at: new Date("2026-10-27T10:00:00Z"),
  ended_at: new Date("2026-10-27T10:10:00Z"),
};

describe("generation", () => {
  it("proposes the best 3 and is exactly-once across re-runs", async () => {
    const { store } = memoryStore();
    const prefsOn = async () => ({ auto_highlights_enabled: true });
    expect(await generateHighlightProposals(store, streamRow, prefsOn)).toBe(3);
    expect(await generateHighlightProposals(store, streamRow, prefsOn)).toBe(0);
    expect(await store.listProposals(STREAM_ID)).toHaveLength(3);
  });

  it("the creator's off switch means no proposals, ever", async () => {
    const { store } = memoryStore();
    const prefsOff = async () => ({ auto_highlights_enabled: false });
    expect(await generateHighlightProposals(store, streamRow, prefsOff)).toBe(0);
    expect(await store.listProposals(STREAM_ID)).toHaveLength(0);
  });

  it("a stream without a full timeline generates nothing", async () => {
    const { store } = memoryStore();
    const prefsOn = async () => ({ auto_highlights_enabled: true });
    expect(
      await generateHighlightProposals(store, { ...streamRow, ended_at: null }, prefsOn),
    ).toBe(0);
  });
});

describe("decisions", () => {
  function fakeRail() {
    const cuts: Array<{ status: "queued" | "processing" | "done" | "failed" }> = [];
    const rail: HighlightCutRail = {
      async startCut() {
        cuts.push({ status: "processing" });
        return { jobId: `job-${cuts.length}` };
      },
      getCut(jobId) {
        const idx = Number(jobId.split("-")[1]) - 1;
        const cut = cuts[idx];
        if (!cut) return null;
        return {
          status: cut.status,
          outputUrl: cut.status === "done" ? "https://cdn.example/clip.mp4" : null,
          outputRef: cut.status === "done" ? "supabase://clips/clip.mp4" : null,
        };
      },
    };
    return { rail, cuts };
  }

  it("approve starts the cut and records the job; only the owner may decide", async () => {
    const { store, proposals } = memoryStore();
    proposals.set("prop-1", proposalRow());
    const { rail } = fakeRail();
    const decided = await decideHighlightProposal(store, rail, CREATOR, "prop-1", "approved");
    expect(decided.status).toBe("approved");
    expect(decided.cut_job_id).toBe("job-1");
    await expect(
      decideHighlightProposal(store, rail, OTHER, "prop-1", "dismissed"),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      decideHighlightProposal(store, rail, CREATOR, "prop-1", "dismissed"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("dismiss closes a proposed draft", async () => {
    const { store, proposals } = memoryStore();
    proposals.set("prop-1", proposalRow());
    const { rail } = fakeRail();
    const decided = await decideHighlightProposal(store, rail, CREATOR, "prop-1", "dismissed");
    expect(decided.status).toBe("dismissed");
  });

  it("a finished cut settles to posted; a failed cut returns to proposed", async () => {
    const { store, proposals } = memoryStore();
    proposals.set("prop-1", proposalRow({ status: "approved", cut_job_id: "job-1" }));
    const { rail, cuts } = fakeRail();
    cuts.push({ status: "done" });
    const settled = await refreshHighlightProposal(store, rail, CREATOR, "prop-1");
    expect(settled.status).toBe("posted");
    expect(settled.output_url).toBe("https://cdn.example/clip.mp4");

    proposals.set("prop-2", proposalRow({ id: "prop-2", status: "approved", cut_job_id: "job-2" }));
    cuts.push({ status: "failed" });
    const retried = await refreshHighlightProposal(store, rail, CREATOR, "prop-2");
    expect(retried.status).toBe("proposed");
    expect(retried.cut_job_id).toBeNull();
  });

  it("missing proposals 404 as a ProposalError", async () => {
    const { store } = memoryStore();
    const { rail } = fakeRail();
    await expect(
      decideHighlightProposal(store, rail, CREATOR, "nope", "approved"),
    ).rejects.toBeInstanceOf(ProposalError);
  });
});
