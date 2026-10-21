/* ── RTMP protocol core ─────────────────────────────────────────────────
   Just enough of RTMP (spec: Adobe's RTMP specification + the
   community-maintained protocol notes every implementation works
   from) to accept a publish from a real encoder — OBS, VirtualDJ,
   Serato, djay — with zero new dependencies:

   - AMF0 encode/decode (the command/data serialization);
   - the chunk stream layer: handshake is the server's job, this
     module parses fmt 0–3 chunk headers, extended timestamps,
     per-chunk-stream message reassembly, and Set Chunk Size;
   - an outbound chunk writer (fmt 0 + fmt 3 continuations);
   - an FLV muxer: RTMP audio/video/data messages ARE FLV tags with
     the header stripped, so the publish byte stream re-frames 1:1
     into the FLV container the house media engine already carries.

   Deliberately NOT here: play/subscribe (this stage only receives),
   AMF3 commands, shared objects, aggregate messages. An encoder that
   meets an unsupported message gets it ignored, not a crashed socket. */

import { randomBytes } from "node:crypto";

/* ══ AMF0 ════════════════════════════════════════════════════════════ */

export type AmfValue =
  | number
  | boolean
  | string
  | null
  | undefined
  | Date
  | AmfValue[]
  | { [key: string]: AmfValue };

const AMF = {
  NUMBER: 0x00,
  BOOLEAN: 0x01,
  STRING: 0x02,
  OBJECT: 0x03,
  NULL: 0x05,
  UNDEFINED: 0x06,
  REFERENCE: 0x07,
  ECMA_ARRAY: 0x08,
  OBJECT_END: 0x09,
  STRICT_ARRAY: 0x0a,
  DATE: 0x0b,
  LONG_STRING: 0x0c,
} as const;

export function amfEncode(value: AmfValue): Buffer {
  const parts: Buffer[] = [];
  encodeInto(value, parts);
  return Buffer.concat(parts);
}

function encodeInto(value: AmfValue, parts: Buffer[]): void {
  if (typeof value === "number") {
    const b = Buffer.alloc(9);
    b[0] = AMF.NUMBER;
    b.writeDoubleBE(value, 1);
    parts.push(b);
    return;
  }
  if (typeof value === "boolean") {
    parts.push(Buffer.from([AMF.BOOLEAN, value ? 1 : 0]));
    return;
  }
  if (typeof value === "string") {
    const utf = Buffer.from(value, "utf8");
    if (utf.length < 0x10000) {
      const head = Buffer.alloc(3);
      head[0] = AMF.STRING;
      head.writeUInt16BE(utf.length, 1);
      parts.push(head, utf);
    } else {
      const head = Buffer.alloc(5);
      head[0] = AMF.LONG_STRING;
      head.writeUInt32BE(utf.length, 1);
      parts.push(head, utf);
    }
    return;
  }
  if (value === null) {
    parts.push(Buffer.from([AMF.NULL]));
    return;
  }
  if (value === undefined) {
    parts.push(Buffer.from([AMF.UNDEFINED]));
    return;
  }
  if (value instanceof Date) {
    const b = Buffer.alloc(11);
    b[0] = AMF.DATE;
    b.writeDoubleBE(value.getTime(), 1);
    b.writeInt16BE(0, 9);
    parts.push(b);
    return;
  }
  if (Array.isArray(value)) {
    const head = Buffer.alloc(5);
    head[0] = AMF.STRICT_ARRAY;
    head.writeUInt32BE(value.length, 1);
    parts.push(head);
    for (const item of value) encodeInto(item, parts);
    return;
  }
  // Plain object → AMF object (key/value pairs + end marker).
  parts.push(Buffer.from([AMF.OBJECT]));
  for (const [k, v] of Object.entries(value)) {
    const kb = Buffer.from(k, "utf8");
    const head = Buffer.alloc(2);
    head.writeUInt16BE(kb.length, 0);
    parts.push(head, kb);
    encodeInto(v, parts);
  }
  parts.push(Buffer.from([0, 0, AMF.OBJECT_END]));
}

