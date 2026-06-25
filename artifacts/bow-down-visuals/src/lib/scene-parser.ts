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
  thumbnailUrl: string | null;
  /** generated_clips table row id — used for attachment tracking */
  clipId: string | null;
  runwayJobId: string | null;
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
      const c = cleaned.toLowerCase();
      if (c.startsWith(prefix.toLowerCase() + ":")) {
        return cleaned.slice(prefix.length + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return "";
}

/**
 * Pull the raw text of the Scene-by-Scene Breakdown section from a full result string.
 * Tries multiple header patterns so it works regardless of how the AI formatted its output.
 * If no section header is found but the text looks parseable, returns the full result.
 */
export function extractBreakdownContent(result: string): string {
  if (!result) return "";

  const patterns = [
    // ## SCENE-BY-SCENE BREAKDOWN (hyphens or spaces between words)
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

  // No recognized section header — check if the text has parseable scene content
  const hasMarkdownTable = /^\s*\|.+\|/m.test(result);
  const hasSceneMarker   = /(?:^|\n)\s*(?:\*\*|#+)?\s*[Ss]cene\s+\d+/m.test(result);
  const hasTimestamp     = /(?:^|\n)\s*[-*•]?\s*Timestamp\s*:/im.test(result);
  const hasInlineTime    = /\|\s*\d+:\d{2}/m.test(result); // pipe-delimited timestamp cell

  if (hasMarkdownTable || hasSceneMarker || hasTimestamp || hasInlineTime) return result;

  return "";
}

// ─── Markdown table parser ────────────────────────────────────────────────────

/** Map a table header cell text → SceneData field name */
function headerToField(h: string): keyof SceneData | null {
  const t = h.toLowerCase().replace(/[^a-z ]/g, "").trim();
  if (t.includes("timestamp"))                    return "timestamp";
  if (t.includes("section"))                      return "section";
  if (t.includes("lyric") || t.includes("line"))  return "lyricLine";
  if (t.includes("location"))                     return "location";
  if (t.includes("action"))                       return "action";
  if (t.includes("camera"))                       return "cameraMovement";
  if (t.includes("lighting"))                     return "lighting";
  if (t.includes("mood"))                         return "mood";
  if (t.includes("negative"))                     return "negativePrompt";
  // "ai video prompt", "ai prompt", "video prompt", "prompt" — catch-all last
  if (t.includes("prompt"))                       return "aiVideoPrompt";
  return null;
}

/** True if a table row is a separator line like |---|---|--- */
function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^[-:]+$/.test(c));
}

/** Split a table line by "|" and return trimmed, non-empty cells */
function splitTableRow(line: string): string[] {
  return line
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Parse a markdown table into SceneData[].
 * Returns [] if the content doesn't look like a table or yields no scenes.
 */
function parseMarkdownTable(text: string): SceneData[] {
  const lines = text.split("\n");
  const tableLines = lines.filter((l) => l.trim().startsWith("|") && l.includes("|", 1));
  if (tableLines.length < 2) return [];

  // Find header row (first non-separator row)
  const headerCells = splitTableRow(tableLines[0]);
  if (isSeparatorRow(headerCells)) return [];

  const fieldMap = headerCells.map(headerToField);

  const scenes: SceneData[] = [];

  for (let i = 1; i < tableLines.length; i++) {
    const cells = splitTableRow(tableLines[i]);
    if (cells.length === 0) continue;
    if (isSeparatorRow(cells)) continue;

    const pick = (field: keyof SceneData): string => {
      const idx = fieldMap.indexOf(field);
      return idx !== -1 && idx < cells.length
        ? cells[idx].replace(/^["']|["']$/g, "").trim()
        : "";
    };

    const timestamp     = pick("timestamp");
    const aiVideoPrompt = pick("aiVideoPrompt");
    const section       = pick("section");

    // Only create a card if there's at least one meaningful piece of data
    if (!timestamp && !aiVideoPrompt && !section) continue;

    scenes.push({
      id:               `scene-${scenes.length}`,
      sceneNumber:      scenes.length + 1,
      timestamp,
      section,
      lyricLine:        pick("lyricLine"),
      location:         pick("location"),
      action:           pick("action"),
      cameraMovement:   pick("cameraMovement"),
      lighting:         pick("lighting"),
      mood:             pick("mood"),
      aiVideoPrompt,
      negativePrompt:   pick("negativePrompt"),
      approved:         false,
      demoClipUrl:      null,
      thumbnailUrl:     null,
      clipId:           null,
      runwayJobId:      null,
      provider:         null,
      generationStatus: null,
      promptUsed:       null,
      generatedAt:      null,
    });
  }

  return scenes;
}

// ─── Timestamp-split fallback ─────────────────────────────────────────────────

/**
 * Fallback: split on bare timestamp patterns like "0:00-0:03" or "0:04-0:06"
 * that appear as the first token on a table row or a standalone line.
 * Builds one scene per timestamp block, putting the full row text in aiVideoPrompt.
 */
function parseByTimestampRows(text: string): SceneData[] {
  // Match lines that start with a timestamp-like token (optionally inside a table cell)
  const timestampLineRegex = /^[| \t]*(\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?)\s*[|\t]/m;
  if (!timestampLineRegex.test(text)) return [];

  const lines = text.split("\n");
  const scenes: SceneData[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;

    const cells = splitTableRow(line);
    if (cells.length === 0 || isSeparatorRow(cells)) continue;

    // Does the first cell look like a timestamp?
    if (!/^\d{1,2}:\d{2}/.test(cells[0])) continue;

    // Best-effort: use remaining cells as the prompt text
    const promptText = cells.slice(1).filter(Boolean).join(" — ");

    scenes.push({
      id:               `scene-${scenes.length}`,
      sceneNumber:      scenes.length + 1,
      timestamp:        cells[0],
      section:          cells[1] ?? "",
      lyricLine:        cells[2] ?? "",
      location:         cells[3] ?? "",
      action:           cells[4] ?? "",
      cameraMovement:   cells[5] ?? "",
      lighting:         cells[6] ?? "",
      mood:             cells[7] ?? "",
      aiVideoPrompt:    cells[8] ?? promptText,
      negativePrompt:   cells[9] ?? "",
      approved:         false,
      demoClipUrl:      null,
      thumbnailUrl:     null,
      clipId:           null,
      runwayJobId:      null,
      provider:         null,
      generationStatus: null,
      promptUsed:       null,
      generatedAt:      null,
    });
  }

  return scenes;
}

// ─── Label-block parser (original logic) ─────────────────────────────────────

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

    if (timestamp || aiVideoPrompt || (section && location)) {
      scenes.push({
        id:               `scene-${scenes.length}`,
        sceneNumber:      scenes.length + 1,
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
        approved:         false,
        demoClipUrl:      null,
        thumbnailUrl:     null,
        clipId:           null,
        runwayJobId:      null,
        provider:         null,
        generationStatus: null,
        promptUsed:       null,
        generatedAt:      null,
      });
    }
  }

  return scenes;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type ParseMode = "table" | "timestamp-rows" | "scene-header" | "timestamp-label" | "paragraph" | "none";

export interface ParseResult {
  scenes: SceneData[];
  mode: ParseMode;
}

/**
 * Parse scenes from a scene-breakdown text block.
 * Tries strategies in order of reliability:
 *   1. Markdown table (| col | col |)
 *   2. Timestamp row fallback (table with timestamp as first cell)
 *   3. Scene N: headers
 *   4. "Timestamp:" label blocks
 *   5. Paragraph blocks
 */
export function parseScenesWithMode(breakdownContent: string): ParseResult {
  if (!breakdownContent || breakdownContent.trim().length < 20) {
    return { scenes: [], mode: "none" };
  }

  // 1. Markdown table — try first because it's the most structured format
  const hasTableRows = /^\s*\|.+\|/m.test(breakdownContent);
  if (hasTableRows) {
    const tableScenes = parseMarkdownTable(breakdownContent);
    if (tableScenes.length > 0) return { scenes: tableScenes, mode: "table" };

    // Table detected but header parse failed — try timestamp-row fallback
    const tsRowScenes = parseByTimestampRows(breakdownContent);
    if (tsRowScenes.length > 0) return { scenes: tsRowScenes, mode: "timestamp-rows" };
  }

  // 2. Scene N: / ## Scene N headers
  const sceneHeaderRegex = /(?:^|\n)(?:\s*(?:\*\*|#+)\s*)?[Ss]cene\s+\d+[:\s*]*/;
  const sceneHeaderParts = breakdownContent.split(sceneHeaderRegex).filter((b) => b.trim().length > 0);
  if (sceneHeaderParts.length > 1) {
    const scenes = buildScenesFromBlocks(sceneHeaderParts);
    if (scenes.length > 0) return { scenes, mode: "scene-header" };
  }

  // 3. "Timestamp:" label blocks
  const timestampSplitRegex = /\n(?=\s*[-*•]?\s*Timestamp\s*:)/i;
  const timestampParts = breakdownContent.split(timestampSplitRegex).filter((b) => b.trim().length > 0);
  if (timestampParts.length > 1) {
    const scenes = buildScenesFromBlocks(timestampParts);
    if (scenes.length > 0) return { scenes, mode: "timestamp-label" };
  }

  // 4. Paragraph blocks
  const paragraphParts = breakdownContent.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  if (paragraphParts.length > 1) {
    const scenes = buildScenesFromBlocks(paragraphParts);
    if (scenes.length > 0) return { scenes, mode: "paragraph" };
  }

  return { scenes: [], mode: "none" };
}

/** Convenience wrapper — returns just the scenes array (backwards compatible) */
export function parseScenes(breakdownContent: string): SceneData[] {
  return parseScenesWithMode(breakdownContent).scenes;
}
