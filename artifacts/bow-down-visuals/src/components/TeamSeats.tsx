import { useEffect, useState, useCallback } from "react";
import {
  Loader2, Users, UserPlus, Copy, Check, Trash2, MailWarning, ShieldCheck, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/* Team Seats — DistroKid-style roles for collaborators & managers.
   Docks inside Settings. Invite by email; no email provider is configured,
   so invites are link-based and the owner shares the link manually (stated
   honestly, never faked as sent). Price: FREE. */

export interface TeamSeat {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "manager" | "collaborator" | "viewer";
  status: "invited" | "active" | "revoked";
  invitedAt: string;
  joinedAt: string | null;
  permissions: {
    canGenerate: boolean;
    canPublish: boolean;
    canViewMoney: boolean;
    canEditProfile: boolean;
    canManageTeam: boolean;
  };
}

const ROLE_ORDER = ["owner", "manager", "collaborator", "viewer"] as const;

const MATRIX_ROWS = [
  { key: "canGenerate", labelKey: "settings.teamPermGenerate" },
  { key: "canPublish", labelKey: "settings.teamPermPublish" },
  { key: "canViewMoney", labelKey: "settings.teamPermMoney" },
  { key: "canEditProfile", labelKey: "settings.teamPermProfile" },
  { key: "canManageTeam", labelKey: "settings.teamPermTeam" },
] as const;

const PERMISSIONS_BY_ROLE: Record<string, Record<string, boolean>> = {
  owner: { canGenerate: true, canPublish: true, canViewMoney: true, canEditProfile: true, canManageTeam: true },
  manager: { canGenerate: true, canPublish: true, canViewMoney: true, canEditProfile: true, canManageTeam: false },
  collaborator: { canGenerate: true, canPublish: false, canViewMoney: false, canEditProfile: false, canManageTeam: false },
  viewer: { canGenerate: false, canPublish: false, canViewMoney: false, canEditProfile: false, canManageTeam: false },
};

function roleBadgeClass(role: string) {
  switch (role) {
    case "owner": return "border-primary/50 bg-primary/15 text-primary";
    case "manager": return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "collaborator": return "border-white/20 bg-white/5 text-white/70";
    default: return "border-white/10 bg-white/[0.03] text-white/40";
  }
}

export function TeamSeats() {
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [seats, setSeats] = useState<TeamSeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"manager" | "collaborator" | "viewer">("collaborator");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

  async function authFetch(path: string, init?: RequestInit) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    return res;
  }

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await authFetch("/api/team-seats");
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setSeats(data.seats ?? []);
    } catch {
      setLoadError(true);
      setSeats([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Accept an invite link landing on /settings?teamInvite=<token>. */
  useEffect(() => {
    reload();
    const params = new URLSearchParams(window.location.search);
    const token = params.get("teamInvite");
    if (!token) return;
    params.delete("teamInvite");
    window.history.replaceState(null, "", `/settings${params.toString() ? `?${params}` : ""}`);
    (async () => {
      try {
        const res = await authFetch("/api/team-seats/accept", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "accept failed");
        toast({
          title: t("settings.teamInviteAcceptedTitle"),
          description: data.alreadyActive
            ? t("settings.teamInviteAcceptedAlready")
            : t("settings.teamInviteAcceptedDesc"),
        });
      } catch (err) {
        toast({
          title: t("settings.teamInviteFailedTitle"),
          description: err instanceof Error ? err.message : t("settings.teamInviteFailedDesc"),
          variant: "destructive",
        });
      }
      reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteLink(null);
    try {
      const res = await authFetch("/api/team-seats/invite", {
        method: "POST",
        body: JSON.stringify({ email, displayName: name, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "invite failed");
      setSeats((prev) => [data.seat, ...prev]);
      setInviteLink(data.inviteLink ?? null);
      setEmail("");
      setName("");
      toast({
        title: t("settings.teamInviteCreatedTitle"),
        description: t("settings.teamInviteCreatedDesc"),
      });
    } catch (err) {
      toast({
        title: t("settings.teamInviteFailedTitle"),
        description: err instanceof Error ? err.message : t("settings.teamInviteFailedDesc"),
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(seat: TeamSeat, next: string) {
    setChangingRoleId(seat.id);
    try {
      const res = await authFetch(`/api/team-seats/${seat.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "role change failed");
      setSeats((prev) => prev.map((s) => (s.id === seat.id ? data.seat : s)));
    } catch (err) {
      toast({
        title: t("settings.teamRoleFailedTitle"),
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setChangingRoleId(null);
    }
  }

  async function revoke(seat: TeamSeat) {
    setRevokingId(seat.id);
    try {
      const res = await authFetch(`/api/team-seats/${seat.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "revoke failed");
      }
      setSeats((prev) => prev.filter((s) => s.id !== seat.id));
      toast({ title: t("settings.teamRevokedTitle") });
    } catch (err) {
      toast({
        title: t("settings.teamRevokeFailedTitle"),
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setRevokingId(null);
    }
  }

  function copyLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast({ title: t("settings.teamCopyFailed"), variant: "destructive" }),
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">{t("settings.teamTitle")}</h2>
          <p className="text-white/40 text-sm">{t("settings.teamSubtitle")}</p>
        </div>
        <span className="ml-auto rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          {t("settings.teamFreeBadge")}
        </span>
      </div>

      {/* Permission matrix */}
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary/[0.06] text-left">
                <th className="px-4 py-3 font-semibold text-white/60">{t("settings.teamMatrixCapability")}</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} className="px-4 py-3 font-semibold text-center whitespace-nowrap">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${roleBadgeClass(r)}`}>
                      {t(`settings.teamRole_${r}`)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX_ROWS.map((row) => (
                <tr key={row.key} className="border-t border-white/[0.06]">
                  <td className="px-4 py-2.5 text-white/70">{t(row.labelKey)}</td>
                  {ROLE_ORDER.map((r) => (
                    <td key={r} className="px-4 py-2.5 text-center">
                      {PERMISSIONS_BY_ROLE[r][row.key] ? (
                        <Check className="h-4 w-4 text-primary inline" />
                      ) : (
                        <X className="h-4 w-4 text-white/20 inline" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite form */}
      <form onSubmit={invite} className="rounded-xl border border-primary/25 bg-primary/[0.05] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">{t("settings.teamInviteHeading")}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("settings.teamEmailPlaceholder")}
            className="bg-black/40 border-white/15"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("settings.teamNamePlaceholder")}
            maxLength={80}
            className="bg-black/40 border-white/15"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="rounded-md bg-black/40 border border-white/15 px-3 py-2 text-sm"
            aria-label={t("settings.teamRoleLabel")}
          >
            {(["manager", "collaborator", "viewer"] as const).map((r) => (
              <option key={r} value={r} className="bg-black">
                {t(`settings.teamRole_${r}`)}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            disabled={inviting}
            className="bg-primary hover:bg-primary/90 text-black font-bold text-xs shadow-[0_0_16px_rgba(218,165,32,0.35)]"
          >
            {inviting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            {t("settings.teamInviteButton")}
          </Button>
        </div>

        {inviteLink && (
          <div className="rounded-lg border border-primary/30 bg-black/50 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm text-amber-200/90">
              <MailWarning className="h-4 w-4 shrink-0" />
              {t("settings.teamNoEmailNote")}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-black/60 border border-white/10 px-2 py-1.5 text-xs text-white/70">
                {inviteLink}
              </code>
              <Button type="button" variant="outline" size="sm" onClick={copyLink} className="border-white/15">
                {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="ml-1.5 text-xs">{copied ? t("settings.teamCopied") : t("settings.teamCopyLink")}</span>
              </Button>
            </div>
          </div>
        )}
      </form>

      {/* Seat list */}
      <div className="space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8 text-white/40">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            {t("settings.teamLoading")}
          </div>
        )}
        {!loading && loadError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80 flex items-center gap-3">
            {t("settings.teamLoadError")}
            <Button variant="outline" size="sm" onClick={reload} className="border-white/15 ml-auto">
              {t("settings.teamRetry")}
            </Button>
          </div>
        )}
        {!loading && !loadError && seats.length === 0 && (
          <p className="text-sm text-white/40 py-4 text-center">{t("settings.teamEmpty")}</p>
        )}
        {!loading &&
          !loadError &&
          seats.map((seat) => (
            <div
              key={seat.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">
                  {seat.displayName || seat.email}
                </div>
                {seat.displayName && <div className="text-xs text-white/40 truncate">{seat.email}</div>}
                <div className="text-xs text-white/40 mt-0.5">
                  {seat.status === "invited" ? (
                    <span className="text-amber-300/80">{t("settings.teamStatusInvited")}</span>
                  ) : (
                    <span className="text-primary/80">{t("settings.teamStatusActive")}</span>
                  )}
                </div>
              </div>
              <select
                value={seat.role}
                disabled={changingRoleId === seat.id}
                onChange={(e) => changeRole(seat, e.target.value)}
                className={`rounded-full border px-2.5 py-1 text-xs bg-black/40 ${roleBadgeClass(seat.role)}`}
                aria-label={t("settings.teamRoleLabel")}
              >
                {(["manager", "collaborator", "viewer"] as const).map((r) => (
                  <option key={r} value={r} className="bg-black">
                    {t(`settings.teamRole_${r}`)}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => revoke(seat)}
                disabled={revokingId === seat.id}
                className="text-white/40 hover:text-red-300 hover:bg-red-500/10"
              >
                {revokingId === seat.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span className="ml-1.5 text-xs">
                  {seat.status === "invited" ? t("settings.teamCancel") : t("settings.teamRevoke")}
                </span>
              </Button>
            </div>
          ))}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs text-white/40">
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary/70 mt-0.5" />
        <span>{t("settings.teamAuthGapNote")}</span>
      </div>
    </section>
  );
}
