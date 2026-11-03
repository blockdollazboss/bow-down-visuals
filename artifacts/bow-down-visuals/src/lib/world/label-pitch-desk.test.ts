import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  LABEL_PITCH_KIT_COST_VISUAL_BUCS,
  LABEL_PITCH_KIT_PATH,
  LABEL_PITCH_LABELS_PATH,
  LABEL_PITCH_STATUSES,
  LABEL_PITCH_TRACKER_PATH,
  PLAYLIST_DEADLINE_STATUSES,
  PLAYLIST_PITCH_KIT_COST_VISUAL_BUCS,
  PLAYLIST_PITCH_KIT_PATH,
  PLAYLIST_PITCH_STATUSES,
  buildDeadlinePayload,
  buildLabelKitPayload,
  buildLabelSubmissionPayload,
  buildPlaylistKitPayload,
  buildPlaylistPitchPayload,
  deadlineReady,
  labelKitReady,
  labelPitchLabelsPath,
  labelPitchTrackerItemPath,
  labelSubmissionReady,
  packetAsText,
  packetMissingLabel,
  parseCuratorDirectory,
  parseDeadlineBoard,
  parseLabelDirectory,
  parseLabelKit,
  parseLabelSubmissionAnswer,
  parseLabelTracker,
  parseLibrarySongs,
  parsePitchPacket,
  parsePitchReleases,
  parsePlaylistKit,
  parsePlaylistPitchAnswer,
  parsePlaylistTracker,
  playlistKitReady,
  playlistPitchCuratorsPath,
  playlistPitchDeadlineItemPath,
  playlistPitchPacketPath,
  playlistPitchReady,
  playlistPitchTrackerItemPath,
} from "./label-pitch-desk";

/* ─── Label Pitch desk seam (stack1400 world parity, wave #1 item 2) ──
   The Promote Room's pitch desk rides the 2D pages' own rails. These
   tests pin the seam: the paths are the page's endpoints, the kit
   costs are the SERVER constants' own defaults (read from the route
   files, never re-typed from memory), the payload builders carry the
   page's field names trimmed the page's way, and every parser maps
   its rail's answer field-for-field — with a broken or incomplete
   answer reading as a failed read (null), never a painted-over kit,
   directory, tracker or packet. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("rails + prices", () => {
  it("the paths are the label-pitch page's own endpoints", () => {
    expect(LABEL_PITCH_KIT_PATH).toBe("/api/label-pitch/kit");
    expect(LABEL_PITCH_LABELS_PATH).toBe("/api/label-pitch/labels");
    expect(LABEL_PITCH_TRACKER_PATH).toBe("/api/label-pitch/tracker");
    expect(PLAYLIST_PITCH_KIT_PATH).toBe("/api/playlist-pitch/kit");
    expect(labelPitchLabelsPath("hip-hop", "major")).toBe(
      "/api/label-pitch/labels?genre=hip-hop&type=major",
    );
    expect(playlistPitchCuratorsPath("r&b")).toBe("/api/playlist-pitch/curators?genre=r%26b");
    expect(playlistPitchPacketPath("rel 1")).toBe("/api/playlist-pitch/packet/rel%201");
    expect(labelPitchTrackerItemPath("a/b")).toBe("/api/label-pitch/tracker/a%2Fb");
    expect(playlistPitchTrackerItemPath("p1")).toBe("/api/playlist-pitch/tracker/p1");
    expect(playlistPitchDeadlineItemPath("d1")).toBe("/api/playlist-pitch/deadlines/d1");
    const page = read("../../pages/label-pitch.tsx");
    for (const p of [
      "/api/label-pitch/kit", "/api/label-pitch/labels", "/api/label-pitch/tracker",
      "/api/playlist-pitch/kit", "/api/playlist-pitch/curators", "/api/playlist-pitch/tracker",
      "/api/playlist-pitch/releases", "/api/playlist-pitch/packet/", "/api/playlist-pitch/deadlines",
      "/api/songs",
    ]) {
      expect(page, p).toContain(p);
    }
  });

  it("the kit costs are the server constants' defaults — 300 label / 200 playlist", () => {
    const labelRoute = read("../../../../api-server/src/routes/generate/label-pitch.ts");
    expect(labelRoute).toContain('Number(process.env["LABEL_PITCH_CREDIT_COST"]) || 300');
    expect(LABEL_PITCH_KIT_COST_VISUAL_BUCS).toBe(300);
    const page = read("../../pages/label-pitch.tsx");
    expect(page).toContain("const CREDIT_COST = 300");
    expect(page).toContain("const PLAYLIST_KIT_COST = 200");
    const playlistRoute = read("../../../../api-server/src/routes/generate/playlist-pitch.ts");
    expect(playlistRoute).toContain('Number(process.env["PLAYLIST_PITCH_CREDIT_COST"]) || 200');
    expect(PLAYLIST_PITCH_KIT_COST_VISUAL_BUCS).toBe(200);
    /* The playlist kit's price is also the credit registry's row. */
    expect(read("../credit-costs.ts")).toContain(
      '"/api/playlist-pitch/kit": { cost: 200, feature: "Playlist Pitch Kit" }',
    );
  });

  it("the status vocabularies are the server schemas' own enums", () => {
    expect(LABEL_PITCH_STATUSES).toEqual(["sent", "pending", "signed", "passed"]);
    expect(PLAYLIST_PITCH_STATUSES).toEqual(["sent", "pending", "accepted", "rejected"]);
    expect(PLAYLIST_DEADLINE_STATUSES).toEqual(["drafted", "sent", "followed_up", "answered"]);
    const labelRoute = read("../../../../api-server/src/routes/generate/label-pitch.ts");
    expect(labelRoute).toContain('["sent", "pending", "signed", "passed"]');
    const playlistRoute = read("../../../../api-server/src/routes/generate/playlist-pitch.ts");
    expect(playlistRoute).toContain('["drafted", "sent", "followed_up", "answered"]');
  });
});

