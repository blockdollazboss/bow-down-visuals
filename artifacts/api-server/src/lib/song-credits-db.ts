/* ─── Song credits (Stack-200 N1) — DB-facing layer ──────────────────────
   Raw-SQL loaders that feed the pure merge machine (lib/song-credits.ts)
   from the FOUR existing homes of credit data:
     publishing_split_registrations/writers  (writer shares)
     distribution_royalty_splits              (master shares, current version)
     co_releases/co_release_sides             (consented co-release shares)
     song_credit_entries                      (producers/features/samples/…)
   plus creator_profiles for names/slugs (a credit is tappable only
   when it resolves to a real profile).

   Guard discipline (resilience law + publishing/co-release pattern):
   - WRITE paths probe first (probeSongCreditTables): a missing table
     becomes the honest 503 before anything is written.
   - READ sources are guarded INDIVIDUALLY: one un-migrated rail
     degrades to "no records from that rail" and can never take a play
     or share surface down.
   Anchor resolution follows the song: release → its library song
   (distribution_releases.song_id), song → parent_song_id chain
   (remixes, covers, open-verse winners, loop builds), depth-capped
   and cycle-safe. */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  buildCanonicalCredits,
  isMissingSongCreditTable,
  normalizeCreditEntries,
  type CanonicalSongCredits,
  type CreditEntry,
  type CreditSources,
  type SongAnchor,
  type SongCreditKind,
} from "./song-credits";
import {
  initialWriters,
  validateWriterSplits,
  type PublishingWriter,
  type WriterInput,
} from "./publishing-splits";
import { isMissingPublishingTable } from "./publishing-splits";

type Row = Record<string, unknown>;

const MAX_CHAIN_DEPTH = 5;

export interface AnchorMeta {
  anchor: SongAnchor;
  title: string;
  ownerUserId: string;
  artistName: string | null; // releases carry artist_name; songs don't
  parentAnchor: SongAnchor | null; // release→its song, song→parent song
}

async function loadAnchorMeta(kind: SongCreditKind, id: string): Promise<AnchorMeta | null> {
  if (kind === "song") {
    const rows = await db.execute(sql`
      SELECT id, title, user_id, parent_song_id FROM songs WHERE id = ${id} LIMIT 1
    `);
    const r = rows.rows[0] as Row | undefined;
    if (!r) return null;
    return {
      anchor: { kind, id },
      title: String(r.title ?? ""),
      ownerUserId: String(r.user_id),
      artistName: null,
      parentAnchor: r.parent_song_id ? { kind: "song", id: String(r.parent_song_id) } : null,
    };
  }
  /* song_id is a v2 column (migration 0034) — fall back to no link on
     an install old enough to lack it rather than failing the read. */
  let r: Row | undefined;
  try {
    const rows = await db.execute(sql`
      SELECT id, title, user_id, artist_name, song_id FROM distribution_releases WHERE id = ${id} LIMIT 1
    `);
    r = rows.rows[0] as Row | undefined;
  } catch {
    const rows = await db.execute(sql`
      SELECT id, title, user_id, artist_name FROM distribution_releases WHERE id = ${id} LIMIT 1
    `);
    r = rows.rows[0] as Row | undefined;
  }
  if (!r) return null;
  return {
    anchor: { kind, id },
    title: String(r.title ?? ""),
    ownerUserId: String(r.user_id),
    artistName: (r.artist_name as string | null) ?? null,
    parentAnchor: r.song_id ? { kind: "song", id: String(r.song_id) } : null,
  };
}

async function profileByUser(userId: string): Promise<{ id: string; slug: string | null; displayName: string } | null> {
  try {
    const rows = await db.execute(sql`
      SELECT id, slug, display_name FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
    `);
    const r = rows.rows[0] as Row | undefined;
    return r ? { id: String(r.id), slug: (r.slug as string | null) ?? null, displayName: String(r.display_name ?? "") } : null;
  } catch {
    return null;
  }
}

