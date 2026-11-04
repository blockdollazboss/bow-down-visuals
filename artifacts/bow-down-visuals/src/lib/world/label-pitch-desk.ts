/* ─── Label Pitch desk seam (stack1400 world parity, wave #1 item 2) ──
   The Label Pitch family, native in the Promote Room — on the 2D
   pages' own rails, the same endpoints pages/label-pitch.tsx calls
   (the /label-pitch page carries BOTH modes: Labels and the absorbed
   /playlist-pitch Playlists mode, packet included):

   LABELS mode
     POST /api/label-pitch/kit            → the demo kit (300 VB —
                                            LABEL_PITCH_CREDIT_COST in
                                            routes/generate/label-pitch.ts,
                                            the 2D page's CREDIT_COST=300)
     GET  /api/label-pitch/labels         → the label directory (free)
     GET/POST/PATCH/DELETE
          /api/label-pitch/tracker[/:id]  → submission tracker (free)

   PLAYLISTS mode (mode-playlist-pitch)
     POST /api/playlist-pitch/kit         → the playlist pitch kit
                                            (200 VB — PLAYLIST_PITCH_
                                            CREDIT_COST, also the
                                            credit-costs registry row)
     GET  /api/playlist-pitch/curators    → curator directory (free)
     GET/POST/PATCH/DELETE
          /api/playlist-pitch/tracker[/:id] → pitch tracker (free)

   PITCH PACKET (playlist-pitch-packet)
     GET  /api/playlist-pitch/releases    → the caller's releases (free)
     GET  /api/playlist-pitch/packet/:id  → the packet, assembled
                                            server-side from the REAL
                                            release record (free)
     GET/POST/PATCH/DELETE
          /api/playlist-pitch/deadlines[/:id] → submission deadlines
                                            (free; the packet section's
                                            workflow board on the 2D page)

   CHARGE / CONFIRMATION LAW: the kits are the family's only paid
   rails. The desk rides them through useConfirmedApi with the costs
   below passed as explicit overrides — the same confirmation the
   website shows. The costs READ the lib/credit-costs.ts registry
   (the label kit's row landed with the stack1400 registry lane,
   closing the gap this desk's first version named; the playlist
   kit's row predates it). The override now carries the registry's
   own value into the confirmation, so the desk can never drift
   from the registered price. Directory, trackers, packet,
   releases and deadlines are free on the server and free here.

   HONESTY: numbers and text render only from the rails' fields. A
   kit payload missing its email/one-sheet (label) or email/DM
   (playlist) is a failed read, never a kit painted over a broken
   answer; a packet's `missing` list is spoken verbatim (in the 2D
   page's own words), never filled in. */

import { getCreditCost } from "../credit-costs";

/** Registry cost for an endpoint; throws if unregistered so a desk
 *  can never silently show (or charge against) an invented price. */
function registryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

export const SONGS_PATH = "/api/songs";

export const LABEL_PITCH_KIT_PATH = "/api/label-pitch/kit";
export const LABEL_PITCH_KIT_COST_VISUAL_BUCS = registryCost(LABEL_PITCH_KIT_PATH);
export const LABEL_PITCH_LABELS_PATH = "/api/label-pitch/labels";
export const LABEL_PITCH_TRACKER_PATH = "/api/label-pitch/tracker";

export const PLAYLIST_PITCH_KIT_PATH = "/api/playlist-pitch/kit";
export const PLAYLIST_PITCH_KIT_COST_VISUAL_BUCS = registryCost(PLAYLIST_PITCH_KIT_PATH);
export const PLAYLIST_PITCH_CURATORS_PATH = "/api/playlist-pitch/curators";
export const PLAYLIST_PITCH_TRACKER_PATH = "/api/playlist-pitch/tracker";
export const PLAYLIST_PITCH_RELEASES_PATH = "/api/playlist-pitch/releases";
export const PLAYLIST_PITCH_DEADLINES_PATH = "/api/playlist-pitch/deadlines";

