export interface SongSection {
  name: string;
  startTime?: string;
  endTime?: string;
  lyrics?: string;
  notes?: string;
}

export interface SongPromoClip {
  section: string;
  startTime?: string;
  endTime?: string;
  reason: string;
}

export interface SongStructure {
  hasTimestamps: boolean;
  sections: SongSection[];
  promo15: SongPromoClip;
  promo30: SongPromoClip;
  videoPacing: string;
  energyMap: string;
}

export function songStructureToPromptText(s: SongStructure): string {
  const lines: string[] = ["SONG STRUCTURE ANALYSIS — align your scene breakdown to these sections:"];
  for (const sec of s.sections) {
    const time = sec.startTime ? ` [${sec.startTime}${sec.endTime ? `–${sec.endTime}` : ""}]` : "";
    lines.push(`  • ${sec.name}${time}${sec.notes ? `: ${sec.notes}` : ""}`);
  }
  if (s.promo15?.section) lines.push(`Best 15s promo clip: ${s.promo15.section} — ${s.promo15.reason}`);
  if (s.promo30?.section) lines.push(`Best 30s promo clip: ${s.promo30.section} — ${s.promo30.reason}`);
  if (s.videoPacing) lines.push(`Video Pacing: ${s.videoPacing}`);
  if (s.energyMap) lines.push(`Energy Arc: ${s.energyMap}`);
  return lines.join("\n");
}