export interface AmfDecoded {
  value: AmfValue;
  bytesRead: number;
}

export function amfDecode(buf: Buffer, offset = 0): AmfDecoded {
  const type = buf[offset];
  switch (type) {
    case AMF.NUMBER: {
      return { value: buf.readDoubleBE(offset + 1), bytesRead: 9 };
    }
    case AMF.BOOLEAN: {
      return { value: buf[offset + 1] !== 0, bytesRead: 2 };
    }
    case AMF.STRING: {
      const len = buf.readUInt16BE(offset + 1);
      return { value: buf.toString("utf8", offset + 3, offset + 3 + len), bytesRead: 3 + len };
    }
    case AMF.LONG_STRING: {
      const len = buf.readUInt32BE(offset + 1);
      return { value: buf.toString("utf8", offset + 5, offset + 5 + len), bytesRead: 5 + len };
    }
    case AMF.NULL:
      return { value: null, bytesRead: 1 };
    case AMF.UNDEFINED:
      return { value: undefined, bytesRead: 1 };
    case AMF.DATE: {
      return { value: new Date(buf.readDoubleBE(offset + 1)), bytesRead: 11 };
    }
    case AMF.REFERENCE:
      return { value: null, bytesRead: 3 };
    case AMF.OBJECT: {
      const { obj, bytesRead } = decodeObjectBody(buf, offset + 1);
      return { value: obj, bytesRead: 1 + bytesRead };
    }
    case AMF.ECMA_ARRAY: {
      // uint32 count, then an object body; the count is advisory.
      const { obj, bytesRead } = decodeObjectBody(buf, offset + 5);
      return { value: obj, bytesRead: 5 + bytesRead };
    }
    case AMF.STRICT_ARRAY: {
      const count = buf.readUInt32BE(offset + 1);
      let pos = offset + 5;
      const arr: AmfValue[] = [];
      for (let i = 0; i < count; i++) {
        const d = amfDecode(buf, pos);
        arr.push(d.value);
        pos += d.bytesRead;
      }
      return { value: arr, bytesRead: pos - offset };
    }
    default:
      throw new Error(`Unsupported AMF0 type marker 0x${type?.toString(16) ?? "??"}`);
  }
}

function decodeObjectBody(
  buf: Buffer,
  start: number,
): { obj: Record<string, AmfValue>; bytesRead: number } {
  const obj: Record<string, AmfValue> = {};
  let pos = start;
  for (;;) {
    if (pos + 3 > buf.length) throw new Error("AMF object body overruns buffer");
    const keyLen = buf.readUInt16BE(pos);
    if (keyLen === 0 && buf[pos + 2] === AMF.OBJECT_END) {
      pos += 3;
      break;
    }
    const key = buf.toString("utf8", pos + 2, pos + 2 + keyLen);
    pos += 2 + keyLen;
    const d = amfDecode(buf, pos);
    obj[key] = d.value;
    pos += d.bytesRead;
  }
  return { obj, bytesRead: pos - start };
}

/** Decode a full AMF0 command/data payload into its value list. */
export function amfDecodeAll(buf: Buffer): AmfValue[] {
  const values: AmfValue[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const d = amfDecode(buf, pos);
    values.push(d.value);
    pos += d.bytesRead;
  }
  return values;
}

/* ══ Chunk stream layer ══════════════════════════════════════════════ */

export const RTMP_MSG = {
  SET_CHUNK_SIZE: 1,
  ABORT: 2,
  ACK: 3,
  USER_CONTROL: 4,
  WINDOW_ACK_SIZE: 5,
  SET_PEER_BANDWIDTH: 6,
  AUDIO: 8,
  VIDEO: 9,
  DATA_AMF3: 15,
  COMMAND_AMF3: 17,
  DATA_AMF0: 18,
  COMMAND_AMF0: 20,
  AGGREGATE: 22,
} as const;