export function labelPitchLabelsPath(genre: string, type: string): string {
  return `${LABEL_PITCH_LABELS_PATH}?genre=${encodeURIComponent(genre)}&type=${encodeURIComponent(type)}`;
}

export function playlistPitchCuratorsPath(genre: string): string {
  return `${PLAYLIST_PITCH_CURATORS_PATH}?genre=${encodeURIComponent(genre)}`;
}

export function playlistPitchPacketPath(releaseId: string): string {
  return `/api/playlist-pitch/packet/${encodeURIComponent(releaseId)}`;
}

export function labelPitchTrackerItemPath(id: string): string {
  return `${LABEL_PITCH_TRACKER_PATH}/${encodeURIComponent(id)}`;
}

export function playlistPitchTrackerItemPath(id: string): string {
  return `${PLAYLIST_PITCH_TRACKER_PATH}/${encodeURIComponent(id)}`;
}

export function playlistPitchDeadlineItemPath(id: string): string {
  return `${PLAYLIST_PITCH_DEADLINES_PATH}/${encodeURIComponent(id)}`;
}

/* The genre chips — the 2D page's own filter lists. */
export const LABEL_PITCH_GENRES = [
  "hip-hop", "r&b", "pop", "rock", "country", "latin", "afrobeats", "edm",
] as const;

export const PLAYLIST_PITCH_GENRES = [
  "hip-hop", "r&b", "pop", "edm", "rock", "indie", "country", "latin", "afrobeats",
] as const;

/* The tracker vocabularies — the server schemas' own enums
   (LABEL_PITCH_STATUSES / PITCH_STATUSES / PITCH_DEADLINE_STATUSES). */
export const LABEL_PITCH_STATUSES = ["sent", "pending", "signed", "passed"] as const;
export const PLAYLIST_PITCH_STATUSES = ["sent", "pending", "accepted", "rejected"] as const;
export const PLAYLIST_DEADLINE_STATUSES = ["drafted", "sent", "followed_up", "answered"] as const;

/* ─── Shared shapes ──────────────────────────────────────────────── */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function strRecord(v: unknown): Record<string, string> {
  const r = asRecord(v);
  if (!r) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(r)) {
    if (typeof val === "string" && val.length > 0) out[k] = val;
  }
  return out;
}

export interface LibrarySong {
  id: string;
  title: string;
}

/** GET /api/songs → { songs: [{ id, title }] } — the pickers' list.
 *  A non-array answer is an empty shelf read, not a crash. */
export function parseLibrarySongs(payload: unknown): LibrarySong[] {
  const root = asRecord(payload);
  const rows = root?.["songs"];
  if (!Array.isArray(rows)) return [];
  const out: LibrarySong[] = [];
  for (const raw of rows) {
    const r = asRecord(raw);
    if (!r) continue;
    const id = str(r["id"]);
    if (!id) continue;
    out.push({ id, title: str(r["title"]) });
  }
  return out.slice(0, 100);
}

/* ─── Labels mode ────────────────────────────────────────────────── */

export interface LabelKitInput {
  songTitle: string;
  artistName: string;
  genre: string;
  mood: string;
  energy: number;
  tempo: string;
  description: string;
  lyrics: string;
  artistBio: string;
  socialStats: string;
  labelName: string;
}

export function labelKitReady(input: Pick<LabelKitInput, "songTitle">): boolean {
  return input.songTitle.trim().length > 0;
}

/** The demo-kit POST body — the 2D page's own field names, trimmed
 *  the way the page trims them. Manual/library mode in-world: the
 *  page's third "auto" source (autoBio/autoTarget) is a page-side
 *  convenience the desk does not claim; the desk always sends the
 *  explicit fields, with autoMode off. */
export function buildLabelKitPayload(input: LabelKitInput): Record<string, unknown> {
  return {
    songTitle: input.songTitle.trim(),
    artistName: input.artistName.trim(),
    songDescription: input.description.trim(),
    genre: input.genre.trim(),
    mood: input.mood.trim(),
    energy: input.energy,
    tempo: input.tempo.trim(),
    lyrics: input.lyrics.trim(),
    artistBio: input.artistBio.trim(),
    socialStats: input.socialStats.trim(),
    labelName: input.labelName.trim(),
    autoMode: false,
    autoBio: false,
    autoTarget: false,
  };
}

