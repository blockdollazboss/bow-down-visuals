export const CREDIT_COSTS = {
  song: 1,
  video: 1,
  "song-video": 2,
  promo: 1,
  thumbnail: 1,
} as const;

export type ToolKey = keyof typeof CREDIT_COSTS;
