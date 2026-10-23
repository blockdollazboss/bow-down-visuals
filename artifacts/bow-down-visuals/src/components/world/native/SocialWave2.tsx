import { useCallback, useEffect, useState } from "react";
import {
  Search, Loader2, ShieldCheck, Eye, Pencil, Copy, Check, ChevronUp, ChevronDown,
  EyeOff, Trash2, Plus, Compass, Users, Flame, CalendarPlus, MessageSquare, Clapperboard,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeCard, NativeLoadingState, NativeEmptyState, NativeErrorState,
} from "@/components/world/native";
import { normalizeExploreData, exploreSectionOrEmpty } from "@/lib/explore-data";
import {
  REMOVAL_REASONS, REMOVAL_REASON_LABELS, removalReasonLabel, parseContentId,
} from "@/lib/content-removal";
import {
  moveBlock, toggleBlockVisibility, retitleBlock, removeBlock, addBlock,
  addableBlockTypes, themeSettingsPatch,
  type ProfileBlockDto, type ProfileLayoutDto, type ProfileThemeSettingsDto,
} from "@/lib/profile-website";
import {
  EXPLORE_PATH, DISCOVERY_SEARCH_TYPES, discoverySearchPath, normalizeSearchResults,
  searchHasResults,
  ADMIN_STATUS_PATH, ADMIN_CONTENT_REMOVED_PATH,
  adminQueuePath, adminQueueItemPath, adminContentPath,
  REPORT_STATUSES, moderationBenchVisible,
  normalizeAdminReports, normalizeAdminContent, normalizeRemovedContent,
  MY_PROFILE_PATH, MY_LAYOUT_PATH, MY_THEME_SETTINGS_PATH, publicProfilePath,
  normalizeOwnProfile, normalizePublicProfile, socialLinkRows, socialLinksFromRows,
  profileBasicsReady, referralShareUrl,
  type DiscoverySearchType, type DiscoverySearchResults,
  type AdminQueueKind, type AdminReportRow, type AdminContentState,
  type OwnProfile, type PublicProfileView,
} from "@/lib/world/social-desk";

/* ─── Social Wave II (stack-100 #81–#84) ────────────────────────────
   Three instruments docked beside the Community Hall board and the
   My Studio board:
   - ExploreDesk (#81): the Explore page's blended sections plus
     the discovery search box — the exact rails /explore and
     /search ride (GET /api/explore, GET /api/discovery/search).
   - ModerationBench (#82): the admin page's moderation bench —
     member-report queue, DMCA queue, content-removal rail — on
     /api/admin/*, which is requireAuth + requireAdmin server-side.
     The bench ALSO gates its own rendering on GET /api/admin/status
     and renders nothing for anyone else: fail-closed, like the
     server. Peace law: a button existing is never the enforcement.
   - MyProfileDesk (#83/#84): my public page as visitors see it
     (GET /api/creator-profiles/:slug) and the owner editor on the
     profile editor's own rails (PUT /me, PUT /me/layout, PUT
     /me/theme-settings), referral code included.
   All fetches ride the member token, like every native desk. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

async function apiJson<T>(
  authHeaders: () => Promise<Record<string, string>>,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string; message?: string;
  };
  if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
  return data as T;
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

/* ═══ #81 Explore + search ═════════════════════════════════════════ */

interface ExploreShort { id: string; title: string; thumbnail_url: string | null; view_count: number; creator: { slug: string; display_name: string } }
interface ExploreCreator { id: string; slug: string; display_name: string; avatar_url: string | null; vertical: string; follower_count: number }
interface ExplorePost { id: string; body: string; like_count: number; group: { slug: string; name: string }; author: { slug: string; displayName: string } | null }
interface ExploreEvent { id: string; title: string; kind: string; starts_at: string; rsvp_count: number; host: { slug: string; display_name: string } }
interface ExploreGroup { id: string; slug: string; name: string; description: string; member_count: number }

