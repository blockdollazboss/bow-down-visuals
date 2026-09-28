import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Hub project state ─────────────────────────────────────────────────────
   The heart of the One Unified Creation Hub: a single project ("Midnight
   Run") that every tool reports its finished assets into. Any page can call
   useHubProject().addAsset(...) with 2-3 lines — the hub's tray, workflow
   rail, and handoffs pick it up automatically. Persisted to localStorage as
   a fast cache, and synced to the account (PUT /api/hub/project, debounced)
   when signed in — so the project follows the user across devices. */

export type HubAssetKind = "beat" | "stems" | "song" | "video" | "image" | "thumbnail" | "clip" | "script" | "sfx" | "other";

/** What kind of thing this project is making — drives the workflow rail. */
export type HubProjectType = "song" | "video" | "visual" | "movie" | "game" | "series" | "podcast" | "release" | "grow" | "influencer" | "monetize" | "learn" | "business";

export interface HubAsset {
  id: string;
  kind: HubAssetKind;
  url: string;
  label: string;
  detail?: string;
  /** Structured context the next step can prefill from (genre, bpm, style…). */
  meta?: Record<string, string>;
  createdAt: number;
}

export interface HubProject {
  id: string;
  name: string;
  type: HubProjectType;
  assets: HubAsset[];
  updatedAt: number;
}

export type HubSyncStatus = "local" | "syncing" | "synced" | "error";

interface HubProjectContextValue {
  project: HubProject;
  syncStatus: HubSyncStatus;
  setProjectName: (name: string) => void;
  setProjectType: (type: HubProjectType) => void;
  addAsset: (asset: Omit<HubAsset, "id" | "createdAt">) => HubAsset;
  removeAsset: (id: string) => void;
  newProject: () => void;
  hasKind: (kind: HubAssetKind) => boolean;
  latestOfKind: (kind: HubAssetKind) => HubAsset | undefined;
  /** Step keys the user manually marked done/skipped (no-asset steps). Per project type. */
  stepDones: string[];
  markStepDone: (key: string) => void;
  clearStepDones: (type: HubProjectType) => void;
}

const HubProjectContext = createContext<HubProjectContextValue | null>(null);

const STORAGE_KEY = "bdv-hub-project-v1";
const DONES_KEY = "bdv-hub-step-dones-v1";

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
    // Blob URLs die with the page session — drop them on reload.
    parsed.assets = parsed.assets.filter((a) => !a.url.startsWith("blob:"));
    const validTypes: HubProjectType[] = ["song", "video", "visual", "movie", "game", "series", "podcast", "release", "grow", "influencer", "monetize", "learn", "business"];
    return {
      ...parsed,
      id: parsed.id || freshProject().id,
      type: validTypes.includes(parsed.type) ? parsed.type : "song",
    };
  } catch {
    return freshProject();
  }
}

function loadDones(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(DONES_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function HubProjectProvider({ children }: { children: React.ReactNode }) {
  const [project, setProject] = useState<HubProject>(loadProject);
  const [dones, setDones] = useState<Record<string, string[]>>(loadDones);
  const [syncStatus, setSyncStatus] = useState<HubSyncStatus>("local");
  const { user, getAccessToken } = useAuth();
  const projectRef = useRef(project);
  const lastSyncedJson = useRef<string | null>(null);

  useEffect(() => {
    projectRef.current = project;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    } catch {
      /* storage full or unavailable — project still works in-memory */
    }
  }, [project]);

  useEffect(() => {
    try {
      localStorage.setItem(DONES_KEY, JSON.stringify(dones));
    } catch {
      /* ignore */
    }
  }, [dones]);

  async function pushProject(snapshot: HubProject, token: string | null) {
    const res = await fetch("/api/hub/project", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        name: snapshot.name,
        type: snapshot.type,
        assets: snapshot.assets,
        updatedAt: snapshot.updatedAt,
      }),
    });
    if (!res.ok) throw new Error(`hub sync failed: ${res.status}`);
  }

  /* Initial pull + merge when the user is signed in. Newest updatedAt wins. */
  useEffect(() => {
    if (!user) {
      setSyncStatus("local");
      return;
    }
    let cancelled = false;
    (async () => {
      setSyncStatus("syncing");
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/hub/project", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`hub pull failed: ${res.status}`);
        const data = (await res.json()) as {
          project: { name: string; type: HubProjectType; assets: HubAsset[]; updatedAt: number } | null;
        };
        if (cancelled) return;
        const local = projectRef.current;
        const server = data.project;
        if (server && server.updatedAt > local.updatedAt) {
          const adopted: HubProject = {
            id: local.id,
            name: server.name,
            type: ["song", "video", "visual", "movie", "game", "series", "release", "grow", "monetize", "learn", "business"].includes(server.type) ? server.type : "song",
            assets: Array.isArray(server.assets) ? server.assets : [],
            updatedAt: server.updatedAt,
          };
          lastSyncedJson.current = JSON.stringify(adopted);
          setProject(adopted);
        } else {
          // Local is newer (or nothing on the server) — push it up.
          const t = await getAccessToken();
          if (cancelled) return;
          await pushProject(projectRef.current, t);
          lastSyncedJson.current = JSON.stringify(projectRef.current);
        }
        if (!cancelled) setSyncStatus("synced");
      } catch {
        if (!cancelled) setSyncStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* Debounced push on every local change (skips states already synced). */
  useEffect(() => {
    if (!user) return;
    const snapshot = projectRef.current;
    const json = JSON.stringify(snapshot);
    if (json === lastSyncedJson.current) return;
    const timer = setTimeout(async () => {
      try {
        const token = await getAccessToken();
        await pushProject(projectRef.current, token);
        lastSyncedJson.current = JSON.stringify(projectRef.current);
        setSyncStatus("synced");
      } catch {
        setSyncStatus("error"); // next change retries
      }
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, user]);

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

  const markStepDone = useCallback((key: string) => {
    const t = projectRef.current.type;
    setDones((d) => {
      const cur = d[t] ?? [];
      return cur.includes(key) ? d : { ...d, [t]: [...cur, key] };
    });
    setProject((p) => ({ ...p, updatedAt: Date.now() }));
  }, []);

  const clearStepDones = useCallback((type: HubProjectType) => {
    setDones((d) => {
      if (!d[type]) return d;
      const next = { ...d };
      delete next[type];
      return next;
    });
  }, []);

  const value = useMemo<HubProjectContextValue>(() => {
    const kinds = new Set(project.assets.map((a) => a.kind));
    return {
      project,
      syncStatus,
      setProjectName,
      setProjectType,
      addAsset,
      removeAsset,
      newProject,
      hasKind: (kind) => kinds.has(kind),
      latestOfKind: (kind) => project.assets.find((a) => a.kind === kind),
      stepDones: dones[project.type] ?? [],
      markStepDone,
      clearStepDones,
    };
  }, [project, syncStatus, setProjectName, setProjectType, addAsset, removeAsset, newProject, dones, markStepDone, clearStepDones]);

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
      syncStatus: "local",
      setProjectName: () => {},
      setProjectType: () => {},
      addAsset: noopAsset,
      removeAsset: () => {},
      newProject: () => {},
      hasKind: () => false,
      latestOfKind: () => undefined,
      stepDones: [],
      markStepDone: () => {},
      clearStepDones: () => {},
    };
  }
  return ctx;
}
