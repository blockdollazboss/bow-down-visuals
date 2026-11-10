/**
 * R2 client — r2ListMultipartUploads (stack400 C-08 follow-on).
 *
 * The C-08 stale-session sweep aborts sessions the in-process tracker
 * knows about; a bucket-wide sweep needs the bucket's own truth — every
 * multipart session still open, including ones orphaned by a restart.
 * That primitive was missing from lib/r2-client (create/parts/complete/
 * abort existed, list-uploads did not). These tests pin the export
 * against a faked @aws-sdk/client-s3:
 *  - every open session comes back mapped to { key, uploadId,
 *    initiated } (initiated is null when R2 omits it);
 *  - a truncated listing is followed with BOTH continuation markers
 *    (S3 requires the pair) and the pages are concatenated;
 *  - truncation without the full marker pair stops instead of looping
 *    or re-reading page one;
 *  - an optional prefix is passed through to the command untouched;
 *  - entries missing a key or an upload id are skipped, never mapped
 *    into a half-identified session a sweep could act on;
 *  - an empty bucket is an empty list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  process.env.R2_ACCOUNT_ID = "acct-test";
  process.env.R2_ACCESS_KEY_ID = "key-test";
  process.env.R2_SECRET_ACCESS_KEY = "secret-test";
  process.env.R2_BUCKET_NAME = "bucket-test";
  return {
    calls: [] as any[],
    handler: (async (_cmd: any) => ({})) as (cmd: any) => Promise<any>,
  };
});

vi.mock("@aws-sdk/client-s3", () => {
  const cmd = (name: string) =>
    class {
      __name = name;
      input: any;
      constructor(input: any) {
        this.input = input;
      }
    };
  class S3Client {
    async send(command: any) {
      h.calls.push(command);
      return h.handler(command);
    }
  }
  return {
    S3Client,
    PutObjectCommand: cmd("PutObject"),
    GetObjectCommand: cmd("GetObject"),
    DeleteObjectCommand: cmd("DeleteObject"),
    ListObjectsV2Command: cmd("ListObjectsV2"),
    HeadObjectCommand: cmd("HeadObject"),
    CreateMultipartUploadCommand: cmd("CreateMultipartUpload"),
    UploadPartCommand: cmd("UploadPart"),
    CompleteMultipartUploadCommand: cmd("CompleteMultipartUpload"),
    AbortMultipartUploadCommand: cmd("AbortMultipartUpload"),
    ListPartsCommand: cmd("ListParts"),
    ListMultipartUploadsCommand: cmd("ListMultipartUploads"),
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async () => "https://r2.example/signed",
}));

import { r2ListMultipartUploads } from "../r2-client";

const D1 = new Date("2026-11-01T00:00:00.000Z");

beforeEach(() => {
  h.calls.length = 0;
  h.handler = async () => ({});
});

describe("r2ListMultipartUploads", () => {
  it("returns every open session on a single page, mapped to the house shape", async () => {
    h.handler = async () => ({
      Uploads: [
        { Key: "user-1/a.mp4", UploadId: "up-1", Initiated: D1 },
        { Key: "user-2/b.mp4", UploadId: "up-2" },
      ],
      IsTruncated: false,
    });
    const out = await r2ListMultipartUploads();
    expect(out).toEqual([
      { key: "user-1/a.mp4", uploadId: "up-1", initiated: D1 },
      { key: "user-2/b.mp4", uploadId: "up-2", initiated: null },
    ]);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].__name).toBe("ListMultipartUploads");
    expect(h.calls[0].input.Bucket).toBe("bucket-test");
    expect(h.calls[0].input.Prefix).toBeUndefined();
    expect(h.calls[0].input.KeyMarker).toBeUndefined();
    expect(h.calls[0].input.UploadIdMarker).toBeUndefined();
  });

  it("follows a truncated listing with BOTH markers and concatenates the pages", async () => {
    h.handler = async (cmd: any) => {
      if (cmd.input.KeyMarker === undefined) {
        return {
          Uploads: [{ Key: "user-1/a.mp4", UploadId: "up-1", Initiated: D1 }],
          IsTruncated: true,
          NextKeyMarker: "user-1/a.mp4",
          NextUploadIdMarker: "up-1",
        };
      }
      return {
        Uploads: [{ Key: "user-9/z.mp4", UploadId: "up-9", Initiated: D1 }],
        IsTruncated: false,
      };
    };
    const out = await r2ListMultipartUploads();
    expect(out.map((u) => u.uploadId)).toEqual(["up-1", "up-9"]);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].input.KeyMarker).toBe("user-1/a.mp4");
    expect(h.calls[1].input.UploadIdMarker).toBe("up-1");
  });

  it("stops when a truncated page omits one of the marker pair", async () => {
    h.handler = async () => ({
      Uploads: [{ Key: "user-1/a.mp4", UploadId: "up-1", Initiated: D1 }],
      IsTruncated: true,
      NextKeyMarker: "user-1/a.mp4",
      // NextUploadIdMarker missing — S3 cannot continue safely.
    });
    const out = await r2ListMultipartUploads();
    expect(out).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
  });

  it("passes a prefix through to the command", async () => {
    await r2ListMultipartUploads("user-1/");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].input.Prefix).toBe("user-1/");
  });

  it("skips entries missing a key or an upload id", async () => {
    h.handler = async () => ({
      Uploads: [
        { UploadId: "up-x", Initiated: D1 },
        { Key: "user-3/c.mp4", Initiated: D1 },
        { Key: "user-3/c.mp4", UploadId: "up-3", Initiated: D1 },
      ],
      IsTruncated: false,
    });
    const out = await r2ListMultipartUploads();
    expect(out).toEqual([{ key: "user-3/c.mp4", uploadId: "up-3", initiated: D1 }]);
  });

  it("returns an empty list for an empty bucket", async () => {
    h.handler = async () => ({});
    await expect(r2ListMultipartUploads()).resolves.toEqual([]);
  });
});
