export interface SceneData {
  id: string;
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

/** Split breakdown text into per-scene blocks.
 *  Handles formats:
 *    **Scene 1** / **Scene 1:** / ### Scene 1 / Scene 1:
 *    followed by bullet lines with "- Label: value"
 */
/** Pull the raw text of the Scene-by-Scene Breakdown section from a full result string */
export function extractBreakdownContent(result: string): string {
  const m = result.match(/##\s*SCENE[- ]BY[- ]SCENE BREAKDOWN\s*\n([\s\S]+?)(?=\n##|$)/i);
  return m ? m[1].trim() : "";
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
  // This handles cases like: "\n- Timestamp:" or "\n  - Timestamp:"
  const timestampSplitRegex = /\n(?=\s*[-*•]?\s*Timestamp\s*:)/i;
  const timestampParts = breakdownContent.split(timestampSplitRegex).filter((b) => b.trim().length > 0);

  if (timestampParts.length > 1) {
    return buildScenesFromBlocks(timestampParts);
  }

  // Last resort: try to split on double-newlines between scenes
  // and see if any block has both a timestamp and a prompt
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

    const timestamp = extractField(lines, "Timestamp");
    const section = extractField(lines, "Section");
    const lyricLine = extractField(lines, "Lyric/Line", "Lyric", "Line");
    const location = extractField(lines, "Location");
    const action = extractField(lines, "Action");
    const cameraMovement = extractField(lines, "Camera Movement", "Camera");
    const lighting = extractField(lines, "Lighting");
    const mood = extractField(lines, "Mood");
    const aiVideoPrompt = extractField(lines, "AI Video Prompt", "AI Prompt", "Video Prompt", "Prompt");
    const negativePrompt = extractField(lines, "Negative Prompt", "Negative");

    // Only create a card if there's meaningful data
    if (timestamp || aiVideoPrompt || (section && location)) {
      scenes.push({
        id: `scene-${scenes.length}`,
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
        approved: false,
        demoClipUrl: null,
      });
    }
  }

  return scenes;
}
