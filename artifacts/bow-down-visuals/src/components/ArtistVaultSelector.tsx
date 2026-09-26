import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronDown, Archive, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ArtistVault {
  id: string;
  user_id: string;
  artist_name: string;
  artist_type: string | null;
  genre: string | null;
  voice_style: string | null;
  visual_style: string | null;
  hair: string | null;
  tattoos: string | null;
  jewelry: string | null;
  clothing_style: string | null;
  brand_colors: string | null;
  theme_id: string | null;
  personality: string | null;
  do_not_change_rules: string | null;
  reference_image_url: string | null;
  reference_image_path: string | null;
  reference_video_url?: string | null;
  reference_video_path?: string | null;
  consistency_prompt: string | null;
  voice_id: string | null;
  voice_name: string | null;
  voice_preview_url: string | null;
  is_active: boolean;
  created_at: string;
}

/* ─── Subject types ────────────────────────────────────────────────────────
   Stored in the existing `artist_type` DB text field. Legacy values
   ("Rapper", "Singer", …) and empty/null normalize to "artist". */

export type SubjectType = "artist" | "actor" | "actress" | "character" | "gamer" | "streamer" | "podcaster";

export type VaultContext = "music" | "video" | "movie" | "series" | "promo" | "thumbnail";

export function normalizeSubjectType(value: string | null | undefined): SubjectType {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "actor") return "actor";
  if (v === "actress") return "actress";
  if (v === "character") return "character";
  if (v === "gamer") return "gamer";
  if (v === "streamer") return "streamer";
  if (v === "podcaster") return "podcaster";
  return "artist";
}

export const SUBJECT_TYPE_META: Record<
  SubjectType,
  { label: string; badge: string; dot: string; glow: string; description: string }
> = {
  artist: {
    label: "Artist",
    badge: "text-amber-300 border-amber-400/40 bg-gradient-to-r from-amber-500/25 via-amber-400/15 to-amber-500/25",
    dot: "bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.8)]",
    glow: "shadow-[0_0_12px_rgba(251,191,36,0.25)]",
    description: "Musicians, singers, rappers - for music videos and songs",
  },
  actor: {
    label: "Actor",
    badge: "text-blue-300 border-blue-400/40 bg-gradient-to-r from-blue-500/25 via-blue-400/15 to-blue-500/25",
    dot: "bg-blue-300 shadow-[0_0_6px_rgba(147,197,253,0.8)]",
    glow: "shadow-[0_0_12px_rgba(96,165,250,0.25)]",
    description: "Actors, male presenters, hosts - for movies, series, and skits",
  },
  actress: {
    label: "Actress",
    badge: "text-rose-300 border-rose-400/40 bg-gradient-to-r from-rose-500/25 via-rose-400/15 to-rose-500/25",
    dot: "bg-rose-300 shadow-[0_0_6px_rgba(253,164,175,0.8)]",
    glow: "shadow-[0_0_12px_rgba(251,113,133,0.25)]",
    description: "Actresses, female presenters, hosts - for movies, series, and skits",
  },
  character: {
    label: "Character",
    badge: "text-purple-300 border-purple-400/40 bg-gradient-to-r from-purple-500/25 via-purple-400/15 to-purple-500/25",
    dot: "bg-purple-300 shadow-[0_0_6px_rgba(216,180,254,0.8)]",
    glow: "shadow-[0_0_12px_rgba(192,132,252,0.25)]",
    description: "Fictional characters, mascots, avatars - for stories and branding",
  },
  gamer: {
    label: "Gamer",
    badge: "text-emerald-300 border-emerald-400/40 bg-gradient-to-r from-emerald-500/25 via-emerald-400/15 to-emerald-500/25",
    dot: "bg-emerald-300 shadow-[0_0_6px_rgba(110,231,183,0.8)]",
    glow: "shadow-[0_0_12px_rgba(52,211,153,0.25)]",
    description: "Gamers, streamers, esports players - for gaming content and streams",
  },
  streamer: {
    label: "Streamer",
    badge: "text-red-300 border-red-400/40 bg-gradient-to-r from-red-500/25 via-red-400/15 to-red-500/25",
    dot: "bg-red-300 shadow-[0_0_6px_rgba(252,165,165,0.8)]",
    glow: "shadow-[0_0_12px_rgba(248,113,113,0.35)]",
    description: "Streamers, live creators, broadcasters - for live content and community streams",
  },
  podcaster: {
    label: "Podcaster",
    badge: "text-orange-300 border-orange-400/40 bg-gradient-to-r from-orange-500/25 via-orange-400/15 to-orange-500/25",
    dot: "bg-orange-300 shadow-[0_0_6px_rgba(253,186,116,0.8)]",
    glow: "shadow-[0_0_12px_rgba(251,146,60,0.25)]",
    description: "Podcasters, hosts, interviewers - for podcasts and talk content",
  },
};

