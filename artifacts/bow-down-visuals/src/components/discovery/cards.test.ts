/**
 * Source pins for the website discovery cards' 2.15 listening extras.
 *
 * The website's chart/discovery rows (TrackRow / VideoCard in
 * cards.tsx) gained the tail of Ring 2 item 2.15: a per-row Repost
 * riding the track repost rail, seeded from the batched repost-state
 * read (GET /api/discovery/reposts), and the EmbedButton — whose
 * snippet points at the standalone /embed/<kind>/<id> pages the API
 * server really serves. VideoCard also stopped being one whole-card
 * link so the artist's name can carry the more-from-this-artist door
 * (the /artist/<slug> page) without nesting interactives in an anchor.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const cardsSrc = readFileSync(new URL("./cards.tsx", import.meta.url), "utf8");

describe("website discovery rows — the 2.15 extras", () => {
  it("TrackRow carries a Repost on the shared rail, seeded from the server read", () => {
    expect(cardsSrc).toContain('data-testid="discovery-row-repost"');
    expect(cardsSrc).toContain("/api/discovery/reposts?ids=");
    expect(cardsSrc).toContain("toggleRepost(trackId, prev");
    /* the seed answers under the kind-keyed name the endpoint uses */
    expect(cardsSrc).toContain("d?.[`track:${trackId}`]");
    /* the row feeds the button the DTO's counter when it carries one */
    expect(cardsSrc).toContain("startCount={track.repost_count ?? 0}");
  });

  it("both row kinds carry the embed button, at the kinds the embed system serves", () => {
    expect(cardsSrc).toContain('<EmbedButton kind="track"');
    expect(cardsSrc).toContain('<EmbedButton kind="video"');
    /* the refcode rides the artist's own slug — never an invented code */
    expect(cardsSrc).toContain("artistSlug={track.slug}");
    expect(cardsSrc).toContain("artistSlug={video.slug}");
  });

  it("VideoCard's artist name is the more-from door — a real link, not nested in the card link", () => {
    expect(cardsSrc).toContain("href={`/artist/${video.slug}`}");
    expect(cardsSrc).toContain("href={`/artist/${track.slug}`}");
    /* the watch door survives the restructure, on thumbnail and title */
    expect(cardsSrc).toContain("href={`/watch/${video.id}`}");
  });
});
