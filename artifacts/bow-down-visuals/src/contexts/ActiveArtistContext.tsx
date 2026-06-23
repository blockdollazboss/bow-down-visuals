import { createContext, useContext, useState, type ReactNode } from "react";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

interface ActiveArtistContextValue {
  activeArtist: ArtistVault | null;
  setActiveArtist: (artist: ArtistVault | null) => void;
  clearActiveArtist: () => void;
}

const ActiveArtistContext = createContext<ActiveArtistContextValue>({
  activeArtist: null,
  setActiveArtist: () => {},
  clearActiveArtist: () => {},
});

const STORAGE_KEY = "bdv_active_artist";

function loadStored(): ArtistVault | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ArtistVault) : null;
  } catch {
    return null;
  }
}

export function ActiveArtistProvider({ children }: { children: ReactNode }) {
  const [activeArtist, setActiveArtistState] = useState<ArtistVault | null>(loadStored);

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

  return (
    <ActiveArtistContext.Provider value={{ activeArtist, setActiveArtist, clearActiveArtist }}>
      {children}
    </ActiveArtistContext.Provider>
  );
}

export function useActiveArtist() {
  return useContext(ActiveArtistContext);
}
