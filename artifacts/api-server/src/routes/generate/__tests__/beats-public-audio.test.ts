/**
 * Public beat reads never hand out the master file (stack1000 R1,
 * public-surface truth).
 *
 * The marketplace is public to browse (access law D5), and the browse
 * payloads (GET /beats, GET /beats/:id) presented every beat with
 * presentBeat — whose audio_url is the FULL master, the very file a
 * license sells — sitting right next to the watermarked preview_url.
 * The page's player politely preferred the preview; the payload did
 * not care. Anyone could take the product without licensing it.
 *
 * presentBeatPublic is the browse shape: when a distinct preview
 * exists, audio_url carries the preview and the storage path is
 * dropped. With no distinct preview, the schema's documented fallback
 * stands (the full file IS the preview). Owner/buyer reads keep
 * presentBeat — a completed license's download is the master.
 */
import { describe, expect, it } from "vitest";
import { presentBeatPublic } from "../beats";

const MASTER = "https://cdn.example.com/beats/master-full.mp3";
const PREVIEW = "https://cdn.example.com/beats/preview-tagged.mp3";

describe("presentBeatPublic — the browse shape of a beat", () => {
  it("masks the master behind the watermarked preview", async () => {
    const out = await presentBeatPublic({
      id: "b1",
      title: "Tagged",
      audio_url: MASTER,
      audio_path: "beats/master-full.mp3",
      preview_url: PREVIEW,
    });
    expect(out.preview_url).toBe(PREVIEW);
    expect(out.audio_url).toBe(PREVIEW);
    expect(out.audio_url).not.toBe(MASTER);
    expect(out.audio_path).toBeNull();
    // The rest of the card is untouched.
    expect(out.title).toBe("Tagged");
  });

  it("keeps the documented fallback when no distinct preview exists", async () => {
    const out = await presentBeatPublic({
      id: "b2",
      title: "No Preview",
      audio_url: MASTER,
      audio_path: null,
      preview_url: null,
    });
    expect(out.audio_url).toBe(MASTER);
    expect(out.preview_url).toBeNull();
  });
});
