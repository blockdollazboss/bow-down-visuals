/**
 * LevelMeter — a small RMS bar fed by any AnalyserNode getter (the
 * mixer's channels / master bus). Peaks green under −12 dBFS, gold to
 * −6, red above. Stays flat and dim when there's no analyser (channel
 * not wired yet) — an honest silent meter, not a fake animation.
 */
import { useEffect, useRef } from "react";

export default function LevelMeter({
  getAnalyser,
  width = 72,
}: {
  getAnalyser: () => AnalyserNode | null;
  width?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const getRef = useRef(getAnalyser);
  getRef.current = getAnalyser;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const analyser = getRef.current();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(0, 0, w, h);
      if (!analyser) return;
      if (!buf || buf.length !== analyser.fftSize) buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i]! - 128) / 128;
        sum += v * v;
      }
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 0.0001);
      const frac = Math.max(0, Math.min(1, (db + 55) / 55));
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#3f9e4d");
      grad.addColorStop(0.72, "#C9A84C");
      grad.addColorStop(0.95, "#c0392b");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w * frac, h);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={10}
      className="rounded-sm border border-black/30"
      aria-hidden
    />
  );
}
