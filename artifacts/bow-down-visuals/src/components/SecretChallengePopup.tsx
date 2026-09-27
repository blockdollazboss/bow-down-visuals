import { useEffect, useRef } from "react";
import { Crown } from "lucide-react";

/* Procedural fireworks sound: launch whistle -> sharp bang -> crackle.
   No audio file needed. */
function playFireworksSound() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.4;
    master.connect(ctx.destination);

    // Shared 2s white-noise buffer reused by bangs and crackles.
    const noiseLen = Math.floor(ctx.sampleRate * 2);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;

    const oneFirework = (startAt: number) => {
      const t0 = ctx.currentTime + startAt;

      // 1. Launch whistle: soft rising tone, ~0.45s.
      const whistle = ctx.createOscillator();
      const wGain = ctx.createGain();
      whistle.type = "sine";
      whistle.frequency.setValueAtTime(500, t0);
      whistle.frequency.exponentialRampToValueAtTime(1800, t0 + 0.45);
      wGain.gain.setValueAtTime(0.0001, t0);
      wGain.gain.exponentialRampToValueAtTime(0.1, t0 + 0.12);
      wGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.48);
      whistle.connect(wGain).connect(master);
      whistle.start(t0);
      whistle.stop(t0 + 0.5);

      // 2. Bang: loud noise burst with fast decay + low thump.
      const t1 = t0 + 0.5;
      const bang = ctx.createBufferSource();
      bang.buffer = noiseBuf;
      const bFilter = ctx.createBiquadFilter();
      bFilter.type = "lowpass";
      bFilter.frequency.setValueAtTime(9000, t1);
      bFilter.frequency.exponentialRampToValueAtTime(400, t1 + 0.35);
      const bGain = ctx.createGain();
      bGain.gain.setValueAtTime(0.85, t1);
      bGain.gain.exponentialRampToValueAtTime(0.001, t1 + 0.4);
      bang.connect(bFilter).connect(bGain).connect(master);
      bang.start(t1);
      bang.stop(t1 + 0.45);

      const thump = ctx.createOscillator();
      const thGain = ctx.createGain();
      thump.type = "sine";
      thump.frequency.setValueAtTime(120, t1);
      thump.frequency.exponentialRampToValueAtTime(35, t1 + 0.3);
      thGain.gain.setValueAtTime(0.65, t1);
      thGain.gain.exponentialRampToValueAtTime(0.001, t1 + 0.35);
      thump.connect(thGain).connect(master);
      thump.start(t1);
      thump.stop(t1 + 0.4);

      // 3. Crackle: random short pops for ~1.2s after the bang.
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
        pop.connect(bp).connect(pGain).connect(master);
        pop.start(ct);
        pop.stop(ct + dur + 0.02);
      }
    };

    // A volley of three fireworks, staggered.
    oneFirework(0.05);
    oneFirework(0.9);
    oneFirework(1.7);
    window.setTimeout(() => void ctx.close(), 6000);
  } catch {
    /* audio unavailable — stay silent */
  }
}

/* Canvas golden fireworks behind the card. */
function FireworksCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; hue: number }
    let particles: Particle[] = [];
    const burst = (x: number, y: number) => {
      const n = 60 + Math.floor(Math.random() * 40);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 1.5 + Math.random() * 4.5;
        particles.push({
          x, y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, maxLife: 50 + Math.random() * 40,
          size: 1 + Math.random() * 2.5,
          hue: 40 + Math.random() * 15, // gold range
        });
      }
    };

    let frame = 0;
    const tick = () => {
      frame++;
      if (frame % 45 === 0 && particles.length < 900) {
        burst(w * (0.15 + Math.random() * 0.7), h * (0.1 + Math.random() * 0.35));
      }
      ctx.clearRect(0, 0, w, h);
      particles = particles.filter((p) => p.life < p.maxLife);
      for (const p of particles) {
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.045; // gravity
        p.vx *= 0.985;
        const alpha = 1 - p.life / p.maxLife;
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
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[9996]" aria-hidden="true" />;
}

export function SecretChallengePopup({ credits, onClaim }: { credits: number; onClaim: () => void }) {
  useEffect(() => {
    playFireworksSound();
  }, []);

  return (
    <>
      {/* Golden screen edges */}
      <div
        className="pointer-events-none fixed inset-0 z-[9995]"
        aria-hidden="true"
        style={{ boxShadow: "inset 0 0 120px 24px rgba(201,168,76,0.45), inset 0 0 24px 4px rgba(201,168,76,0.7)" }}
      />
      <FireworksCanvas />

      {/* Card — no backdrop behind it */}
      <div className="fixed inset-0 z-[9997] flex items-center justify-center p-6 pointer-events-none" role="dialog" aria-modal="true" aria-label="Secret challenge complete">
        <div className="pointer-events-auto relative w-full max-w-md rounded-2xl border-2 border-[#C9A84C] bg-black/90 px-8 py-8 text-center shadow-[0_0_80px_rgba(201,168,76,0.5)] backdrop-blur-md animate-[popIn_0.45s_cubic-bezier(0.34,1.56,0.64,1)_both]">
          {/* 8-bit shark peeking from the right edge — kept outside the
              dialog so it never covers the title text */}
          <img
            src={`${import.meta.env.BASE_URL}thy-cheat-code-8bit.webp`}
            alt=""
            aria-hidden="true"
            className="absolute -right-36 top-1/2 hidden h-44 w-auto -translate-y-1/2 sm:block"
          />
          <Crown className="mx-auto h-10 w-10 text-[#C9A84C]" aria-hidden="true" />
          <h2 className="mt-3 font-display text-3xl font-bold text-[#e8c86a]">You Cracked the Code!</h2>
          <p className="mt-3 text-sm text-white/70">You&rsquo;ve been awarded</p>
          <p className="mt-1 font-display text-5xl font-bold text-[#e8c86a]">{credits} credits</p>
          <button
            type="button"
            onClick={onClaim}
            className="mt-6 w-full rounded-xl bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] py-3 text-lg font-bold text-black shadow-[0_0_32px_rgba(201,168,76,0.5)] transition hover:brightness-110 active:scale-[0.98]"
          >
            Claim
          </button>
          <p className="mt-4 text-xs italic text-[#C9A84C]/80">Shhh&hellip; don&rsquo;t tell nobody.</p>
        </div>
      </div>
      <style>{`@keyframes popIn { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
    </>
  );
}