async function profilesByIds(ids: string[]): Promise<Map<string, { slug: string | null; displayName: string; userId: string }>> {
  const out = new Map<string, { slug: string | null; displayName: string; userId: string }>();
  if (ids.length === 0) return out;
  try {
    const rows = await db.execute(sql`
      SELECT id, slug, display_name, user_id FROM creator_profiles
      WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
    `);
    for (const r of rows.rows as Row[]) {
      out.set(String(r.id), {
        slug: (r.slug as string | null) ?? null,
        displayName: String(r.display_name ?? ""),
        userId: String(r.user_id),
      });
    }
  } catch { /* profiles are enrichment — names from the rails still render */ }
  return out;
}

/* ── Per-rail guarded loaders ──────────────────────────────────────────── */

async function loadPublishingWriters(anchor: SongAnchor): Promise<PublishingWriter[]> {
  try {
    const regs = await db.execute(sql`
      SELECT id FROM publishing_split_registrations
      WHERE song_kind = ${anchor.kind} AND song_id = ${anchor.id}
      ORDER BY created_at DESC LIMIT 1
    `);
    const reg = regs.rows[0] as Row | undefined;
    if (!reg) return [];
    const rows = await db.execute(sql`
      SELECT * FROM publishing_split_writers WHERE registration_id = ${String(reg.id)}
      ORDER BY share_pct DESC, writer_name ASC
    `);
    return (rows.rows as Row[]).map((r) => ({
      id: String(r.id),
      writerName: String(r.writer_name ?? ""),
      writerUserId: (r.writer_user_id as string | null) ?? null,
      writerProfileId: (r.writer_profile_id as string | null) ?? null,
      sharePct: Number(r.share_pct),
      confirmationStatus: String(r.confirmation_status ?? "pending") as PublishingWriter["confirmationStatus"],
      disputeNote: (r.dispute_note as string | null) ?? null,
      confirmedAt: (r.confirmed_at as string | null) ?? null,
      disputedAt: (r.disputed_at as string | null) ?? null,
    }));
  } catch (err) {
    if (isMissingPublishingTable(err)) return [];
    throw err;
  }
}

async function loadMasterSplits(anchor: SongAnchor): Promise<CreditSources["masterSplits"]> {
  try {
    let rows: Row[] = [];
    if (anchor.kind === "release") {
      const res = await db.execute(sql`
        SELECT payee_name, role, share_pct FROM distribution_royalty_splits
        WHERE release_id = ${anchor.id} AND superseded_at IS NULL
        ORDER BY share_pct DESC
      `);
      rows = res.rows as Row[];
    } else {
      /* A library song inherits the CURRENT master splits of releases
         built from it — the release is the song travelling. */
      const res = await db.execute(sql`
        SELECT s.payee_name, s.role, s.share_pct FROM distribution_royalty_splits s
        JOIN distribution_releases r ON r.id = s.release_id
        WHERE r.song_id = ${anchor.id} AND s.superseded_at IS NULL
        ORDER BY s.share_pct DESC
      `);
      rows = res.rows as Row[];
    }
    return rows.map((r) => ({
      payeeName: String(r.payee_name ?? ""),
      role: (r.role as string | null) ?? null,
      sharePct: Number(r.share_pct),
    }));
  } catch {
    return []; // rail not migrated / column absent — no master credits, honestly
  }
}

async function loadCoReleaseSides(anchor: SongAnchor): Promise<CreditSources["coReleaseSides"]> {
  if (anchor.kind !== "release") return [];
  try {
    const heads = await db.execute(sql`
      SELECT id, published_at FROM co_releases WHERE item_kind = 'release' AND item_id = ${anchor.id}
      ORDER BY created_at DESC LIMIT 1
    `);
    const head = heads.rows[0] as Row | undefined;
    if (!head) return [];
    const frozen = head.published_at != null;
    const rows = await db.execute(sql`
      SELECT profile_id, user_id, share_pct, agreed_share_pct FROM co_release_sides
      WHERE co_release_id = ${String(head.id)}
    `);
    const sideRows = rows.rows as Row[];
    const profiles = await profilesByIds(sideRows.map((r) => String(r.profile_id)));
    return sideRows.map((r) => {
      const p = profiles.get(String(r.profile_id));
      return {
        profileId: String(r.profile_id),
        userId: String(r.user_id),
        displayName: p?.displayName || "Creator",
        profileSlug: p?.slug ?? null,
        sharePct: Number(frozen && r.agreed_share_pct != null ? r.agreed_share_pct : r.share_pct),
        frozen,
      };
    });
  } catch {
    return [];
  }
}