export interface PitchAnalysis {
  genre: string;
  mood: string;
  energy: number;
  tempoFeel: string;
  comparableArtists: string[];
  fit: string[];
  oneLiner: string;
}

export interface LabelKit {
  analysis: PitchAnalysis;
  emailSubject: string;
  emailBody: string;
  oneSheet: string;
  followUp: string;
  disclaimer: string;
}

function parseAnalysis(v: unknown, fitKey: string): PitchAnalysis | null {
  const a = asRecord(v);
  if (!a) return null;
  const oneLiner = str(a["oneLiner"]);
  if (!oneLiner) return null;
  return {
    genre: str(a["genre"]),
    mood: str(a["mood"]),
    energy: num(a["energy"]),
    tempoFeel: str(a["tempoFeel"]),
    comparableArtists: strArr(a["comparableArtists"]),
    fit: strArr(a[fitKey]),
    oneLiner,
  };
}

/** POST /api/label-pitch/kit → { kit }. The server's parser already
 *  refuses an incomplete kit; the desk mirrors that: no one-liner,
 *  no subject/body, or no one-sheet = a failed read (null). */
export function parseLabelKit(payload: unknown): LabelKit | null {
  const root = asRecord(payload);
  const kit = asRecord(root?.["kit"]);
  if (!kit) return null;
  const analysis = parseAnalysis(kit["analysis"], "labelFit");
  const email = asRecord(kit["submissionEmail"]);
  const emailSubject = str(email?.["subject"]);
  const emailBody = str(email?.["body"]);
  const oneSheet = str(kit["oneSheet"]);
  if (!analysis || !emailSubject || !emailBody || !oneSheet) return null;
  return {
    analysis,
    emailSubject,
    emailBody,
    oneSheet,
    followUp: str(kit["followUp"]),
    disclaimer: str(kit["disclaimer"]),
  };
}

export interface LabelEntry {
  id: string;
  name: string;
  parent: string;
  type: string;
  genres: string[];
  knownFor: string;
  submitVia: string;
}

export interface LabelDirectory {
  labels: LabelEntry[];
  notice: string;
}

export function parseLabelDirectory(payload: unknown): LabelDirectory | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["labels"])) return null;
  const labels: LabelEntry[] = [];
  for (const raw of root["labels"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const id = str(r["id"]);
    const name = str(r["name"]);
    if (!id || !name) return null;
    labels.push({
      id,
      name,
      parent: str(r["parent"]),
      type: str(r["type"], "indie"),
      genres: strArr(r["genres"]),
      knownFor: str(r["knownFor"]),
      submitVia: str(r["submitVia"]),
    });
  }
  return { labels, notice: str(root["notice"]) };
}

export interface LabelSubmission {
  id: string;
  songTitle: string;
  artistName: string | null;
  labelName: string;
  status: string;
  notes: string | null;
  contactedAt: string | null;
}

function parseLabelSubmission(raw: unknown): LabelSubmission | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = str(r["id"]);
  const songTitle = str(r["songTitle"]);
  const labelName = str(r["labelName"]);
  if (!id || !songTitle || !labelName) return null;
  return {
    id,
    songTitle,
    artistName: strOrNull(r["artistName"]),
    labelName,
    status: str(r["status"], "sent"),
    notes: strOrNull(r["notes"]),
    contactedAt: strOrNull(r["contactedAt"]),
  };
}

/** GET /api/label-pitch/tracker → { pitches: [...] }. */
export function parseLabelTracker(payload: unknown): LabelSubmission[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["pitches"])) return null;
  const out: LabelSubmission[] = [];
  for (const raw of root["pitches"]) {
    const row = parseLabelSubmission(raw);
    if (!row) return null;
    out.push(row);
  }
  return out;
}

/** POST/PATCH tracker answers carry the single row: { pitch }. */
export function parseLabelSubmissionAnswer(payload: unknown): LabelSubmission | null {
  const root = asRecord(payload);
  return root ? parseLabelSubmission(root["pitch"]) : null;
}

