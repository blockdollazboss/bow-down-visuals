import { useEffect, useRef } from "react";
import type { ChromaKeySettings } from "@/lib/editor-settings";

/* ── ChromaKeyPreview ────────────────────────────────────────────────────
 * Live canvas preview for chroma key. CSS cannot key out a selected color,
 * so when chroma is enabled for the current clip we draw the master player's
 * video frames to a canvas and apply a real-time RGB-distance key in JS.
 * The export equivalent is the chromakey filter in buildProToolsFilterChain().
 */

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 255, 0];
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function hexToCss(hex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  return m ? `#${m[1]}` : "#000000";
}

export function ChromaKeyPreview({
  videoRef,
  settings,
  className = "",
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  settings: ChromaKeySettings;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastW = 0;
    const off = document.createElement("canvas");
    const offCtx = off.getContext("2d", { willReadFrequently: true });

    const render = () => {
      raf = requestAnimationFrame(render);
      const v = videoRef.current;
      const s = settingsRef.current;
      if (!v || v.readyState < 2 || v.videoWidth === 0) return;
      // Work at a capped resolution for real-time keying.
      const scale = Math.min(1, 480 / v.videoWidth);
      const w = Math.max(2, Math.round(v.videoWidth * scale));
      const h = Math.max(2, Math.round(v.videoHeight * scale));
      if (w !== lastW) {
        canvas.width = w; canvas.height = h;
        off.width = w; off.height = h;
        lastW = w;
      }
      if (!offCtx) return;
      offCtx.drawImage(v, 0, 0, w, h);
      let img: ImageData;
      try {
        img = offCtx.getImageData(0, 0, w, h);
      } catch {
        return; // CORS-tainted — can't key cross-origin frames.
      }
      const [kr, kg, kb] = hexToRgb(s.color);
      // similarity 0..100 → distance threshold (0..~441 max RGB distance).
      const thresh = (s.similarity / 100) * 200;
      const feather = (s.blend / 100) * 120;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const dr = d[i]! - kr, dg = d[i + 1]! - kg, db = d[i + 2]! - kb;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < thresh) {
          d[i + 3] = 0;
        } else if (feather > 0 && dist < thresh + feather) {
          d[i + 3] = Math.round(255 * ((dist - thresh) / feather));
        }
      }
      // Paint bg color, then the keyed frame over it.
      ctx.fillStyle = hexToCss(s.bgColor);
      ctx.fillRect(0, 0, w, h);
      ctx.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      data-testid="chroma-key-preview"
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}
