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
export type HubProjectType = "song" | "video" | "visual" | "movie" | "game" | "series" | "podcast" | "release" | "grow" | "influencer" | "ai-influencer" | "ai-producer" | "clipper" | "monetize" | "learn" | "business";

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
  /** Preloaded creative brief (from a template) — carried through the chain. */
  concept: string;
  /** Template key the concept came from (for per-step preloaded hints). */
  templateKey: string | null;
  /** "Made with Bow Down Visuals" credit toggle — project-level, default ON.
      Flows into every export/share output from every tool in the project. */
  attribution: boolean;
}

export type HubSyncStatus = "local" | "syncing" | "synced" | "error";

interface HubProjectContextValue {
  project: HubProject;
  syncStatus: HubSyncStatus;
  setProjectName: (name: string) => void;
  setProjectType: (type: HubProjectType) => void;
  setProjectConcept: (concept: string) => void;
  setTemplateKey: (key: string | null) => void;
  /** "Made with Bow Down Visuals" credit toggle (default ON). */
  setAttribution: (on: boolean) => void;
  addAsset: (asset: Omit<HubAsset, "id" | "createdAt">) => HubAsset;
  removeAsset: (id: string) => void;
  newProject: () => void;
  hasKind: (kind: HubAssetKind) => boolean;
  latestOfKind: (kind: HubAssetKind) => HubAsset | undefined;
  /** Step keys the user manually marked done/skipped (no-asset steps). Per project type. */
  stepDones: string[];
  markStepDone: (key: string) => void;
  clearStepDones: (type: HubProjectType) => void;
  /** Creator's referral code (null when signed out / not loaded yet).
      Shared outputs carry ?ref=CODE so they become earning loops. */
  referralCode: string | null;
  /** Clean share link for the project (or a specific asset): origin + ?ref=CODE.
      Falls back to plain origin when no code is loaded yet. */
  getShareLink: (assetLabel?: string) => string;
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
    concept: "",
    templateKey: null,
    attribution: true,
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
    const validTypes: HubProjectType[] = ["song", "video", "visual", "movie", "game", "series", "podcast", "release", "grow", "influencer", "ai-influencer", "ai-producer", "clipper", "monetize", "learn", "business"];
    return {
      ...parsed,
      id: parsed.id || freshProject().id,
      type: validTypes.includes(parsed.type) ? parsed.type : "song",
      concept: typeof parsed.concept === "string" ? parsed.concept : "",
      templateKey: typeof parsed.templateKey === "string" ? parsed.templateKey : null,
      attribution: typeof parsed.attribution === "boolean" ? parsed.attribution : true,
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
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const { user, getAccessToken } = useAuth();
  const projectRef = useRef(project);
  const lastSyncedJson = useRef<string | null>(null);

  /* Load the creator's referral code once per sign-in so shared project
     outputs can carry ?ref=CODE — every share becomes an earning loop. */
  useEffect(() => {
    if (!user) {
      setReferralCode(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/referrals/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = (await res.json()) as { code?: string };
        if (!cancelled && typeof data.code === "string" && data.code) {
          setReferralCode(data.code);
        }
      } catch {
        /* referral code is a nice-to-have — share links still work without it */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /** Clean, SEO-friendly share link for the project: site root carrying the
      creator's referral code so every shared output is an earning loop. */
  const getShareLink = useCallback(
    (_assetLabel?: string) => {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      return referralCode ? `${origin}/?ref=${encodeURIComponent(referralCode)}` : `${origin}/`;
    },
    [referralCode]
  );

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
        concept: snapshot.concept,
        templateKey: snapshot.templateKey,
        attribution: snapshot.attribution,
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
          project: { name: string; type: HubProjectType; assets: HubAsset[]; concept?: string; templateKey?: string | null; attribution?: boolean; updatedAt: number } | null;
        };
        if (cancelled) return;
        const local = projectRef.current;
        const server = data.project;
        if (server && server.updatedAt > local.updatedAt) {
          const adopted: HubProject = {
            id: local.id,
            name: server.name,
            type: ["song", "video", "visual", "movie", "game", "series", "podcast", "release", "grow", "influencer", "ai-influencer", "ai-producer", "clipper", "monetize", "learn", "business"].includes(server.type) ? server.type : "song",
            assets: Array.isArray(server.assets) ? server.assets : [],
            concept: typeof server.concept === "string" ? server.concept : "",
            templateKey: typeof server.templateKey === "string" ? server.templateKey : null,
            attribution: typeof server.attribution === "boolean" ? server.attribution : true,
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

  const setProjectConcept = useCallback((concept: string) => {
    setProject((p) => ({ ...p, concept: concept.slice(0, 2000), updatedAt: Date.now() }));
  }, []);

  const setTemplateKey = useCallback((key: string | null) => {
    setProject((p) => ({ ...p, templateKey: key, updatedAt: Date.now() }));
  }, []);

  const setAttribution = useCallback((on: boolean) => {
    setProject((p) => ({ ...p, attribution: on, updatedAt: Date.now() }));
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
      setProjectConcept,
      setTemplateKey,
      setAttribution,
      addAsset,
      removeAsset,
      newProject,
      hasKind: (kind) => kinds.has(kind),
      latestOfKind: (kind) => project.assets.find((a) => a.kind === kind),
      stepDones: dones[project.type] ?? [],
      markStepDone,
      clearStepDones,
      referralCode,
      getShareLink,
    };
  }, [project, syncStatus, setProjectName, setProjectType, setProjectConcept, setTemplateKey, setAttribution, addAsset, removeAsset, newProject, dones, markStepDone, clearStepDones, referralCode, getShareLink]);

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
      setProjectConcept: () => {},
      setTemplateKey: () => {},
      setAttribution: () => {},
      addAsset: noopAsset,
      removeAsset: () => {},
      newProject: () => {},
      hasKind: () => false,
      latestOfKind: () => undefined,
      stepDones: [],
      markStepDone: () => {},
      clearStepDones: () => {},
      referralCode: null,
      getShareLink: () => (typeof window !== "undefined" ? window.location.origin + "/" : "/"),
    };
  }
  return ctx;
}
