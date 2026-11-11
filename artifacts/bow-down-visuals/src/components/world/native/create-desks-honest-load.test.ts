/**
 * CreateDesks (the World Create station's generation desks) —
 * honest load classification (Stack-400 C-28 components residual,
 * deep-pins tranche 2). This file is a family of generation
 * desks, not a collection surface: its network life is priced
 * generation actions (confirmedFetch), task polls, and three
 * small shared rails. No fetched collection renders a list here,
 * so no load can dress up as "you have nothing here" — what the
 * standard demands is that every result state is EARNED, and the
 * file's own header law says it: "audio exists only when the
 * audio call lands; 'published' exists only when the publish call
 * answers with a track the jukebox gate accepts; every failure
 * keeps its state dark + retryable." This pin records the rails:
 *
 * - THE PUBLISH RAIL: the profile read throws on non-ok with its
 *   own message; a profile-less answer opens the in-World
 *   creation card (needsProfile) instead of faking a publish;
 *   the publish records a track ONLY from an ok response that
 *   carries a real track id — an ok without one throws.
 * - THE AUDIO LEG: running/done/failed machine; done records
 *   only from a landed response; a declined charge confirmation
 *   runs nothing and changes nothing; out-of-credits is told
 *   apart from failure.
 * - THE TASK POLLS: a done read without a URL is failed, not
 *   done; a thrown poll STOPS the poll and lands failed with a
 *   network-error line — never an endless spin, never a fake
 *   finish.
 * - THE VAULT PICKER: presets record only on ok, and the picker
 *   renders only when presets actually landed (vaults.length >
 *   0) — a failed read hides an additive nicety, claims nothing.
 * - THE DRAFT SAVER + EDITOR SEED: the saved light lights only
 *   on an ok draft POST (setSaved rides res.ok); the seed save
 *   is documented best-effort — the step-through opens either
 *   way and no saved state is claimed for it.
 *
 * NO FIX in this lane — the rails already meet the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desks = read("./CreateDesks.tsx");

const publish = desks.slice(desks.indexOf("const publish = async () => {"), desks.indexOf("const queueToJukebox = (trackId: string) => {"));
const makeAudio = desks.slice(desks.indexOf("const makeAudio = async () => {"), desks.indexOf("const publish = async () => {"));
const poll = desks.slice(desks.indexOf("const startImagePoll = (taskId: string) => {"), desks.indexOf("const pickCartoonFile = (file: File | undefined) => {"));

describe("the publish rail: published exists only when the rail proves it", () => {
  it("the profile check throws on a non-ok read with its own message", () => {
    expect(publish).toContain('const profRes = await fetch("/api/creator-profiles", { headers });');
    expect(publish).toContain('if (!profRes.ok) throw new Error(t("worldCreateDesk.publishProfileCheckFailed"));');
  });

  it("a profile-less answer opens the creation card — it never fakes a publish", () => {
    expect(publish).toContain("if (!profileId) {");
    expect(publish).toContain("setNeedsProfile(true);");
    expect(publish.indexOf("setNeedsProfile(true);")).toBeLessThan(publish.indexOf('fetch("/api/publish/track"'));
  });

  it("an ok publish without a track id still throws — the track records only from a proven id", () => {
    expect(publish).toContain('if (!res.ok) throw new Error(apiErrorMessage(json, t("worldCreateDesk.publishFailed")));');
    expect(publish).toContain("const trackId = publishedTrackIdOfResponse(json);");
    expect(publish).toContain("if (!trackId) {");
    expect(publish).toContain("setPublishedTrackId(trackId);");
    expect(publish.indexOf("if (!trackId) {")).toBeLessThan(publish.indexOf("setPublishedTrackId(trackId);"));
  });

  it("the rail's honesty law is written on it", () => {
    expect(desks).toContain('"published" exists only when the publish call answers with a');
  });
});

describe("the audio leg: done is earned, decline runs nothing", () => {
  it("the audio URL + done state record only from a landed response", () => {
    expect(makeAudio).toContain('setAudioState("running");');
    expect(makeAudio).toContain("setAudioUrl(resp.url);");
    expect(makeAudio).toContain('setAudioState("done");');
    expect(makeAudio.indexOf("setAudioUrl(resp.url);")).toBeLessThan(makeAudio.indexOf('setAudioState("done");'));
  });

  it("a declined confirmation returns before any state changes", () => {
    expect(makeAudio).toContain("if (!resp) return; // a confirmation was declined — nothing ran");
  });

  it("failure lands failed, with out-of-credits told apart", () => {
    expect(makeAudio).toContain('setAudioState("failed");');
    expect(makeAudio).toContain('msg === "out_of_credits" ? t("worldCreateDesk.audioOutOfBucs") : msg');
  });
});

describe("the task polls never fake a finish", () => {
  it("a done read without a URL is failed, not done", () => {
    expect(poll).toContain("if (read.failed || !read.url) {");
    expect(poll).toContain('setImageState("failed");');
    expect(poll).toContain("setArtistImageUrl(read.url);");
    expect(poll).toContain('setImageState("done");');
  });

  it("a thrown poll stops the poll and lands failed with a network line", () => {
    expect(poll).toContain('setImageError(t("worldCreateDesk.imageNetworkError"));');
    expect(poll).toContain("if (imagePollRef.current) clearInterval(imagePollRef.current);");
  });
});

describe("the small shared rails record only what landed", () => {
  it("vault presets record only on ok and the picker renders only with presets in hand", () => {
    expect(desks).toContain('const res = await fetch("/api/artist-vaults", { headers: await authHeaders() });');
    expect(desks).toContain("if (!res.ok) return;");
    expect(desks).toContain("setVaults(vaultsOfResponse(json));");
    expect(desks).toContain("{vaults.length > 0 ? (");
  });

  it("the draft saver's saved light lights only on an ok POST", () => {
    const saver = desks.slice(desks.indexOf("function useDraftSaver()"), desks.indexOf("/* ─── The song publish rail"));
    expect(saver).toContain("if (res.ok) setSaved(true);");
    expect(saver).toContain("/* draft save is a convenience — a failure never masks the result */");
  });
});
