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
  personality: string | null;
  do_not_change_rules: string | null;
  reference_image_url: string | null;
  reference_image_path: string | null;
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

export type SubjectType = "artist" | "actor" | "actress" | "character";

export type VaultContext = "music" | "video" | "movie" | "series" | "promo" | "thumbnail";

export function normalizeSubjectType(value: string | null | undefined): SubjectType {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "actor") return "actor";
  if (v === "actress") return "actress";
  if (v === "character") return "character";
  return "artist";
}

export const SUBJECT_TYPE_META: Record<
  SubjectType,
  { label: string; badge: string; description: string }
> = {
  artist: {
    label: "Artist",
    badge: "text-amber-400 border-amber-400/30 bg-amber-400/10",
    description: "Musicians, singers, rappers - for music videos and songs",
  },
  actor: {
    label: "Actor",
    badge: "text-blue-400 border-blue-400/30 bg-blue-400/10",
    description: "Actors, male presenters, hosts - for movies, series, and skits",
  },
  actress: {
    label: "Actress",
    badge: "text-rose-400 border-rose-400/30 bg-rose-400/10",
    description: "Actresses, female presenters, hosts - for movies, series, and skits",
  },
  character: {
    label: "Character",
    badge: "text-purple-400 border-purple-400/30 bg-purple-400/10",
    description: "Fictional characters, mascots, avatars - for stories and branding",
  },
};

export function SubjectBadge({ type, className = "" }: { type: SubjectType; className?: string }) {
  const meta = SUBJECT_TYPE_META[type];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 ${meta.badge} ${className}`}
    >
      {meta.label}
    </span>
  );
}

/* Sort priority per context. Array.prototype.sort is stable, so profiles of
   the same type keep their original (created_at) relative order. */
const CONTEXT_PRIORITY: Record<VaultContext, Record<SubjectType, number>> = {
  music: { artist: 0, character: 1, actor: 2, actress: 2 },
  video: { artist: 0, character: 1, actor: 2, actress: 2 },
  movie: { actor: 0, actress: 0, character: 1, artist: 2 },
  series: { character: 0, actor: 1, actress: 1, artist: 2 },
  promo: { artist: 0, actor: 1, actress: 1, character: 2 },
  thumbnail: { artist: 0, actor: 1, actress: 1, character: 2 },
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
    <div className="mb-6 p-4 rounded-xl border border-primary/20 bg-primary/[0.04]">
      <div className="flex items-center gap-2 mb-3">
        <Archive className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-bold text-primary uppercase tracking-wider">Subject Selection</span>
        <Link href="/artist-vault" className="ml-auto text-xs text-white/30 hover:text-white/60 transition-colors">
          Manage profiles
        </Link>
      </div>

      {loaded ? (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0 flex items-center gap-2">
            <p className="text-sm font-bold text-white truncate">{loaded.artist_name} loaded</p>
            <SubjectBadge type={normalizeSubjectType(loaded.artist_type)} />
          </div>
          {loaded.genre && <p className="text-xs text-white/40 truncate">{loaded.genre}</p>}
          <button
            onClick={() => setSelected(loaded.id)}
            className="ml-auto text-xs text-white/30 hover:text-white transition-colors shrink-0"
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
              className={`${selectClass} flex items-center gap-2 text-left`}
            >
              <span className="truncate">{selectedVault ? selectedVault.artist_name : "Select a profile"}</span>
              {selectedVault && <SubjectBadge type={normalizeSubjectType(selectedVault.artist_type)} />}
              <ChevronDown className="ml-auto h-4 w-4 text-white/30 shrink-0" />
            </button>
            {dropdownOpen && (
              <div className="absolute z-50 mt-2 w-full rounded-xl border border-white/10 bg-[#141414] shadow-2xl overflow-hidden max-h-64 overflow-y-auto">
                {sortedVaults.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setSelected(v.id);
                      setDropdownOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/5 ${
                      v.id === selected ? "bg-primary/10" : ""
                    }`}
                  >
                    <span className="truncate text-sm text-white">{v.artist_name}</span>
                    <SubjectBadge type={normalizeSubjectType(v.artist_type)} />
                    {v.genre && <span className="ml-auto text-xs text-white/30 truncate pl-2">{v.genre}</span>}
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
            className="h-10 px-5 shrink-0 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 rounded-xl text-sm font-bold transition-colors"
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