async function loadEntries(anchor: SongAnchor): Promise<CreditEntry[]> {
  try {
    const rows = await db.execute(sql`
      SELECT * FROM song_credit_entries
      WHERE song_kind = ${anchor.kind} AND song_id = ${anchor.id}
      ORDER BY sort_order ASC, created_at ASC
    `);
    return (rows.rows as Row[]).map((r) => ({
      id: String(r.id),
      role: String(r.role) as CreditEntry["role"],
      displayName: String(r.display_name ?? ""),
      creditUserId: (r.credit_user_id as string | null) ?? null,
      creditProfileId: (r.credit_profile_id as string | null) ?? null,
      detail: (r.detail as string | null) ?? null,
      sortOrder: Number(r.sort_order ?? 0),
    }));
  } catch (err) {
    if (isMissingSongCreditTable(err)) return [];
    throw err;
  }
}

async function loadVersion(anchor: SongAnchor): Promise<number> {
  try {
    const rows = await db.execute(sql`
      SELECT MAX(version) AS v FROM song_credit_revisions
      WHERE song_kind = ${anchor.kind} AND song_id = ${anchor.id}
    `);
    const v = (rows.rows[0] as Row | undefined)?.v;
    return v == null ? 0 : Number(v);
  } catch {
    return 0;
  }
}

async function loadBundle(meta: AnchorMeta, inheritedFrom: SongAnchor | null): Promise<CreditSources> {
  const ownerProfile = await profileByUser(meta.ownerUserId);
  const [writers, masterSplits, coReleaseSides, entries] = await Promise.all([
    loadPublishingWriters(meta.anchor),
    loadMasterSplits(meta.anchor),
    loadCoReleaseSides(meta.anchor),
    loadEntries(meta.anchor),
  ]);
  /* Profile slugs for writer/entry credits (their rails store profile
     ids, not slugs) are attached after the merge — see attachSlugs. */
  return {
    owner: {
      userId: meta.ownerUserId,
      profileId: ownerProfile?.id ?? null,
      profileSlug: ownerProfile?.slug ?? null,
      displayName: ownerProfile?.displayName || meta.artistName || "",
    },
    publishingWriters: writers,
    masterSplits,
    coReleaseSides,
    entries,
    inheritedFrom,
  };
}

/** Attach profile slugs to merged credits whose profile is known but
 *  whose slug the originating rail didn't carry (publishing writers and
 *  credit entries store profile ids, not slugs). */
async function attachSlugs(credits: CanonicalSongCredits): Promise<CanonicalSongCredits> {
  const missing = credits.credits.filter((c) => c.profileId && !c.profileSlug).map((c) => c.profileId!);
  if (missing.length === 0) return credits;
  const profiles = await profilesByIds(missing);
  for (const c of credits.credits) {
    if (c.profileId && !c.profileSlug) c.profileSlug = profiles.get(c.profileId)?.slug ?? null;
  }
  return credits;
}

/* ── Canonical read ────────────────────────────────────────────────────── */

/** The one read every surface uses. Null = the song/release doesn't
 *  exist. Guarded per rail: an un-migrated rail contributes nothing. */
export async function loadCanonicalCredits(
  kind: SongCreditKind,
  id: string,
): Promise<CanonicalSongCredits | null> {
  const first = await loadAnchorMeta(kind, id);
  if (!first) return null;
  const bundles: Array<{ anchor: SongAnchor; sources: CreditSources }> = [];
  const seen = new Set<string>();
  let meta: AnchorMeta | null = first;
  let depth = 0;
  while (meta && depth < MAX_CHAIN_DEPTH) {
    const key = `${meta.anchor.kind}:${meta.anchor.id}`;
    if (seen.has(key)) break;
    seen.add(key);
    bundles.push({
      anchor: meta.anchor,
      sources: await loadBundle(meta, depth === 0 ? null : meta.anchor),
    });
    meta = meta.parentAnchor ? await loadAnchorMeta(meta.parentAnchor.kind, meta.parentAnchor.id) : null;
    depth++;
  }
  const version = await loadVersion(first.anchor);
  const built = buildCanonicalCredits({ anchor: first.anchor, songTitle: first.title, version, bundles });
  return attachSlugs(built);
}

