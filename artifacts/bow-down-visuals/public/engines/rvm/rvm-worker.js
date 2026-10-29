"use strict";
/**
 * rvm-worker.js — the Pro matting engine's worker (Robust Video
 * Matting, MobileNetV3, via ONNX Runtime Web), vendored next to the
 * model it runs (public/engines/rvm).
 *
 * WHY THIS FILE EXISTS (the freeze, Oct 18–23, 2026): RVM used to
 * run IN THE PAGE. ONNX Runtime Web executes on the calling thread
 * unless it is offloaded — the WASM proxy worker was never enabled
 * and the WebGPU backend orchestrates and reads back on the caller
 * too — so every frame's inference, plus the synchronous
 * drawImage/getImageData/pixel-planar conversion ahead of it,
 * blocked the UI thread for the full inference cost, back to back,
 * for as long as a backdrop effect was on. On the owner's phone
 * that saturated the tab: the "freeze when an effect is picked"
 * that got the heavy engine pulled from the studio. The fix is
 * isolation, not a smaller model: the session, the recurrent
 * state, and all per-frame math live HERE, in a dedicated worker.
 * Inference can now block only this thread; the page ships one
 * frame bitmap in and gets one alpha matte back, both transferred
 * (zero-copy). If this worker hangs or dies, the page-side client
 * (rvm-engine.ts) times it out and the studio runs the camera raw
 * with the engine-down status shown — a heavy-engine failure is
 * visible, never a freeze and never a silent substitute engine.
 *
 * Protocol (client: src/lib/stream-kit/rvm-engine.ts):
 *   in : { type: "init", ortBases: string[], modelUrls: string[],
 *          threads: number }
 *        { type: "frame", seq, step, bitmap: ImageBitmap }
 *        { type: "step", step } | { type: "reset" }
 *        { type: "dispose" }
 *   out: { type: "ready", provider: "wasm" }
 *        { type: "init-error", message }
 *        { type: "matte", seq, alpha: ArrayBuffer (transferred),
 *          width, height, ms }
 *        { type: "frame-error", seq, message }
 *
 * Messages are handled strictly in order (a promise chain), so a
 * step change or a recurrence reset always lands BETWEEN frames,
 * never mid-inference. The step table below mirrors RVM_STEPS in
 * rvm-engine.ts — the two are pinned to each other by
 * rvm-engine.test.ts; change one, change both.
 *
 * Asset discipline matches the page-side loaders: the ONNX runtime
 * script and the model are tried vendored-first — the site's media
 * bucket, then the shipped same-origin copies, then the public
 * CDN/GitHub — and importScripts/fetch inside a worker may run
 * cross-origin exactly like the page's classic script loads did.
 *
 * INIT HARDENING (Stack-100 #3, Lane C): init used to lock onto
 * the first base whose runtime SCRIPT loaded, then try sessions
 * only under it — a base with a good script and a poisoned or
 * unreachable session path bricked the whole init even with good
 * copies elsewhere, and a single session create could hang
 * forever (a WebGPU compile that never returns on a phone),
 * eating the caller's entire init budget. Now init makes a FULL
 * attempt per base (script, then the provider × model session
 * chain for that base) and moves to the next base when a base's
 * chain fails outright; every session create races
 * CREATE_DEADLINE_MS, and a create that resolves after losing
 * its race is released, never adopted. The assets are the same
 * version-pinned vendored build at every base, so a later base's
 * WASM may serve a runtime script an earlier base loaded.
 *
 * THE FP16 TYPE CONTRACT + PROVIDER RULING (Oct 29, 2026): the
 * vendored model's graph declares its own tensor types — src
 * and the four recurrent states are float16, downsample_ratio
 * is float32, and every output (fgr, pha, r1o–r4o) is float16
 * (read straight out of the shipped .onnx). The feeds MUST be
 * built in those types: ONNX Runtime checks feed types at run
 * time and rejects the call, so float32 feeds against this
 * model fail EVERY frame on EVERY provider ("Unexpected input
 * data type. Actual: (tensor(float)), expected:
 * (tensor(float16))") — the session creates fine, which is why
 * load-only checks never saw it, and the first matte never
 * lands, which is why the studio parked the engine and ran the
 * camera plain. Feeding the model means speaking float16, and
 * the runtime's float16 tensors ride in Float16Array — a
 * browser without it cannot feed this model at all, so init
 * says so up front instead of dying frame by frame. The matte
 * comes back float16 and is decoded to the float32 the
 * page-side client contract carries before it is transferred.
 *
 * Sessions are created on the WASM provider ONLY. The WebGPU
 * execution provider in the vendored runtime (1.20.1) cannot
 * run this graph: its first run rejects with "using ceil() in
 * shape computation is not yet supported for AveragePool" —
 * a support check inside the runtime, not a driver quirk
 * (bench-proven under the production CSP, Oct 29, 2026, across
 * feed shapes and steps). A provider that cannot produce one
 * frame is never selected; if a future vendored runtime clears
 * that path, re-bench before re-adding it here.
 */