export interface LabelSubmissionInput {
  songTitle: string;
  artistName: string;
  labelName: string;
  notes: string;
}

export function labelSubmissionReady(input: Pick<LabelSubmissionInput, "songTitle" | "labelName">): boolean {
  return input.songTitle.trim().length > 0 && input.labelName.trim().length > 0;
}

export function buildLabelSubmissionPayload(input: LabelSubmissionInput): Record<string, unknown> {
  return {
    songTitle: input.songTitle.trim(),
    artistName: input.artistName.trim(),
    labelName: input.labelName.trim(),
    notes: input.notes.trim(),
  };
}

/* ─── Playlists mode ─────────────────────────────────────────────── */

export interface PlaylistKitInput {
  songTitle: string;
  artistName: string;
  genre: string;
  mood: string;
  energy: number;
  tempo: string;
  description: string;
  lyrics: string;
  curatorName: string;
  playlistName: string;
}

export function playlistKitReady(input: Pick<PlaylistKitInput, "songTitle">): boolean {
  return input.songTitle.trim().length > 0;
}

export function buildPlaylistKitPayload(input: PlaylistKitInput): Record<string, unknown> {
  return {
    songTitle: input.songTitle.trim(),
    artistName: input.artistName.trim(),
    songDescription: input.description.trim(),
    genre: input.genre.trim(),
    mood: input.mood.trim(),
    energy: input.energy,
    tempo: input.tempo.trim(),
    lyrics: input.lyrics.trim(),
    curatorName: input.curatorName.trim(),
    playlistName: input.playlistName.trim(),
  };
}

export interface PlaylistKit {
  analysis: PitchAnalysis;
  emailSubject: string;
  emailBody: string;
  dmPitch: string;
  followUp: string;
  disclaimer: string;
}

/** POST /api/playlist-pitch/kit → { kit } — kit.pitchEmail on this
 *  rail (not submissionEmail). No email or no DM = failed read. */
export function parsePlaylistKit(payload: unknown): PlaylistKit | null {
  const root = asRecord(payload);
  const kit = asRecord(root?.["kit"]);
  if (!kit) return null;
  const analysis = parseAnalysis(kit["analysis"], "playlistFit");
  const email = asRecord(kit["pitchEmail"]);
  const emailSubject = str(email?.["subject"]);
  const emailBody = str(email?.["body"]);
  const dmPitch = str(kit["dmPitch"]);
  if (!analysis || !emailSubject || !emailBody || !dmPitch) return null;
  return {
    analysis,
    emailSubject,
    emailBody,
    dmPitch,
    followUp: str(kit["followUp"]),
    disclaimer: str(kit["disclaimer"]),
  };
}

export interface PlaylistCurator {
  id: string;
  name: string;
  platform: string;
  genres: string[];
  focus: string;
  submitVia: string;
}

export interface CuratorDirectory {
  curators: PlaylistCurator[];
  notice: string;
}

export function parseCuratorDirectory(payload: unknown): CuratorDirectory | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["curators"])) return null;
  const curators: PlaylistCurator[] = [];
  for (const raw of root["curators"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const id = str(r["id"]);
    const name = str(r["name"]);
    if (!id || !name) return null;
    curators.push({
      id,
      name,
      platform: str(r["platform"]),
      genres: strArr(r["genres"]),
      focus: str(r["focus"]),
      submitVia: str(r["submitVia"]),
    });
  }
  return { curators, notice: str(root["notice"]) };
}

export interface PlaylistPitch {
  id: string;
  songTitle: string;
  artistName: string | null;
  curatorName: string | null;
  playlistName: string;
  status: string;
  notes: string | null;
  contactedAt: string | null;
}

function parsePlaylistPitch(raw: unknown): PlaylistPitch | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = str(r["id"]);
  const songTitle = str(r["songTitle"]);
  const playlistName = str(r["playlistName"]);
  if (!id || !songTitle || !playlistName) return null;
  return {
    id,
    songTitle,
    artistName: strOrNull(r["artistName"]),
    curatorName: strOrNull(r["curatorName"]),
    playlistName,
    status: str(r["status"], "sent"),
    notes: strOrNull(r["notes"]),
    contactedAt: strOrNull(r["contactedAt"]),
  };
}

