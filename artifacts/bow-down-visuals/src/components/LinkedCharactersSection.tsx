import { useState, useEffect } from "react";
import { X, Plus, Users, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getCharacterTheme } from "@/lib/character-themes";
import type { ArtistVault } from "./ArtistVaultSelector";

interface LinkedCharacter {
  id: string;
  role: string;
  character: ArtistVault | null;
}

const ROLES = [
  "featured-artist",
  "collaborator",
  "cameo",
  "rival",
  "love-interest",
  "crew",
];

function roleLabel(role: string): string {
  return role.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Linked Characters — manage which other characters star in this
 * character's content. Linked co-stars are automatically pulled into
 * every generation for this character.
 */
export function LinkedCharactersSection({
  vault,
  allVaults,
}: {
  vault: ArtistVault;
  allVaults: ArtistVault[];
}) {
  const { getAccessToken } = useAuth();
  const [links, setLinks] = useState<LinkedCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selectedRole, setSelectedRole] = useState("collaborator");

  async function load() {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/artist-vaults/${vault.id}/links`, {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { links: LinkedCharacter[] };
        setLinks(data.links ?? []);
      }
    } catch {
      /* show empty */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.id]);

  const linkedIds = new Set(links.map((l) => l.character?.id).filter(Boolean));
  const candidates = allVaults.filter(
    (v) => v.id !== vault.id && !linkedIds.has(v.id),
  );

  async function handleLink() {
    if (!selectedId || linking) return;
    setLinking(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/artist-vaults/${vault.id}/links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({ linkedCharacterId: selectedId, role: selectedRole }),
      });
      if (res.ok) {
        setSelectedId("");
        await load();
      }
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink(linkId: string) {
    try {
      const token = await getAccessToken();
      await fetch(`/api/artist-vaults/${vault.id}/links/${linkId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch {
      /* keep the link on failure */
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 mt-3">
      <div className="flex items-center gap-2 mb-1">
        <Users className="h-4 w-4 text-[#C9A84C]" />
        <p className="text-sm font-bold text-white">Linked Characters</p>
      </div>
      <p className="text-xs text-white/35 mb-3">
        Co-stars for {vault.artist_name} — they're automatically pulled into scenes
        whenever a generation needs another character.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-white/30" />
        </div>
      ) : links.length === 0 ? (
        <p className="text-xs text-white/30 py-2">
          No linked characters yet — link one below to build {vault.artist_name}'s cast.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {links.map((link) => {
            const c = link.character;
            if (!c) return null;
            const theme = getCharacterTheme(c.theme_id);
            return (
              <div
                key={link.id}
                className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2"
              >
                <div
                  className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-black shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${theme.primary}, ${theme.deep})`,
                    color: "#000",
                  }}
                >
                  {c.artist_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{c.artist_name}</p>
                  <p className="text-[11px]" style={{ color: theme.primary }}>
                    {roleLabel(link.role)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleUnlink(link.id)}
                  className="text-white/30 hover:text-red-400 transition-colors p-1"
                  title="Remove link"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            style={{ colorScheme: "dark" }}
          >
            <option value="">Choose a character…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.artist_name}
              </option>
            ))}
          </select>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            style={{ colorScheme: "dark" }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleLink}
            disabled={!selectedId || linking}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#C9A84C] px-4 py-2 text-sm font-bold text-black hover:bg-[#DDB84E] transition-colors disabled:opacity-40"
          >
            {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Link
          </button>
        </div>
      )}
    </div>
  );
}
