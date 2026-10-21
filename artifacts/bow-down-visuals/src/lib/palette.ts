/* ─── Palette extraction — client-side canvas pixel sampling (FREE) ──────────
   No API call, no credits. Sample a downscaled copy of the creator's cover
   art / artist photo and return the dominant colors as #RRGGBB hexes, which
   feed the AI Page Designer as a palette hint. */

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Extract up to `count` dominant colors from an image URL. */
export async function extractPalette(imageUrl: string, count = 5): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not load image for palette sampling."));
    img.src = imageUrl;
  });

  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas not available for palette sampling.");
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  /* Bucket pixels into coarse color clusters. */
  const clusters: { color: [number, number, number]; weight: number }[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 128) continue;
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    /* Skip near-black / near-white noise so the palette reads as "vibe". */
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 12 || lum > 244) continue;
    const px: [number, number, number] = [r, g, b];
    let best: (typeof clusters)[number] | null = null;
    for (const c of clusters) {
      if (colorDistance(c.color, px) < 48) {
        if (!best || colorDistance(c.color, px) < colorDistance(best.color, px)) best = c;
      }
    }
    if (best) {
      const w = best.weight;
      best.color = [
        (best.color[0] * w + r) / (w + 1),
        (best.color[1] * w + g) / (w + 1),
        (best.color[2] * w + b) / (w + 1),
      ];
      best.weight = w + 1;
    } else {
      clusters.push({ color: px, weight: 1 });
    }
  }

  clusters.sort((a, b) => b.weight - a.weight);
  return clusters.slice(0, count).map((c) => rgbToHex(c.color[0], c.color[1], c.color[2]));
}