var RVM_STEPS = [
  { feedCap: 640, ratio: 0.5 },
  { feedCap: 640, ratio: 0.42 },
  { feedCap: 512, ratio: 0.5 },
  { feedCap: 512, ratio: 0.4 },
];

var ort = null;
var session = null;
var states = null;
var step = 0;
var feed = null;
var feedCtx = null;

function ratioFor(stepDef, feedLongSide) {
  if (stepDef.ratio !== "auto") return stepDef.ratio;
  var r = 480 / Math.max(1, feedLongSide);
  return Math.min(0.6, Math.max(0.3, r));
}

/* One session create may take this long before it counts as
   failed and the chain moves on (next model URL, next provider,
   next runtime base). See the INIT HARDENING note at the top. */
var CREATE_DEADLINE_MS = 10000;

function createSession(url, provider) {
  var create = ort.InferenceSession.create(url, { executionProviders: [provider] });
  var deadline = new Promise(function (_resolve, reject) {
    setTimeout(function () {
      reject(new Error("Session create timed out (" + provider + ")"));
    }, CREATE_DEADLINE_MS);
  });
  return Promise.race([create, deadline]).then(
    function (created) {
      return created;
    },
    function (err) {
      /* A create that resolves AFTER losing its race is released,
         never adopted — the chain has already moved on. */
      create.then(
        function (late) {
          if (late && typeof late.release === "function") {
            late.release().catch(function () {
              /* already released */
            });
          }
        },
        function () {
          /* the failure is already reported */
        },
      );
      throw err;
    },
  );
}

/* One full init attempt under one runtime base: load the runtime
   script from it (unless an earlier base already loaded it — the
   vendored build is identical at every base), point the WASM
   assets at it, then walk provider × model until a session
   stands. Resolves true when a session was created and "ready"
   posted; false when this base's chain failed outright and the
   next base deserves its attempt. */
function attemptBase(base, modelUrls, threads) {
  if (!self.ort) {
    try {
      importScripts(base + "/ort.all.min.js");
    } catch (err) {
      return Promise.resolve(false);
    }
  }
  if (!self.ort) return Promise.resolve(false);
  ort = self.ort;
  ort.env.logLevel = "warning";
  ort.env.wasm.wasmPaths = base + "/";
  ort.env.wasm.numThreads = Math.max(1, Math.min(4, threads || 1));
  /* WASM only — the WebGPU provider cannot run this graph in
     the vendored runtime (see the FP16 TYPE CONTRACT note). */
  var providers = ["wasm"];
  var chain = Promise.resolve(false);
  providers.forEach(function (provider) {
    modelUrls.forEach(function (url) {
      chain = chain.then(function (done) {
        if (done) return true;
        return createSession(url, provider).then(
          function (created) {
            session = created;
            states = null;
            self.postMessage({ type: "ready", provider: provider });
            return true;
          },
          function () {
            return false;
          },
        );
      });
    });
  });
  return chain;
}

function init(msg) {
  /* Feeding the fp16 model rides in Float16Array (see the FP16
     TYPE CONTRACT note): without it this worker cannot serve
     its model at all, so init refuses up front — an honest
     engine-down at load time, never thirty doomed frames. */
  if (typeof Float16Array !== "function") {
    self.postMessage({
      type: "init-error",
      message: "The Pro background engine could not be loaded.",
    });
    return Promise.resolve();
  }
  var bases = msg.ortBases || [];
  var modelUrls = msg.modelUrls || [];
  var chain = Promise.resolve(false);
  bases.forEach(function (base) {
    chain = chain.then(function (done) {
      if (done) return true;
      return attemptBase(base, modelUrls, msg.threads);
    });
  });
  return chain.then(function (done) {
    if (!done) {
      self.postMessage({
        type: "init-error",
        message: "The Pro background engine could not be loaded.",
      });
    }
  });
}

function zeroStates() {
  return [0, 1, 2, 3].map(function () {
    /* The recurrent states are float16-typed in the model's
       graph (see the FP16 TYPE CONTRACT note). */
    return new ort.Tensor("float16", new Float16Array(1), [1, 1, 1, 1]);
  });
}

