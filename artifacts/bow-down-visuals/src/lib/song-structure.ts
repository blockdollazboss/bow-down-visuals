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

/* Removed 2026-10-10: songStructureToPromptText was dead (zero imports). */
