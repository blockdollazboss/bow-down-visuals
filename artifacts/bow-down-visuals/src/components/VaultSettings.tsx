import { useEffect, useRef, useState } from "react";
import { Archive, Download, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { formatVaultBytes, vaultPhaseOf, type VaultJobView } from "@/lib/vault-view";

/* ─── The Vault (Stack-200 UPGRADE #162) ──────────────────────────────────
   One-tap FULL export: the creator's original songs, videos and art at
   full quality in one ZIP, plus their data — packaged as a background
   job by POST /api/account/vault, polled here until the download is
   ready. Docked in Settings, directly above the Danger Zone's quick
   JSON export (data-only) — the Vault is the everything version. */

const POLL_MS = 3000;

export function VaultSettings() {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const isLight = useIsLightTheme();
  const [view, setView] = useState<VaultJobView | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const phase = vaultPhaseOf(view);

  async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await getAccessToken();
    return fetch(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  async function pollOnce(jobId: string) {
    try {
      const res = await authedFetch(`/api/account/vault/${jobId}`);
      if (!res.ok) throw new Error();
      const next = (await res.json()) as VaultJobView;
      setView(next);
      if (next.state === "done" || next.state === "failed") stopPolling();
    } catch {
      // A single failed poll is not a failed Vault — the next tick retries.
    }
  }

  function stopPolling() {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }

  function startPolling(jobId: string) {
    stopPolling();
    timer.current = setInterval(() => {
      void pollOnce(jobId);
    }, POLL_MS);
  }

  useEffect(() => stopPolling, []);

  async function startVault() {
    if (starting || phase === "working") return;
    setStarting(true);
    setError(null);
    try {
      const res = await authedFetch("/api/account/vault", { method: "POST" });
      if (!res.ok) throw new Error();
      const next = (await res.json()) as VaultJobView;
      setView(next);
      if (next.state === "queued" || next.state === "active") startPolling(next.jobId);
    } catch {
      setError(t("settings.vaultError", { defaultValue: "Could not start your Vault. Please try again." }));
    } finally {
      setStarting(false);
    }
  }

  return (
    <section
      className={`rounded-2xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="vault-settings"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
          <Archive className="h-4 w-4 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-bold">
            {t("settings.vaultTitle", { defaultValue: "The Vault" })}
          </h2>
          <p className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("settings.vaultDescription", {
              defaultValue:
                "Everything you made here, in one archive: your original songs, videos and art at full quality — never recompressed — plus your data, sales and splits. Packaged in the background; download it when it's ready.",
            })}
          </p>
        </div>
      </div>

      <div className="mt-5">
        {phase === "idle" || phase === "failed" ? (
          <button
            type="button"
            onClick={() => { void startVault(); }}
            disabled={starting}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            {phase === "failed"
              ? t("settings.vaultRetry", { defaultValue: "Try again" })
              : t("settings.vaultStart", { defaultValue: "Package my Vault" })}
          </button>
        ) : null}

        {phase === "working" && view ? (
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>{view.stage}</span>
            </div>
            <div
              className={`mt-3 h-2 w-full overflow-hidden rounded-full ${isLight ? "bg-black/10" : "bg-white/10"}`}
              role="progressbar"
              aria-valuenow={view.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, view.progress))}%` }}
              />
            </div>
          </div>
        ) : null}

        {phase === "ready" && view?.result ? (
          <div className="space-y-3">
            <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
              {t("settings.vaultReady", {
                defaultValue: "{{files}} originals · {{size}}",
                files: view.result.fileCount,
                size: formatVaultBytes(view.result.sizeBytes),
              })}
              {view.result.skippedCount > 0
                ? ` ${t("settings.vaultSkipped", {
                    defaultValue: "{{count}} file(s) couldn't be fetched — they're named in the archive's manifest.",
                    count: view.result.skippedCount,
                  })}`
                : ""}
            </p>
            {view.downloadUrl ? (
              <a
                href={view.downloadUrl}
                className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20"
              >
                <Download className="h-4 w-4" />
                {t("settings.vaultDownload", { defaultValue: "Download my Vault" })}
              </a>
            ) : (
              <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/60"}`}>
                {t("settings.vaultLinkPending", {
                  defaultValue: "Your archive is ready — the download link is being prepared. Check back in a moment.",
                })}
              </p>
            )}
          </div>
        ) : null}

        {phase === "failed" && view?.error ? (
          <p className="mt-3 text-sm text-red-400">{view.error}</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      </div>
    </section>
  );
}
