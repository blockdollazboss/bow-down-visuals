/**
 * RVM model-contract tests — the pins that would have caught the
 * Oct 29, 2026 Pro-engine outage.
 *
 * The story: the vendored Pro model is the fp16 export, and its
 * graph declares its own tensor types — src and the recurrent
 * states float16, downsample_ratio float32, every output
 * float16. The worker fed it float32 tensors. Session creation
 * does not check feed types, so the engine "loaded"; every
 * session.run() then rejected ("Unexpected input data type.
 * Actual: (tensor(float)), expected: (tensor(float16))"), the
 * background changer counted the failures, parked the engine,
 * and the studio honestly reported "Background effects couldn't
 * load — camera is running plain." The tests at the time pinned
 * URLs, chains and step tables — everything except the one
 * contract that mattered: the types the model itself declares.
 *
 * These pins read the truth out of the shipped .onnx (a minimal
 * protobuf walk over the graph's declared inputs/outputs — no
 * runtime, no inference) and hold the vendored worker to it:
 * feeds built in the declared types, the float16 matte decoded
 * to the client's float32, an up-front Float16Array gate, and
 * the WASM-only provider ruling (the vendored runtime's WebGPU
 * provider rejects this graph's first run — AveragePool ceil
 * shape computation is unsupported there — bench-proven under
 * the production CSP, Oct 29, 2026).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/* ── Minimal protobuf wire walk (field iteration only) ─────── */

type Field = { num: number; wire: 0; value: number } | { num: number; wire: 2; value: Buffer };

function* fields(buf: Buffer): Generator<Field> {
  let i = 0;
  const varint = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = buf[i++];
      result |= (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return result;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const tag = varint();
    const num = Math.floor(tag / 8);
    const wire = tag % 8;
    if (wire === 0) {
      yield { num, wire, value: varint() };
    } else if (wire === 2) {
      const len = varint();
      yield { num, wire, value: buf.subarray(i, i + len) };
      i += len;
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 1) {
      i += 8;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
}

function messages(buf: Buffer, num: number): Buffer[] {
  const out: Buffer[] = [];
  for (const f of fields(buf)) if (f.num === num && f.wire === 2) out.push(f.value);
  return out;
}

function text(buf: Buffer, num: number): string | null {
  for (const f of fields(buf)) if (f.num === num && f.wire === 2) return f.value.toString("utf8");
  return null;
}

const ELEM_TYPE: Record<number, string> = { 1: "float32", 10: "float16" };

function valueInfoType(vi: Buffer): { name: string | null; elem: string | null } {
  let elem: string | null = null;
  for (const typeProto of messages(vi, 2)) {
    for (const tensorType of messages(typeProto, 1)) {
      for (const f of fields(tensorType)) {
        if (f.num === 1 && f.wire === 0) elem = ELEM_TYPE[f.value] ?? `elem_${f.value}`;
      }
    }
  }
  return { name: text(vi, 1), elem };
}

function modelSignature(): { inputs: Record<string, string>; outputs: Record<string, string> } {
  const model = readFileSync(
    new URL("../../../public/engines/rvm/rvm_mobilenetv3_fp16.onnx", import.meta.url),
  );
  const graph = messages(model, 7)[0];
  const initializerNames = new Set(
    messages(graph, 5)
      .map((t) => text(t, 8))
      .filter((n): n is string => n !== null),
  );
  const inputs: Record<string, string> = {};
  for (const vi of messages(graph, 11)) {
    const { name, elem } = valueInfoType(vi);
    if (name && elem && !initializerNames.has(name)) inputs[name] = elem;
  }
  const outputs: Record<string, string> = {};
  for (const vi of messages(graph, 12)) {
    const { name, elem } = valueInfoType(vi);
    if (name && elem) outputs[name] = elem;
  }
  return { inputs, outputs };
}

/* ── The model's declared signature ────────────────────────── */

describe("the vendored RVM model's declared signature", () => {
  it("declares float16 src and recurrent states, a float32 downsample_ratio, float16 outputs", () => {
    const { inputs, outputs } = modelSignature();
    expect(inputs).toEqual({
      src: "float16",
      r1i: "float16",
      r2i: "float16",
      r3i: "float16",
      r4i: "float16",
      downsample_ratio: "float32",
    });
    expect(outputs).toEqual({
      fgr: "float16",
      pha: "float16",
      r1o: "float16",
      r2o: "float16",
      r3o: "float16",
      r4o: "float16",
    });
  });
});

/* ── The worker honours the contract ───────────────────────── */

describe("the vendored worker honours the model's contract", () => {
  const src = readFileSync(
    new URL("../../../public/engines/rvm/rvm-worker.js", import.meta.url),
    "utf8",
  );

  it("builds the src feed as a float16 tensor carried in a Float16Array", () => {
    expect(src).toContain('new ort.Tensor("float16", Float16Array.from(buf), [1, 3, fh, fw])');
  });

  it("builds the recurrent zero states as float16 tensors", () => {
    expect(src).toContain('new ort.Tensor("float16", new Float16Array(1), [1, 1, 1, 1])');
  });

  it("keeps downsample_ratio float32 — the one input the graph declares float32", () => {
    expect(src).toContain('new ort.Tensor("float32", new Float32Array([ratio]), [1])');
  });

  it("decodes the float16 matte to the client's float32 before transfer", () => {
    expect(src).toContain("Float32Array.from(data)");
    expect(src).toContain("alpha instanceof Float16Array");
  });

  it("refuses init up front when Float16Array is unavailable", () => {
    expect(src).toContain('typeof Float16Array !== "function"');
  });

  it("creates sessions on the wasm provider only — the webgpu provider cannot run this graph", () => {
    expect(src).toContain('var providers = ["wasm"];');
    expect(src).not.toContain('"webgpu"');
  });

  it("routes synchronous feed/run failures to the frame-error path, never a silent hang", () => {
    expect(src).toContain("run = session.run(feeds);");
    expect(src).toContain("fail(err);");
  });
});