/** Batch read for the song library list (one owner, many songs).
 *  Covers the rails a song anchor can carry — writers, entries, owner,
 *  and parent inheritance from within the batch (parents outside the
 *  page fall back to a full single load). Master/co-release shares are
 *  release-surface data and ride the full single read. Guarded: any
 *  failure returns honest empties per song, never a thrown list. */
export async function loadCanonicalCreditsForSongs(
  songs: Array<{ id: string; title: string; user_id: string; parent_song_id?: string | null }>,
): Promise<Map<string, CanonicalSongCredits>> {
  const out = new Map<string, CanonicalSongCredits>();
  if (songs.length === 0) return out;
  try {
    const idSet = new Set<string>(songs.map((s) => s.id));
    for (const s of songs) if (s.parent_song_id) idSet.add(s.parent_song_id);
    const ids = [...idSet];

    const entriesBySong = new Map<string, CreditEntry[]>();
    try {
      const rows = await db.execute(sql`
        SELECT * FROM song_credit_entries WHERE song_kind = 'song'
        AND song_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        ORDER BY sort_order ASC, created_at ASC
      `);
      for (const r of rows.rows as Row[]) {
        const list = entriesBySong.get(String(r.song_id)) ?? [];
        list.push({
          id: String(r.id),
          role: String(r.role) as CreditEntry["role"],
          displayName: String(r.display_name ?? ""),
          creditUserId: (r.credit_user_id as string | null) ?? null,
          creditProfileId: (r.credit_profile_id as string | null) ?? null,
          detail: (r.detail as string | null) ?? null,
          sortOrder: Number(r.sort_order ?? 0),
        });
        entriesBySong.set(String(r.song_id), list);
      }
    } catch (err) {
      if (!isMissingSongCreditTable(err)) throw err;
    }

    const writersBySong = new Map<string, PublishingWriter[]>();
    try {
      const regs = await db.execute(sql`
        SELECT id, song_id FROM publishing_split_registrations WHERE song_kind = 'song'
        AND song_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        ORDER BY created_at DESC
      `);
      const regSong = new Map<string, string>();
      const songsWithReg = new Set<string>();
      for (const r of regs.rows as Row[]) {
        /* Rows arrive newest-first: the FIRST registration per song is
           the current one — older ones never contribute writers. */
        if (songsWithReg.has(String(r.song_id))) continue;
        songsWithReg.add(String(r.song_id));
        regSong.set(String(r.id), String(r.song_id));
      }
      if (regSong.size > 0) {
        const regIds = [...regSong.keys()];
        const rows = await db.execute(sql`
          SELECT * FROM publishing_split_writers
          WHERE registration_id IN (${sql.join(regIds.map((i) => sql`${i}`), sql`, `)})
          ORDER BY share_pct DESC, writer_name ASC
        `);
        for (const r of rows.rows as Row[]) {
          const songId = regSong.get(String(r.registration_id));
          if (!songId) continue;
          const list = writersBySong.get(songId) ?? [];
          list.push({
            id: String(r.id),
            writerName: String(r.writer_name ?? ""),
            writerUserId: (r.writer_user_id as string | null) ?? null,
            writerProfileId: (r.writer_profile_id as string | null) ?? null,
            sharePct: Number(r.share_pct),
            confirmationStatus: String(r.confirmation_status ?? "pending") as PublishingWriter["confirmationStatus"],
            disputeNote: (r.dispute_note as string | null) ?? null,
            confirmedAt: (r.confirmed_at as string | null) ?? null,
            disputedAt: (r.disputed_at as string | null) ?? null,
          });
          writersBySong.set(songId, list);
        }
      }
    } catch (err) {
      if (!isMissingPublishingTable(err)) throw err;
    }

    const ownerProfile = await profileByUser(songs[0]!.user_id);
    const sourcesFor = (songId: string, ownerUserId: string, inheritedFrom: SongAnchor | null): CreditSources => ({
      owner: {
        userId: ownerUserId,
        profileId: ownerProfile?.id ?? null,
        profileSlug: ownerProfile?.slug ?? null,
        displayName: ownerProfile?.displayName ?? "",
      },
      publishingWriters: writersBySong.get(songId) ?? [],
      masterSplits: [],
      coReleaseSides: [],
      entries: entriesBySong.get(songId) ?? [],
      inheritedFrom,
    });

    for (const s of songs) {
      const bundles: Array<{ anchor: SongAnchor; sources: CreditSources }> = [
        { anchor: { kind: "song", id: s.id }, sources: sourcesFor(s.id, s.user_id, null) },
      ];
      if (s.parent_song_id && idSet.has(s.parent_song_id)) {
        const parentAnchor: SongAnchor = { kind: "song", id: s.parent_song_id };
        bundles.push({ anchor: parentAnchor, sources: sourcesFor(s.parent_song_id, s.user_id, parentAnchor) });
      }
      const built = buildCanonicalCredits({
        anchor: { kind: "song", id: s.id },
        songTitle: s.title,
        version: 0,
        bundles,
      });
      out.set(s.id, await attachSlugs(built));
    }
  } catch (err) {
    logger.error({ err }, "[song-credits] batch load failed — serving honest empties");
    for (const s of songs) {
      out.set(
        s.id,
        buildCanonicalCredits({
          anchor: { kind: "song", id: s.id },
          songTitle: s.title,
          version: 0,
          bundles: [{ anchor: { kind: "song", id: s.id }, sources: { owner: null, publishingWriters: [], masterSplits: [], coReleaseSides: [], entries: [], inheritedFrom: null } }],
        }),
      );
    }
  }
  return out;
}

