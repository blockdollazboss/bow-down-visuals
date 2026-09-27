import { useEffect, useRef } from "react";

/* ============================================================
   Synced fireworks show.
   One timeline drives BOTH the canvas visuals and the WebAudio
   sounds: each rocket whistles as it rises, then its bang lands
   at the exact moment the burst flashes on screen, followed by
   crackle. Sound and picture are never on separate clocks.
   ============================================================ */

const ROCKET_FLIGHT_S = 0.5; // rocket rise time — visuals + audio agree on this

function makeAudioCtx(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    return new Ctx();
  } catch {
    return null;
  }
}

function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** One firework's full sound: whistle (0→0.5s), bang (exactly 0.5s),
 *  crackle (0.65→1.85s). `delaySec` offsets the whole firework. */
function scheduleFireworkSound(
  ctx: AudioContext,
  master: GainNode,
  noiseBuf: AudioBuffer,
  delaySec: number,
) {
  const t0 = ctx.currentTime + delaySec;

  // 1. Launch whistle — rises as the rocket climbs.
  const whistle = ctx.createOscillator();
  const wGain = ctx.createGain();
  whistle.type = "sine";
  whistle.frequency.setValueAtTime(500, t0);
  whistle.frequency.exponentialRampToValueAtTime(1800, t0 + ROCKET_FLIGHT_S);
  wGain.gain.setValueAtTime(0.0001, t0);
  wGain.gain.exponentialRampToValueAtTime(0.1, t0 + 0.12);
  wGain.gain.exponentialRampToValueAtTime(0.0001, t0 + ROCKET_FLIGHT_S);
  whistle.connect(wGain);
  wGain.connect(master);
  whistle.start(t0);
  whistle.stop(t0 + ROCKET_FLIGHT_S + 0.02);

  // 2. Bang — exactly when the rocket bursts on screen.
  const t1 = t0 + ROCKET_FLIGHT_S;
  const bang = ctx.createBufferSource();
  bang.buffer = noiseBuf;
  const bFilter = ctx.createBiquadFilter();
  bFilter.type = "lowpass";
  bFilter.frequency.setValueAtTime(9000, t1);
  bFilter.frequency.exponentialRampToValueAtTime(400, t1 + 0.35);
  const bGain = ctx.createGain();
  bGain.gain.setValueAtTime(0.85, t1);
  bGain.gain.exponentialRampToValueAtTime(0.001, t1 + 0.4);
  bang.connect(bFilter);
  bFilter.connect(bGain);
  bGain.connect(master);
  bang.start(t1);
  bang.stop(t1 + 0.45);

  const thump = ctx.createOscillator();
  const thGain = ctx.createGain();
  thump.type = "sine";
  thump.frequency.setValueAtTime(120, t1);
  thump.frequency.exponentialRampToValueAtTime(35, t1 + 0.3);
  thGain.gain.setValueAtTime(0.65, t1);
  thGain.gain.exponentialRampToValueAtTime(0.001, t1 + 0.35);
  thump.connect(thGain);
  thGain.connect(master);
  thump.start(t1);
  thump.stop(t1 + 0.4);

  // 3. Crackle — random short pops while the sparks fall.
  for (let i = 0; i < 22; i++) {
    const ct = t1 + 0.15 + Math.random() * 1.2;
    const dur = 0.02 + Math.random() * 0.04;
    const pop = ctx.createBufferSource();
    pop.buffer = noiseBuf;
    pop.playbackRate.value = 0.8 + Math.random() * 0.8;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2500 + Math.random() * 3500;
    bp.Q.value = 1.2;
    const pGain = ctx.createGain();
    pGain.gain.setValueAtTime(0.08 + Math.random() * 0.16, ct);
    pGain.gain.exponentialRampToValueAtTime(0.001, ct + dur);
    pop.connect(bp);
    bp.connect(pGain);
    pGain.connect(master);
    pop.start(ct);
    pop.stop(ct + dur + 0.02);
  }
}

/* ---------------- Canvas: rockets, bursts, bokeh, confetti ---------------- */

