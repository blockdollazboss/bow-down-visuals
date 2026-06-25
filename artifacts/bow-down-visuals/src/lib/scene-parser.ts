export interface SceneData {
  id: string;
  sceneNumber: number;
  timestamp: string;
  section: string;
  lyricLine: string;
  location: string;
  action: string;
  cameraMovement: string;
  lighting: string;
  mood: string;
  aiVideoPrompt: string;
  negativePrompt: string;
  approved: boolean;
  demoClipUrl: string | null;
  /** Runway-specific generation metadata */
  provider: string | null;
  generationStatus: "pending" | "completed" | "failed" | null;
  promptUsed: string | null;
  generatedAt: string | null;
}

/** Strip markdown bold/italic wrappers and leading bullet/dash from a line */
function cleanLine(line: string): string {
  return line
    .replace(/^\s*[-*•]\s*/, "")   // remove leading bullet
    .replace(/\*\*/g, "")           // remove **bold**
    .replace(/\*/g, "")             // remove *italic*
    .replace(/^#+\s*/, "")          // remove ## headers
    .trim();
}

/** Extract the value after "Label:" from a list of (already cleaned) lines */
function extractField(lines: string[], ...prefixes: string[]): string {
  for (const line of lines) {
    const cleaned = cleanLine(line);
    for (const prefix of prefixes) {
      const p = prefix.toLowerCase();
      const c = cleaned.toLowerCase();
      if (c.startsWith(p + ":")) {
        return cleaned.slice(prefix.length + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return "";
}

/**
 * Pull the raw text of the Scene-by-Scene Breakdown section from a full result string.
 * Tries multiple header patterns so it works regardless of how the AI formatted its output.
 * If no section header is found, returns the full result so parseScenes can still try.
 */
export function extractBreakdownContent(result: string): string {
  if (!result) return "";

  // All patterns that should end the section: next ## heading or end of string
  const sectionEnd = /(?=\n#{1,4}\s+[A-Z][^\n]{3,})|$/;

  const patterns = [
    // Exact prompt format: ## SCENE-BY-SCENE BREAKDOWN
    /#{1,4}\s*SCENE[- ]BY[- ]SCENE\s+BREAKDOWN[^\n]*\n([\s\S]+?)(?=\n#{1,4}\s+[A-Z][^\n]{3,}|$)/i,
    // ## SCENE BREAKDOWN or ### Scenes Breakdown
    /#{1,4}\s*SCENES?\s*BREAKDOWN[^\n]*\n([\s\S]+?)(?=\n#{1,4}\s+[A-Z][^\n]{3,}|$)/i,
    // ## VIDEO SCENES or ## VIDEO BREAKDOWN
    /#{1,4}\s*VIDEO\s+(?:SCENES?|BREAKDOWN|PLAN)[^\n]*\n([\s\S]+?)(?=\n#{1,4}\s+[A-Z][^\n]{3,}|$)/i,
    // ## SCENE PLAN or ## SCENES
    /#{1,4}\s*SCENE\s+PLAN[^\n]*\n([\s\S]+?)(?=\n#{1,4}\s+[A-Z][^\n]{3,}|$)/i,
  ];

  for (const pattern of patterns) {
    const m = result.match(pattern);
    if (m?.[1]?.trim()) return m[1].trim();
  }

  // No recognized section header — check if the text itself contains scene markers.
  // Return the full result so parseScenes can try its own splitting strategies.
  const hasSceneMarker = /(?:^|\n)\s*(?:\*\*|#+)?\s*[Ss]cene\s+\d+/m.test(result);
  const hasTimestamp   = /(?:^|\n)\s*[-*•]?\s*Timestamp\s*:/im.test(result);
  if (hasSceneMarker || hasTimestamp) return result;

  return "";
}

export function parseScenes(breakdownContent: string): SceneData[] {
  if (!breakdownContent || breakdownContent.trim().length < 20) return [];

  // Try splitting on scene headers first (most reliable)
  const sceneHeaderRegex = /(?:^|\n)(?:\s*(?:\*\*|#+)\s*)?[Ss]cene\s+\d+[:\s*]*/;
  const sceneHeaderParts = breakdownContent.split(sceneHeaderRegex).filter((b) => b.trim().length > 0);

  // If that gives us multiple blocks, use it
  if (sceneHeaderParts.length > 1) {
    return buildScenesFromBlocks(sceneHeaderParts);
  }

  // Fallback: split on lines that start a new timestamp entry
  const timestampSplitRegex = /\n(?=\s*[-*•]?\s*Timestamp\s*:)/i;
  const timestampParts = breakdownContent.split(timestampSplitRegex).filter((b) => b.trim().length > 0);

  if (timestampParts.length > 1) {
    return buildScenesFromBlocks(timestampParts);
  }

  // Last resort: try to split on double-newlines between scenes
  const paragraphParts = breakdownContent.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  if (paragraphParts.length > 1) {
    const candidate = buildScenesFromBlocks(paragraphParts);
    if (candidate.length > 0) return candidate;
  }

  return [];
}

function buildScenesFromBlocks(blocks: string[]): SceneData[] {
  const scenes: SceneData[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");

    const timestamp      = extractField(lines, "Timestamp");
    const section        = extractField(lines, "Section");
    const lyricLine      = extractField(lines, "Lyric/Line", "Lyric", "Line");
    const location       = extractField(lines, "Location");
    const action         = extractField(lines, "Action");
    const cameraMovement = extractField(lines, "Camera Movement", "Camera");
    const lighting       = extractField(lines, "Lighting");
    const mood           = extractField(lines, "Mood");
    const aiVideoPrompt  = extractField(lines, "AI Video Prompt", "AI Prompt", "Video Prompt", "Prompt");
    const negativePrompt = extractField(lines, "Negative Prompt", "Negative");

    // Only create a card if there's meaningful data
    if (timestamp || aiVideoPrompt || (section && location)) {
      scenes.push({
        id:              `scene-${scenes.length}`,
        sceneNumber:     scenes.length + 1,
        timestamp,
        section,
        lyricLine,
        location,
        action,
        cameraMovement,
        lighting,
        mood,
        aiVideoPrompt,
        negativePrompt,
        approved:        false,
        demoClipUrl:     null,
        provider:        null,
        generationStatus: null,
        promptUsed:      null,
        generatedAt:     null,
      });
    }
  }

  return scenes;
}
