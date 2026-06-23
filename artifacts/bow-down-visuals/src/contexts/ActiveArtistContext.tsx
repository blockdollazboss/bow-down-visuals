import { createContext, useContext, useState, type ReactNode } from "react";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

interface ActiveArtistContextValue {
  activeArtist: ArtistVault | null;
  setActiveArtist: (artist: ArtistVault | null) => void;
  clearActiveArtist: () => void;
  consistencyPrompt: string | null;
  setConsistencyPrompt: (prompt: string | null) => void;
  clearConsistencyPrompt: () => void;
}

const ActiveArtistContext = createContext<ActiveArtistContextValue>({
  activeArtist: null,
  setActiveArtist: () => {},
  clearActiveArtist: () => {},
  consistencyPrompt: null,
  setConsistencyPrompt: () => {},
  clearConsistencyPrompt: () => {},
});

const STORAGE_KEY = "bdv_active_artist";
const CONSISTENCY_KEY = "bdv_consistency_prompt";

function loadStored(): ArtistVault | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ArtistVault) : null;
  } catch {
    return null;
  }
}

function loadStoredConsistency(): string | null {
  try {
    return localStorage.getItem(CONSISTENCY_KEY) ?? null;
  } catch {
    return null;
  }
}

export function ActiveArtistProvider({ children }: { children: ReactNode }) {
  const [activeArtist, setActiveArtistState] = useState<ArtistVault | null>(loadStored);
  const [consistencyPrompt, setConsistencyPromptState] = useState<string | null>(loadStoredConsistency);

  function setActiveArtist(artist: ArtistVault | null) {
    setActiveArtistState(artist);
    if (artist) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(artist));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
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
        activeArtist, setActiveArtist, clearActiveArtist,
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