function frame(msg) {
  var bitmap = msg.bitmap;
  var seq = msg.seq;
  function fail(err) {
    // A failed frame poisons the recurrence — restart it rather
    // than carrying corrupt state into the next frame.
    states = null;
    try {
      bitmap.close();
    } catch (e) {
      /* already closed */
    }
    self.postMessage({
      type: "frame-error",
      seq: seq,
      message: String((err && err.message) || err),
    });
  }
  if (!session || !ort) {
    fail(new Error("The Pro engine session is not ready."));
    return Promise.resolve();
  }
  if (typeof msg.step === "number" && msg.step !== step) {
    step = Math.max(0, Math.min(RVM_STEPS.length - 1, Math.floor(msg.step)));
    states = null;
  }
  var vw = bitmap.width;
  var vh = bitmap.height;
  if (!vw || !vh) {
    fail(new Error("The frame was empty."));
    return Promise.resolve();
  }
  var stepDef = RVM_STEPS[step];
  var scale = Math.min(1, stepDef.feedCap / vw);
  var fw = Math.max(2, Math.round(vw * scale));
  var fh = Math.max(2, Math.round((vh * fw) / vw));
  if (!feed) {
    feed = new OffscreenCanvas(fw, fh);
    feedCtx = feed.getContext("2d", { willReadFrequently: true });
  }
  if (feed.width !== fw || feed.height !== fh) {
    feed.width = fw;
    feed.height = fh;
    states = null; // geometry changed — recurrence restarts
  }
  var pixels;
  try {
    feedCtx.drawImage(bitmap, 0, 0, fw, fh);
    bitmap.close();
    pixels = feedCtx.getImageData(0, 0, fw, fh).data;
  } catch (err) {
    fail(err);
    return Promise.resolve();
  }
  var plane = fw * fh;
  var buf = new Float32Array(3 * plane);
  for (var i = 0, j = 0; i < plane; i++, j += 4) {
    buf[i] = pixels[j] / 255;
    buf[plane + i] = pixels[j + 1] / 255;
    buf[2 * plane + i] = pixels[j + 2] / 255;
  }
  /* Feeds are built in the model's declared types (see the
     FP16 TYPE CONTRACT note): src and the recurrent states are
     float16; downsample_ratio stays float32 because the graph
     declares it float32. A runtime that rejects a tensor
     construction throws synchronously, inside the message chain
     that absorbs it — catch, so a bad build is an honest frame
     error the client can count, not a silent hang the client
     only learns about from its frame timeout. */
  var feeds;
  var t0 = performance.now();
  try {
    if (!states) states = zeroStates();
    var ratio = ratioFor(stepDef, Math.max(fw, fh));
    feeds = {
      src: new ort.Tensor("float16", Float16Array.from(buf), [1, 3, fh, fw]),
      r1i: states[0],
      r2i: states[1],
      r3i: states[2],
      r4i: states[3],
      downsample_ratio: new ort.Tensor("float32", new Float32Array([ratio]), [1]),
    };
  } catch (err) {
    fail(err);
    return Promise.resolve();
  }
  var run;
  try {
    run = session.run(feeds);
  } catch (err) {
    fail(err);
    return Promise.resolve();
  }
  return run.then(
    function (outputs) {
      var ms = performance.now() - t0;
      var next = [outputs.r1o, outputs.r2o, outputs.r3o, outputs.r4o];
      if (next.every(Boolean)) states = next;
      var pha = outputs.pha;
      var alpha = pha && pha.data;
      var send = function (data) {
        // The matte leaves the model float16-typed and the
        // page-side client contract carries float32 — decode
        // here, and detach from the runtime's own buffer before
        // transferring.
        var copy = data instanceof Float32Array ? new Float32Array(data) : Float32Array.from(data);
        self.postMessage(
          { type: "matte", seq: seq, alpha: copy.buffer, width: fw, height: fh, ms: ms },
          [copy.buffer],
        );
      };
      if (alpha instanceof Float32Array || alpha instanceof Float16Array) {
        send(alpha);
      } else if (pha && typeof pha.getData === "function") {
        // GPU-side tensors keep their data on the GPU until asked.
        pha.getData().then(
          function (data) {
            if (data instanceof Float32Array || data instanceof Float16Array) send(data);
            else fail(new Error("The Pro engine returned no matte."));
          },
          function (err) {
            fail(err);
          },
        );
      } else {
        fail(new Error("The Pro engine returned no matte."));
      }
    },
    function (err) {
      fail(err);
    },
  );
}

function applyStep(next) {
  var clamped = Math.max(0, Math.min(RVM_STEPS.length - 1, Math.floor(next)));
  if (clamped === step) return;
  step = clamped;
  states = null; // geometry of the recurrence changes with the step
}

/* Strictly ordered message handling: frames, step changes and
   resets run one at a time, in arrival order, so the recurrent
   state is only ever touched by one operation at a time. */
var chain = Promise.resolve();
function enqueue(fn) {
  chain = chain.then(fn, fn);
}

self.onmessage = function (ev) {
  var msg = ev.data || {};
  if (msg.type === "init") {
    enqueue(function () {
      return init(msg);
    });
  } else if (msg.type === "frame") {
    enqueue(function () {
      return frame(msg);
    });
  } else if (msg.type === "step") {
    enqueue(function () {
      applyStep(msg.step);
    });
  } else if (msg.type === "reset") {
    enqueue(function () {
      states = null;
    });
  } else if (msg.type === "dispose") {
    var s = session;
    session = null;
    states = null;
    if (s && typeof s.release === "function") {
      s.release().catch(function () {
        /* already released */
      });
    }
    self.close();
  }
};
