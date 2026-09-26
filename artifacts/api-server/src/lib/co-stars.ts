import { db, artistVaultsTable, artistCharacterLinksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/**
 * Character co-stars — automatic pull-in for generation.
 *
 * When creating content for a character, their linked characters are
 * automatically pulled into the generation context. The AI director is
 * instructed: if a scene needs another person, use the linked character
 * whose role fits — don't invent a stranger.
 */

type VaultRow = typeof artistVaultsTable.$inferSelect;

function describeCharacter(vault: VaultRow, role: string): string {
  const parts: string[] = [
    `★ CO-STAR: ${vault.artist_name} (role: ${role})`,
  ];
  if (vault.artist_type) parts.push(`  Type: ${vault.artist_type}`);
  if (vault.visual_style) parts.push(`  Visual Style: ${vault.visual_style}`);
  if (vault.hair) parts.push(`  Hair: ${vault.hair}`);
  if (vault.tattoos) parts.push(`  Tattoos: ${vault.tattoos}`);
  if (vault.jewelry) parts.push(`  Jewelry: ${vault.jewelry}`);
  if (vault.clothing_style) parts.push(`  Clothing: ${vault.clothing_style}`);
  if (vault.brand_colors) parts.push(`  Brand Colors: ${vault.brand_colors}`);
  if (vault.personality) parts.push(`  Personality: ${vault.personality}`);
  if (vault.consistency_prompt) parts.push(`  Identity: ${vault.consistency_prompt}`);
  if (vault.reference_image_url)
    parts.push(`  Reference Image: ${vault.reference_image_url}`);
  return parts.join("\n");
}

/**
 * Build the co-star context block for a character. Returns "" when the
 * character has no linked characters. Safe to call on every generation —
 * it's a single indexed query plus one fetch per linked character.
 */
export async function buildCoStarContext(
  characterId: string | null | undefined,
  userId: string | null | undefined,
): Promise<string> {
  if (!characterId || !userId) return "";
  try {
    const links = await db
      .select()
      .from(artistCharacterLinksTable)
      .where(
        and(
          eq(artistCharacterLinksTable.character_id, characterId),
          eq(artistCharacterLinksTable.user_id, userId),
        ),
      );
    if (links.length === 0) return "";

    const blocks: string[] = [];
    for (const link of links) {
      const [vault] = await db
        .select()
        .from(artistVaultsTable)
        .where(eq(artistVaultsTable.id, link.linked_character_id));
      if (vault) blocks.push(describeCharacter(vault, link.role));
    }
    if (blocks.length === 0) return "";

    return [
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "CO-STARS — LINKED CHARACTERS (AUTO PULLED-IN)",
      "These characters are linked to the active artist. Whenever a scene,",
      "shot, or storyline needs another person, pull from THIS cast —",
      "match the role that fits (love interest, rival, collaborator, cameo).",
      "Do NOT invent a random stranger when a linked character fits the part.",
      "Describe each co-star with their identity details below so they stay",
      "consistent across every scene they appear in.",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      ...blocks,
    ].join("\n");
  } catch {
    /* Co-stars are enrichment — never break generation if the lookup fails. */
    return "";
  }
}
