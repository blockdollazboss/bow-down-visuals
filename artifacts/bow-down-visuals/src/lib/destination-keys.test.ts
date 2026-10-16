import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  liveStreamDestinations,
  savedDestinationsFromPayload,
  savedDestinationsOrEmpty,
} from "./destination-keys";
import type { SavedDestination } from "./reach-api";

const panelSource = readFileSync(
  new URL("../components/reach/DestinationKeysPanel.tsx", import.meta.url),
  "utf8",
);

const saved: SavedDestination[] = [
  {
    platform: "youtube",
    ingestUrl: "rtmp://example.invalid/live",
    hasKey: true,
    updatedAt: null,
  },
];

describe("DestinationKeysPanel payload guards", () => {
  it("rejects partial payloads instead of storing undefined as saved state", () => {
    expect(savedDestinationsFromPayload({})).toBeNull();
    expect(savedDestinationsFromPayload(null)).toBeNull();
    expect(savedDestinationsFromPayload({ destinations: "youtube" })).toBeNull();
  });

  it("accepts a complete destinations payload", () => {
    expect(savedDestinationsFromPayload({ destinations: saved })).toEqual(saved);
  });

  it("renders poisoned or missing collections as empty collections", () => {
    expect(
      savedDestinationsOrEmpty(undefined as unknown as SavedDestination[]),
    ).toEqual([]);
    expect(savedDestinationsOrEmpty(saved)).toEqual(saved);
    expect(liveStreamDestinations(undefined)).toEqual([]);
    expect(liveStreamDestinations({ platform: "youtube" })).toEqual([]);
  });

  it("wires the guards into the panel's load and render paths", () => {
    expect(panelSource).toContain("savedDestinationsFromPayload(d)");
    expect(panelSource).toContain("savedDestinationsOrEmpty(saved)");
    expect(panelSource).toContain("liveStreamDestinations(liveStream?.destinations)");
    expect(panelSource).not.toContain("saved.length");
  });
});