export interface RtmpMessage {
  chunkStreamId: number;
  messageStreamId: number;
  typeId: number;
  /** Absolute timestamp (ms) on the message's chunk stream. */
  timestamp: number;
  payload: Buffer;
}

interface ChunkStreamState {
  lastLength: number;
  lastTypeId: number;
  lastStreamId: number;
  lastTimestamp: number;
  lastDelta: number;
  hasExtTs: boolean;
  /* In-flight message assembly. */
  assembling: {
    typeId: number;
    streamId: number;
    timestamp: number;
    length: number;
    parts: Buffer[];
    received: number;
  } | null;
}

const DEFAULT_CHUNK_SIZE = 128;
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024; // sanity ceiling vs garbage lengths

export class RtmpChunkParser {
  private buffer: Buffer = Buffer.alloc(0);
  private streams = new Map<number, ChunkStreamState>();
  private inboundChunkSize = DEFAULT_CHUNK_SIZE;
  /* When set, we're mid-chunk: header parsed, payload bytes owed. */
  private pending: { csid: number; take: number } | null = null;

  constructor(private readonly onMessage: (msg: RtmpMessage) => void) {}

  feed(data: Buffer): void {
    this.buffer = this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data]);
    this.drain();
  }

  private stateFor(csid: number): ChunkStreamState {
    let s = this.streams.get(csid);
    if (!s) {
      s = {
        lastLength: 0,
        lastTypeId: 0,
        lastStreamId: 0,
        lastTimestamp: 0,
        lastDelta: 0,
        hasExtTs: false,
        assembling: null,
      };
      this.streams.set(csid, s);
    }
    return s;
  }

  private drain(): void {
    for (;;) {
      if (this.pending) {
        const { csid, take } = this.pending;
        if (this.buffer.length < take) return;
        const s = this.stateFor(csid);
        const piece = this.buffer.subarray(0, take);
        this.buffer = this.buffer.subarray(take);
        this.pending = null;
        if (s.assembling) {
          s.assembling.parts.push(Buffer.from(piece));
          s.assembling.received += take;
          if (s.assembling.received >= s.assembling.length) {
            const done = s.assembling;
            s.assembling = null;
            this.emit(csid, done);
          }
        }
        continue;
      }
      if (!this.parseChunkHeader()) return;
    }
  }

  private emit(csid: number, done: NonNullable<ChunkStreamState["assembling"]>): void {
    const payload = done.parts.length === 1 ? done.parts[0]! : Buffer.concat(done.parts, done.length);
    if (done.typeId === RTMP_MSG.SET_CHUNK_SIZE && payload.length >= 4) {
      const size = payload.readUInt32BE(0) & 0x7fffffff;
      if (size >= 16 && size <= 0x1000000) this.inboundChunkSize = size;
    }
    this.onMessage({
      chunkStreamId: csid,
      messageStreamId: done.streamId,
      typeId: done.typeId,
      timestamp: done.timestamp,
      payload,
    });
  }

  /** Parse one chunk header from the head of the buffer.
   *  Returns false when more bytes are needed. */
  private parseChunkHeader(): boolean {
    const buf = this.buffer;
    if (buf.length < 1) return false;
    const first = buf[0]!;
    const fmt = first >> 6;
    let csid = first & 0x3f;
    let pos = 1;
    if (csid === 0) {
      if (buf.length < 2) return false;
      csid = 64 + buf[1]!;
      pos = 2;
    } else if (csid === 1) {
      if (buf.length < 3) return false;
      csid = 64 + buf[1]! + 256 * buf[2]!;
      pos = 3;
    }
    const s = this.stateFor(csid);
    const headerLen = fmt === 0 ? 11 : fmt === 1 ? 7 : fmt === 2 ? 3 : 0;
    /* A fmt-3 continuation of an in-flight message repeats the ext-ts
       field when the message's header carried one. */
    const continuing = fmt === 3 && s.assembling !== null;
    const extLen = continuing ? (s.hasExtTs ? 4 : 0) : 0;
    if (buf.length < pos + headerLen + extLen) return false;

    let timestampField = 0;
    let delta = 0;
    let length = s.lastLength;
    let typeId = s.lastTypeId;
    let streamId = s.lastStreamId;
    let hasExtTs = s.hasExtTs;

    if (fmt === 0) {
      timestampField = buf.readUIntBE(pos, 3);
      length = buf.readUIntBE(pos + 3, 3);
      typeId = buf[pos + 6]!;
      streamId = buf.readUInt32LE(pos + 7);
      hasExtTs = timestampField === 0xffffff;
    } else if (fmt === 1) {
      delta = buf.readUIntBE(pos, 3);
      length = buf.readUIntBE(pos + 3, 3);
      typeId = buf[pos + 6]!;
      hasExtTs = delta === 0xffffff;
    } else if (fmt === 2) {
      delta = buf.readUIntBE(pos, 3);
      hasExtTs = delta === 0xffffff;
    }
    pos += headerLen;

    if (continuing) {
      pos += extLen; // value repeats the message timestamp; not needed
    } else if (hasExtTs) {
      if (buf.length < pos + 4) return false;
      const ext = buf.readUInt32BE(pos);
      pos += 4;
      if (fmt === 0) timestampField = ext;
      else delta = ext;
    }

    if (!continuing) {
      if (length <= 0 || length > MAX_MESSAGE_BYTES) {
        throw new Error(`RTMP message length ${length} is implausible — dropping the connection`);
      }
      /* fmt 3 starting a NEW message repeats the previous header —
         including its delta, applied once more. */
      const effectiveDelta = fmt === 0 ? 0 : fmt === 3 ? s.lastDelta : delta;
      const absolute = fmt === 0 ? timestampField : s.lastTimestamp + effectiveDelta;
      s.assembling = {
        typeId,
        streamId,
        timestamp: absolute,
        length,
        parts: [],
        received: 0,
      };
      s.lastLength = length;
      s.lastTypeId = typeId;
      s.lastStreamId = streamId;
      s.lastTimestamp = absolute;
      s.lastDelta = effectiveDelta;
      s.hasExtTs = hasExtTs;
    }

    this.buffer = buf.subarray(pos);
    const remaining = s.assembling!.length - s.assembling!.received;
    const take = Math.min(this.inboundChunkSize, remaining);
    this.pending = { csid, take };
    return true;
  }
}

