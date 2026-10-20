/* ─── My Projects tab ids + ?tab= deep-link parsing ──────────────────────
   The page's six tabs are addressable: shipped routes depend on it —
   /generations redirects to /my-projects?tab=history and /my-clips and
   /songs redirect to their tabs (App.tsx + lib/public-routes.ts). The
   parser must therefore honor EVERY tab id, not a subset: a ?tab=
   value it doesn't recognize falls back to the Projects tab, but a
   valid one always lands where the link promised. */

export const MY_PROJECTS_TABS = [
  "projects",
  "drafts",
  "clips",
  "myclips",
  "songs",
  "history",
] as const;

export type MyProjectsTab = (typeof MY_PROJECTS_TABS)[number];

export const DEFAULT_MY_PROJECTS_TAB: MyProjectsTab = "projects";

export function isMyProjectsTab(value: string | null | undefined): value is MyProjectsTab {
  return (
    typeof value === "string" &&
    (MY_PROJECTS_TABS as readonly string[]).includes(value)
  );
}

/** The tab a ?tab= query string asks for — default tab when the param
    is absent or isn't one of the six real tab ids. */
export function parseMyProjectsTab(search: string): MyProjectsTab {
  try {
    const q = new URLSearchParams(search).get("tab");
    if (isMyProjectsTab(q)) return q;
  } catch {
    /* unparseable query — the default tab is the honest landing */
  }
  return DEFAULT_MY_PROJECTS_TAB;
}