export function SubjectBadge({ type, className = "" }: { type: SubjectType; className?: string }) {
  const meta = SUBJECT_TYPE_META[type];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] shrink-0 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ${meta.badge} ${meta.glow} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/* Sort priority per context. Array.prototype.sort is stable, so profiles of
   the same type keep their original (created_at) relative order. */
const CONTEXT_PRIORITY: Record<VaultContext, Record<SubjectType, number>> = {
  music: { artist: 0, character: 1, actor: 2, actress: 2, gamer: 3, streamer: 3, podcaster: 3 },
  video: { artist: 0, character: 1, actor: 2, actress: 2, gamer: 3, streamer: 3, podcaster: 3 },
  movie: { actor: 0, actress: 0, character: 1, artist: 2, gamer: 3, streamer: 3, podcaster: 3 },
  series: { character: 0, actor: 1, actress: 1, artist: 2, gamer: 3, streamer: 3, podcaster: 3 },
  promo: { artist: 0, actor: 1, actress: 1, character: 2, gamer: 2, streamer: 2, podcaster: 2 },
  thumbnail: { artist: 0, actor: 1, actress: 1, character: 2, gamer: 2, streamer: 2, podcaster: 2 },
};

interface Props {
  onLoad: (vault: ArtistVault) => void;
  loadedVaultId?: string | null;
  loadedVault?: ArtistVault | null;
  /** Context-aware sorting: puts the most relevant subject type first. */
  context?: VaultContext;
}

const selectClass =
  "h-10 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 pr-8 text-sm focus:outline-none focus:border-primary/50 appearance-none cursor-pointer";