export interface FireworksHandle {
  /** Launch a rocket that bursts at (xPct, yPct) of the canvas after exactly ROCKET_FLIGHT_S. */
  launch: (xPct: number, yPct: number) => void;
}

interface Rocket {
  x: number;
  y: number;
  targetY: number;
  vy: number;
  trail: { x: number; y: number; life: number }[];
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
  crackle: boolean;
}
interface Bokeh {
  x: number;
  y: number;
  r: number;
  vy: number;
  alpha: number;
  phase: number;
}
interface Confetti {
  x: number;
  y: number;
  vy: number;
  sway: number;
  phase: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
}

function FireworksCanvas({ handleRef }: { handleRef: React.RefObject<FireworksHandle | null> }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    onResize();
    window.addEventListener("resize", onResize);

    const rockets: Rocket[] = [];
    let particles: Particle[] = [];
    const flashes: { x: number; y: number; life: number; maxLife: number }[] = [];
    const bokeh: Bokeh[] = Array.from({ length: 26 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: 20 + Math.random() * 60,
      vy: 0.15 + Math.random() * 0.35,
      alpha: 0.04 + Math.random() * 0.06,
      phase: Math.random() * Math.PI * 2,
    }));
    const confetti: Confetti[] = Array.from({ length: 70 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vy: 0.8 + Math.random() * 1.8,
      sway: 20 + Math.random() * 40,
      phase: Math.random() * Math.PI * 2,
      w: 4 + Math.random() * 6,
      h: 2 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.1,
    }));

    const burst = (x: number, y: number) => {
      // Expanding core flash ring — the big golden bloom from the mockup.
      flashes.push({ x, y, life: 0, maxLife: 30 });
      // Core flash
      for (let i = 0; i < 44; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 4;
        particles.push({
          x, y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, maxLife: 34 + Math.random() * 22,
          size: 3 + Math.random() * 3.5,
          hue: 48, crackle: false,
        });
      }
      // Main gold burst — bigger, wider, longer-lived.
      const count = 140 + Math.floor(Math.random() * 50);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
        const sp = 3 + Math.random() * 7.5;
        particles.push({
          x, y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, maxLife: 70 + Math.random() * 55,
          size: 1.5 + Math.random() * 3,
          hue: 38 + Math.random() * 18,
          crackle: false,
        });
      }
      // Crackle sparks — blink as they fall, matching the crackle audio.
      for (let i = 0; i < 22; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1 + Math.random() * 4;
        particles.push({
          x: x + (Math.random() - 0.5) * 60,
          y: y + (Math.random() - 0.5) * 60,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, maxLife: 70 + Math.random() * 50,
          size: 1 + Math.random() * 1.8,
          hue: 45 + Math.random() * 10,
          crackle: true,
        });
      }
    };

    if (handleRef) {
      handleRef.current = {
        launch: (xPct: number, yPct: number) => {
          const x = w * xPct;
          const targetY = h * yPct;
          const startY = h + 12;
          const frames = ROCKET_FLIGHT_S * 60;
          rockets.push({
            x, y: startY, targetY,
            vy: (startY - targetY) / frames,
            trail: [],
          });
        },
      };
    }

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);

      // Bokeh ambience
      for (const b of bokeh) {
        b.y -= b.vy;
        b.phase += 0.01;
        if (b.y < -b.r) {
          b.y = h + b.r;
          b.x = Math.random() * w;
        }
        const tw = b.alpha * (0.7 + 0.3 * Math.sin(b.phase));
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0, `hsla(45, 95%, 60%, ${tw})`);
        g.addColorStop(1, "hsla(45, 95%, 60%, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Confetti
      for (const c of confetti) {
        c.y += c.vy;
        c.phase += 0.02;
        c.rot += c.vr;
        if (c.y > h + 10) {
          c.y = -10;
          c.x = Math.random() * w;
        }
        const cx = c.x + Math.sin(c.phase) * c.sway * 0.3;
        ctx.save();
        ctx.translate(cx, c.y);
        ctx.rotate(c.rot);
        ctx.fillStyle = "hsla(45, 95%, 62%, 0.85)";
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx.restore();
      }

      // Rockets
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.trail.push({ x: r.x, y: r.y, life: 1 });
        if (r.trail.length > 22) r.trail.shift();
        for (const t of r.trail) {
          t.life *= 0.92;
          ctx.fillStyle = `hsla(45, 100%, 65%, ${t.life * 0.8})`;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 2.2 * t.life + 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#fff8e0";
        ctx.beginPath();
        ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
        ctx.fill();
        r.y -= r.vy;
        if (r.y <= r.targetY) {
          burst(r.x, r.targetY);
          rockets.splice(i, 1);
        }
      }

      // Core flash rings — big golden blooms, expanding and fading.
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.life++;
        if (f.life >= f.maxLife) {
          flashes.splice(i, 1);
          continue;
        }
        const t = f.life / f.maxLife;
        const r = 30 + t * 190;
        const alpha = (1 - t) * 0.55;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        g.addColorStop(0, `hsla(48, 100%, 70%, ${alpha})`);
        g.addColorStop(0.55, `hsla(45, 95%, 58%, ${alpha * 0.5})`);
        g.addColorStop(1, "hsla(45, 95%, 55%, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Burst particles
      particles = particles.filter((p) => p.life < p.maxLife);
      for (const p of particles) {
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.045;
        p.vx *= 0.985;
        let alpha = 1 - p.life / p.maxLife;
        if (p.crackle) alpha *= 0.4 + 0.6 * Math.abs(Math.sin(p.life * 0.55));
        ctx.fillStyle = `hsla(${p.hue}, 95%, 62%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      if (handleRef) handleRef.current = null;
    };
  }, [handleRef]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 z-[9997]"
      aria-hidden="true"
    />
  );
}

/* ---------------- The popup, rebuilt to the approved mockup ---------------- */

const SHOW: { at: number; x: number; y: number }[] = [
  { at: 250, x: 0.2, y: 0.24 },
  { at: 950, x: 0.8, y: 0.2 },
  { at: 1650, x: 0.5, y: 0.3 },
  { at: 2350, x: 0.32, y: 0.18 },
  { at: 3050, x: 0.68, y: 0.26 },
];

export function SecretChallengePopup({
  credits,
  onClaim,
}: {
  credits: number;
  onClaim: () => void;
}) {
  const canvasHandle = useRef<FireworksHandle | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const ctx = makeAudioCtx();
    let master: GainNode | null = null;
    let noiseBuf: AudioBuffer | null = null;
    if (ctx) {
      master = ctx.createGain();
      master.gain.value = 0.4;
      master.connect(ctx.destination);
      noiseBuf = makeNoiseBuffer(ctx, 2);
    }

    const timers = SHOW.map((s) =>
      window.setTimeout(() => {
        // Same launch moment fires the whistle AND the rocket —
        // the bang is then locked to the on-screen burst.
        if (ctx && master && noiseBuf) scheduleFireworkSound(ctx, master, noiseBuf, 0);
        canvasHandle.current?.launch(s.x, s.y);
      }, s.at),
    );

    // Ambient celebration loop — the sky never goes quiet while the
    // popup is open. Each loop launch fires its own synced whistle/bang.
    let loopTimer = 0;
    const ambient = () => {
      const x = 0.15 + Math.random() * 0.7;
      const y = 0.14 + Math.random() * 0.22;
      if (ctx && master && noiseBuf) scheduleFireworkSound(ctx, master, noiseBuf, 0);
      canvasHandle.current?.launch(x, y);
      loopTimer = window.setTimeout(ambient, 2100 + Math.random() * 900);
    };
    loopTimer = window.setTimeout(ambient, 4200);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(loopTimer);
      if (ctx) void ctx.close().catch(() => {});
    };
  }, []);

  return (
    <>
      {/* Dark smoky overlay */}
      <div className="pointer-events-none fixed inset-0 z-[9995] bg-black/70" aria-hidden="true" />

      {/* Glowing gold frame around the whole screen (per mockup) */}
      <div
        className="pointer-events-none fixed inset-3 z-[9996] rounded-sm border-2 border-[#C9A84C]/90 sm:inset-4"
        aria-hidden="true"
        style={{
          boxShadow:
            "0 0 32px rgba(201,168,76,0.55), inset 0 0 32px rgba(201,168,76,0.35)",
        }}
      />

      <FireworksCanvas handleRef={canvasHandle} />

      {/* Card */}
      <div
        className="pointer-events-none fixed inset-0 z-[9998] flex items-center justify-center p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Secret challenge complete"
      >
        <div className="relative">
          <div
            className="pointer-events-auto relative z-10 w-full max-w-lg rounded-2xl bg-black/85 px-10 py-10 text-center backdrop-blur-xl animate-[popIn_0.45s_cubic-bezier(0.34,1.56,0.64,1)_both]"
            style={{
              border: "2px solid #C9A84C",
              boxShadow:
                "0 0 60px rgba(201,168,76,0.45), inset 0 0 40px rgba(201,168,76,0.12)",
            }}
          >
            {/* Inner hairline border */}
            <div
              className="pointer-events-none absolute inset-2 rounded-xl border border-[#C9A84C]/50"
              aria-hidden="true"
            />
            {/* Corner flourishes */}
            {["-top-1 -left-1 border-t-2 border-l-2 rounded-tl-lg",
              "-top-1 -right-1 border-t-2 border-r-2 rounded-tr-lg",
              "-bottom-1 -left-1 border-b-2 border-l-2 rounded-bl-lg",
              "-bottom-1 -right-1 border-b-2 border-r-2 rounded-br-lg"].map((pos) => (
              <div
                key={pos}
                aria-hidden="true"
                className={`pointer-events-none absolute ${pos} h-6 w-6 border-[#e8c86a]`}
              />
            ))}

            {/* Pixel-art gold crown (per mockup) */}
            <svg
              viewBox="0 0 20 14"
              className="mx-auto h-12 w-auto"
              aria-hidden="true"
              shapeRendering="crispEdges"
              style={{ filter: "drop-shadow(0 0 12px rgba(232,200,106,0.8))" }}
            >
              <rect x="3" y="10" width="14" height="3" fill="#e8c86a" />
              <rect x="3" y="5" width="2" height="5" fill="#e8c86a" />
              <rect x="9" y="3" width="2" height="7" fill="#e8c86a" />
              <rect x="15" y="5" width="2" height="5" fill="#e8c86a" />
              <rect x="3" y="3" width="2" height="2" fill="#f4dd8f" />
              <rect x="9" y="1" width="2" height="2" fill="#f4dd8f" />
              <rect x="15" y="3" width="2" height="2" fill="#f4dd8f" />
              <rect x="7" y="11" width="2" height="1" fill="#b08d3e" />
              <rect x="11" y="11" width="2" height="1" fill="#b08d3e" />
            </svg>
            <h2
              className="mt-4 font-display text-4xl font-bold text-[#e8c86a] sm:text-5xl"
              style={{ textShadow: "0 0 24px rgba(232,200,106,0.45)" }}
            >
              You Cracked the Code!
            </h2>
            <p className="mt-4 text-base text-white/80">You&rsquo;ve been awarded</p>
            <p
              className="mt-1 font-display text-6xl font-bold text-[#e8c86a] sm:text-7xl"
              style={{ textShadow: "0 0 32px rgba(232,200,106,0.55)" }}
            >
              {credits} credits
            </p>
            <button
              type="button"
              onClick={onClaim}
              className="mt-8 w-full rounded-xl bg-gradient-to-b from-[#f4dd8f] to-[#b08d3e] py-4 text-xl font-bold text-black transition hover:brightness-110 active:scale-[0.98]"
              style={{ boxShadow: "0 0 40px rgba(201,168,76,0.65)" }}
            >
              Claim
            </button>
            <p className="mt-5 text-sm italic text-[#C9A84C]/90">
              Shhh&hellip; don&rsquo;t tell nobody.
            </p>
          </div>

          {/* 8-bit King Shark peeking from behind the card's right edge */}
          <img
            src={`${import.meta.env.BASE_URL}thy-cheat-code-8bit.webp`}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none absolute left-[78%] top-[50%] z-0 hidden h-[105%] w-auto -translate-y-1/2 lg:block"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
      </div>
      <style>{`@keyframes popIn { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
    </>
  );
}
