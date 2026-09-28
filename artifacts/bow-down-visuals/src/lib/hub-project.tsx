import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/* ─── Hub project state ─────────────────────────────────────────────────────
   The heart of the One Unified Creation Hub: a single project ("Midnight
   Run") that every tool reports its finished assets into. Any page can call
   useHubProject().addAsset(...) with 2-3 lines — the hub's tray, workflow
   rail, and handoffs pick it up automatically. Persisted to localStorage so
   the project survives refreshes and navigation between tools. */

export type HubAssetKind = "beat" | "stems" | "song" | "video" | "image" | "thumbnail" | "clip" | "other";

/** What kind of thing this project is making — drives the workflow rail. */
export type HubProjectType = "song" | "video" | "visual";

export interface HubAsset {
  id: string;
  kind: HubAssetKind;
  url: string;
  label: string;
  detail?: string;
  createdAt: number;
}

export interface HubProject {
  id: string;
  name: string;
  type: HubProjectType;
  assets: HubAsset[];
  updatedAt: number;
}

interface HubProjectContextValue {
  project: HubProject;
  setProjectName: (name: string) => void;
  setProjectType: (type: HubProjectType) => void;
  addAsset: (asset: Omit<HubAsset, "id" | "createdAt">) => HubAsset;
  removeAsset: (id: string) => void;
  newProject: () => void;
  hasKind: (kind: HubAssetKind) => boolean;
  latestOfKind: (kind: HubAssetKind) => HubAsset | undefined;
}

const HubProjectContext = createContext<HubProjectContextValue | null>(null);

const STORAGE_KEY = "bdv-hub-project-v1";

function freshProject(): HubProject {
  return {
    id: `proj-${Date.now().toString(36)}`,
    name: "Untitled Project",
    type: "song",
    assets: [],
    updatedAt: Date.now(),
  };
}

function loadProject(): HubProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshProject();
    const parsed = JSON.parse(raw) as HubProject;
    if (!parsed || !Array.isArray(parsed.assets) || typeof parsed.name !== "string") {
      return freshProject();
    }
    const validTypes: HubProjectType[] = ["song", "video", "visual"];
    return {
      ...parsed,
      id: parsed.id || freshProject().id,
      type: validTypes.includes(parsed.type) ? parsed.type : "song",
    };
  } catch {
    return freshProject();
  }
}

export function HubProjectProvider({ children }: { children: React.ReactNode }) {
  const [project, setProject] = useState<HubProject>(loadProject);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      /* storage full or unavailable — project still works in-memory */
    }
  }, [project]);

  const setProjectName = useCallback((name: string) => {
    setProject((p) => ({ ...p, name: name.slice(0, 80) || "Untitled Project", updatedAt: Date.now() }));
  }, []);

  const setProjectType = useCallback((type: HubProjectType) => {
    setProject((p) => ({ ...p, type, updatedAt: Date.now() }));
  }, []);

  const addAsset = useCallback((asset: Omit<HubAsset, "id" | "createdAt">) => {
    const full: HubAsset = {
      ...asset,
      id: `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    setProject((p) => ({
      ...p,
      assets: [full, ...p.assets].slice(0, 100), // cap at 100, newest first
      updatedAt: Date.now(),
    }));
    return full;
  }, []);

  const removeAsset = useCallback((id: string) => {
    setProject((p) => ({ ...p, assets: p.assets.filter((a) => a.id !== id), updatedAt: Date.now() }));
  }, []);

  const newProject = useCallback(() => {
    setProject(freshProject());
  }, []);

  const value = useMemo<HubProjectContextValue>(() => {
    const kinds = new Set(project.assets.map((a) => a.kind));
    return {
      project,
      setProjectName,
      setProjectType,
      addAsset,
      removeAsset,
      newProject,
      hasKind: (kind) => kinds.has(kind),
      latestOfKind: (kind) => project.assets.find((a) => a.kind === kind),
    };
  }, [project, setProjectName, setProjectType, addAsset, removeAsset, newProject]);

  return <HubProjectContext.Provider value={value}>{children}</HubProjectContext.Provider>;
}

/** Use inside any tool page: const { addAsset } = useHubProject(); then
 *  addAsset({ kind: "song", url, label }) when the generation completes.
 *  Safe to call even when no provider is mounted (no-op). */
export function useHubProject(): HubProjectContextValue {
  const ctx = useContext(HubProjectContext);
  if (!ctx) {
    const noopAsset = () => ({ id: "", kind: "other" as HubAssetKind, url: "", label: "", createdAt: 0 });
    return {
      project: freshProject(),
      setProjectName: () => {},
      setProjectType: () => {},
      addAsset: noopAsset,
      removeAsset: () => {},
      newProject: () => {},
      hasKind: () => false,
      latestOfKind: () => undefined,
    };
  }
  return ctx;
}
