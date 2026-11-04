import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Loader2, ShieldAlert } from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import {
  ADMIN_NOT_AUTHORIZED_MESSAGE,
  isNotAuthorized,
} from "@/lib/world/admin-desk";

/* ─── Shared bits for the in-World Admin benches (wave #5) ─────────
   One fetch shape for every bench: the member's Bearer token (the
   desk auth-headers seam), JSON in and out, and failures carried as
   an Error whose message came through apiErrorMessage — never a raw
   body field — with the HTTP status riding along so a bench can
   tell the gate's 403 (the not-authorized state) from a load
   failure, and a 409 (someone settled it first) from both.       */

export interface AdminApi {
  /** GET a rail; resolves with the parsed body, throws on !ok. */
  get: (path: string) => Promise<unknown>;
  /** POST/PATCH/PUT/DELETE a rail with an optional JSON body. */
  send: (path: string, method: string, body?: unknown) => Promise<unknown>;
  /** Raw call for benches that classify statuses themselves (the
   *  gate probe, the reversal 409): never throws on !ok. */
  call: (path: string, method?: string, body?: unknown) => Promise<{ status: number; data: unknown }>;
}

function statusError(message: string, status: number): Error {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

/** The HTTP status a bench failure carried, if any. */
export function adminErrorStatus(e: unknown): number | null {
  if (e && typeof e === "object" && "status" in e) {
    const s = (e as { status?: unknown }).status;
    return typeof s === "number" ? s : null;
  }
  return null;
}

/** True when the failure is the admin gate's own refusal. */
export function adminDenied(e: unknown): boolean {
  const s = adminErrorStatus(e);
  return s !== null && isNotAuthorized(s);
}

export function useAdminApi(): AdminApi {
  const authHeaders = useDeskAuthHeaders();
  const call = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      const res = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders()),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const data: unknown = await res.json().catch(() => ({}));
      return { status: res.status, data };
    },
    [authHeaders],
  );
  const unwrap = useCallback(
    async (path: string, method = "GET", body?: unknown): Promise<unknown> => {
      const { status, data } = await call(path, method, body);
      if (status < 200 || status >= 300) {
        throw statusError(
          apiErrorMessage(data, `Request failed (${status})`),
          status,
        );
      }
      return data;
    },
    [call],
  );
  const get = useCallback((path: string) => unwrap(path), [unwrap]);
  const send = useCallback(
    (path: string, method: string, body?: unknown) => unwrap(path, method, body),
    [unwrap],
  );
  return { get, send, call };
}

/* ─── bench load state ───────────────────────────────────────────── */

export type BenchPhase = "loading" | "denied" | "failed" | "ready";

/** One bench's load: runs on mount (benches mount lazily, when
 *  their section first opens), classifies the gate's 403 as the
 *  denied state, anything else broken as failed — never as empty. */
