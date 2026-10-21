/**
 * rtmp-protocol.test.ts — the RTMP wire core behind stream-key ingest
 * (lib/rtmp-protocol): AMF0 codec, handshake, the chunk-stream parser
 * (fmt 0–3, extended timestamps, Set Chunk Size, reassembly across
 * arbitrary TCP splits), the outbound writer, and the FLV muxer.
 * Pure byte tests — no sockets, no db.
 */
import { describe, it, expect } from "vitest";
import {
  RTMP_MSG,
  RtmpChunkParser,
  amfDecode,
  amfDecodeAll,
  amfEncode,
  buildHandshakeResponse,
  encodeRtmpMessage,
  flvHeader,
  flvScriptData,
  flvTag,
  HANDSHAKE_BYTES,
  type RtmpMessage,
} from "../rtmp-protocol";

function collect(): { messages: RtmpMessage[]; parser: RtmpChunkParser } {
  const messages: RtmpMessage[] = [];
  const parser = new RtmpChunkParser((m) => messages.push(m));
  return { messages, parser };
}

describe("AMF0 codec", () => {
  it("round-trips the scalar types", () => {
    for (const v of [0, 1, -3.5, 42_000, true, false, "hello", ""]) {
      const enc = amfEncode(v as never);
      const dec = amfDecode(enc, 0);
      expect(dec.value).toEqual(v);
      expect(dec.bytesRead).toBe(enc.length);
    }
    expect(amfDecode(amfEncode(null), 0).value).toBeNull();
  });

  it("round-trips objects and strict arrays", () => {
    const obj = { app: "live", tcUrl: "rtmp://example.test/live", flashVer: "FMLE/3.0" };
    const dec = amfDecode(amfEncode(obj), 0);
    expect(dec.value).toEqual(obj);
    const arr = amfDecode(amfEncode(["publish", 0, null, "bdv_key"] as never), 0);
    expect(arr.value).toEqual(["publish", 0, null, "bdv_key"]);
  });

  it("decodes a full command payload as a value list", () => {
    const payload = Buffer.concat([
      amfEncode("connect"),
      amfEncode(1),
      amfEncode({ app: "live" }),
    ]);
    expect(amfDecodeAll(payload)).toEqual(["connect", 1, { app: "live" }]);
  });

  it("throws on an unsupported type marker instead of misparsing", () => {
    expect(() => amfDecode(Buffer.from([0x7f, 0, 0]), 0)).toThrow(/Unsupported AMF0/);
  });
});

describe("handshake", () => {
  it("answers C0+C1 with S0+S1+S2 of the right shape, echoing C1", () => {
    const c1 = Buffer.alloc(HANDSHAKE_BYTES);
    c1.writeUInt32BE(12345, 0);
    for (let i = 8; i < HANDSHAKE_BYTES; i++) c1[i] = i % 251;
    const res = buildHandshakeResponse(c1);
    expect(res.length).toBe(1 + HANDSHAKE_BYTES * 2);
    expect(res[0]).toBe(3); // S0 version
    const s2 = res.subarray(1 + HANDSHAKE_BYTES);
    expect(s2.length).toBe(HANDSHAKE_BYTES);
    // S2 echoes the client's random bytes, with the time2 field zeroed.
    expect(s2.subarray(8).equals(c1.subarray(8))).toBe(true);
    expect(s2.readUInt32BE(4)).toBe(0);
  });
});

