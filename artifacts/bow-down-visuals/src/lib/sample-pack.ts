/* ─── Sample Pack Generator — frontend helpers ───────────────────────────────
   Pricing display, pack-size options, origin badges. Pure functions, tested. */

export interface PackSizeOption {
  size: 10 | 25 | 50;
  credits: number;
  label: string;
}

export const PACK_SIZE_OPTIONS: PackSizeOption[] = [
  { size: 10, credits: 5, label: "10 samples" },
  { size: 25, credits: 12, label: "25 samples" },
  { size: 50, credits: 20, label: "50 samples" },
];

export function creditsForSize(size: number): number {
  const opt = PACK_SIZE_OPTIONS.find((o) => o.size === size);
  if (!opt) throw new Error(`Unsupported pack size: ${size}`);
  return opt.credits;
}

export type SampleOrigin = "synthesized" | "ai-generated";

export function originBadge(origin: SampleOrigin): { label: string; className: string } {
  if (origin === "ai-generated") {
    return {
      label: "AI",
      className: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    };
  }
  return {
    label: "Synth",
    className: "border-white/20 bg-white/[0.06] text-white/60",
  };
}

/** "0:03" style duration for the sample list. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Per-sample credit math for display ("≈0.5 credits per sample"). */
export function perSampleCredits(size: number): string {
  const per = creditsForSize(size) / size;
  return per.toFixed(2).replace(/\.?0+$/, "");
}