export function useBench<T>(loader: (api: AdminApi) => Promise<T | null>): {
  phase: BenchPhase;
  data: T | null;
  failMessage: string;
  reload: () => void;
} {
  const { t } = useTranslation();
  const api = useAdminApi();
  const [phase, setPhase] = useState<BenchPhase>("loading");
  const [data, setData] = useState<T | null>(null);
  const [failMessage, setFailMessage] = useState("");

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const parsed = await loader(api);
      if (parsed === null) throw new Error("shape");
      setData(parsed);
      setPhase("ready");
    } catch (e) {
      if (adminDenied(e)) {
        setPhase("denied");
      } else {
        setFailMessage(plainErrorText(e, t("worldAdminDesk.bitsLoadFailed")));
        setPhase("failed");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { phase, data, failMessage, reload: () => void load() };
}

/** The denied panel every bench shares: the gate's own sentence,
 *  plainly — an admin whose session lost the allowlist sees this,
 *  never a half-painted bench. */
export function BenchDenied({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  return (
    <div data-testid="world-admin-denied" className="flex flex-col items-start gap-2 px-1 py-3">
      <p
        className={`inline-flex items-center gap-2 text-sm font-bold ${
          isLight ? "text-[#2a1e07]" : "text-white"
        }`}
      >
        <ShieldAlert className="h-4 w-4 text-[#d4af37]" /> {ADMIN_NOT_AUTHORIZED_MESSAGE}
      </p>
      <p className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        {t("worldAdminDesk.bitsDeniedBody")}
      </p>
    </div>
  );
}

/** Renders a bench's loading / denied / failed states; children
 *  render only in the ready state. */
export function BenchStates({
  isLight,
  phase,
  failMessage,
  onRetry,
  loadingMessage,
  children,
}: {
  isLight: boolean;
  phase: BenchPhase;
  failMessage: string;
  onRetry: () => void;
  loadingMessage?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (phase === "loading") {
    return <NativeLoadingState isLight={isLight} message={loadingMessage ?? t("worldAdminDesk.bitsLoading")} />;
  }
  if (phase === "denied") return <BenchDenied isLight={isLight} />;
  if (phase === "failed") {
    return (
      <NativeErrorState
        isLight={isLight}
        title={t("worldAdminDesk.bitsFailedTitle")}
        message={failMessage}
        onRetry={onRetry}
      />
    );
  }
  return <>{children}</>;
}

/* ─── bench actions ──────────────────────────────────────────────── */

/** One bench's action runner: busy key, success note, plain-text
 *  error, and the denied flip — if the gate refuses an action
 *  mid-session the bench renders the not-authorized state instead
 *  of pretending the action merely failed. The work returns an
 *  optional success note; benches reload their list inside it. */
export function useBenchAction(): {
  busy: string | null;
  note: string | null;
  error: string | null;
  denied: boolean;
  setNote: (note: string | null) => void;
  setError: (error: string | null) => void;
  run: (key: string, work: () => Promise<string | void>) => Promise<void>;
} {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const run = useCallback(async (key: string, work: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const msg = await work();
      if (typeof msg === "string") setNote(msg);
    } catch (e) {
      if (adminDenied(e)) setDenied(true);
      else setError(plainErrorText(e, t("worldAdminDesk.bitsActionFailed")));
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, note, error, denied, setNote, setError, run };
}

/* ─── the accordion section ──────────────────────────────────────── */

/** One bench's collapsible home in the Admin desk stack. The body
 *  mounts only when the section first opens, so a bench's rails are
 *  called when the admin actually goes to it — and one bench's
 *  failure never touches its neighbours. */
export function BenchSection({
  isLight,
  title,
  blurb,
  defaultOpen = false,
  children,
}: {
  isLight: boolean;
  title: string;
  blurb: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(defaultOpen);
  return (
    <section
      data-testid="world-admin-bench"
      className={`rounded-2xl border px-4 py-3 ${
        isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (!mounted) setMounted(true);
          setOpen((v) => !v);
        }}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span
            className={`block text-xs font-black uppercase tracking-[0.14em] ${
              isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
            }`}
          >
            {title}
          </span>
          <span className={`mt-0.5 block text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            {blurb}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""} ${
            isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
          }`}
        />
      </button>
      {mounted ? <div className={open ? "mt-3" : "hidden"}>{children}</div> : null}
    </section>
  );
}

/* ─── shared bench styling (the TeamDesk idiom) ──────────────────── */

export function adminCls(isLight: boolean) {
  return {
    goldBtn:
      "rounded-xl bg-[#C9A84C] px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50",
    ghostBtn: `rounded-xl border px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${
      isLight
        ? "border-[#C9A84C]/50 text-[#7A5A12] hover:bg-[#C9A84C]/10"
        : "border-white/15 text-white/70 hover:bg-white/5"
    }`,
    smallBtn: `rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
      isLight
        ? "border-[#C9A84C]/50 text-[#7A5A12] hover:bg-[#C9A84C]/10"
        : "border-white/15 text-white/70 hover:bg-white/5"
    }`,
    labelCls: `block text-xs font-semibold uppercase tracking-wider ${
      isLight ? "text-[#6B5B36]" : "text-white/40"
    }`,
    selectCls: `rounded-lg border px-3 py-2 text-sm ${
      isLight
        ? "border-[#C9A84C]/40 bg-white/80 text-[#241C0A]"
        : "border-white/10 bg-white/[0.05] text-white"
    }`,
    rowCls: `rounded-lg px-4 py-3 ${isLight ? "bg-black/[0.03]" : "bg-white/[0.04]"}`,
    subCls: isLight ? "text-[#6B5B36]" : "text-white/40",
    titleCls: isLight ? "text-[#2a1e07]" : "text-white",
  } as const;
}

/** A status chip in the page benches' colour language. */
export function StatusPill({ status, isLight }: { status: string; isLight: boolean }) {
  const tone =
    status === "new" || status === "pending" || status === "needs_manual_review"
      ? "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#b8912f]"
      : status === "reviewing" || status === "processing" || status === "contacted" || status === "judging" || status === "open"
        ? "border-sky-400/40 bg-sky-400/10 text-sky-500"
        : status === "actioned" || status === "approved" || status === "completed" || status === "paid" || status === "shipped" || status === "delivered" || status === "released" || status === "decided"
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-500"
          : status === "dismissed" || status === "rejected" || status === "cancelled" || status === "partial_shortfall"
            ? "border-red-400/40 bg-red-400/10 text-red-400"
            : isLight
              ? "border-black/15 bg-black/[0.04] text-[#6B5B36]"
              : "border-white/20 bg-white/5 text-white/50";
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${tone}`}>
      {status}
    </span>
  );
}

/** The busy spinner + label the benches share on action buttons. */
export function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </span>
  );
}

/** A bench action's outcome line: a note (gold) or an error (red),
 *  both plain text through the shared rail — never raw bodies. */
export function BenchOutcome({
  note,
  error,
  isLight,
}: {
  note: string | null;
  error: string | null;
  isLight: boolean;
}) {
  if (error) {
    return (
      <p className={`mt-2 text-xs font-semibold ${isLight ? "text-red-700" : "text-red-300"}`}>
        {error}
      </p>
    );
  }
  if (note) {
    return (
      <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {note}
      </p>
    );
  }
  return null;
}