export function ExploreDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const [data, setData] = useState<{
    shorts: ExploreShort[]; creators: ExploreCreator[]; posts: ExplorePost[];
    events: ExploreEvent[]; groups: ExploreGroup[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<DiscoverySearchType>("all");
  const [results, setResults] = useState<DiscoverySearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const d = await apiJson<unknown>(authHeaders, EXPLORE_PATH);
        if (!cancelled) {
          setData(normalizeExploreData<ExploreShort, ExploreCreator, ExplorePost, ExploreEvent, ExploreGroup>(d));
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function runSearch() {
    const path = discoverySearchPath(query, searchType);
    if (!path || searching) return;
    setSearching(true);
    setSearchFailed(false);
    try {
      const d = await apiJson<unknown>(authHeaders, path);
      setResults(normalizeSearchResults(d));
    } catch {
      setSearchFailed(true);
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  const shorts = data ? exploreSectionOrEmpty(data.shorts) : [];
  const creators = data ? exploreSectionOrEmpty(data.creators) : [];
  const hotPosts = data ? exploreSectionOrEmpty(data.posts) : [];
  const events = data ? exploreSectionOrEmpty(data.events) : [];
  const groups = data ? exploreSectionOrEmpty(data.groups) : [];
  const allEmpty = data !== null && [shorts, creators, hotPosts, events, groups].every((s) => s.length === 0);

  return (
    <div className="space-y-3" data-testid="world-explore-desk">
      <NativeCard isLight={isLight} title="Explore the kingdom">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runSearch()}
            placeholder="Search creators, tracks, videos, playlists…"
            className={inputCls(isLight)}
            data-testid="world-explore-search-input"
          />
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={searching || !discoverySearchPath(query, searchType)}
            className={goldBtn}
            data-testid="world-explore-search-go"
          >
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {DISCOVERY_SEARCH_TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSearchType(t.key)}
              aria-pressed={searchType === t.key}
              data-testid={`world-explore-search-type-${t.key}`}
              className={`${chipBtn(isLight)} ${searchType === t.key ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {searchFailed ? (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-explore-search-failed">
            That search didn&rsquo;t land — the kingdom is fine, try again.
          </p>
        ) : results !== null ? (
          searchHasResults(results) ? (
            <div className="mt-3 space-y-3" data-testid="world-explore-results">
              {results.creators.length > 0 && (
                <div>
                  <p className={`mb-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Creators</p>
                  {results.creators.map((c) => (
                    <p key={c.id} className={`py-0.5 text-sm ${strong}`} data-testid="world-explore-hit-creator">
                      {c.display_name} <span className={muted}>@{c.slug}{typeof c.follower_count === "number" ? ` · ${c.follower_count.toLocaleString()} followers` : ""}</span>
                    </p>
                  ))}
                </div>
              )}
              {results.tracks.length > 0 && (
                <div>
                  <p className={`mb-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Audio</p>
                  {results.tracks.map((t) => (
                    <p key={t.id} className={`py-0.5 text-sm ${strong}`} data-testid="world-explore-hit-track">
                      {t.title}{t.display_name ? <span className={muted}> · {t.display_name}</span> : null}
                    </p>
                  ))}
                </div>
              )}
              {results.videos.length > 0 && (
                <div>
                  <p className={`mb-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Videos</p>
                  {results.videos.map((v) => (
                    <p key={v.id} className={`py-0.5 text-sm ${strong}`} data-testid="world-explore-hit-video">
                      {v.title}{v.display_name ? <span className={muted}> · {v.display_name}</span> : null}
                    </p>
                  ))}
                </div>
              )}
              {results.playlists.length > 0 && (
                <div>
                  <p className={`mb-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Playlists</p>
                  {results.playlists.map((p) => (
                    <p key={p.id} className={`py-0.5 text-sm ${strong}`} data-testid="world-explore-hit-playlist">
                      {p.title}{p.display_name ? <span className={muted}> · {p.display_name}</span> : null}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className={`mt-3 text-xs ${muted}`} data-testid="world-explore-no-results">
              Nothing in the kingdom matches that — yet. Try a creator&rsquo;s name or a track title.
            </p>
          )
        ) : null}
      </NativeCard>

      {failed ? (
        <NativeErrorState
          isLight={isLight}
          title="Explore wouldn't open"
          message="The scene is fine — the scouting fetch slipped."
          onRetry={() => setTick((n) => n + 1)}
        />
      ) : data === null ? (
        <NativeLoadingState isLight={isLight} message="Scouting the scene…" />
      ) : allEmpty ? (
        <NativeEmptyState isLight={isLight} message="Nothing is popping yet." detail="The first drop, post or event lights this desk up." />
      ) : (
        <>
          {creators.length > 0 && (
            <NativeCard isLight={isLight} title="Rising creators">
              <div className="space-y-1.5" data-testid="world-explore-creators">
                {creators.slice(0, 8).map((c) => (
                  <p key={c.id} className={`flex items-center gap-2 text-sm ${strong}`}>
                    <Users className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                    <span className="font-bold">{c.display_name}</span>
                    <span className={muted}>@{c.slug} · {c.vertical} · {c.follower_count.toLocaleString()} followers</span>
                  </p>
                ))}
              </div>
            </NativeCard>
          )}
          {shorts.length > 0 && (
            <NativeCard isLight={isLight} title="Trending shorts">
              <div className="space-y-1.5" data-testid="world-explore-shorts">
                {shorts.slice(0, 6).map((s) => (
                  <p key={s.id} className={`flex items-center gap-2 text-sm ${strong}`}>
                    <Clapperboard className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                    <span className="font-bold">{s.title}</span>
                    <span className={muted}>{s.view_count.toLocaleString()} views · by {s.creator.display_name}</span>
                  </p>
                ))}
              </div>
            </NativeCard>
          )}
          {hotPosts.length > 0 && (
            <NativeCard isLight={isLight} title="Hot posts">
              <div className="space-y-2" data-testid="world-explore-posts">
                {hotPosts.slice(0, 4).map((p) => (
                  <div key={p.id}>
                    <p className={`whitespace-pre-wrap text-sm ${strong}`}>{p.body}</p>
                    <p className={`mt-0.5 flex items-center gap-1.5 text-xs ${muted}`}>
                      <MessageSquare className="h-3 w-3" />
                      {p.like_count} likes · {p.author?.displayName ?? "a member"} · {p.group.name}
                    </p>
                  </div>
                ))}
              </div>
            </NativeCard>
          )}
          {events.length > 0 && (
            <NativeCard isLight={isLight} title="Upcoming events">
              <div className="space-y-1.5" data-testid="world-explore-events">
                {events.slice(0, 6).map((e) => (
                  <p key={e.id} className={`flex items-center gap-2 text-sm ${strong}`}>
                    <CalendarPlus className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                    <span className="font-bold">{e.title}</span>
                    <span className={muted}>{new Date(e.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {e.rsvp_count} going · by {e.host.display_name}</span>
                  </p>
                ))}
              </div>
            </NativeCard>
          )}
          {groups.length > 0 && (
            <NativeCard isLight={isLight} title="Active groups">
              <div className="space-y-1.5" data-testid="world-explore-groups">
                {groups.slice(0, 6).map((g) => (
                  <p key={g.id} className={`flex items-center gap-2 text-sm ${strong}`}>
                    <Flame className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                    <span className="font-bold">{g.name}</span>
                    <span className={muted}>{g.member_count.toLocaleString()} members</span>
                  </p>
                ))}
              </div>
            </NativeCard>
          )}
          <p className={`flex items-center gap-1.5 px-1 text-[11px] ${muted}`}>
            <Compass className="h-3 w-3" /> The same blended scene the website&rsquo;s Explore page shows — follow a creator from their portrait card, join a crew at the groups desk below.
          </p>
        </>
      )}
    </div>
  );
}

/* ═══ #82 The admin moderation bench ═══════════════════════════════ */

export function ModerationBench({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [queueKind, setQueueKind] = useState<AdminQueueKind>("reports");
  const [queue, setQueue] = useState<AdminReportRow[] | null>(null);
  const [queueFailed, setQueueFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removedList, setRemovedList] = useState<AdminContentState[] | null>(null);
  const [removedFailed, setRemovedFailed] = useState(false);
  const [lookupInput, setLookupInput] = useState("");
  const [current, setCurrent] = useState<AdminContentState | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [reason, setReason] = useState<string>("spam");
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);
  const [benchNote, setBenchNote] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  /* The gate: the bench asks the server who is standing here. A
     member, a guest, or a failed read all render NOTHING — the
     bench doesn't exist for non-admins in-world, exactly as the
     admin routes 403 for them server-side. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiJson<{ isAdmin?: unknown }>(authHeaders, ADMIN_STATUS_PATH);
        if (!cancelled) setIsAdmin(d.isAdmin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = moderationBenchVisible(isAdmin);

  const loadQueue = useCallback(async () => {
    setQueueFailed(false);
    try {
      const d = await apiJson<unknown>(authHeaders, adminQueuePath(queueKind));
      setQueue(normalizeAdminReports(d));
    } catch {
      setQueueFailed(true);
      setQueue(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKind]);

  const loadRemoved = useCallback(async () => {
    setRemovedFailed(false);
    try {
      const d = await apiJson<unknown>(authHeaders, ADMIN_CONTENT_REMOVED_PATH);
      setRemovedList(normalizeRemovedContent(d));
    } catch {
      setRemovedFailed(true);
      setRemovedList(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!visible) return;
    void loadQueue();
    void loadRemoved();
  }, [visible, tick, loadQueue, loadRemoved]);

  if (!visible) return null;

  async function setStatus(kind: AdminQueueKind, id: string, status: string) {
    setBusyId(id);
    setBenchNote(null);
    try {
      await apiJson(authHeaders, adminQueueItemPath(kind, id), {
        method: "PATCH", body: { status },
      });
      setQueue((rows) => (rows ?? []).map((r) => (r.id === id ? { ...r, status } : r)));
    } catch {
      setBenchNote("That status change didn't land — the queue is unchanged.");
    } finally {
      setBusyId(null);
    }
  }

  async function lookup() {
    const id = parseContentId(lookupInput);
    setLookupNote(null);
    setCurrent(null);
    if (!id) {
      setLookupNote("Paste a post or comment ID (or a link carrying one) — there's nothing to look up in that.");
      return;
    }
    setLooking(true);
    try {
      const d = await apiJson<unknown>(authHeaders, adminContentPath(id));
      const content = normalizeAdminContent(d);
      if (!content) {
        setLookupNote("That content couldn't be found.");
        return;
      }
      setCurrent(content);
      setNote("");
    } catch {
      setLookupNote("That content couldn't be found — or the lookup slipped. Try again.");
    } finally {
      setLooking(false);
    }
  }

  async function patchContent(id: string, removed: boolean) {
    setActing(true);
    setBenchNote(null);
    try {
      const d = await apiJson<unknown>(authHeaders, adminContentPath(id), {
        method: "PATCH",
        body: removed
          ? { removed: true, reason, ...(note.trim() ? { note: note.trim() } : {}) }
          : { removed: false },
      });
      const updated = normalizeAdminContent(d);
      if (updated && current?.id === id) setCurrent(updated);
      setTick((n) => n + 1);
    } catch {
      setBenchNote("That action didn't land — the content's state is unchanged.");
    } finally {
      setActing(false);
    }
  }

  return (
    <NativeCard isLight={isLight} title="Moderation bench — admin only">
      <div data-testid="world-moderation-bench">
        <p className={`flex items-start gap-1.5 text-xs ${muted}`}>
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
          The admin workbench, in-world: member reports, DMCA takedowns and the content-removal
          rail. Every verb rides the admin routes, which re-check your admin standing
          server-side — this bench showing is never the enforcement.
        </p>

        {/* The two queues */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              { key: "reports", label: "Member reports" },
              { key: "dmca-reports", label: "DMCA reports" },
            ] as { key: AdminQueueKind; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setQueueKind(t.key)}
              aria-pressed={queueKind === t.key}
              data-testid={`world-moderation-queue-${t.key}`}
              className={`${chipBtn(isLight)} ${queueKind === t.key ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {queueFailed ? (
          <div className="mt-2" data-testid="world-moderation-queue-failed">
            <NativeErrorState
              isLight={isLight}
              title="The queue wouldn't load"
              message="A failed load is not an empty queue — the reports are safe."
              onRetry={() => void loadQueue()}
            />
          </div>
        ) : queue === null ? (
          <NativeLoadingState isLight={isLight} message="Opening the queue…" />
        ) : queue.length === 0 ? (
          <p className={`mt-2 text-xs ${muted}`} data-testid="world-moderation-queue-empty">
            The queue is clear — nothing waiting on a ruling.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {queue.map((r) => (
              <div
                key={r.id}
                className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                data-testid="world-moderation-report"
              >
                <p className={`text-sm font-bold ${strong}`}>
                  {queueKind === "reports"
                    ? `${r.targetType ?? "content"} · ${r.reason ?? ""}`
                    : `${r.reporterName ?? "Reporter"}${r.reporterOrg ? ` · ${r.reporterOrg}` : ""}`}
                  <span className={`ml-2 rounded-full border border-[#d4af37]/50 px-2 py-0.5 text-[10px] font-black uppercase ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                    {r.status}
                  </span>
                </p>
                {queueKind === "reports" ? (
                  <>
                    {r.targetSummary && <p className={`mt-1 text-sm ${strong}`}>“{r.targetSummary}”</p>}
                    {r.note && <p className={`mt-0.5 text-xs italic ${muted}`}>{r.note}</p>}
                  </>
                ) : (
                  <>
                    {r.description && <p className={`mt-1 whitespace-pre-wrap text-sm ${strong}`}>{r.description}</p>}
                    {r.reporterEmail && <p className={`mt-0.5 text-xs ${muted}`}>{r.reporterEmail}</p>}
                    {(r.infringingUrls ?? []).map((u) => (
                      <p key={u} className={`mt-0.5 break-all text-xs ${muted}`}>{u}</p>
                    ))}
                  </>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {REPORT_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busyId === r.id || r.status === s}
                      onClick={() => void setStatus(queueKind, r.id, s)}
                      data-testid={`world-moderation-status-${s}`}
                      className={`${chipBtn(isLight)} ${r.status === s ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
                    >
                      {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Content removal — state first, then the verb (no blind removals). */}
        <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          Content removal
        </p>
        <div className="flex gap-2">
          <input
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void lookup()}
            placeholder="Paste a post / comment ID or link…"
            className={inputCls(isLight)}
            data-testid="world-moderation-lookup-input"
          />
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={looking}
            className={goldBtn}
            data-testid="world-moderation-lookup-go"
          >
            {looking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Look up
          </button>
        </div>
        {lookupNote && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{lookupNote}</p>
        )}
        {current && (
          <div
            className={`mt-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
            data-testid="world-moderation-content"
          >
            <p className={`text-xs ${muted}`}>
              {current.kind === "comment" ? "Comment" : "Post"}
              {current.author ? ` · ${current.author.displayName} (@${current.author.slug})` : ""}
              {" · "}
              <span className={current.removed ? "font-bold text-red-400" : "font-bold text-emerald-400"}>
                {current.removed ? `Removed — ${removalReasonLabel(current.removalReason)}` : "Live"}
              </span>
            </p>
            <p className={`mt-1 whitespace-pre-wrap text-sm ${strong}`}>{current.body}</p>
            {current.removed ? (
              <button
                type="button"
                onClick={() => void patchContent(current.id, false)}
                disabled={acting}
                className={`${goldBtn} mt-2`}
                data-testid="world-moderation-restore"
              >
                {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                Restore it
              </button>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className={inputCls(isLight)}
                    data-testid="world-moderation-reason"
                    aria-label="Removal reason"
                  >
                    {REMOVAL_REASONS.map((r) => (
                      <option key={r} value={r}>{REMOVAL_REASON_LABELS[r]}</option>
                    ))}
                  </select>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Internal note (never shown to the author)"
                    maxLength={500}
                    className={inputCls(isLight)}
                    data-testid="world-moderation-note"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void patchContent(current.id, true)}
                  disabled={acting}
                  className={`${chipBtn(isLight)} border-red-400/60 font-black text-red-400`}
                  data-testid="world-moderation-remove"
                >
                  {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
                  Remove this {current.kind}
                </button>
                <p className={`text-[11px] ${muted}`}>
                  Removal is a state, never a delete — the author sees the reason category, and restoring brings it back whole.
                </p>
              </div>
            )}
          </div>
        )}

        {/* The standing removal record — restores are one lookup away. */}
        <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          Currently removed
        </p>
        {removedFailed ? (
          <div data-testid="world-moderation-removed-failed">
            <NativeErrorState
              isLight={isLight}
              title="The removal record wouldn't load"
              message="A failed load is not an empty record."
              onRetry={() => void loadRemoved()}
            />
          </div>
        ) : removedList === null ? (
          <NativeLoadingState isLight={isLight} message="Reading the record…" />
        ) : removedList.length === 0 ? (
          <p className={`text-xs ${muted}`}>Nothing is removed right now.</p>
        ) : (
          <div className="space-y-2">
            {removedList.map((c) => (
              <div
                key={c.id}
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                data-testid="world-moderation-removed-row"
              >
                <p className={`min-w-0 flex-1 truncate text-sm ${strong}`}>
                  {c.body}
                  <span className={muted}>
                    {" "}· {c.author ? `@${c.author.slug}` : "unknown"} · {removalReasonLabel(c.removalReason)}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => void patchContent(c.id, false)}
                  disabled={acting}
                  className={chipBtn(isLight)}
                  data-testid="world-moderation-removed-restore"
                >
                  <Eye className="h-3.5 w-3.5" /> Restore
                </button>
              </div>
            ))}
          </div>
        )}
        {benchNote && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-moderation-note-line">
            {benchNote}
          </p>
        )}
      </div>
    </NativeCard>
  );
}

/* ═══ #83/#84 My profile — view as a visitor, edit as the owner ════ */

export function MyProfileDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const [own, setOwn] = useState<OwnProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "none">("loading");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [tick, setTick] = useState(0);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const d = await apiJson<unknown>(authHeaders, MY_PROFILE_PATH);
        const profile = normalizeOwnProfile(d);
        if (cancelled) return;
        if (profile) {
          setOwn(profile);
          setState("ready");
        } else {
          setState("failed");
        }
      } catch (e) {
        if (cancelled) return;
        /* The owner read 404s when no profile exists yet — that's
           the honest "none" state, not a failure. */
        setState(e instanceof Error && /404|No profile/.test(e.message) ? "none" : "failed");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return (
    <div className="space-y-3" data-testid="world-my-profile">
      <NativeCard isLight={isLight} title="My public page">
        {state === "loading" ? (
          <NativeLoadingState isLight={isLight} message="Fetching your page…" />
        ) : state === "failed" ? (
          <NativeErrorState
            isLight={isLight}
            title="Your page wouldn't load"
            message="The page is fine — the fetch slipped."
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : state === "none" || !own ? (
          <NativeEmptyState
            isLight={isLight}
            message="No creator profile yet."
            detail="Claim your corner first — the creation card on this board walks you through it, and your page appears here the moment it exists."
          />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setMode("view")}
                aria-pressed={mode === "view"}
                data-testid="world-my-profile-mode-view"
                className={`${chipBtn(isLight)} ${mode === "view" ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
              >
                <Eye className="h-3.5 w-3.5" /> As visitors see it
              </button>
              <button
                type="button"
                onClick={() => setMode("edit")}
                aria-pressed={mode === "edit"}
                data-testid="world-my-profile-mode-edit"
                className={`${chipBtn(isLight)} ${mode === "edit" ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit my page
              </button>
            </div>
            {mode === "view" ? (
              <ProfileVisitorView isLight={isLight} authHeaders={authHeaders} own={own} tick={tick} />
            ) : (
              <ProfileEditor
                isLight={isLight}
                authHeaders={authHeaders}
                own={own}
                onSaved={() => setTick((n) => n + 1)}
              />
            )}
          </>
        )}
        {state === "ready" && (
          <p className={`mt-2 text-[11px] ${muted}`}>
            This is your page inside the palace — the same profile the website serves at /artist/{own?.slug ?? "you"}.
          </p>
        )}
      </NativeCard>
    </div>
  );
}

function ProfileVisitorView({
  isLight, authHeaders, own, tick,
}: {
  isLight: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  own: OwnProfile;
  tick: number;
}) {
  const [view, setView] = useState<PublicProfileView | null>(null);
  const [failed, setFailed] = useState(false);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setView(null);
    (async () => {
      try {
        const d = await apiJson<unknown>(authHeaders, publicProfilePath(own.slug));
        const v = normalizePublicProfile(d);
        if (cancelled) return;
        if (v) setView(v);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own.slug, tick]);

  if (!own.is_public) {
    return (
      <p className={`text-sm ${muted}`} data-testid="world-my-profile-private">
        Your page is set to private — visitors see nothing right now. Flip it public in the editor and this view shows exactly what they&rsquo;d meet.
      </p>
    );
  }
  if (failed) {
    return (
      <p className={`text-sm font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-my-profile-view-failed">
        The visitor view wouldn&rsquo;t load — your page itself is fine.
      </p>
    );
  }
  if (view === null) return <NativeLoadingState isLight={isLight} message="Stepping outside to look at your page…" />;
  const p = view.profile;
  return (
    <div data-testid="world-my-profile-visitor">
      {p.banner_url && <img src={p.banner_url} alt="" className="mb-3 h-24 w-full rounded-xl object-cover" />}
      <div className="flex items-center gap-3">
        {p.avatar_url ? (
          <img src={p.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#d4af37]/20 text-xl font-black text-[#e8c86a]">
            {p.display_name[0] ?? "?"}
          </span>
        )}
        <div className="min-w-0">
          <p className={`truncate text-base font-black ${strong}`}>{p.display_name}</p>
          <p className={`text-xs ${muted}`}>
            @{p.slug}{p.vertical ? ` · ${p.vertical}` : ""} · {p.follower_count.toLocaleString()} followers · {p.total_plays.toLocaleString()} plays
          </p>
        </div>
      </div>
      {p.bio && <p className={`mt-2 whitespace-pre-wrap text-sm ${strong}`}>{p.bio}</p>}
      <p className={`mt-2 text-xs ${muted}`}>
        {view.counts.tracks} tracks · {view.counts.videos} videos · {view.counts.playlists} playlists on the page
      </p>
      {view.topTracks.length > 0 && (
        <div className="mt-2">
          <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Top tracks</p>
          {view.topTracks.map((t) => (
            <p key={t.id} className={`py-0.5 text-sm ${strong}`}>
              {t.title}{typeof t.play_count === "number" ? <span className={muted}> · {t.play_count.toLocaleString()} plays</span> : null}
            </p>
          ))}
        </div>
      )}
      {view.topVideos.length > 0 && (
        <div className="mt-2">
          <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Top videos</p>
          {view.topVideos.map((v) => (
            <p key={v.id} className={`py-0.5 text-sm ${strong}`}>
              {v.title}{typeof v.view_count === "number" ? <span className={muted}> · {v.view_count.toLocaleString()} views</span> : null}
            </p>
          ))}
        </div>
      )}
      {Object.keys(p.social_links).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(p.social_links).map(([platform, url]) => (
            <span key={platform} className={`${chipBtn(isLight)} pointer-events-none capitalize`} data-testid="world-my-profile-social">
              {platform}: {url.replace(/^https?:\/\//, "").slice(0, 32)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileEditor({
  isLight, authHeaders, own, onSaved,
}: {
  isLight: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  own: OwnProfile;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(own.display_name);
  const [bio, setBio] = useState(own.bio ?? "");
  const [isPublic, setIsPublic] = useState(own.is_public);
  const [rows, setRows] = useState(() => socialLinkRows(own.social_links));
  const [savingBasics, setSavingBasics] = useState(false);
  const [basicsNote, setBasicsNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const shareUrl = referralShareUrl(
    typeof window !== "undefined" ? window.location.origin : "",
    own.slug,
    own.referral_code,
  );

  async function saveBasics() {
    if (savingBasics || !profileBasicsReady(displayName, bio)) return;
    setSavingBasics(true);
    setBasicsNote(null);
    try {
      await apiJson(authHeaders, MY_PROFILE_PATH, {
        method: "PUT",
        body: {
          display_name: displayName.trim(),
          bio,
          is_public: isPublic,
          social_links: socialLinksFromRows(rows),
        },
      });
      setBasicsNote("Saved — your page wears it now.");
      onSaved();
    } catch (e) {
      setBasicsNote(e instanceof Error ? e.message : "That save didn't land — your page is unchanged.");
    } finally {
      setSavingBasics(false);
    }
  }

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div data-testid="world-my-profile-editor">
      <label className={`text-xs font-bold ${muted}`}>Display name</label>
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={80}
        className={`${inputCls(isLight)} mt-1`}
        data-testid="world-profile-edit-name"
      />
      <label className={`mt-3 block text-xs font-bold ${muted}`}>Bio</label>
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="Tell the kingdom who you are…"
        className={`${inputCls(isLight)} mt-1`}
        data-testid="world-profile-edit-bio"
      />
      <p className={`mt-1 text-[11px] ${muted}`}>{bio.length}/2000</p>
      <button
        type="button"
        onClick={() => setIsPublic((v) => !v)}
        aria-pressed={isPublic}
        data-testid="world-profile-edit-public"
        className={`${chipBtn(isLight)} mt-2 ${isPublic ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
      >
        {isPublic ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        {isPublic ? "Page is public" : "Page is private"}
      </button>

      <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        Social links
      </p>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={r.platform} className="flex items-center gap-2">
            <span className={`w-20 shrink-0 text-xs capitalize ${muted}`}>{r.platform}</span>
            <input
              value={r.url}
              onChange={(e) =>
                setRows((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
              }
              placeholder="https://…"
              className={inputCls(isLight)}
              data-testid={`world-profile-edit-social-${r.platform}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void saveBasics()}
          disabled={savingBasics || !profileBasicsReady(displayName, bio)}
          className={goldBtn}
          data-testid="world-profile-edit-save"
        >
          {savingBasics ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save name, bio &amp; links
        </button>
        {basicsNote && (
          <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{basicsNote}</span>
        )}
      </div>

      <LayoutEditor isLight={isLight} authHeaders={authHeaders} />
      <ThemeEditor isLight={isLight} authHeaders={authHeaders} />

      {/* Referral — the code is minted on the referrals rail; the
          editor's job is the same one artist-setup does: show it,
          and build the share link that carries it. */}
      <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        Your referral
      </p>
      {own.referral_code ? (
        <div data-testid="world-profile-referral">
          <p className={`text-sm ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
            Shares carry <span className="font-mono font-bold text-[#e8c86a]">?ref={own.referral_code}</span> — new fans earn you referral credit.
          </p>
          {shareUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`min-w-0 flex-1 truncate rounded-xl border px-3 py-2 text-xs ${isLight ? "border-[#C9A84C]/40 bg-white/60" : "border-white/10 bg-white/5"}`}>
                {shareUrl}
              </span>
              <button type="button" onClick={() => void copyShare()} className={chipBtn(isLight)} data-testid="world-profile-referral-copy">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className={`text-xs ${muted}`} data-testid="world-profile-referral-none">
          No referral code minted yet — it appears here the moment the referrals rail issues one.
        </p>
      )}
    </div>
  );
}

function LayoutEditor({
  isLight, authHeaders,
}: {
  isLight: boolean;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const [dto, setDto] = useState<ProfileLayoutDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiJson<ProfileLayoutDto>(authHeaders, MY_LAYOUT_PATH);
        if (!cancelled) setDto(d);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!dto || saving) return;
    setSaving(true);
    setNote(null);
    try {
      const d = await apiJson<ProfileLayoutDto>(authHeaders, MY_LAYOUT_PATH, {
        method: "PUT", body: { layout: dto.layout },
      });
      setDto(d);
      setNote("Layout saved — your page renders in this order.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That layout didn't save — the server validates blocks; your page is unchanged.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="world-profile-layout">
      <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        Page blocks {dto?.isDefault ? <span className={`normal-case tracking-normal ${muted}`}>(the Grand Stage order — yours once you save)</span> : null}
      </p>
      {failed ? (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>The layout wouldn&rsquo;t load — editing waits for a clean read.</p>
      ) : dto === null ? (
        <NativeLoadingState isLight={isLight} message="Reading your blocks…" />
      ) : (
        <>
          <div className="space-y-1.5">
            {dto.layout.map((b) => (
              <div
                key={b.type}
                className={`flex flex-wrap items-center gap-1.5 rounded-xl border px-2.5 py-1.5 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                data-testid="world-profile-block"
              >
                <input
                  value={b.title}
                  onChange={(e) => setDto((d) => (d ? { ...d, layout: retitleBlock(d.layout, b.type, e.target.value) } : d))}
                  maxLength={80}
                  className={`min-w-0 flex-1 rounded-lg border px-2 py-1 text-sm outline-none focus:border-[#d4af37] ${isLight ? "border-[#C9A84C]/30 bg-white/60 text-[#2a1e07]" : "border-white/10 bg-white/5 text-white"}`}
                  data-testid={`world-profile-block-title-${b.type}`}
                  aria-label={`Block title for ${b.type}`}
                />
                <button type="button" onClick={() => setDto((d) => (d ? { ...d, layout: moveBlock(d.layout, b.type, -1) } : d))} className={chipBtn(isLight)} data-testid={`world-profile-block-up-${b.type}`} aria-label="Move block up">
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setDto((d) => (d ? { ...d, layout: moveBlock(d.layout, b.type, 1) } : d))} className={chipBtn(isLight)} data-testid={`world-profile-block-down-${b.type}`} aria-label="Move block down">
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDto((d) => (d ? { ...d, layout: toggleBlockVisibility(d.layout, b.type) } : d))}
                  aria-pressed={b.visible}
                  className={`${chipBtn(isLight)} ${b.visible ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
                  data-testid={`world-profile-block-visible-${b.type}`}
                >
                  {b.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {b.visible ? "Shown" : "Hidden"}
                </button>
                <button
                  type="button"
                  onClick={() => setDto((d) => (d ? { ...d, layout: removeBlock(d.layout, b.type) } : d))}
                  className={chipBtn(isLight)}
                  data-testid={`world-profile-block-remove-${b.type}`}
                  aria-label={`Remove ${b.type} block`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {addableBlockTypes(dto.layout, dto.blockTypes).length > 0 && dto.layout.length < dto.maxBlocks && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {addableBlockTypes(dto.layout, dto.blockTypes).map((def) => (
                <button
                  key={def.type}
                  type="button"
                  onClick={() => setDto((d) => (d ? { ...d, layout: addBlock(d.layout, def) } : d))}
                  className={chipBtn(isLight)}
                  data-testid={`world-profile-block-add-${def.type}`}
                >
                  <Plus className="h-3.5 w-3.5" /> {def.label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className={goldBtn} data-testid="world-profile-layout-save">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save layout
            </button>
            {note && <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function ThemeEditor({
  isLight, authHeaders,
}: {
  isLight: boolean;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const [dto, setDto] = useState<ProfileThemeSettingsDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [colorway, setColorway] = useState<string | null>(null);
  const [headingFont, setHeadingFont] = useState<string | null>(null);
  const [bodyFont, setBodyFont] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiJson<ProfileThemeSettingsDto>(authHeaders, MY_THEME_SETTINGS_PATH);
        if (cancelled) return;
        setDto(d);
        setColorway(d.colorway);
        setHeadingFont(d.headingFont);
        setBodyFont(d.bodyFont);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = themeSettingsPatch({ colorway, headingFont, bodyFont });
  const patchEmpty = Object.keys(patch).length === 0;

  async function save() {
    if (saving || patchEmpty) return;
    setSaving(true);
    setNote(null);
    try {
      const d = await apiJson<ProfileThemeSettingsDto>(authHeaders, MY_THEME_SETTINGS_PATH, {
        method: "PUT", body: patch,
      });
      setDto(d);
      setColorway(d.colorway);
      setHeadingFont(d.headingFont);
      setBodyFont(d.bodyFont);
      setNote("Theme saved — your page wears the new look.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That theme didn't save — picks must come from the designed lists.");
    } finally {
      setSaving(false);
    }
  }

  const selectCls = `${inputCls(isLight)} mt-1`;
  return (
    <div data-testid="world-profile-theme">
      <p className={`mb-1.5 mt-4 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        Page theme
      </p>
      {failed ? (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>The theme settings wouldn&rsquo;t load — editing waits for a clean read.</p>
      ) : dto === null ? (
        <NativeLoadingState isLight={isLight} message="Reading your theme…" />
      ) : (
        <>
          <label className={`text-xs font-bold ${muted}`}>Colorway</label>
          <select value={colorway ?? ""} onChange={(e) => setColorway(e.target.value || null)} className={selectCls} data-testid="world-profile-theme-colorway">
            <option value="">No pick yet</option>
            {dto.colorways.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <label className={`text-xs font-bold ${muted}`}>Heading font</label>
              <select value={headingFont ?? ""} onChange={(e) => setHeadingFont(e.target.value || null)} className={selectCls} data-testid="world-profile-theme-heading">
                <option value="">No pick yet</option>
                {dto.fonts.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={`text-xs font-bold ${muted}`}>Body font</label>
              <select value={bodyFont ?? ""} onChange={(e) => setBodyFont(e.target.value || null)} className={selectCls} data-testid="world-profile-theme-body">
                <option value="">No pick yet</option>
                {dto.fonts.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={saving || patchEmpty} className={goldBtn} data-testid="world-profile-theme-save">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save theme
            </button>
            {patchEmpty && <span className={`text-[11px] ${muted}`}>Make a pick first — an all-empty save changes nothing.</span>}
            {note && <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</span>}
          </div>
        </>
      )}
    </div>
  );
}
