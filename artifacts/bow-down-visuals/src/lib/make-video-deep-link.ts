/* ─── Make-video deep-link ?sound= interpretation ──────────────────────
   Two schemes share the one param:
   - the viral sound finder's plain title ("<title> — <artist>"), which
     pre-fills the Song title field;
   - Trend Radar's attach scheme, track:<mediaId> ("Use this sound"),
     which must resolve the streaming track and attach it as the
     project's song — never land as literal text in the title field.
   This parser is the whole decision, kept pure so the landing contract
   is testable without mounting the wizard. */

export type MakeVideoSoundParam =
  | { kind: "track"; id: string }
  | { kind: "title"; title: string };

export function parseMakeVideoSoundParam(
  raw: string | null | undefined,
): MakeVideoSoundParam | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  const track = /^track:(.+)$/.exec(value);
  if (track) {
    const id = track[1].trim();
    return id ? { kind: "track", id } : null;
  }
  /* A bare "track:" is a malformed scheme value, not a song title —
     it parses to nothing rather than landing in the title field. */
  if (value.startsWith("track:")) return null;
  return { kind: "title", title: value };
}
