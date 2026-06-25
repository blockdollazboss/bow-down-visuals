import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronRight, Archive, CheckCircle2 } from "lucide-react";
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
  is_active: boolean;
  created_at: string;
}

interface Props {
  onLoad: (vault: ArtistVault) => void;
  loadedVaultId?: string | null;
  loadedVault?: ArtistVault | null;
}

const selectClass =
  "h-10 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] text-white px-3 pr-8 text-sm focus:outline-none focus:border-primary/50 appearance-none cursor-pointer";

export function ArtistVaultSelector({ onLoad, loadedVaultId, loadedVault: loadedVaultProp }: Props) {
  const { getAccessToken } = useAuth();
  const [vaults, setVaults] = useState<ArtistVault[]>([]);
  const [selected, setSelected] = useState("");
  const [fetching, setFetching] = useState(true);

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
          if (data.vaults.length > 0) setSelected(data.vaults[0].id);
        }
      } catch {
        /* silent */
      } finally {
        setFetching(false);
      }
    }
    loadVaults();
  }, []);

  if (fetching) return null;

  const loaded = loadedVaultProp ?? (loadedVaultId ? vaults.find((v) => v.id === loadedVaultId) : null) ?? null;

  if (!loaded && vaults.length === 0) {
    return (
      <div className="mb-6 p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] flex items-center gap-3">
        <Archive className="h-4 w-4 text-white/25 shrink-0" />
        <p className="text-sm text-white/40">
          No Artist Vault profiles yet.{" "}
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
        <span className="text-xs font-bold text-primary uppercase tracking-wider">Artist Vault</span>
        <Link href="/artist-vault" className="ml-auto text-xs text-white/30 hover:text-white/60 transition-colors">
          Manage profiles
        </Link>
      </div>

      {loaded ? (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{loaded.artist_name} loaded</p>
            {loaded.artist_type && (
              <p className="text-xs text-white/40">{loaded.artist_type}{loaded.genre ? ` · ${loaded.genre}` : ""}</p>
            )}
          </div>
          <button
            onClick={() => setSelected(loaded.id)}
            className="ml-auto text-xs text-white/30 hover:text-white transition-colors shrink-0"
          >
            Change
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="relative flex-1 min-w-0">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className={selectClass}
              style={{ colorScheme: "dark" }}
            >
              {vaults.map((v) => (
                <option key={v.id} value={v.id} style={{ background: "#111" }}>
                  {v.artist_name}
                  {v.artist_type ? ` · ${v.artist_type}` : ""}
                  {v.genre ? ` · ${v.genre}` : ""}
                </option>
              ))}
            </select>
            <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30 rotate-90 pointer-events-none" />
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
