/**
 * label-pitch-desk-components — stack1400 world parity wave #1 item 2
 * source-contract pins. The Label Pitch family (label-pitch,
 * mode-playlist-pitch, playlist-pitch-packet — the census's ABSENT
 * ×3) must exist as ONE native desk in the Promote Room:
 * - the desk rides the 2D page's rails end to end through the seam
 *   (both kits, both directories, both trackers, releases + packet +
 *   deadlines), never a website pull-up of /label-pitch;
 * - the paid kits go through the confirmed rail with the seam's
 *   explicit override costs (300 / 200 VB) shown on the buttons;
 * - the desk is hung in the StationPanel's promote-room composition,
 *   stacked with the Promote Desk like its neighbors;
 * - guests get the pitch/sign-in gate, never the working desk.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/LabelPitchDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const seam = read("./label-pitch-desk.ts");

describe("the desk rides the family's rails end to end", () => {
  it("both kits ride the confirmed rail at the seam's prices", () => {
    expect(desk).toContain("confirmedFetch(LABEL_PITCH_KIT_PATH");
    expect(desk).toContain("overrideCost: LABEL_PITCH_KIT_COST_VISUAL_BUCS");
    expect(desk).toContain('overrideFeature: "Label Pitch Demo Kit"');
    expect(desk).toContain("confirmedFetch(PLAYLIST_PITCH_KIT_PATH");
    expect(desk).toContain("overrideCost: PLAYLIST_PITCH_KIT_COST_VISUAL_BUCS");
    expect(desk).toContain('overrideFeature: "Playlist Pitch Kit"');
    expect(desk).toContain('data-testid="world-label-pitch-generate"');
    expect(desk).toContain('data-testid="world-playlist-pitch-generate"');
    expect(desk).toContain("buildLabelKitPayload");
    expect(desk).toContain("buildPlaylistKitPayload");
    expect(desk).toContain("parseLabelKit");
    expect(desk).toContain("parsePlaylistKit");
  });

  it("directories + trackers ride their free rails (GET/POST/PATCH/DELETE)", () => {
    for (const needle of [
      "labelPitchLabelsPath(genreFilter, typeFilter)",
      "playlistPitchCuratorsPath(genreFilter)",
      "LABEL_PITCH_TRACKER_PATH",
      "PLAYLIST_PITCH_TRACKER_PATH",
      "labelPitchTrackerItemPath(id)",
      "playlistPitchTrackerItemPath(id)",
      'method: "PATCH"',
      'method: "DELETE"',
      "buildLabelSubmissionPayload",
      "buildPlaylistPitchPayload",
      "LABEL_PITCH_STATUSES",
      "PLAYLIST_PITCH_STATUSES",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the packet + deadlines ride their rails (releases, packet by id, deadline CRUD)", () => {
    for (const needle of [
      "PLAYLIST_PITCH_RELEASES_PATH",
      "playlistPitchPacketPath(releaseId)",
      "parsePitchPacket",
      "packetAsText",
      "packetMissingLabel",
      'data-testid="world-playlist-pitch-packet"',
      "PLAYLIST_PITCH_DEADLINES_PATH",
      "playlistPitchDeadlineItemPath(id)",
      "buildDeadlinePayload",
      "PLAYLIST_DEADLINE_STATUSES",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the song picker rides /api/songs like the page's library", () => {
    expect(desk).toContain('fetch("/api/songs"');
    expect(seam).toContain('export const SONGS_PATH = "/api/songs"');
    expect(desk).toContain("parseLibrarySongs");
  });
});

describe("world law: everything completes in-world", () => {
  it("no pull-up, no walk-out to the 2D pitch pages", () => {
    expect(desk).not.toContain('href="/label-pitch"');
    expect(desk).not.toContain('href="/playlist-pitch"');
    expect(desk).not.toContain("setLocation");
    expect(desk).not.toContain("window.location");
    expect(desk).not.toContain("window.open");
    /* the only Link is the guest gate's sign-in door, the house shape */
    expect(desk).toContain('<Link href="/login"');
  });

  it("results render in-world: analysis, email, one-sheet / DM, follow-up, disclaimer", () => {
    expect(desk).toContain('data-testid="world-label-pitch-kit-result"');
    expect(desk).toContain('data-testid="world-playlist-pitch-kit-result"');
    expect(desk).toContain("oneSheet");
    expect(desk).toContain("dmPitch");
    expect(desk).toContain("disclaimer");
  });

  it("guests get the gate, members get the desk", () => {
    expect(desk).toContain("if (isGuest) return <GuestGate isLight={isLight} />");
    expect(desk).toContain('data-testid="world-label-pitch-desk"');
  });
});

describe("station composition", () => {
  it("the desk is hung in the promote-room composition, stacked with PromoteDesk", () => {
    expect(panel).toContain('station.id === "promote-room"');
    expect(panel).toContain("<PromoteDesk isLight={isLight} isGuest={isGuest} />");
    expect(panel).toContain("<LabelPitchDesk isLight={isLight} isGuest={isGuest} />");
    expect(panel).toContain(
      'import("@/components/world/native/LabelPitchDesk")',
    );
    /* the promote station itself is unchanged: business pattern in
       the Courtyard, transfer target /promote (stations.test pins
       the full table separately) */
    const stations = read("./stations.ts");
    const promote = stations.slice(stations.indexOf('id: "promote-room"'));
    expect(promote.slice(0, 600)).toContain('websitePath: "/promote"');
  });
});