describe("payload builders", () => {
  it("the label kit body carries the page's field names, trimmed", () => {
    const body = buildLabelKitPayload({
      songTitle: "  Gold Hour ", artistName: " Thy ", genre: " hip-hop ", mood: " warm ",
      energy: 72, tempo: " slow burn ", description: " d ", lyrics: " l ",
      artistBio: " bio ", socialStats: " 10k ", labelName: " Def Jam ",
    });
    expect(body).toEqual({
      songTitle: "Gold Hour", artistName: "Thy", songDescription: "d", genre: "hip-hop",
      mood: "warm", energy: 72, tempo: "slow burn", lyrics: "l", artistBio: "bio",
      socialStats: "10k", labelName: "Def Jam", autoMode: false, autoBio: false, autoTarget: false,
    });
    expect(labelKitReady({ songTitle: " x " })).toBe(true);
    expect(labelKitReady({ songTitle: "  " })).toBe(false);
  });

  it("the playlist kit body carries the page's field names, trimmed", () => {
    const body = buildPlaylistKitPayload({
      songTitle: " Gold Hour ", artistName: " Thy ", genre: " pop ", mood: " warm ",
      energy: 40, tempo: " mid ", description: " d ", lyrics: " l ",
      curatorName: " Cur ", playlistName: " List ",
    });
    expect(body).toEqual({
      songTitle: "Gold Hour", artistName: "Thy", songDescription: "d", genre: "pop",
      mood: "warm", energy: 40, tempo: "mid", lyrics: "l", curatorName: "Cur", playlistName: "List",
    });
    expect(playlistKitReady({ songTitle: "" })).toBe(false);
  });

  it("tracker + deadline bodies match the page's shapes (deadline = end of day)", () => {
    expect(buildLabelSubmissionPayload({ songTitle: " S ", artistName: " A ", labelName: " L ", notes: " n " }))
      .toEqual({ songTitle: "S", artistName: "A", labelName: "L", notes: "n" });
    expect(labelSubmissionReady({ songTitle: "S", labelName: "" })).toBe(false);
    expect(buildPlaylistPitchPayload({ songTitle: " S ", artistName: " A ", curatorName: " C ", playlistName: " P ", notes: " n " }))
      .toEqual({ songTitle: "S", artistName: "A", curatorName: "C", playlistName: "P", notes: "n" });
    expect(playlistPitchReady({ songTitle: "S", playlistName: " " })).toBe(false);
    expect(buildDeadlinePayload({ playlistName: " P ", curatorName: " C ", deadlineDate: "2026-12-01", releaseId: "" }))
      .toEqual({ playlistName: "P", curatorName: "C", deadlineAt: "2026-12-01T23:59:59.999Z" });
    expect(buildDeadlinePayload({ playlistName: "P", curatorName: "", deadlineDate: "2026-12-01", releaseId: "r1" }))
      .toEqual({ playlistName: "P", curatorName: "", deadlineAt: "2026-12-01T23:59:59.999Z", releaseId: "r1" });
    expect(deadlineReady({ playlistName: "P", deadlineDate: "" })).toBe(false);
  });
});

describe("library songs", () => {
  it("maps id + title, caps at 100, tolerates junk rows", () => {
    const songs = parseLibrarySongs({ songs: [{ id: "1", title: "A" }, { title: "no id" }, null, { id: "2" }] });
    expect(songs).toEqual([{ id: "1", title: "A" }, { id: "2", title: "" }]);
    expect(parseLibrarySongs({})).toEqual([]);
    expect(parseLibrarySongs(null)).toEqual([]);
  });
});