/* ══ Outbound chunk writer ═══════════════════════════════════════════ */

export const OUTBOUND_CHUNK_SIZE = 4096;

export function encodeRtmpMessage(args: {
  chunkStreamId: number;
  messageStreamId: number;
  typeId: number;
  payload: Buffer;
  timestamp?: number;
}): Buffer {
  const { chunkStreamId: csid, messageStreamId, typeId, payload } = args;
  if (csid < 2 || csid > 63) throw new Error("writer supports csid 2..63");
  const head = Buffer.alloc(12);
  head[0] = csid; // fmt 0
  head.writeUIntBE(0, 1, 3); // timestamp 0 — control/command traffic
  head.writeUIntBE(payload.length, 4, 3);
  head[7] = typeId;
  head.writeUInt32LE(messageStreamId, 8);
  const parts: Buffer[] = [head];
  let offset = 0;
  let first = true;
  while (offset < payload.length || first) {
    const take = Math.min(OUTBOUND_CHUNK_SIZE, payload.length - offset);
    if (!first) parts.push(Buffer.from([(3 << 6) | csid]));
    parts.push(payload.subarray(offset, offset + take));
    offset += take;
    first = false;
    if (payload.length === 0) break;
  }
  return Buffer.concat(parts);
}

export function setChunkSizeMessage(size: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(size, 0);
  return encodeRtmpMessage({ chunkStreamId: 2, messageStreamId: 0, typeId: RTMP_MSG.SET_CHUNK_SIZE, payload });
}

export function windowAckSizeMessage(size: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(size, 0);
  return encodeRtmpMessage({ chunkStreamId: 2, messageStreamId: 0, typeId: RTMP_MSG.WINDOW_ACK_SIZE, payload });
}