export function parsePlaylistTracker(payload: unknown): PlaylistPitch[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["pitches"])) return null;
  const out: PlaylistPitch[] = [];
  for (const raw of root["pitches"]) {
    const row = parsePlaylistPitch(raw);
    if (!row) return null;
    out.push(row);
  }
  return out;
}

export function parsePlaylistPitchAnswer(payload: unknown): PlaylistPitch | null {
  const root = asRecord(payload);
  return root ? parsePlaylistPitch(root["pitch"]) : null;
}

export interface PlaylistPitchInput {
  songTitle: string;
  artistName: string;
  curatorName: string;
  playlistName: string;
  notes: string;
}

export function playlistPitchReady(input: Pick<PlaylistPitchInput, "songTitle" | "playlistName">): boolean {
  return input.songTitle.trim().length > 0 && input.playlistName.trim().length > 0;
}

export function buildPlaylistPitchPayload(input: PlaylistPitchInput): Record<string, unknown> {
  return {
    songTitle: input.songTitle.trim(),
    artistName: input.artistName.trim(),
    curatorName: input.curatorName.trim(),
    playlistName: input.playlistName.trim(),
    notes: input.notes.trim(),
  };
}

/* ─── Pitch packet + deadlines ───────────────────────────────────── */

export interface PitchRelease {
  id: string;
  title: string;
  artistName: string;
  releaseDate: string | null;
  status: string;
}

export function parsePitchReleases(payload: unknown): PitchRelease[] | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["releases"])) return null;
  const out: PitchRelease[] = [];
  for (const raw of root["releases"]) {
    const r = asRecord(raw);
    if (!r) return null;
    const id = str(r["id"]);
    const title = str(r["title"]);
    if (!id || !title) return null;
    out.push({
      id,
      title,
      artistName: str(r["artistName"]),
      releaseDate: strOrNull(r["releaseDate"]),
      status: str(r["status"]),
    });
  }
  return out;
}

export interface PitchPacket {
  releaseId: string;
  artistName: string;
  artistBio: string | null;
  followerCount: number | null;
  totalPlays: number | null;
  profileUrl: string | null;
  releaseTitle: string;
  releaseDate: string | null;
  releaseStatus: string;
  platforms: string[];
  trackTitle: string;
  audioUrl: string | null;
  genre: string[];
  description: string | null;
  streaming: Record<string, string>;
  presaveUrl: string | null;
  stats: { presaves: number; shares: number; linkViews: number; linkClicks: number };
  artworkUrl: string | null;
  headline: string | null;
  bannerUrl: string | null;
  avatarUrl: string | null;
  missing: string[];
}

/** GET /api/playlist-pitch/packet/:id → { packet }. A packet without
 *  its release title or artist name is a failed read — the record's
 *  own spine, never painted over. */