const LABEL_KIT = {
  kit: {
    analysis: {
      genre: "Trap / melodic rap", mood: "warm, hungry", energy: 72, tempoFeel: "slow burn",
      comparableArtists: ["A", "B"], labelFit: ["hip-hop imprints"], oneLiner: "A gold-hour confession.",
    },
    submissionEmail: { subject: "Demo Submission: Thy — Gold Hour", body: "Dear team…" },
    oneSheet: "THY\nTHE SOUND…",
    followUp: "Following up…",
    disclaimer: "Labels rarely sign from cold demos…",
  },
};

describe("parseLabelKit", () => {
  it("maps the kit field-for-field (labelFit rides the fit slot)", () => {
    const kit = parseLabelKit(LABEL_KIT)!;
    expect(kit.analysis.oneLiner).toBe("A gold-hour confession.");
    expect(kit.analysis.fit).toEqual(["hip-hop imprints"]);
    expect(kit.emailSubject).toContain("Demo Submission");
    expect(kit.oneSheet).toContain("THE SOUND");
    expect(kit.disclaimer).toContain("rarely sign");
  });

  it("an incomplete kit is a failed read, never a painted kit", () => {
    expect(parseLabelKit({ kit: { ...LABEL_KIT.kit, oneSheet: "" } })).toBeNull();
    expect(parseLabelKit({ kit: { ...LABEL_KIT.kit, submissionEmail: { subject: "", body: "x" } } })).toBeNull();
    expect(parseLabelKit({})).toBeNull();
    expect(parseLabelKit(null)).toBeNull();
  });
});

const PLAYLIST_KIT = {
  kit: {
    analysis: {
      genre: "Pop", mood: "bright", energy: 80, tempoFeel: "driving",
      comparableArtists: ["C"], playlistFit: ["New Music Friday style lists"], oneLiner: "A sunrise chorus.",
    },
    pitchEmail: { subject: "Pitch: Gold Hour", body: "Hi curator…" },
    dmPitch: "Hey! …",
    followUp: "Quick nudge…",
    disclaimer: "No playlist placement is guaranteed…",
  },
};

describe("parsePlaylistKit", () => {
  it("maps the kit field-for-field (pitchEmail + playlistFit)", () => {
    const kit = parsePlaylistKit(PLAYLIST_KIT)!;
    expect(kit.analysis.fit).toEqual(["New Music Friday style lists"]);
    expect(kit.emailBody).toContain("curator");
    expect(kit.dmPitch).toContain("Hey!");
  });

  it("a kit without its DM or email is a failed read", () => {
    expect(parsePlaylistKit({ kit: { ...PLAYLIST_KIT.kit, dmPitch: "" } })).toBeNull();
    expect(parsePlaylistKit({ kit: { ...PLAYLIST_KIT.kit, pitchEmail: null } })).toBeNull();
    expect(parsePlaylistKit({ kit: null })).toBeNull();
  });
});

describe("directories", () => {
  it("labels map with the notice; a nameless row fails the read", () => {
    const dir = parseLabelDirectory({
      labels: [{ id: "umg", name: "Universal Music Group", parent: "Independent", type: "major", genres: ["pop"], knownFor: "Biggest.", submitVia: "Referral only." }],
      notice: "Starter list — verify…",
    })!;
    expect(dir.labels[0]?.name).toBe("Universal Music Group");
    expect(dir.notice).toContain("Starter list");
    expect(parseLabelDirectory({ labels: [{ id: "x" }] })).toBeNull();
    expect(parseLabelDirectory({ labels: "nope" })).toBeNull();
  });

  it("curators map with the notice", () => {
    const dir = parseCuratorDirectory({
      curators: [{ id: "c1", name: "Fresh Finds", platform: "Spotify", genres: ["pop"], focus: "New pop", submitVia: "SubmitHub" }],
      notice: "Starter list",
    })!;
    expect(dir.curators[0]?.platform).toBe("Spotify");
    expect(parseCuratorDirectory({})).toBeNull();
  });
});

describe("trackers", () => {
  it("label tracker rows + single-row answers map; junk fails", () => {
    const rows = parseLabelTracker({
      pitches: [{ id: "1", songTitle: "Gold Hour", artistName: "Thy", labelName: "Def Jam", status: "pending", notes: null, contactedAt: "2026-10-01T00:00:00.000Z" }],
    })!;
    expect(rows[0]).toMatchObject({ songTitle: "Gold Hour", status: "pending", notes: null });
    expect(parseLabelSubmissionAnswer({ pitch: { id: "2", songTitle: "S", labelName: "L", status: "sent" } })?.id).toBe("2");
    expect(parseLabelTracker({ pitches: [{ id: "1" }] })).toBeNull();
    expect(parseLabelTracker({})).toBeNull();
  });

  it("playlist tracker rows map with curator + playlist", () => {
    const rows = parsePlaylistTracker({
      pitches: [{ id: "1", songTitle: "Gold Hour", artistName: null, curatorName: "Cur", playlistName: "List", status: "accepted", notes: "n", contactedAt: null }],
    })!;
    expect(rows[0]).toMatchObject({ curatorName: "Cur", playlistName: "List", status: "accepted" });
    expect(parsePlaylistPitchAnswer({ pitch: { id: "9", songTitle: "S", playlistName: "P" } })?.id).toBe("9");
    expect(parsePlaylistTracker({ pitches: null })).toBeNull();
  });
});

