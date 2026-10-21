import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { ArtistVault } from "@/components/ArtistVaultSelector";
import {
  readLegacyActiveArtistSnapshot,
  readStoredActiveArtistId,
  resolveActiveArtist,
  writeStoredActiveArtistId,
} from "@/lib/active-artist";

interface ActiveArtistContextValue {
  activeArtist: ArtistVault | null;
  setActiveArtist: (artist: ArtistVault | null) => void;
  clearActiveArtist: () => void;
  /** Re-read the vault and re-resolve the active artist from its id,
   *  so edits made anywhere land on every creation surface. */
  refreshActiveArtist: () => Promise<void>;
  consistencyPrompt: string | null;
  setConsistencyPrompt: (prompt: string | null) => void;
  clearConsistencyPrompt: () => void;
}

const ActiveArtistContext = createContext<ActiveArtistContextValue>({
  activeArtist: null,
  setActiveArtist: () => {},
  clearActiveArtist: () => {},
  refreshActiveArtist: async () => {},
  consistencyPrompt: null,
  setConsistencyPrompt: () => {},
  clearConsistencyPrompt: () => {},
});

const CONSISTENCY_KEY = "bdv_consistency_prompt";

function loadStoredConsistency(): string | null {
  try {
    return localStorage.getItem(CONSISTENCY_KEY) ?? null;
  } catch {
    return null;
  }
}

export function ActiveArtistProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();
  /* The artist itself is resolved from its id against the live vault
   * list (lib/active-artist.ts). A legacy whole-row snapshot still on
   * the device seeds the first paint only; storage is rewritten to
   * the bare id on load and the fresh row replaces the seed. */
  const [activeArtist, setActiveArtistState] = useState<ArtistVault | null>(
    () => readLegacyActiveArtistSnapshot(),
  );
  const [consistencyPrompt, setConsistencyPromptState] = useState<string | null>(loadStoredConsistency);
  const activeIdRef = useRef<string | null>(readStoredActiveArtistId());

  const fetchVaultRows = useCallback(async (): Promise<ArtistVault[]> => {
    const token = await getAccessToken().catch(() => null);
    const res = await fetch("/api/artist-vaults", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`artist-vaults ${res.status}`);
    const data = (await res.json()) as { vaults?: ArtistVault[] };
    return data.vaults ?? [];
  }, [getAccessToken]);

  /** Re-resolve the remembered id against the live vault list. A
   *  successful read that no longer holds the id drops the pick
   *  cleanly (no ghost of a deleted character); a failed read keeps
   *  the current state rather than nuking it on a network blip. */
  const refreshActiveArtist = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    let rows: ArtistVault[];
    try {
      rows = await fetchVaultRows();
    } catch {
      return;
    }
    const resolved = resolveActiveArtist(rows, id);
    if (!resolved) {
      activeIdRef.current = null;
      writeStoredActiveArtistId(null);
    }
    setActiveArtistState(resolved);
  }, [fetchVaultRows]);

  /* On load: migrate any legacy snapshot to id-only storage, then
   * resolve the id against the live vault rows. */
  useEffect(() => {
    if (readLegacyActiveArtistSnapshot()) {
      writeStoredActiveArtistId(activeIdRef.current);
    }
    void refreshActiveArtist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setActiveArtist(artist: ArtistVault | null) {
    activeIdRef.current = artist?.id ?? null;
    writeStoredActiveArtistId(activeIdRef.current);
    setActiveArtistState(artist);
  }

  function clearActiveArtist() {
    setActiveArtist(null);
  }

  function setConsistencyPrompt(prompt: string | null) {
    setConsistencyPromptState(prompt);
    if (prompt) {
      localStorage.setItem(CONSISTENCY_KEY, prompt);
    } else {
      localStorage.removeItem(CONSISTENCY_KEY);
    }
  }

  function clearConsistencyPrompt() {
    setConsistencyPrompt(null);
  }

  return (
    <ActiveArtistContext.Provider
      value={{
        activeArtist, setActiveArtist, clearActiveArtist, refreshActiveArtist,
        consistencyPrompt, setConsistencyPrompt, clearConsistencyPrompt,
      }}
    >
      {children}
    </ActiveArtistContext.Provider>
  );
}

export function useActiveArtist() {
  return useContext(ActiveArtistContext);
}