export function setPeerBandwidthMessage(size: number, limitType = 0): Buffer {
  const payload = Buffer.alloc(5);
  payload.writeUInt32BE(size, 0);
  payload[4] = limitType;
  return encodeRtmpMessage({ chunkStreamId: 2, messageStreamId: 0, typeId: RTMP_MSG.SET_PEER_BANDWIDTH, payload });
}

/** User Control message: event type + a uint32 body (a message
 *  stream id for Stream Begin/EOF, a timestamp for ping req/resp). */
export function userControlMessage(eventType: number, body: number): Buffer {
  const payload = Buffer.alloc(6);
  payload.writeUInt16BE(eventType, 0);
  payload.writeUInt32BE(body, 2);
  return encodeRtmpMessage({ chunkStreamId: 2, messageStreamId: 0, typeId: RTMP_MSG.USER_CONTROL, payload });
}

/** User Control: Stream Begin (event 0) for a message stream id. */
export function streamBeginMessage(messageStreamId: number): Buffer {
  return userControlMessage(0, messageStreamId);
}

/** User Control: Stream EOF (event 1). */
export function streamEofMessage(messageStreamId: number): Buffer {
  return userControlMessage(1, messageStreamId);
}

export function commandMessage(messageStreamId: number, values: AmfValue[]): Buffer {
  return encodeRtmpMessage({
    chunkStreamId: 3,
    messageStreamId,
    typeId: RTMP_MSG.COMMAND_AMF0,
    payload: Buffer.concat(values.map((v) => amfEncode(v))),
  });
}

/* ══ Handshake ═══════════════════════════════════════════════════════ */

export const RTMP_VERSION = 3;
export const HANDSHAKE_BYTES = 1536;

/** S0+S1 for a received C0 version byte; S2 is the echo of C1. */
export function buildHandshakeResponse(c1: Buffer): Buffer {
  const s0 = Buffer.from([RTMP_VERSION]);
  const s1 = Buffer.alloc(HANDSHAKE_BYTES);
  s1.writeUInt32BE(0, 0); // time (0 is fine — no clock sync in play)
  s1.writeUInt32BE(0, 4); // zero field
  randomBytes(HANDSHAKE_BYTES - 8).copy(s1, 8);
  const s2 = Buffer.from(c1); // echo: time + zero + the client's random
  s2.writeUInt32BE(0, 4); // time2 is not validated by real encoders
  return Buffer.concat([s0, s1, s2]);
}

/* ══ FLV muxer ═══════════════════════════════════════════════════════ */

export function flvHeader(): Buffer {
  // "FLV", version 1, flags 0x05 (audio + video), header size 9, prev0.
  return Buffer.from([
    0x46, 0x4c, 0x56, 0x01, 0x05, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00,
  ]);
}

export function flvTag(typeId: number, timestamp: number, data: Buffer): Buffer {
  const head = Buffer.alloc(11);
  head[0] = typeId;
  head.writeUIntBE(data.length, 1, 3);
  head.writeUIntBE(timestamp & 0xffffff, 4, 3);
  head[7] = (timestamp >>> 24) & 0xff;
  head.writeUIntBE(0, 8, 3); // stream id (always 0 in FLV)
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(11 + data.length, 0);
  return Buffer.concat([head, data, tail]);
}

/**
 * An RTMP data message's payload opens with the AMF string
 * "@setDataFrame"; an FLV script tag carries only the remaining
 * values ("onMetaData", the metadata object). Strip the frame marker
 * when present; anything else passes through untouched.
 */
export function flvScriptData(rtmpDataPayload: Buffer): Buffer {
  try {
    const first = amfDecode(rtmpDataPayload, 0);
    if (first.value === "@setDataFrame") {
      return rtmpDataPayload.subarray(first.bytesRead);
    }
  } catch {
    /* not an AMF-led payload — pass through as-is */
  }
  return rtmpDataPayload;
}
