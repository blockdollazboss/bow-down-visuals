import type { HubAsset, HubAssetKind } from "./hub-project";

/* ─── Song package → hub project ────────────────────────────────────────────
   Parses the Make-a-Song text package (## sections) and pushes the whole
   creative context into the hub project: name, concept, lyrics (as a script
   asset), and the music-video idea + cover-art prompt as prefill metadata.
   Every downstream tool (Video Studio, Thumbnail Maker, Promo Clips, Hook
   Studio, Scheduler) reads this — no re-typing. */

export interface SongPackage {
  concept: string;
  bestTitle: string;
  lyrics: string;
  hook: string;
  musicVideoIdea: string;
  coverArtPrompt: string;
  promoCaptions: string;
}

function section(raw: string, header: string): string {
  const re = new RegExp(`^##\\s*${header}\\s*$`, "im");
  const m = re.exec(raw);
  if (!m || m.index === undefined) return "";
  const start = m.index + m[0].length;
  const rest = raw.slice(start);
  const next = /^##\s+\S/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

export function extractSongPackage(raw: string): SongPackage {
  return {
    concept: section(raw, "SONG CONCEPT"),
    bestTitle: section(raw, "BEST SONG TITLE").split("\n")[0]?.trim() ?? "",
    lyrics: section(raw, "FULL LYRICS"),
    hook: section(raw, "HOOK"),
    musicVideoIdea: section(raw, "MUSIC VIDEO IDEA"),
    coverArtPrompt: section(raw, "COVER ART PROMPT"),
    promoCaptions: section(raw, "PROMO CAPTION IDEAS"),
  };
}

export interface PushSongInput {
  artistName: string;
  songTitle: string;
  genre: string;
  mood: string;
  rawResult: string;
  audioUrl?: string | null;
  setProjectName: (n: string) => void;
  setProjectType: (t: "song") => void;
  setProjectConcept: (c: string) => void;
  addAsset: (a: Omit<HubAsset, "id" | "createdAt">) => HubAsset;
  hasKind: (k: HubAssetKind) => boolean;
  latestOfKind: (k: HubAssetKind) => HubAsset | undefined;
}

/** Push the finished song package into the hub project. Idempotent per
 *  result: skips when an identical lyrics asset is already the newest. */
export function pushSongPackageToProject(input: PushSongInput): void {
  const { artistName, songTitle, genre, mood, rawResult, audioUrl } = input;
  const pkg = extractSongPackage(rawResult);
  const title = songTitle.trim() || pkg.bestTitle || "Untitled Song";
  const artist = artistName.trim() || "Unknown Artist";
  const name = `${artist} — ${title}`;

  input.setProjectType("song");
  input.setProjectName(name);
  if (pkg.concept) input.setProjectConcept(pkg.concept);

  const meta: Record<string, string> = {
    artist,
    title,
    ...(genre ? { genre } : {}),
    ...(mood ? { mood } : {}),
    ...(pkg.hook ? { hook: pkg.hook.slice(0, 300) } : {}),
    ...(pkg.musicVideoIdea ? { musicVideoIdea: pkg.musicVideoIdea.slice(0, 600) } : {}),
    ...(pkg.coverArtPrompt ? { coverArtPrompt: pkg.coverArtPrompt.slice(0, 600) } : {}),
  };

  // Lyrics travel as a script asset (data: URL) so Script Writer, Voiceover,
  // and the video editor's caption tools can pick them up with one tap.
  const lyricsFingerprint = `${name}|${pkg.lyrics.length}`;
  const newest = input.latestOfKind("script");
  if (pkg.lyrics && newest?.meta?.["lyricsFingerprint"] !== lyricsFingerprint) {
    input.addAsset({
      kind: "script",
      url: `data:text/plain;charset=utf-8,${encodeURIComponent(pkg.lyrics)}`,
      label: `Lyrics · ${title}`,
      detail: `${artist}${genre ? ` · ${genre}` : ""}`,
      meta: { ...meta, kind: "lyrics", lyricsFingerprint },
    });
  }

  // Audio URL (generated or uploaded) travels as the song asset.
  if (audioUrl && !audioUrl.startsWith("blob:")) {
    const latestSong = input.latestOfKind("song");
    if (latestSong?.url !== audioUrl) {
      input.addAsset({
        kind: "song",
        url: audioUrl,
        label: title,
        detail: `${artist}${genre ? ` · ${genre}` : ""}`,
        meta,
      });
    }
  }
}

/* ─── Reading the package back ─────────────────────────────────────────────
   The meta written above is the song's travelling context. Desks that pick
   a song out of the project must carry ALL of it — a pick that takes only
   the audio URL strands the title, genre, and lyrics at the seam
   (linkage audit DE-10), and the cover desk never read the art direction
   at all (DE-8). These readers are the other half of the writers above. */

/** Decode a `data:text/plain` asset URL (how script assets carry text).
 *  Returns null for anything else — remote text is not read synchronously. */
export function decodeDataTextUrl(url: string): string | null {
  if (!url.startsWith("data:text/plain")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  try {
    return decodeURIComponent(url.slice(comma + 1));
  } catch {
    return null;
  }
}

/** The lyrics script asset that belongs to a picked song asset — the
 *  sibling pushSongPackageToProject added alongside it. Matched on the
 *  package identity (artist + title in meta), never on position, so a
 *  project holding several songs can't attach the wrong words. */
export function findSongLyricsScript(
  assets: HubAsset[],
  song: HubAsset,
): HubAsset | undefined {
  const title = song.meta?.["title"];
  const artist = song.meta?.["artist"];
  if (!title || !artist) return undefined;
  return assets.find(
    (a) =>
      a.kind === "script" &&
      a.meta?.["kind"] === "lyrics" &&
      a.meta?.["title"] === title &&
      a.meta?.["artist"] === artist,
  );
}

export interface SongPickPrefill {
  title?: string;
  genre?: string;
  lyrics?: string;
}

/** Everything a desk should prefill when the creator picks this song:
 *  title + genre from the song's own meta, lyrics decoded from the
 *  sibling script asset. Fields the package doesn't know stay absent —
 *  a pick must never invent or borrow another song's data. */
export function songPickPrefill(assets: HubAsset[], song: HubAsset): SongPickPrefill {
  const prefill: SongPickPrefill = {};
  const title = song.meta?.["title"]?.trim();
  if (title) prefill.title = title;
  const genre = song.meta?.["genre"]?.trim();
  if (genre) prefill.genre = genre;
  const script = findSongLyricsScript(assets, song);
  if (script) {
    const lyrics = decodeDataTextUrl(script.url);
    if (lyrics?.trim()) prefill.lyrics = lyrics;
  }
  return prefill;
}

export interface CoverArtSeed {
  title?: string;
  artist?: string;
  genre?: string;
  mood?: string;
  /** The song package's own art direction for its cover (DE-8). */
  coverArtPrompt?: string;
}

/** Seed for the Cover Art desk from any song-package asset (the song and
 *  its lyrics script carry the same meta). Absent fields stay absent. */
export function coverArtSeedFromAsset(asset: HubAsset): CoverArtSeed {
  const meta = asset.meta ?? {};
  const seed: CoverArtSeed = {};
  const title = meta["title"]?.trim();
  if (title) seed.title = title;
  const artist = meta["artist"]?.trim();
  if (artist) seed.artist = artist;
  const genre = meta["genre"]?.trim();
  if (genre) seed.genre = genre;
  const mood = meta["mood"]?.trim();
  if (mood) seed.mood = mood;
  const coverArtPrompt = meta["coverArtPrompt"]?.trim();
  if (coverArtPrompt) seed.coverArtPrompt = coverArtPrompt;
  return seed;
}
