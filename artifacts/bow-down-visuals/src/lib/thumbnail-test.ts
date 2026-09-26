/* Pure helpers for the Thumbnail A/B Tester page — kept here so they're unit-testable. */

export type ScoreBand = "high" | "medium" | "low";

/** Map a 0-100 score to a band for color coding. */
export function scoreBand(value: number): ScoreBand {
  if (value >= 75) return "high";
  if (value >= 50) return "medium";
  return "low";
}

/** Tailwind bar color class for a score band. */
export function scoreBandClass(band: ScoreBand): string {
  switch (band) {
    case "high":
      return "bg-emerald-400";
    case "medium":
      return "bg-amber-400";
    case "low":
      return "bg-red-400";
  }
}

/** Validate the files a user picks before upload: images only, max 4. */
export function filterImageFiles(files: File[], max = 4): File[] {
  return files.filter((f) => f.type.startsWith("image/")).slice(0, max);
}