export function parsePitchPacket(payload: unknown): PitchPacket | null {
  const root = asRecord(payload);
  const p = asRecord(root?.["packet"]);
  if (!p) return null;
  const artist = asRecord(p["artist"]);
  const release = asRecord(p["release"]);
  const track = asRecord(p["track"]);
  const links = asRecord(p["links"]);
  const stats = asRecord(p["stats"]);
  const press = asRecord(p["pressAssets"]);
  const releaseTitle = str(release?.["title"]);
  const artistName = str(artist?.["name"]);
  if (!releaseTitle || !artistName) return null;
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    releaseId: str(p["releaseId"]),
    artistName,
    artistBio: strOrNull(artist?.["bio"]),
    followerCount: numOrNull(artist?.["followerCount"]),
    totalPlays: numOrNull(artist?.["totalPlays"]),
    profileUrl: strOrNull(links?.["profileUrl"]) ?? strOrNull(artist?.["profileUrl"]),
    releaseTitle,
    releaseDate: strOrNull(release?.["releaseDate"]),
    releaseStatus: str(release?.["status"]),
    platforms: strArr(release?.["platforms"]),
    trackTitle: str(track?.["title"], releaseTitle),
    audioUrl: strOrNull(track?.["audioUrl"]) ?? strOrNull(links?.["audioUrl"]),
    genre: strArr(p["genre"]),
    description: strOrNull(p["description"]),
    streaming: strRecord(links?.["streaming"]),
    presaveUrl: strOrNull(links?.["presaveUrl"]),
    stats: {
      presaves: num(stats?.["presaves"]),
      shares: num(stats?.["shares"]),
      linkViews: num(stats?.["linkViews"]),
      linkClicks: num(stats?.["linkClicks"]),
    },
    artworkUrl: strOrNull(press?.["artworkUrl"]),
    headline: strOrNull(press?.["headline"]),
    bannerUrl: strOrNull(press?.["bannerUrl"]),
    avatarUrl: strOrNull(press?.["avatarUrl"]),
    missing: strArr(p["missing"]),
  };
}

/* The 2D page's own words for what a packet record doesn't hold
   (locales/en.json playlistPitch.missing*), spoken verbatim — the
   desk never fills a gap in. Unknown keys pass through raw, the
   page's own fallback (t(key) ?? key shape). */
const PACKET_MISSING_LABELS: Record<string, string> = {
  genre: "Genre tags on the release",
  description: "A description in the release metadata",
  releaseDate: "Release date",
  trackAudio: "The track audio file",
  streamingLinks: "Streaming links (add them on the release's pre-save page)",
  artwork: "Artwork",
  headline: "A pre-save headline",
  artistProfile: "Your creator profile (bio, photo, links)",
  artistBio: "Your profile bio",
};

/* ─── Display strings (i18n seam, stack100 locale unit 47) ────────
   The packet's words are the 2D page's own (locales playlistPitch
   .missing* / packet* keys): the bundles below default to the
   English above, byte-identical, and the desk builds them from
   those catalog keys so the room and the page speak the same
   words in every language. */

export interface PacketMissingStrings {
  genre: string;
  description: string;
  releaseDate: string;
  trackAudio: string;
  streamingLinks: string;
  artwork: string;
  headline: string;
  artistProfile: string;
  artistBio: string;
}

/** Build the bundle from a translate function (the desk's `t`). */
export function packetMissingStrings(translate: (key: string) => string): PacketMissingStrings {
  return {
    genre: translate("playlistPitch.missingGenre"),
    description: translate("playlistPitch.missingDescription"),
    releaseDate: translate("playlistPitch.missingReleaseDate"),
    trackAudio: translate("playlistPitch.missingTrackAudio"),
    streamingLinks: translate("playlistPitch.missingStreamingLinks"),
    artwork: translate("playlistPitch.missingArtwork"),
    headline: translate("playlistPitch.missingHeadline"),
    artistProfile: translate("playlistPitch.missingArtistProfile"),
    artistBio: translate("playlistPitch.missingArtistBio"),
  };
}

export function packetMissingLabel(key: string, strings?: PacketMissingStrings): string {
  if (strings && key in strings) return strings[key as keyof PacketMissingStrings];
  return PACKET_MISSING_LABELS[key] ?? key;
}

export interface PacketTextStrings {
  genreLabel: string;
  releaseDateLabel: string;
  presaveLabel: string;
  linksLabel: string;
  statPresaves: string;
  statShares: string;
  statViews: string;
  statClicks: string;
}

export const PACKET_TEXT_STRINGS_EN: PacketTextStrings = {
  genreLabel: "Genre",
  releaseDateLabel: "Release date",
  presaveLabel: "Pre-save / smartlink",
  linksLabel: "Links",
  statPresaves: "Pre-saves",
  statShares: "Shares",
  statViews: "Smartlink views",
  statClicks: "Link clicks",
};

/** Build the bundle from a translate function (the desk's `t`) —
 *  every label is the 2D packet's own playlistPitch.packet* key. */
