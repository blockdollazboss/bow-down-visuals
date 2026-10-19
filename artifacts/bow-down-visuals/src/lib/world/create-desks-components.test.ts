/**
 * create-desks-components — Ring 2 Lane G source-contract pins.
 * The desks' components must ride the SITE's real endpoints (the
 * 2D pages are the reference implementation) — these pins fail if
 * a bench's rail moves, if a price stops being displayed before
 * the run, or if the quest chip is rendered anywhere except from
 * the shared server-diff hook.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desks = read("../../components/world/native/CreateDesks.tsx");
const storyboard = read("../../components/world/native/StoryboardBench.tsx");
const songTabs = read("../../components/world/native/SongDeskTabs.tsx");
const thumbBenches = read("../../components/world/native/ThumbnailBenches.tsx");
const audioDesk = read("../../components/world/native/AudioDesk.tsx");
const shared = read("../../components/world/native/CreateDeskShared.tsx");

describe("2.3 storyboard bench contracts", () => {
  it("docks analysis, the audio scene flow, per-scene clips, draft autosave + project save", () => {
    expect(storyboard).toContain('fetch("/api/analyze-sections"');
    expect(storyboard).toContain("runAudioSceneFlow");
    expect(storyboard).toContain('fetch("/api/generate-runway-clip"');
    expect(storyboard).toContain('fetch("/api/drafts"');
    expect(storyboard).toContain("buildStoryboardProjectPayload");
    expect(storyboard).toContain("analyzeSectionsCost()");
    expect(storyboard).toContain("videoClipCost()");
    expect(storyboard).toContain('data-testid="world-storyboard-approve"');
  });
});

describe("2.4 song+video wizard contracts", () => {
  it("auto-transcribes on upload, applies the edit plan, saves the finished package", () => {
    expect(desks).toContain('fetch("/api/transcribe"');
    expect(desks).toContain('fetch("/api/generate/ai-edit-plan"');
    expect(desks).toContain("applyAiTransitionsToClips");
    expect(desks).toContain("buildSongVideoProjectPayload");
    expect(desks).toContain('data-testid="world-song-video-wizard"');
  });
});

describe("2.5 song desk tab contracts", () => {
  it("inspo/mashup/hum benches + vault loading + intake ride the page tabs' endpoints", () => {
    expect(songTabs).toContain('fetch("/api/song-inspo/analyze"');
    expect(songTabs).toContain('"/api/song-inspo/generate"');
    expect(songTabs).toContain('fetch("/api/song-inspo/presets"');
    expect(songTabs).toContain('fetch("/api/mashup"');
    expect(songTabs).toContain('fetch("/api/hum-to-song"');
    expect(desks).toContain('fetch("/api/artist-vaults"');
    expect(desks).toContain("withArtistVault");
    expect(desks).toContain('fetch("/api/transcribe"');
    for (const label of ["Inspo", "Mashup", "Hum to Song"]) expect(desks).toContain(label);
  });
});

describe("2.6–2.8 audio desk contracts", () => {
  it("the full bench is registry-driven and the A/B player + beat fields are docked", () => {
    expect(audioDesk).toContain("AUDIO_BENCHES");
    expect(audioDesk).toContain("interpretAudioBenchResponse");
    expect(audioDesk).toContain('data-testid="world-audio-full-bench"');
    expect(audioDesk).toContain("<ABAudioPlayer");
    expect(shared).toContain('data-testid="world-audio-ab-player"');
    expect(shared).toContain("peaksFromChannelData");
    /* 2.8: beat posts the surfaced fields, not the silent defaults */
    expect(audioDesk).toContain("bpm: beatBpm");
    expect(audioDesk).toContain("musicalKey: beatKey");
    expect(audioDesk).toContain("lengthSeconds: beatLength");
    expect(audioDesk).toContain("title: beatTitle");
  });

  it("stack-20 #11: the beat fields speak the website's ranges, and the result wears them", () => {
    /* BPM runs through the shared page clamp — the raw text-field
       math (`|| 140` with no range) is gone. */
    expect(audioDesk).toContain("setBeatBpm(beatBpmInputOf(v))");
    expect(audioDesk).not.toContain('label="BPM" value={String(beatBpm)} onChange={(v) => setBeatBpm(Number(v.replace(/[^0-9]/g, "")) || 140)}');
    /* Key + length are selects over the page's own lists, sourced
       from the shared constants — the desk's old private lists
       (18 keys incl. minors, free-text seconds) are gone. */
    expect(audioDesk).toContain("options={BEAT_KEYS.map((k) => ({ value: k, label: k }))}");
    expect(audioDesk).not.toContain('"Cm", "Dm", "Em", "Fm", "Gm", "Am"');
    expect(audioDesk).toContain("options={BEAT_LENGTHS.map((d) => ({ value: String(d.value), label: d.label }))}");
    expect(audioDesk).not.toContain('label="Length (seconds)"');
    /* The title is capped at the panel at the endpoint's max. */
    expect(audioDesk).toContain("setBeatTitle(v.slice(0, BEAT_TITLE_MAX))");
    /* The landed beat is labelled with the chosen title + numbers. */
    expect(audioDesk).toContain("beatResultTitleOf({");
    expect(audioDesk).not.toContain('isBeat ? "Your beat" : "Your sound effect"');
  });
});