const PACKET = {
  packet: {
    releaseId: "r1",
    artist: { name: "Thy", bio: "Bio line", followerCount: 1200, totalPlays: 34000, profileUrl: "/artist/thy", socialLinks: {} },
    release: { title: "Gold Hour", releaseDate: "2026-12-01", status: "scheduled", platforms: ["spotify"] },
    track: { title: "Gold Hour", audioUrl: "https://x/audio.mp3" },
    genre: ["hip-hop"],
    description: "The single.",
    links: { streaming: { spotify: "https://open.spotify.com/x" }, presaveUrl: "https://x/pre", audioUrl: "https://x/audio.mp3", profileUrl: "/artist/thy" },
    stats: { presaves: 12, shares: 3, linkViews: 90, linkClicks: 41 },
    pressAssets: { artworkUrl: "https://x/art.jpg", headline: "Gold Hour is coming", bannerUrl: null, avatarUrl: null },
    missing: ["artistBio"],
  },
};

describe("the pitch packet", () => {
  it("releases map; a titleless release fails the read", () => {
    expect(parsePitchReleases({ releases: [{ id: "r1", title: "Gold Hour", artistName: "Thy", releaseDate: null, status: "draft" }] }))
      .toEqual([{ id: "r1", title: "Gold Hour", artistName: "Thy", releaseDate: null, status: "draft" }]);
    expect(parsePitchReleases({ releases: [{ id: "r1" }] })).toBeNull();
  });

  it("the packet maps field-for-field from the record's answer", () => {
    const p = parsePitchPacket(PACKET)!;
    expect(p.releaseTitle).toBe("Gold Hour");
    expect(p.artistName).toBe("Thy");
    expect(p.stats).toEqual({ presaves: 12, shares: 3, linkViews: 90, linkClicks: 41 });
    expect(p.streaming).toEqual({ spotify: "https://open.spotify.com/x" });
    expect(p.missing).toEqual(["artistBio"]);
  });

  it("a packet without its spine (title / artist) is a failed read", () => {
    expect(parsePitchPacket({ packet: { ...PACKET.packet, release: { title: "" } } })).toBeNull();
    expect(parsePitchPacket({})).toBeNull();
  });

  it("packetAsText is the page's construction: title line, links, stats line", () => {
    const text = packetAsText(parsePitchPacket(PACKET)!);
    expect(text.split("\n")[0]).toBe("Gold Hour — Thy");
    expect(text).toContain("Genre: hip-hop");
    expect(text).toContain("spotify: https://open.spotify.com/x");
    expect(text).toContain("Pre-save / smartlink: https://x/pre");
    expect(text).toContain("Pre-saves: 12 · Shares: 3 · Smartlink views: 90 · Link clicks: 41");
  });

  it("missing labels speak the page's own words; unknown keys pass through", () => {
    expect(packetMissingLabel("genre")).toBe("Genre tags on the release");
    expect(packetMissingLabel("streamingLinks")).toContain("pre-save page");
    expect(packetMissingLabel("artistBio")).toBe("Your profile bio");
    expect(packetMissingLabel("somethingNew")).toBe("somethingNew");
  });
});

describe("deadlines", () => {
  it("the board maps rows + dueNext; a dateless row fails the read", () => {
    const board = parseDeadlineBoard({
      deadlines: [{ id: "d1", releaseId: null, curatorName: "Cur", playlistName: "List", deadlineAt: "2026-12-01T23:59:59.999Z", status: "drafted", notes: null, overdue: false }],
      dueNext: { id: "d1", releaseId: null, curatorName: "Cur", playlistName: "List", deadlineAt: "2026-12-01T23:59:59.999Z", status: "drafted", notes: null, overdue: true },
    })!;
    expect(board.deadlines).toHaveLength(1);
    expect(board.dueNext?.overdue).toBe(true);
    expect(parseDeadlineBoard({ deadlines: [{ id: "d1", playlistName: "L" }] })).toBeNull();
    expect(parseDeadlineBoard({ deadlines: [], dueNext: null })?.dueNext).toBeNull();
  });
});