/* ── Canonical write ───────────────────────────────────────────────────── */

export async function probeSongCreditTables(): Promise<void> {
  await db.execute(sql`SELECT id FROM song_credit_entries LIMIT 1`);
  await db.execute(sql`SELECT id FROM song_credit_revisions LIMIT 1`);
}

/** Resolve a credit link the same way the publishing registry does:
 *  profile_id ↔ user_id must name a real creator profile — a bad id is
 *  an error, never a silent downgrade to unlinked. */
export async function resolveCreditLink(input: {
  name: string;
  userId?: string | null;
  profileId?: string | null;
}): Promise<{ userId: string | null; profileId: string | null } | { error: string }> {
  let userId = input.userId ?? null;
  let profileId = input.profileId ?? null;
  if (profileId && !userId) {
    const rows = await db.execute(sql`SELECT user_id FROM creator_profiles WHERE id = ${profileId} LIMIT 1`);
    const row = rows.rows[0] as Row | undefined;
    if (!row) return { error: `No creator profile found for "${input.name}".` };
    userId = String(row.user_id);
  } else if (userId && !profileId) {
    const rows = await db.execute(sql`SELECT id FROM creator_profiles WHERE user_id = ${userId} LIMIT 1`);
    const row = rows.rows[0] as Row | undefined;
    if (!row) {
      return { error: `No creator account found for "${input.name}" — link credits by their creator profile, or list them by name only.` };
    }
    profileId = String(row.id);
  }
  return { userId, profileId };
}

/** One owner save through the canonical layer:
 *  - entries (when provided) replace this anchor's entry list;
 *  - writers (when provided) are validated by validateWriterSplits and
 *    written into the EXISTING publishing registry — created fresh or
 *    amended with the registry's own semantics (confirmations reset,
 *    via initialWriters, exactly like the registry's amend route);
 *  - an audit revision is appended whose snapshot is the full
 *    canonical picture AFTER the save.
 *  Returns the new version + the saved canonical credits. */
