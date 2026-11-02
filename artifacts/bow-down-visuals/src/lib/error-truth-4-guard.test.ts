/**
 * error-truth-4-guard.test.ts — the error-truth guard, round 4 (stack1300).
 *
 * Rounds 1–3 (api-error-guard, error-truth-2, error-truth-3) pinned the
 * translator, the toast funnel, and failure-vs-empty separation. This round
 * censused what was left — especially newer surfaces — for the empty-lie's
 * cousin: when something fails for a member, the words they get must be
 * TRUE, plain, and useful. Three violation classes:
 *  (1) raw technical text reaching members (provider bodies, HTTP status
 *      strings, untranslated codes rendered as-is);
 *  (2) wrong blame / wrong fact ("check your connection" for a server 500,
 *      a failed claim rendered as "already claimed");
 *  (3) swallowed failures — a server rejection that produces no visible
 *      signal at all, or a local state change the server never confirmed.
 *
 * Same harness constraint as rounds 1–3 (vitest node environment, no DOM):
 * the pins assert the source shapes that produce the truthful renders.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** Slice of a source file between two markers (start inclusive). */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `start marker not found: ${start}`).toBeGreaterThan(-1);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b === -1 ? undefined : b);
}

describe("DailyBonusModal — a failed claim is not a handled claim", () => {
  const src = read("components/DailyBonusModal.tsx");
  const claim = between(src, "async function handleClaim()", "// Refresh bonus + crate status");
  const crate = between(src, "async function handleCrateClaim()", "async function handleClaim()");

  it("keeps the modal open and shows a failure line when the daily claim fails", () => {
    expect(claim).toMatch(/setClaimError\(/);
    expect(claim).not.toMatch(/setVisible\(false\)/);
  });

  it("treats the server's already-claimed answer as its own fact, not as failure or success", () => {
    expect(claim).toMatch(/reason === "already_claimed"|claimed === false/);
  });

  it("only reads the crate as taken when the server says someone took it", () => {
    expect(crate).toMatch(/already_claimed_global/);
    expect(crate).toMatch(/setCrateError\(/);
  });

  it("keeps the member's own cooldown distinct from the global take", () => {
    expect(crate).toMatch(/reason === "cooldown"/);
  });
});

describe("ExpressPayButton — the verify failure speaks through the translator", () => {
  const src = read("components/ExpressPayButton.tsx");

  it("never hands the raw server error field to the failure state", () => {
    expect(src).not.toMatch(/fail\(\s*vData\.error \?\?/);
    expect(src).toMatch(/fail\(\s*apiErrorMessage\(\s*vData/);
  });
});

describe("beats page — template delete and AI-tag apply failures are spoken", () => {
  const src = read("pages/beats.tsx");
  const apply = between(src, "async function applySuggestion()", "return (");
  const del = between(src, "async function deleteTemplate(id: string)", "const numField");

  it("applySuggestion surfaces a failure instead of just stopping the spinner", () => {
    expect(apply).toMatch(/setApplyError\(/);
    expect(apply).not.toMatch(/catch \{ \/\* ignore \*\/ \}/);
  });

  it("deleteTemplate surfaces a failure; the false reload comment is gone", () => {
    expect(src).not.toMatch(/section reload surfaces failures/);
    expect(del).toMatch(/setTplError\(|toast\(/);
  });
});

describe("World BeatsDesk — template delete failure reaches the desk's error line", () => {
  const src = read("components/world/native/BeatsDesk.tsx");
  const del = between(src, "const deleteTemplate = async", "const muted =");

  it("wires the delete failure to setTplError and drops the false reload comment", () => {
    expect(src).not.toMatch(/the reload in loadDashboard surfaces the truth/);
    expect(del).toMatch(/setTplError\(/);
  });
});

describe("branding-shop — store design actions fail out loud", () => {
  const src = read("pages/branding-shop.tsx");
  const save = between(src, "async function saveToStore", "async function updateDesign");
  const upd = between(src, "async function updateDesign", "async function deleteDesign");
  const del = between(src, "async function deleteDesign", "async function orderIntent");

  it("saveToStore reports failure instead of the silent comment", () => {
    expect(src).not.toMatch(/silent — user can retry/);
    expect(save).toMatch(/setDesignMsg\(/);
  });

  it("updateDesign reports failure (local state can otherwise diverge)", () => {
    expect(upd).toMatch(/setDesignMsg\(/);
  });

  it("deleteDesign reports failure", () => {
    expect(del).toMatch(/setDesignMsg\(/);
  });
});

describe("RoyaltyTrackerPanel — import errors lead with house words; connect failures speak", () => {
  const src = read("components/coach/RoyaltyTrackerPanel.tsx");
  const imp = between(src, "async function importCsv()", "async function connectManual");
  const conn = between(src, "async function connectManual", "async function getInsights()");

  it("importCsv composes its error through apiErrorMessage, not a raw field join", () => {
    expect(imp).toMatch(/throw new Error\(apiErrorMessage\(data/);
    expect(imp).not.toMatch(/data\.error as string\) \|\|/);
  });

  it("connectManual no longer swallows its failure", () => {
    expect(conn).not.toMatch(/catch \{\s*\/\* non-fatal \*\/\s*\}/);
    expect(conn).toMatch(/setImportMsg\(/);
  });
});

describe("LipSyncSection — no raw provider bodies, statuses, or String(err) reach the member", () => {
  const src = read("components/editor/sections/LipSyncSection.tsx");

  it("never slices a raw response body into a thrown error", () => {
    expect(src).not.toMatch(/body\.slice\(0, 200\)/);
    expect(src).not.toMatch(/Check failed: HTTP/);
    expect(src).not.toMatch(/Job polling failed: HTTP/);
  });

  it("the scene-test poll failure is a plain house sentence, rethrown by its own words", () => {
    expect(src).not.toMatch(/Poll failed: HTTP/);
    expect(src).toMatch(/startsWith\("Poll failed"\)/);
  });

  it("the check-existing-job catch never falls back to String(err)", () => {
    expect(src).not.toMatch(/plainErrorText\(err, String\(err\)\)/);
  });

  it("the provider-error rows show house words, not the raw provider string", () => {
    expect(src).not.toMatch(/value=\{cjr\.providerError\}/);
    expect(src).not.toMatch(/Provider returned failure\{cjr\.providerError \? `: \$\{cjr\.providerError\}`/);
  });

  it("the URL pre-flight lines carry no raw check error or type jargon", () => {
    expect(src).not.toMatch(/\(type: \$\{check\.audio\.sourceType\}\)/);
    expect(src).not.toMatch(/Audio URL check failed: \$\{check\.audio\.error/);
  });

  it("the account check never stores a raw non-JSON preview as the error", () => {
    expect(src).not.toMatch(/Non-JSON response: \$\{preview\}/);
  });

  it("the scene-test start fallback and the stem-upload fallback carry no HTTP status", () => {
    expect(src).not.toMatch(/Scene test route returned HTTP/);
    expect(src).not.toMatch(/Upload failed: HTTP/);
    expect(src).not.toMatch(/error: `HTTP \$\{startRes\.status\}`/);
  });
});

describe("MultiRatioExport — per-ratio and job errors are translated before render", () => {
  const src = read("components/editor/MultiRatioExport.tsx");

  it("the failed toast description goes through plainErrorText", () => {
    expect(src).toMatch(/description: plainErrorText\(next\.error/);
    expect(src).not.toMatch(/description: next\.error \?\?/);
  });

  it("the job and ratio error paragraphs go through plainErrorText", () => {
    expect(src).not.toMatch(/\{job\.error\}/);
    expect(src).not.toMatch(/\{r\.error\}/);
    expect(src).toMatch(/plainErrorText\(job\.error/);
    expect(src).toMatch(/plainErrorText\(r\.error/);
  });
});

describe("PhotoCanvasEditor — per-output failure lines are translated before render", () => {
  const src = read("components/photo/PhotoCanvasEditor.tsx");

  it("no raw server error field is interpolated into a result line", () => {
    expect(src).not.toMatch(/failed: \$\{o\.error\}/);
    expect(src).not.toMatch(/failed: \$\{r\.error\}/);
    expect(src).toMatch(/plainErrorText\(o\.error/);
    expect(src).toMatch(/plainErrorText\(r\.error/);
  });
});

describe("ReleaseDesk — serverMessage is the translator, not a raw field pick", () => {
  const src = read("components/world/native/ReleaseDesk.tsx");
  const fn = between(src, "function serverMessage", "/* ─── The wizard form");

  it("composes through apiErrorMessage so codes never render raw", () => {
    expect(fn).toMatch(/apiErrorMessage\(data, fallback\)/);
    expect(fn).not.toMatch(/d\?\.message \?\? d\?\.error \?\? fallback/);
  });
});

describe("save / attach family — the raw error field never reaches the error state", () => {
  it("make-video save", () => {
    const src = read("pages/make-video.tsx");
    expect(src).not.toMatch(/body\.error \?\? `Save failed \(HTTP/);
    expect(src).toMatch(/apiErrorMessage\(body, t\("makeVideo\.saveFailedRetry"\)\)/);
  });

  it("song-and-video save", () => {
    const src = read("pages/song-and-video.tsx");
    expect(src).not.toMatch(/body\.error \?\? t\("songAndVideo\.errorSaveHttp"/);
    expect(src).toMatch(/apiErrorMessage\(body, t\("songAndVideo\.errorSaveFailed"\)\)/);
  });

  it("my-clips attach + upload", () => {
    const src = read("pages/my-clips.tsx");
    expect(src).not.toMatch(/json\.error \?\? `Server error/);
    expect(src).not.toMatch(/apiErrorMessage\(data, `Server error/);
  });

  it("video-editor attach", () => {
    const src = read("pages/video-editor.tsx");
    expect(src).not.toMatch(/json\.error \?\? `Server error/);
    expect(src).toMatch(/apiErrorMessage\(json,/);
  });
});

describe("HTTP-status fallback family — no fallback sentence carries a status number", () => {
  const cases: Array<[string, RegExp]> = [
    ["components/GenerateArtistImageModal.tsx", /Image API error \(HTTP/],
    ["components/MusicVideoTimeline.tsx", /Scene clip error \(HTTP/],
    ["components/SceneStudio.tsx", /Scene clip error \(HTTP/],
    ["components/SceneStudio/LookRailsPanel.tsx", /AI Director error \(HTTP/],
    ["components/analytics-hub/intelligence/use-paid-call.ts", /Request failed \(\$\{res\.status\}\)/],
    ["components/editor/TimelineDock.tsx", /Upload failed \(\$\{res\.status\}\)/],
    ["components/editor/music/LipSyncStudio.tsx", /\(HTTP \$\{res\.status\}\)/],
    ["components/editor/sections/AutoAiEditSection.tsx", /apiErrorMessage\(j, `HTTP/],
    ["components/editor/sections/AutoChaptersCard.tsx", /apiErrorMessage\(err, `HTTP/],
    ["components/editor/sections/AutoClipSection.tsx", /Export failed \(HTTP/],
    ["components/editor/sections/AutoDirectorPanel.tsx", /Plan failed \(\$\{res\.status\}\)/],
    ["components/editor/sections/BrandingSection.tsx", /Upload failed \(\$\{res\.status\}\)/],
    ["components/editor/sections/ExportSection.tsx", /Upload failed \(\$\{res\.status\}\)/],
    ["components/editor/sections/CaptionsSection.tsx", /apiErrorMessage\(err, `HTTP/],
  ];
  for (const [file, bad] of cases) {
    it(file, () => {
      expect(read(file)).not.toMatch(bad);
    });
  }

  it("ExportSection audio-reach error leads with plain words, not a status", () => {
    const src = read("components/editor/sections/ExportSection.tsx");
    expect(src).not.toMatch(/setAudioReachError\(`HTTP \$\{r\.status\}/);
  });

  it("still-to-lipsync keeps its honest money words but drops the statuses", () => {
    const src = read("components/editor/music/still-to-lipsync.ts");
    expect(src).not.toMatch(/\(HTTP \$\{/);
    expect(src).toMatch(/no Visual Bucs were charged/);
    expect(src).toMatch(/The animated clip above is yours to keep/);
  });

  it("GroupProfileSettings' api() throws through the translator", () => {
    const src = read("components/GroupProfileSettings.tsx");
    expect(src).not.toMatch(/`Request failed \(\$\{res\.status\}\)`/);
    expect(src).toMatch(/throw new Error\(apiErrorMessage\(data,/);
  });
});

describe("wrong blame — a server failure is never the member's connection", () => {
  it("ClipGeneratorSection timeline save + enhancement", () => {
    const src = read("components/editor/sections/ClipGeneratorSection.tsx");
    expect(src).not.toMatch(/Timeline save failed — check your connection/);
    expect(src).not.toMatch(/Enhancement failed\. Check your connection/);
  });

  it("LipSyncStudio poll timeout says the job may still be running, not 'check your connection'", () => {
    const src = read("components/editor/music/LipSyncStudio.tsx");
    expect(src).not.toMatch(/Timed out\. Check your connection/);
    expect(src).toMatch(/may still be running/);
  });
});

describe("wrong-fact deletes — local removal waits for the server's yes", () => {
  it("artist-vault deleteVault gates the local removal on res.ok and speaks on failure", () => {
    const src = read("pages/artist-vault.tsx");
    const del = between(src, "async function deleteVault(id: string)", "async function shareVault");
    expect(del).toMatch(/if \(!res\.ok\)/);
    expect(del).toMatch(/setApiError\(/);
  });

  it("artist-vault shareVault translates the failure and speaks on network failure too", () => {
    const src = read("pages/artist-vault.tsx");
    const share = between(src, "async function shareVault(id: string)", "return (");
    expect(src).not.toMatch(/alert\(d\.error \|\|/);
    expect(share).toMatch(/apiErrorMessage\(d, t\("artistVault\.shareUpdateFailed"\)\)/);
    expect(share).toMatch(/setApiError\(/);
  });

  it("PostCard delete only fires onDeleted when the server agreed", () => {
    const src = read("components/social/PostCard.tsx");
    const del = between(src, "async function del()", "async function share()");
    expect(del).toMatch(/res\.ok/);
    expect(del).toMatch(/setDeleteError\(|setShareMsg\(/);
  });

  it("SongStructureBuilder deleteSaved gates the local removal on res.ok", () => {
    const src = read("components/editor/music/SongStructureBuilder.tsx");
    const del = between(src, "async function deleteSaved(id: string)", "function loadIntoBuilder");
    expect(del).toMatch(/res\.ok/);
    expect(del).not.toMatch(/catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("RemixChain remove gates the local removal on res.ok", () => {
    const src = read("components/songs/RemixChain.tsx");
    const rem = between(src, "async function remove(id: string)", "/* Handoff:");
    expect(rem).toMatch(/res\.ok/);
    expect(rem).not.toMatch(/catch \{\s*\/\* non-fatal \*\/\s*\}/);
  });
});

describe("silent row actions — a rejected action always leaves a word behind", () => {
  it("SyncTab sheet/brief deletes and pitch-status updates reach the error line", () => {
    const src = read("components/sync-pitch/SyncTab.tsx");
    for (const fn of ["async function deleteSheet", "async function deleteBrief", "async function updatePitchStatus"]) {
      const body = between(src, fn, "async function");
      expect(body, fn).toMatch(/setError\(/);
      expect(body, fn).not.toMatch(/catch \{ \/\* non-fatal \*\/ \}/);
    }
  });

  it("label-pitch deadline/pitch actions reach an error line", () => {
    const src = read("pages/label-pitch.tsx");
    for (const fn of ["async function updateDeadlineStatus", "async function deleteDeadline", "async function updatePitchStatus", "async function deletePitch"]) {
      const body = between(src, fn, "async function");
      expect(body, fn).toMatch(/setError\(|toast\(/);
      expect(body, fn).not.toMatch(/catch \{ \/\* non-fatal \*\/ \}/);
    }
  });

  it("ContentIdMonitor status cycle + removal reach detError", () => {
    const src = read("components/analytics-hub/ContentIdMonitor.tsx");
    const cyc = between(src, "async function cycleDetectionStatus", "async function removeDetection");
    const rem = between(src, "async function removeDetection", "/* Revenue attribution");
    expect(cyc).toMatch(/setDetError\(/);
    expect(rem).toMatch(/setDetError\(/);
  });

  it("LutImportSection saved-LUT delete speaks on failure", () => {
    const src = read("components/editor/sections/LutImportSection.tsx");
    const del = between(src, "async function handleDeleteSaved", "/* ── Build the multipart payload");
    expect(del).toMatch(/toast\(/);
    expect(del).not.toMatch(/catch \{ \/\* non-fatal \*\/ \}/);
  });

  it("press-kit kit delete speaks on failure", () => {
    const src = read("pages/press-kit.tsx");
    const del = between(src, "async function handleDelete()", "function copyLink()");
    expect(del).toMatch(/setError\(|toast\(/);
    expect(del).not.toMatch(/if \(!res\.ok\) return;/);
  });

  it("PressReleasePanel release delete speaks on failure", () => {
    const src = read("components/PressReleasePanel.tsx");
    const del = between(src, "async function handleDeleteRelease", "return (");
    expect(del).toMatch(/setError\(/);
    expect(del).not.toMatch(/if \(!res\.ok\) return;/);
  });
});

describe("choose-artist — a failed spotlight reorder rolls back and says so", () => {
  const src = read("pages/choose-artist.tsx");
  const move = between(src, "async function moveToSlot", "useEffect(() => {");

  it("checks the response and restores the prior order on failure", () => {
    expect(move).toMatch(/res\.ok/);
    expect(move).toMatch(/setVaults\(prevVaults\)|setVaults\(before\)|setVaults\(snapshot\)/);
    expect(src).not.toMatch(/order still applies locally; syncs next load/);
  });
});