describe("chunk parser", () => {
  it("parses a small command message fed whole", () => {
    const { messages, parser } = collect();
    const payload = Buffer.concat([amfEncode("connect"), amfEncode(1), amfEncode({ app: "live" })]);
    parser.feed(encodeRtmpMessage({ chunkStreamId: 3, messageStreamId: 0, typeId: RTMP_MSG.COMMAND_AMF0, payload }));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.typeId).toBe(RTMP_MSG.COMMAND_AMF0);
    expect(messages[0]!.payload.equals(payload)).toBe(true);
    expect(amfDecodeAll(messages[0]!.payload)).toEqual(["connect", 1, { app: "live" }]);
  });

  it("reassembles a message delivered one byte at a time", () => {
    const { messages, parser } = collect();
    const payload = Buffer.from("a small video payload");
    const wire = encodeRtmpMessage({ chunkStreamId: 6, messageStreamId: 1, typeId: RTMP_MSG.VIDEO, payload });
    for (const byte of wire) parser.feed(Buffer.from([byte]));
    expect(messages).toHaveLength(1);
    expect(messages[0]!.payload.equals(payload)).toBe(true);
  });

  it("parses two back-to-back messages in one buffer", () => {
    const { messages, parser } = collect();
    const a = encodeRtmpMessage({ chunkStreamId: 6, messageStreamId: 1, typeId: RTMP_MSG.VIDEO, payload: Buffer.from([1, 2, 3]) });
    const b = encodeRtmpMessage({ chunkStreamId: 4, messageStreamId: 1, typeId: RTMP_MSG.AUDIO, payload: Buffer.from([4, 5]) });
    parser.feed(Buffer.concat([a, b]));
    expect(messages.map((m) => m.typeId)).toEqual([RTMP_MSG.VIDEO, RTMP_MSG.AUDIO]);
    expect(messages[1]!.payload.equals(Buffer.from([4, 5]))).toBe(true);
  });

  it("honors Set Chunk Size for large messages with fmt-3 continuations", () => {
    const { messages, parser } = collect();
    const sizePayload = Buffer.alloc(4);
    sizePayload.writeUInt32BE(4096, 0);
    parser.feed(encodeRtmpMessage({ chunkStreamId: 2, messageStreamId: 0, typeId: RTMP_MSG.SET_CHUNK_SIZE, payload: sizePayload }));
    const big = Buffer.alloc(300_000, 0xab);
    parser.feed(encodeRtmpMessage({ chunkStreamId: 6, messageStreamId: 1, typeId: RTMP_MSG.VIDEO, payload: big }));
    const video = messages.filter((m) => m.typeId === RTMP_MSG.VIDEO);
    expect(video).toHaveLength(1);
    expect(video[0]!.payload.length).toBe(300_000);
    expect(video[0]!.payload.equals(big)).toBe(true);
  });

  it("applies fmt-1 timestamp deltas on a chunk stream", () => {
    const { messages, parser } = collect();
    // fmt 0 at t=1000 (hand-built: the writer only emits fmt 0/3).
    const head0 = Buffer.alloc(12);
    head0[0] = 6;
    head0.writeUIntBE(1000, 1, 3);
    head0.writeUIntBE(2, 4, 3);
    head0[7] = RTMP_MSG.VIDEO;
    head0.writeUInt32LE(1, 8);
    parser.feed(Buffer.concat([head0, Buffer.from([0xaa, 0xbb])]));
    // fmt 1 with delta 40, 1-byte payload.
    const head1 = Buffer.alloc(8);
    head1[0] = (1 << 6) | 6;
    head1.writeUIntBE(40, 1, 3);
    head1.writeUIntBE(1, 4, 3);
    head1[7] = RTMP_MSG.VIDEO;
    parser.feed(Buffer.concat([head1, Buffer.from([0xcc])]));
    expect(messages.map((m) => m.timestamp)).toEqual([1000, 1040]);
  });

  it("throws on an implausible message length (the caller drops the connection)", () => {
    const { parser } = collect();
    const zero = Buffer.alloc(12);
    zero[0] = 6; // fmt 0, csid 6
    zero.writeUIntBE(0, 1, 3); // timestamp
    zero.writeUIntBE(0, 4, 3); // length 0 — no real message is empty-framed
    zero[7] = RTMP_MSG.VIDEO;
    zero.writeUInt32LE(1, 8);
    expect(() => parser.feed(zero)).toThrow(/implausible/);
  });
});

describe("FLV muxer", () => {
  it("writes the 13-byte FLV header with audio+video flags", () => {
    const h = flvHeader();
    expect(h.length).toBe(13);
    expect(h.subarray(0, 3).toString("latin1")).toBe("FLV");
    expect(h[3]).toBe(1);
    expect(h[4]).toBe(0x05);
    expect(h.readUInt32BE(9)).toBe(0); // PreviousTagSize0
  });

  it("frames a tag with size, split timestamp and PreviousTagSize", () => {
    const data = Buffer.from([0x17, 0x01, 0x02]);
    const tag = flvTag(RTMP_MSG.VIDEO, 0x01020304, data);
    expect(tag[0]).toBe(RTMP_MSG.VIDEO);
    expect(tag.readUIntBE(1, 3)).toBe(3);
    expect(tag.readUIntBE(4, 3)).toBe(0x020304); // low 24 bits
    expect(tag[7]).toBe(0x01); // extended timestamp byte
    expect(tag.subarray(11, 14).equals(data)).toBe(true);
    expect(tag.readUInt32BE(14)).toBe(11 + 3);
  });

  it("strips the @setDataFrame marker for script tags, passes other data through", () => {
    const meta = { width: 1280, height: 720 };
    const rtmpData = Buffer.concat([amfEncode("@setDataFrame"), amfEncode("onMetaData"), amfEncode(meta)]);
    const flvData = flvScriptData(rtmpData);
    expect(amfDecodeAll(flvData)).toEqual(["onMetaData", meta]);
    const plain = Buffer.from([1, 2, 3]);
    expect(flvScriptData(plain).equals(plain)).toBe(true);
  });
});
