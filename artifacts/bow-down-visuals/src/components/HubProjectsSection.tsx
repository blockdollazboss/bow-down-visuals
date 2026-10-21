import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";
import {
  parseHubProjectsList,
  parseHubProjectPayload,
  hubProjectTypeLabel,
  hubProjectDeleteRequest,
  hubProjectByIdRequest,
  hubProjectsListCapped,
  isCurrentHubProject,
  type HubProjectSummary,
} from "@/lib/hub-projects";
import { useHubProject } from "@/lib/hub-project";

/* ─── Hub projects section (My Projects → Projects tab) ─────────────────────
   The account's synced Hub projects, from GET /api/hub/projects — the
   list rail that existed since 0142 with no frontend consumer, so every
   hub project except the most recent was invisible here. Every row
   carries the door into the Hub: the most recent row is the project
   open in the Hub (the singular read's own definition) and links
   straight there; an older row opens through the by-id payload read
   (GET /api/hub/projects/:id) and is adopted as the active project
   only after the server confirms it. Any row can be deleted from its
   synced copy via the id-scoped DELETE rail.

   Honesty rules (the page's own): a failed load is an error + retry,
   never a fake-empty list; a delete removes its row only after the
   server confirms, and a failed delete keeps the row and says so; a
   failed open keeps the project the member already has and says so —
   the browser never navigates to the Hub on an unconfirmed open. */
export default function HubProjectsSection() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { adoptProject } = useHubProject();
  const [, setLocation] = useLocation();

  const [rows, setRows] = useState<HubProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/hub/projects", {
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error(t("myProjects.failedLoadHubProjects"));
      setRows(parseHubProjectsList(await res.json()));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("myProjects.failedLoadHubProjects"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  /* Open an older project in the Hub: fetch its full payload by id,
     adopt it as the active project, and only then navigate. Any
     failure — the row was deleted elsewhere, the payload is unusable —
     leaves the member where they are, with the project they had. */
  async function handleOpen(row: HubProjectSummary) {
    setOpeningId(row.id);
    setOpenError(null);
    try {
      const token = await getAccessToken();
      const request = hubProjectByIdRequest(row.id);
      const res = await fetch(request.url, {
        method: request.method,
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error(t("myProjects.failedOpenHubProject"));
      const payload = parseHubProjectPayload(await res.json());
      if (!payload) throw new Error(t("myProjects.failedOpenHubProject"));
      adoptProject(payload);
      setLocation("/hub");
    } catch {
      setOpenError(t("myProjects.failedOpenHubProject"));
    } finally {
      setOpeningId(null);
    }
  }

  async function handleDelete(row: HubProjectSummary) {
    if (!confirm(t("myProjects.deleteHubProjectConfirm", { name: row.name }))) return;
    setDeletingId(row.id);
    setDeleteError(null);
    try {
      const token = await getAccessToken();
      const request = hubProjectDeleteRequest(row.id);
      const res = await fetch(request.url, {
        method: request.method,
        headers: { Authorization: `Bearer ${token ?? ""}` },
      });
      if (!res.ok) throw new Error(t("myProjects.failedDeleteHubProject"));
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch {
      setDeleteError(t("myProjects.failedDeleteHubProject"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="mb-10">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-white">{t("myProjects.hubProjectsTitle")}</h2>
        <p className="text-sm text-white/40 mt-1 max-w-2xl">{t("myProjects.hubProjectsHint")}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary/50" />
        </div>
      ) : loadError ? (
        <div className="py-8 text-center space-y-3">
          <p className="text-red-400 font-semibold">{loadError}</p>
          <Button onClick={() => void load()} variant="outline" size="sm"
            className="border-white/10 bg-white/5 text-white hover:bg-white/10">{t("myProjects.tryAgain")}</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-white/35 py-2">{t("myProjects.noHubProjects")}</p>
      ) : (
        <>
          {deleteError && (
            <p role="alert" className="text-sm text-red-400 font-semibold mb-3">{deleteError}</p>
          )}
          {openError && (
            <p role="alert" className="text-sm text-red-400 font-semibold mb-3">{openError}</p>
          )}
          <div className="space-y-2">
            {rows.map((row, index) => {
              const current = isCurrentHubProject(index);
              const date = row.updatedAt > 0
                ? new Date(row.updatedAt).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                  })
                : null;
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
                >
                  <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white truncate">{row.name}</span>
                      {current && (
                        <Badge className="text-[10px] border-primary/30 bg-primary/20 text-primary shrink-0">
                          {t("myProjects.hubProjectsCurrent")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-white/35 mt-0.5">
                      {hubProjectTypeLabel(row.type)}
                      {date ? ` · ${date}` : ""}
                    </p>
                  </div>
                  {current ? (
                    <Link
                      href="/hub"
                      className="text-xs font-semibold text-primary hover:underline shrink-0"
                    >
                      {t("myProjects.hubProjectsOpenInHub")}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleOpen(row)}
                      disabled={openingId === row.id}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline shrink-0 disabled:opacity-40"
                    >
                      {openingId === row.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {t("myProjects.hubProjectsOpenInHub")}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={t("myProjects.deleteHubProject")}
                    disabled={deletingId === row.id}
                    onClick={() => void handleDelete(row)}
                    className="shrink-0 text-white/35 hover:text-red-400 transition-colors disabled:opacity-40"
                  >
                    {deletingId === row.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              );
            })}
          </div>
          {hubProjectsListCapped(rows) && (
            <p className="text-xs text-white/30 mt-3">{t("myProjects.hubProjectsCapNote")}</p>
          )}
        </>
      )}
    </section>
  );
}