export function ArtistVaultSelector({ onLoad, loadedVaultId, loadedVault: loadedVaultProp, context }: Props) {
  const { getAccessToken } = useAuth();
  const [vaults, setVaults] = useState<ArtistVault[]>([]);
  const [selected, setSelected] = useState("");
  const [fetching, setFetching] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadVaults() {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/artist-vaults", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = (await res.json()) as { vaults: ArtistVault[] };
          setVaults(data.vaults);
          if (data.vaults.length > 0) {
            const sorted = sortVaults(data.vaults, context);
            setSelected(sorted[0].id);
          }
        }
      } catch {
        /* silent */
      } finally {
        setFetching(false);
      }
    }
    loadVaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return;
    function onDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [dropdownOpen]);

  const sortedVaults = useMemo(() => sortVaults(vaults, context), [vaults, context]);
  const selectedVault = sortedVaults.find((v) => v.id === selected) ?? null;

  if (fetching) return null;

  const loaded = loadedVaultProp ?? (loadedVaultId ? vaults.find((v) => v.id === loadedVaultId) : null) ?? null;

  if (!loaded && vaults.length === 0) {
    return (
      <div className="mb-6 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-center gap-3">
        <Archive className="h-4 w-4 text-white/25 shrink-0" />
        <p className="text-sm text-white/40">
          No subject profiles yet.{" "}
          <Link href="/artist-vault" className="text-primary hover:underline">
            Create one
          </Link>{" "}
          to auto-fill your style rules into every tool.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-6 p-5 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] via-primary/[0.03] to-transparent shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center h-7 w-7 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/40 shadow-[0_0_12px_rgba(212,175,55,0.3)]">
          <Archive className="h-3.5 w-3.5 text-primary shrink-0" />
        </div>
        <span className="text-xs font-bold text-primary uppercase tracking-[0.18em]">Subject Selection</span>
        <Link href="/artist-vault" className="ml-auto text-xs text-white/40 hover:text-primary transition-colors font-medium">
          Manage profiles →
        </Link>
      </div>

      {loaded ? (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-primary/40 to-primary/10 border border-primary/30 shrink-0">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          </div>
          <div className="min-w-0 flex items-center gap-2.5">
            <p className="text-sm font-bold text-white truncate tracking-wide">{loaded.artist_name}</p>
            <SubjectBadge type={normalizeSubjectType(loaded.artist_type)} />
          </div>
          {loaded.genre && <p className="text-xs text-white/40 truncate font-medium">{loaded.genre}</p>}
          <button
            onClick={() => setSelected(loaded.id)}
            className="ml-auto text-xs text-white/40 hover:text-primary transition-colors shrink-0 font-semibold tracking-wide"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="relative flex-1 min-w-0" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              className="h-11 w-full rounded-xl bg-gradient-to-b from-white/[0.07] to-white/[0.03] border border-white/[0.12] text-white px-4 text-sm focus:outline-none focus:border-primary/60 focus:shadow-[0_0_16px_rgba(212,175,55,0.2)] appearance-none cursor-pointer flex items-center gap-2.5 text-left transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
            >
              <span className="truncate font-semibold tracking-wide">{selectedVault ? selectedVault.artist_name : "Select a profile"}</span>
              {selectedVault && <SubjectBadge type={normalizeSubjectType(selectedVault.artist_type)} />}
              <ChevronDown className={`ml-auto h-4 w-4 text-primary/70 shrink-0 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute z-50 mt-2 w-full rounded-xl border border-white/[0.12] bg-[#161616]/95 backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.6)] overflow-hidden max-h-64 overflow-y-auto">
                {sortedVaults.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setSelected(v.id);
                      setDropdownOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-4 py-3 text-left transition-all hover:bg-gradient-to-r hover:from-white/[0.07] hover:to-transparent ${
                      v.id === selected ? "bg-gradient-to-r from-primary/[0.15] to-transparent border-l-2 border-l-primary" : "border-l-2 border-l-transparent"
                    }`}
                  >
                    <span className="truncate text-sm text-white font-medium tracking-wide">{v.artist_name}</span>
                    <SubjectBadge type={normalizeSubjectType(v.artist_type)} />
                    {v.genre && <span className="ml-auto text-xs text-white/35 truncate pl-2 font-medium">{v.genre}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const vault = vaults.find((v) => v.id === selected);
              if (vault) onLoad(vault);
            }}
            className="h-11 px-6 shrink-0 bg-gradient-to-b from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 text-black border border-primary/50 rounded-xl text-sm font-bold tracking-wide transition-all shadow-[0_4px_16px_rgba(212,175,55,0.3),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_6px_20px_rgba(212,175,55,0.4)]"
          >
            Load Profile
          </Button>
        </div>
      )}
    </div>
  );
}

function sortVaults(vaults: ArtistVault[], context?: VaultContext): ArtistVault[] {
  if (!context) return vaults;
  const priority = CONTEXT_PRIORITY[context];
  return [...vaults].sort(
    (a, b) => priority[normalizeSubjectType(a.artist_type)] - priority[normalizeSubjectType(b.artist_type)]
  );
}
