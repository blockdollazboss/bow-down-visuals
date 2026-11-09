/**
 * clip-upload — Stack 400 census D-45: scene clips ride the direct
 * door. Pins the helper's contract:
 *  - the flow is session (server mints the scoped key) → r2UploadFile
 *    (bytes move browser → storage through the /api/r2 doors) →
 *    complete (server records the ref) — in that order;
 *  - NO call ever posts the file to /api/upload-clip itself (the old
 *    server-transit door is retired);
 *  - the resolved value keeps the old door's { url, ref } shape;
 *  - server refusals (caps, video rule) surface with the server's own
 *    message and stop the flow before any byte moves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadClipDirect } from "./clip-upload";

const MB = 1024 * 1024;
const KEY = "user-1/clips/1700000000000-abc.mp4";
const PUBLIC_URL = `https://cdn.example/${KEY}`;

function installSessionStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchCall {
  url: string;
  method: string;
  body: any;
}

function installFetch(opts: {
  session?: () => Response;
  complete?: () => Response;
} = {}) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    const body =
      typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method, body });
    if (url === "/api/upload-clip/session") {
      return opts.session?.() ?? jsonRes({ key: KEY });
    }
    if (url === "/api/r2/upload") {
      return jsonRes({ uploadUrl: "https://r2.example/single", publicUrl: PUBLIC_URL });
    }
    if (url === "https://r2.example/single") return new Response(null, { status: 200 });
    if (url === "/api/upload-clip/complete") {
      return opts.complete?.() ?? jsonRes({ url: PUBLIC_URL, ref: PUBLIC_URL });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  installSessionStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadClipDirect", () => {
  it("mints, uploads direct, and records — never posting bytes to the old door", async () => {
    const { calls } = installFetch();
    const file = new File([new Uint8Array(2 * MB)], "clip.mp4", { type: "video/mp4" });
    const out = await uploadClipDirect(file, "tok");
    expect(out).toEqual({ url: PUBLIC_URL, ref: PUBLIC_URL });

    const urls = calls.map((c) => `${c.method} ${c.url}`);
    expect(urls).toEqual([
      "POST /api/upload-clip/session",
      "POST /api/r2/upload",
      "PUT https://r2.example/single",
      "POST /api/upload-clip/complete",
    ]);
    /* The session carries metadata only — no file bytes, no FormData. */
    expect(calls[0].body).toEqual({
      filename: "clip.mp4",
      contentType: "video/mp4",
      size: 2 * MB,
    });
    /* The complete call records the minted key, nothing else. */
    expect(calls[3].body).toEqual({ key: KEY });
    /* The retired server-transit door is never touched. */
    expect(calls.some((c) => c.url === "/api/upload-clip")).toBe(false);
  });

  it("surfaces the server's cap refusal verbatim and moves no bytes", async () => {
    const { calls } = installFetch({
      session: () =>
        jsonRes(
          {
            error: "FILE_TOO_LARGE",
            message:
              "This clip exceeds the 80 MB upload limit. Please use a smaller video file.",
          },
          413,
        ),
    });
    const file = new File([new Uint8Array(3)], "big.mp4", { type: "video/mp4" });
    await expect(uploadClipDirect(file, "tok")).rejects.toThrow(
      "This clip exceeds the 80 MB upload limit. Please use a smaller video file.",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/upload-clip/session");
  });

  it("fails honestly when the record step cannot find the upload", async () => {
    installFetch({
      complete: () =>
        jsonRes({ error: "That upload could not be found — please try uploading again." }, 404),
    });
    const file = new File([new Uint8Array(3)], "clip.mp4", { type: "video/mp4" });
    await expect(uploadClipDirect(file, "tok")).rejects.toThrow(
      "That upload could not be found — please try uploading again.",
    );
  });
});