export async function saveCanonicalCredits(input: {
  ownerUserId: string;
  anchor: SongAnchor;
  songTitle: string;
  entries?: CreditEntry[] | null;
  writers?: WriterInput[] | null;
}): Promise<{ version: number; credits: CanonicalSongCredits }> {
  if (input.entries != null) {
    const normalized = normalizeCreditEntries(
      input.entries.map((e) => ({
        role: e.role,
        name: e.displayName,
        userId: e.creditUserId,
        profileId: e.creditProfileId,
        detail: e.detail,
      })),
    );
    await db.execute(sql`
      DELETE FROM song_credit_entries WHERE song_kind = ${input.anchor.kind} AND song_id = ${input.anchor.id}
    `);
    for (const e of normalized) {
      await db.execute(sql`
        INSERT INTO song_credit_entries
          (id, owner_user_id, song_kind, song_id, role, display_name, credit_user_id, credit_profile_id, detail, sort_order)
        VALUES (${randomUUID()}, ${input.ownerUserId}, ${input.anchor.kind}, ${input.anchor.id},
          ${e.role}, ${e.displayName}, ${e.creditUserId}, ${e.creditProfileId}, ${e.detail}, ${e.sortOrder})
      `);
    }
  }

  if (input.writers != null) {
    validateWriterSplits(input.writers); // the existing validator is the only sum gate
    const writers = initialWriters(input.ownerUserId, input.writers);
    const existing = await db.execute(sql`
      SELECT id FROM publishing_split_registrations
      WHERE song_kind = ${input.anchor.kind} AND song_id = ${input.anchor.id}
      ORDER BY created_at DESC LIMIT 1
    `);
    const existingId = (existing.rows[0] as Row | undefined)?.id as string | undefined;
    let registrationId = existingId ?? randomUUID();
    if (!existingId) {
      await db.execute(sql`
        INSERT INTO publishing_split_registrations (id, owner_user_id, song_kind, song_id, song_title, has_dispute)
        VALUES (${registrationId}, ${input.ownerUserId}, ${input.anchor.kind}, ${input.anchor.id}, ${input.songTitle}, false)
      `);
    } else {
      await db.execute(sql`DELETE FROM publishing_split_writers WHERE registration_id = ${registrationId}`);
      await db.execute(sql`
        UPDATE publishing_split_registrations SET has_dispute = false, song_title = ${input.songTitle}, updated_at = now()
        WHERE id = ${registrationId}
      `);
    }
    for (const w of writers) {
      await db.execute(sql`
        INSERT INTO publishing_split_writers
          (id, registration_id, writer_name, writer_user_id, writer_profile_id,
           share_pct, confirmation_status, dispute_note, confirmed_at, disputed_at)
        VALUES (${randomUUID()}, ${registrationId}, ${w.writerName}, ${w.writerUserId}, ${w.writerProfileId},
          ${w.sharePct}, ${w.confirmationStatus}, ${w.disputeNote},
          ${w.confirmedAt ? new Date(w.confirmedAt as string) : null}, NULL)
      `);
    }
  }

  const credits = await loadCanonicalCredits(input.anchor.kind, input.anchor.id);
  if (!credits) throw new Error("song vanished during credits save");
  const version = credits.version + 1;
  await db.execute(sql`
    INSERT INTO song_credit_revisions (id, owner_user_id, song_kind, song_id, version, snapshot)
    VALUES (${randomUUID()}, ${input.ownerUserId}, ${input.anchor.kind}, ${input.anchor.id}, ${version},
      ${JSON.stringify({ ...credits, version })}::jsonb)
  `);
  return { version, credits: { ...credits, version } };
}

export async function loadCreditRevisions(
  anchor: SongAnchor,
): Promise<Array<{ version: number; created_at: string | null; snapshot: unknown }>> {
  const rows = await db.execute(sql`
    SELECT version, created_at, snapshot FROM song_credit_revisions
    WHERE song_kind = ${anchor.kind} AND song_id = ${anchor.id}
    ORDER BY version DESC LIMIT 50
  `);
  return (rows.rows as Row[]).map((r) => ({
    version: Number(r.version),
    created_at: (r.created_at as string | null) ?? null,
    snapshot: r.snapshot,
  }));
}
