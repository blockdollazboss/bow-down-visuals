import { describe, expect, it } from "vitest";
import {
  runStillToLipSync,
  StillToLipSyncError,
  type StillToLipSyncPhase,
} from "./still-to-lipsync";

/**
 * Stack-100 #3 W3 Lane 7 — still → clip → lip-sync orchestration.
 *
 * The helper rides two existing charged rails; these tests pin the
 * wiring with a fake fetch (no real provider, no real charge):
 *  - the animation submit is image-to-video on /generate-runway-clip
 *    with the still as referenceImageUrl;
 *  - lip-sync receives EXACTLY the clip URL the animation produced,
 *    the user's audio, and a 0 → clip-duration window;
 *  - when the animation fails, /lip-sync/preview is NEVER called (so
 *    no lip-sync charge can land, and the rail itself charges nothing
 *    for a failed animation);
 *  - cancelling the credit confirmation at either charged POST stops
 *    the flow before that step runs;
 *  - phases report honestly (animating → clip-ready → syncing → done).
 */

const IMAGE = "https://cdn.test/artist.jpg";
const AUDIO = "https://cdn.test/song.mp3";
const CLIP = "https://cdn.test/clips/animated.mp4";

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(script: {
  clipPolls?: Array<Record<string, unknown>>;
  lipPolls?: Array<Record<string, unknown>>;
  submitStatus?: number;
  lipStatus?: number;
}) {
  const calls: Call[] = [];
  let clipPollIdx = 0;
  let lipPollIdx = 0;
  const clipPolls = script.clipPolls ?? [
    { status: "succeeded", url: CLIP, storageRef: "supabase://generated-clips/clips/animated.mp4" },
  ];
  const lipPolls = script.lipPolls ?? [
    { status: "done", url: "https://cdn.test/lipsynced.mp4", provider: "sync" },
  ];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url === "/api/generate-runway-clip") {
      if ((script.submitStatus ?? 200) !== 200) {
        return jsonRes({ error: "provider down" }, script.submitStatus);
      }
      return jsonRes({ taskId: "task-1", durationSec: 5, creditCost: 400 });
    }
    if (url.startsWith("/api/generate-runway-clip/")) {
      return jsonRes(clipPolls[Math.min(clipPollIdx++, clipPolls.length - 1)]);
    }
    if (url === "/api/lip-sync/preview") {
      if ((script.lipStatus ?? 200) !== 200) {
        return jsonRes({ error: "out_of_credits" }, script.lipStatus);
      }
      return jsonRes({ jobId: "job-1", status: "queued" });
    }
    if (url.startsWith("/api/lip-sync/job/")) {
      return jsonRes(lipPolls[Math.min(lipPollIdx++, lipPolls.length - 1)]);
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { calls, fetchImpl };
}

const baseInput = {
  imageUrl: IMAGE,
  audioUrl: AUDIO,
  projectId: "proj-1",
  artistVaultId: "123e4567-e89b-12d3-a456-426614174000",
  getAccessToken: async () => "tok",
  sleep: async () => {},
  clipPollIntervalMs: 0,
  lipSyncPollIntervalMs: 0,
};

describe("runStillToLipSync", () => {
  it("animates the still image-to-video, then lip-syncs the produced clip with the user's audio", async () => {
    const { calls, fetchImpl } = makeFetch({});
    const phases: StillToLipSyncPhase[] = [];
    const result = await runStillToLipSync({
      ...baseInput,
      fetchImpl,
      onPhase: (p) => phases.push(p),
    });

    /* Step 1 submit: image-to-video with the still as the reference. */
    const submit = calls.find((c) => c.url === "/api/generate-runway-clip" && c.method === "POST");
    expect(submit).toBeTruthy();
    expect(submit!.body).toMatchObject({
      referenceImageUrl: IMAGE,
      model: "gen4.5",
      projectId: "proj-1",
    });
    expect(submit!.body!.promptText).toBeTruthy();

    /* Step 2: lip-sync receives the produced clip — not the still, not
       any other URL — plus the user's audio and the full-clip window. */
    const lip = calls.find((c) => c.url === "/api/lip-sync/preview");
    expect(lip).toBeTruthy();
    expect(lip!.body).toMatchObject({
      clipUrl: CLIP,
      audioUrl: AUDIO,
      sceneStartSec: 0,
      sceneEndSec: 5,
      projectId: "proj-1",
      artistVaultId: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.clipUrl).toBe(CLIP);
    expect(result.clipStorageRef).toContain("animated.mp4");
    expect(result.lipSyncJobId).toBe("job-1");
    expect(result.lipSyncUrl).toBe("https://cdn.test/lipsynced.mp4");
    expect(result.lipSyncStillProcessing).toBe(false);
    expect(phases).toEqual(["animating", "clip-ready", "syncing", "done"]);
  });

  it("animation failure: lip-sync is never called, so no second charge can land", async () => {
    const { calls, fetchImpl } = makeFetch({
      clipPolls: [{ status: "failed", error: "Runway rejected the reference photo (content moderation)." }],
    });
    await expect(runStillToLipSync({ ...baseInput, fetchImpl })).rejects.toMatchObject({
      name: "StillToLipSyncError",
      step: "animate",
    });
    expect(calls.some((c) => c.url === "/api/lip-sync/preview")).toBe(false);
    expect(calls.some((c) => c.url.startsWith("/api/lip-sync/"))).toBe(false);
  });

  it("animation submit failure stops before any poll or lip-sync call", async () => {
    const { calls, fetchImpl } = makeFetch({ submitStatus: 500 });
    const err = await runStillToLipSync({ ...baseInput, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(StillToLipSyncError);
    expect((err as StillToLipSyncError).step).toBe("animate");
    expect(calls).toHaveLength(1);
  });

  it("cancelling the credit confirmation at the animation step submits nothing further", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return null; // confirmedFetch returns null on user cancel
    };
    const err = await runStillToLipSync({ ...baseInput, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(StillToLipSyncError);
    expect(calls).toEqual(["/api/generate-runway-clip"]);
  });

  it("lip-sync failure keeps the produced clip in the error for an honest retry", async () => {
    const { fetchImpl } = makeFetch({ lipStatus: 402 });
    const err = await runStillToLipSync({ ...baseInput, fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(StillToLipSyncError);
    expect((err as StillToLipSyncError).step).toBe("lip-sync");
    expect((err as StillToLipSyncError).clipUrl).toBe(CLIP);
  });

  it("a still-processing lip-sync job is reported as still running, not failed", async () => {
    const { fetchImpl } = makeFetch({
      lipPolls: [{ status: "processing", code: "still_processing", error: "Still processing on Sync.so." }],
    });
    const result = await runStillToLipSync({ ...baseInput, fetchImpl });
    expect(result.lipSyncUrl).toBeNull();
    expect(result.lipSyncStillProcessing).toBe(true);
    expect(result.lipSyncJobId).toBe("job-1");
  });

  it("refuses a non-https still before any fetch (the rail cannot use it)", async () => {
    const { calls, fetchImpl } = makeFetch({});
    await expect(
      runStillToLipSync({ ...baseInput, imageUrl: "blob:http://x", fetchImpl }),
    ).rejects.toMatchObject({ step: "animate" });
    expect(calls).toHaveLength(0);
  });
});