export function packetTextStrings(translate: (key: string) => string): PacketTextStrings {
  return {
    genreLabel: translate("playlistPitch.packetGenre"),
    releaseDateLabel: translate("playlistPitch.packetReleaseDate"),
    presaveLabel: translate("playlistPitch.packetPresaveLabel"),
    linksLabel: translate("playlistPitch.packetLinks"),
    statPresaves: translate("playlistPitch.packetStatPresaves"),
    statShares: translate("playlistPitch.packetStatShares"),
    statViews: translate("playlistPitch.packetStatViews"),
    statClicks: translate("playlistPitch.packetStatClicks"),
  };
}

/** The packet as one copyable text — the 2D page's packetAsText
 *  construction, in the same order, from the packet's own fields. */
export function packetAsText(packet: PitchPacket, strings: PacketTextStrings = PACKET_TEXT_STRINGS_EN): string {
  const lines: string[] = [`${packet.releaseTitle} — ${packet.artistName}`];
  if (packet.genre.length) lines.push(`${strings.genreLabel}: ${packet.genre.join(", ")}`);
  if (packet.description) lines.push(packet.description);
  if (packet.releaseDate) lines.push(`${strings.releaseDateLabel}: ${packet.releaseDate}`);
  for (const [platform, url] of Object.entries(packet.streaming)) {
    lines.push(`${platform}: ${url}`);
  }
  if (packet.presaveUrl) lines.push(`${strings.presaveLabel}: ${packet.presaveUrl}`);
  if (packet.profileUrl) lines.push(`${strings.linksLabel}: ${packet.profileUrl}`);
  lines.push(
    `${strings.statPresaves}: ${packet.stats.presaves} · ${strings.statShares}: ${packet.stats.shares} · ` +
      `${strings.statViews}: ${packet.stats.linkViews} · ${strings.statClicks}: ${packet.stats.linkClicks}`,
  );
  return lines.join("\n");
}

export interface PitchDeadline {
  id: string;
  releaseId: string | null;
  curatorName: string | null;
  playlistName: string;
  deadlineAt: string;
  status: string;
  notes: string | null;
  overdue: boolean;
}

export interface DeadlineBoard {
  deadlines: PitchDeadline[];
  dueNext: PitchDeadline | null;
}

function parseDeadline(raw: unknown): PitchDeadline | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = str(r["id"]);
  const playlistName = str(r["playlistName"]);
  const deadlineAt = str(r["deadlineAt"]);
  if (!id || !playlistName || !deadlineAt) return null;
  return {
    id,
    releaseId: strOrNull(r["releaseId"]),
    curatorName: strOrNull(r["curatorName"]),
    playlistName,
    deadlineAt,
    status: str(r["status"], "drafted"),
    notes: strOrNull(r["notes"]),
    overdue: r["overdue"] === true,
  };
}

/** GET /api/playlist-pitch/deadlines → { deadlines, dueNext }. */
export function parseDeadlineBoard(payload: unknown): DeadlineBoard | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root["deadlines"])) return null;
  const deadlines: PitchDeadline[] = [];
  for (const raw of root["deadlines"]) {
    const row = parseDeadline(raw);
    if (!row) return null;
    deadlines.push(row);
  }
  return { deadlines, dueNext: root["dueNext"] ? parseDeadline(root["dueNext"]) : null };
}

export interface DeadlineInput {
  playlistName: string;
  curatorName: string;
  deadlineDate: string;
  releaseId: string;
}

export function deadlineReady(input: Pick<DeadlineInput, "playlistName" | "deadlineDate">): boolean {
  return input.playlistName.trim().length > 0 && input.deadlineDate.trim().length > 0;
}

/** The 2D page's deadline POST body: a date named by day is due at
 *  the END of that day; the release rides only when one is picked. */
export function buildDeadlinePayload(input: DeadlineInput): Record<string, unknown> {
  return {
    playlistName: input.playlistName.trim(),
    curatorName: input.curatorName.trim(),
    deadlineAt: `${input.deadlineDate}T23:59:59.999Z`,
    ...(input.releaseId ? { releaseId: input.releaseId } : {}),
  };
}
