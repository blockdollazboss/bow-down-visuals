/* Pure pricing for the Bio Generator rail (/generate-bio).
   Kept in a separate module so the price contract is importable
   without loading the route (the operator catalog pins its
   bio.generate price to this exact constant). */

/* 100 VB — the published operator price (owner ruling 2026-10-24: the
   operator list said 100 while this rail's default charged 50; the rail
   aligns to the published price). Env override unchanged. */
export const BIO_COST = Number(process.env["BIO_GENERATOR_CREDITS"]) || 100;
