import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  R2_MULTIPART_PART_BYTES,
  R2_MULTIPART_THRESHOLD_BYTES,
  planParts,
  r2UploadFile,
} from "./r2-storage";

const MB = 1024 * 1024;

/* sessionStorage shim (vitest runs in node env) */
function installSessionStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

function jsonRes(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

interface FetchCall {
  url: string;
  method: string;
  body: any;
}

/**
 * A scripted fetch: the R2 API doors + per-part presigned PUTs.
 * `partPut` may override what a part PUT returns (etag / failure).
 */
function installFetch(opts: {
  serverParts?: Array<{ partNumber: number; etag: string; size: number }>;
  partPut?: (partNumber: number, attempt: number) => Response;
} = {}) {
  const calls: FetchCall[] = [];
  const putAttempts = new Map<number, number>();
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ url, method, body });

    if (url === "/api/r2/upload") return jsonRes({ uploadUrl: "https://r2.example/single", publicUrl: "https://cdn.example/single" });
    if (url === "/api/r2/multipart/init") return jsonRes({ uploadId: "u-1", key: body.key, publicUrl: "https://cdn.example/big" });
    if (url === "/api/r2/multipart/part-url") return jsonRes({ url: `https://parts.example/${body.partNumber}` });
    if (url.startsWith("/api/r2/multipart/parts")) return jsonRes({ parts: opts.serverParts ?? [] });
    if (url === "/api/r2/multipart/complete") return jsonRes({ publicUrl: "https://cdn.example/big", key: body.key });
    if (url === "/api/r2/multipart/abort") return jsonRes({ ok: true });
    if (url.startsWith("https://parts.example/")) {
      const partNumber = Number(url.split("/").pop());
      const attempt = (putAttempts.get(partNumber) ?? 0) + 1;
      putAttempts.set(partNumber, attempt);
      if (opts.partPut) return opts.partPut(partNumber, attempt);
      return new Response(null, { status: 200, headers: { ETag: `"e${partNumber}"` } });
    }
    if (url === "https://r2.example/single") return new Response(null, { status: 200 });
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function bigFile(size = 21 * MB, lastModified = 1234) {
  return new File([new Uint8Array(size)], "big.mp4", { type: "video/mp4", lastModified });
}

beforeEach(() => {
  installSessionStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("planParts (stack300 #67)", () => {
  it("slices by part size with a short final part", () => {
    expect(planParts(0)).toEqual([]);
    expect(planParts(1, 8)).toEqual([{ partNumber: 1, start: 0, end: 1 }]);
    expect(planParts(8, 8)).toEqual([{ partNumber: 1, start: 0, end: 8 }]);
    expect(planParts(21, 8)).toEqual([
      { partNumber: 1, start: 0, end: 8 },
      { partNumber: 2, start: 8, end: 16 },
      { partNumber: 3, start: 16, end: 21 },
    ]);
    const parts = planParts(21 * MB);
    expect(parts).toHaveLength(3);
    expect(parts[2]).toEqual({ partNumber: 3, start: 16 * MB, end: 21 * MB });
    expect(R2_MULTIPART_PART_BYTES).toBe(8 * MB);
    expect(R2_MULTIPART_THRESHOLD_BYTES).toBe(20 * MB);
  });
});

describe("r2UploadFile routing", () => {
  it("keeps the single PUT for files at/under the threshold", async () => {
    const { calls } = installFetch();
    const file = new File([new Uint8Array(2 * MB)], "small.mp4", { type: "video/mp4" });
    const url = await r2UploadFile("user-1/small.mp4", file, "video/mp4", "tok");
    expect(url).toBe("https://cdn.example/single");
    expect(calls.some((c) => c.url.includes("multipart"))).toBe(false);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("uploads a large file in parts and completes with sorted part etags", async () => {
    const { calls } = installFetch();
    const url = await r2UploadFile("user-1/big.mp4", bigFile(), "video/mp4", "tok");
    expect(url).toBe("https://cdn.example/big");
    expect(calls.filter((c) => c.url === "/api/r2/multipart/part-url")).toHaveLength(3);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(3);
    const complete = calls.find((c) => c.url === "/api/r2/multipart/complete");
    expect(complete?.body.parts).toEqual([
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 3, etag: '"e3"' },
    ]);
    // Resume record is cleared once the upload lands.
    expect(sessionStorage.getItem(`bdv-r2mp:user-1/big.mp4:${21 * MB}:1234`)).toBeNull();
  });

  it("resumes: parts the server already holds are not re-sent", async () => {
    const store = installSessionStorage();
    store.set(
      `bdv-r2mp:user-1/big.mp4:${21 * MB}:1234`,
      JSON.stringify({ uploadId: "u-1", etags: { 1: '"stale"' } }),
    );
    const { calls } = installFetch({
      serverParts: [{ partNumber: 1, etag: '"srv1"', size: 8 * MB }],
    });
    const url = await r2UploadFile("user-1/big.mp4", bigFile(), "video/mp4", "tok");
    expect(url).toBe("https://cdn.example/big");
    // No fresh init — the remembered upload was reconciled instead.
    expect(calls.some((c) => c.url === "/api/r2/multipart/init")).toBe(false);
    const partUrlCalls = calls.filter((c) => c.url === "/api/r2/multipart/part-url");
    expect(partUrlCalls.map((c) => c.body.partNumber).sort()).toEqual([2, 3]);
    const complete = calls.find((c) => c.url === "/api/r2/multipart/complete");
    expect(complete?.body.parts[0]).toEqual({ partNumber: 1, etag: '"srv1"' });
  });

  it("retries a failed part instead of restarting the file", async () => {
    const { calls } = installFetch({
      partPut: (partNumber, attempt) => {
        if (partNumber === 2 && attempt === 1) return new Response(null, { status: 500 });
        return new Response(null, { status: 200, headers: { ETag: `"e${partNumber}"` } });
      },
    });
    const url = await r2UploadFile("user-1/big.mp4", bigFile(), "video/mp4", "tok");
    expect(url).toBe("https://cdn.example/big");
    expect(calls.filter((c) => c.url === "https://parts.example/2" && c.method === "PUT")).toHaveLength(2);
    expect(calls.filter((c) => c.url === "/api/r2/multipart/init")).toHaveLength(1);
  });

  it("fills ETags from the server list when PUT responses hide them", async () => {
    const { calls } = installFetch({
      serverParts: [
        { partNumber: 1, etag: '"s1"', size: 8 * MB },
        { partNumber: 2, etag: '"s2"', size: 8 * MB },
        { partNumber: 3, etag: '"s3"', size: 5 * MB },
      ],
      partPut: () => new Response(null, { status: 200 }), // no ETag header
    });
    const url = await r2UploadFile("user-1/big.mp4", bigFile(), "video/mp4", "tok");
    expect(url).toBe("https://cdn.example/big");
    const complete = calls.find((c) => c.url === "/api/r2/multipart/complete");
    expect(complete?.body.parts).toEqual([
      { partNumber: 1, etag: '"s1"' },
      { partNumber: 2, etag: '"s2"' },
      { partNumber: 3, etag: '"s3"' },
    ]);
  });
});