describe("2.9–2.11 thumbnail + cover contracts", () => {
  it("thumbnail benches ride the studio endpoints with the overlay editor + CTR bench", () => {
    expect(thumbBenches).toContain('fetch("/api/thumbnail-generator"');
    expect(thumbBenches).toContain('fetch("/api/wave8/thumbnail-ab/variants"');
    expect(thumbBenches).toContain('fetch("/api/thumbnail-test"');
    expect(thumbBenches).toContain('data-testid="world-thumbnail-overlay-preview"');
    expect(thumbBenches).toContain('data-testid="world-thumbnail-face-upload"');
    expect(thumbBenches).toContain("ctrPredictionOfResponse");
  });

  it("cover desk carries presets, attribution, share tracking, showcase + history", () => {
    expect(desks).toContain('data-testid="world-cover-preset-grid"');
    expect(desks).toContain("COVER_ART_PRESETS");
    expect(desks).toContain('data-testid="world-cover-attribution-toggle"');
    expect(desks).toContain('fetch("/api/showcase/publish"');
    expect(desks).toContain('fetch("/api/shares"');
    expect(desks).toContain('data-testid="world-cover-history"');
  });

  it("cover history restore swaps the whole work — never another cover's motion or showcase slug", () => {
    // history entries restore through the restore handler, not a bare URL swap
    expect(desks).toContain("onClick={() => restoreCover(url)}");
    // slice the handler body and pin the resets INSIDE it
    const start = desks.indexOf("const restoreCover = (url: string) => {");
    expect(start).toBeGreaterThan(-1);
    const body = desks.slice(start, desks.indexOf("const runMotion", start));
    // restoring the cover already on the desk is a no-op (keeps its own live link)
    expect(body).toContain("if (url === coverUrl) return;");
    expect(body).toContain("setCoverUrl(url);");
    expect(body).toContain('setState("done");');
    expect(body).toContain("setError(null);");
    // the previous cover's motion video + showcase slug never follow a restore
    expect(body).toContain("setMotionUrl(null);");
    expect(body).toContain('setMotionState("idle");');
    expect(body).toContain("setShowcaseSlug(null);");
    // history growth rides the dedupe/cap seam, not an inline prepend
    expect(desks).toContain("pushCoverHistory(h, data.url!)");
  });
});

describe("2.1 + 2.2 publish rail + jukebox chip contracts (stack-20 round 2, #3/#4)", () => {
  it("both song desks publish on the site's rail, with every honest state on the card", () => {
    /* The rail: profile lookup, then the /publish page's endpoint. */
    expect(desks).toContain('fetch("/api/creator-profiles"');
    expect(desks).toContain('fetch("/api/publish/track"');
    expect(desks).toContain("buildPublishTrackPayload({");
    expect(desks).toContain("publishedTrackIdOfResponse(json)");
    /* Already published can never publish twice from the card. */
    expect(desks).toContain("if (!audioUrl || publishBusy || publishedTrackId) return;");
    /* The publish chip is offered only once real audio exists and
       retires the moment the publish lands — at BOTH song desks. */
    expect(desks.split("onPublish={rail.audioUrl && !rail.published").length - 1).toBe(2);
    expect(desks.split("jukeboxTrackId={rail.publishedTrackId}").length - 1).toBe(2);
    expect(desks.split("onJukeboxAdd={rail.queueToJukebox}").length - 1).toBe(2);
    /* Failure shows its reason on the card, never a silent dark. */
    expect(desks).toContain('data-testid="world-create-publish-error"');
    expect(shared).toContain('data-testid="world-create-chip-published"');
    expect(shared).toContain("Published — live on your profile");
    expect(shared).toContain('data-testid="world-create-chip-publish"');
    expect(shared).toContain('props.publishBusy ? "Publishing…" : "Publish to my profile"');
  });

  it("the jukebox chip is live only behind the gate; unpublished it sits dark as a span with its reason", () => {
    expect(shared).toContain("jukeboxChipStateOf({");
    expect(shared).toContain('data-testid="world-create-chip-jukebox"');
    expect(shared).toContain("onClick={() => props.onJukeboxAdd?.(trackId)}");
    /* The dark face: its own testid, the reason on its face, and —
       pinned by position — a <span>, not a <button>: it takes no
       click, so it can never be a dead one. */
    const darkAt = shared.indexOf('data-testid="world-create-chip-jukebox-dark"');
    expect(darkAt).toBeGreaterThan(-1);
    expect(shared.slice(shared.lastIndexOf("<span", darkAt), darkAt)).toContain("<span");
    expect(shared).toContain("Put it on the jukebox · publish first");
    expect(shared).toContain('aria-disabled="true"');
  });
});

describe("§5(a) quest chip contracts", () => {
  it("the chip reads server truth via the shared hook and renders only from its lines", () => {
    expect(shared).toContain('fetch("/api/retention/quests"');
    expect(shared).toContain("questAdvancesBetween");
    expect(shared).toContain('data-testid="world-create-quest-chip"');
    expect(shared).toContain("if (lines.length === 0) return null");
    for (const src of [desks, storyboard, songTabs, thumbBenches, audioDesk]) {
      expect(src).toContain("useQuestProgressChip");
    }
  });
});
