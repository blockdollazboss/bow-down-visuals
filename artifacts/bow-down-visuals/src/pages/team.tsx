import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Users, UserPlus, Trash2, LogOut, Crown, Shield, User as UserIcon } from "lucide-react";
import { VisualBucsIcon } from "@/components/VisualBucsIcon";
import { useTranslation } from "react-i18next";

interface Team {
  id: string;
  name: string;
  logoUrl: string | null;
  ownerId: string;
  credits: number;
  allowPersonalFallback: boolean;
  myRole: string | null;
  myStatus: string | null;
}

interface TeamMember {
  id: string;
  teamId: string;
  userId: string | null;
  email: string;
  role: string;
  status: string;
}

interface Invite {
  id: string;
  teamId: string;
  email: string;
  role: string;
  team: { id: string; name: string } | null;
}

interface SpendRow {
  userId: string;
  email: string | null;
  action: string;
  total: number;
}

export default function TeamPage() {
  const { t } = useTranslation();
  usePageTitle(t("team.pageTitle"));
  const { getAccessToken } = useAuth();

  const [teams, setTeams] = useState<Team[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [activeTeam, setActiveTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [spending, setSpending] = useState<SpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [newTeamName, setNewTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [fundAmount, setFundAmount] = useState("");
  const [funding, setFunding] = useState(false);

  async function api(path: string, opts?: RequestInit) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token ?? ""}`,
        ...(opts?.headers ?? {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function load(): Promise<boolean> {
    setLoading(true);
    setMsg(null);
    try {
      const data = await api("/api/teams");
      setTeams(data.teams ?? []);
      setInvites(data.invites ?? []);
      const mine = (data.teams ?? []).find((tm: Team) => tm.myStatus === "active") ?? null;
      setActiveTeam(mine);
      if (mine) {
        const detail = await api(`/api/teams/${mine.id}`);
        setMembers(detail.members ?? []);
        if (detail.myRole === "owner" || detail.myRole === "admin") {
          try {
            const spend = await api(`/api/teams/${mine.id}/spending`);
            setSpending(spend.spending ?? []);
          } catch {
            setSpending([]);
          }
        }
      } else {
        setMembers([]);
        setSpending([]);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("team.errorLoad"));
      return false;
    } finally {
      setLoading(false);
    }
    return true;
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!newTeamName.trim()) return;
    setCreating(true);
    setMsg(null);
    try {
      await api("/api/teams", { method: "POST", body: JSON.stringify({ name: newTeamName.trim() }) });
      setNewTeamName("");
      const loaded = await load();
      setMsg(loaded ? t("team.teamCreated") : t("team.teamCreatedReloadFailed"));
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorCreate")}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleInvite() {
    if (!activeTeam || !inviteEmail.trim()) return;
    setInviting(true);
    setMsg(null);
    try {
      await api(`/api/teams/${activeTeam.id}/invite`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteEmail("");
      await load();
      setMsg(t("team.inviteSent"));
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorInvite")}`);
    } finally {
      setInviting(false);
    }
  }

  async function handleAccept(teamId: string) {
    setMsg(null);
    try {
      await api(`/api/teams/${teamId}/accept`, { method: "POST" });
      await load();
      setMsg(t("team.welcomeToTeam"));
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorAccept")}`);
    }
  }

  async function handleDecline(teamId: string) {
    try {
      await api(`/api/teams/${teamId}/decline`, { method: "POST" });
      await load();
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorDecline")}`);
    }
  }

  async function handleRoleChange(memberId: string, role: string) {
    if (!activeTeam) return;
    try {
      await api(`/api/teams/${activeTeam.id}/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await load();
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorRoleChange")}`);
    }
  }

  async function handleRemove(memberId: string, email: string) {
    if (!activeTeam || !confirm(t("team.confirmRemove", { email }))) return;
    try {
      await api(`/api/teams/${activeTeam.id}/members/${memberId}`, { method: "DELETE" });
      await load();
      setMsg(t("team.memberRemoved"));
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorRemove")}`);
    }
  }

  async function handleLeave() {
    if (!activeTeam || !confirm(t("team.confirmLeave", { name: activeTeam.name }))) return;
    try {
      await api(`/api/teams/${activeTeam.id}/leave`, { method: "POST" });
      await load();
      setMsg(t("team.leftTeam"));
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorLeave")}`);
    }
  }

  async function handleFund() {
    if (!activeTeam) return;
    const amount = Math.floor(Number(fundAmount));
    if (!amount || amount <= 0) {
      setMsg(t("team.errorFundAmount"));
      return;
    }
    if (!confirm(t("team.confirmFund", { amount }))) return;
    setFunding(true);
    setMsg(null);
    try {
      // Idempotency key: if the request is retried (network blip, double-click),
      // the server returns the original result instead of double-funding.
      const idempotencyKey = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const data = await api(`/api/teams/${activeTeam.id}/fund`, {
        method: "POST",
        body: JSON.stringify({ credits: amount, idempotencyKey }),
      });
      setFundAmount("");
      await load();
      setMsg(data?.duplicate ? t("team.alreadyFunded") : t("team.fundedPool", { amount }));
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorFund")}`);
    } finally {
      setFunding(false);
    }
  }

  async function handleToggleFallback() {
    if (!activeTeam) return;
    const next = !activeTeam.allowPersonalFallback;
    setMsg(null);
    try {
      const data = await api(`/api/teams/${activeTeam.id}`, {
        method: "PATCH",
        body: JSON.stringify({ allowPersonalFallback: next }),
      });
      setActiveTeam((prev) => (prev ? { ...prev, allowPersonalFallback: data.team.allowPersonalFallback } : prev));
      setMsg(next ? t("team.fallbackEnabled") : t("team.fallbackDisabled"));
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorFallback")}`);
    }
  }

  async function handleDelete() {
    if (!activeTeam || !confirm(t("team.confirmDelete", { name: activeTeam.name }))) return;
    try {
      await api(`/api/teams/${activeTeam.id}`, { method: "DELETE" });
      await load();
      setMsg(t("team.teamDeleted"));
    } catch (e) {
      setMsg(`✗ ${e instanceof Error ? e.message : t("team.errorDelete")}`);
    }
  }

  const roleIcon = (role: string) =>
    role === "owner" ? <Crown className="h-3.5 w-3.5 text-[#C9A84C]" /> :
    role === "admin" ? <Shield className="h-3.5 w-3.5 text-blue-400" /> :
    <UserIcon className="h-3.5 w-3.5 text-white/40" />;

  if (loading) {
    return (
      <div className="p-8 text-center text-white/50">
        <Users className="h-8 w-8 mx-auto mb-3 animate-pulse text-[#C9A84C]" />
        {t("team.loading")}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-7 w-7 text-[#C9A84C]" />
        <div>
          <h1 className="text-2xl font-black text-white">{t("team.pageTitle")}</h1>
          <p className="text-sm text-white/50">{t("team.pageSubtitle")}</p>
        </div>
      </div>

      {msg && (
        <p className={`text-sm rounded-lg px-4 py-2 ${msg.startsWith("✓") ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
          {msg}
        </p>
      )}

      {/* Pending invites */}
      {invites.length > 0 && (
        <Card className="p-5 bg-white/[0.03] border-white/10">
          <h2 className="font-bold text-white mb-3 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[#C9A84C]" /> {t("team.pendingInvites")}
          </h2>
          <div className="space-y-2">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-4 py-3">
                <div>
                  <p className="text-white font-semibold">{inv.team?.name ?? t("team.teamFallbackName")}</p>
                  <p className="text-xs text-white/40">{t("team.invitedAs", { role: inv.role })}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void handleAccept(inv.teamId)} className="bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-bold">
                    {t("team.accept")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleDecline(inv.teamId)} className="text-white/50">
                    {t("team.decline")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!activeTeam ? (
        <Card className="p-6 bg-white/[0.03] border-white/10">
          <h2 className="font-bold text-white mb-2">{t("team.createTeamTitle")}</h2>
          <p className="text-sm text-white/50 mb-4">
            {t("team.createTeamHint")}
          </p>
          <div className="flex gap-2">
            <Input
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder="Team name — e.g. Blockdollaz Media"
              maxLength={80}
              className="bg-white/[0.05] border-white/10 text-white"
            />
            <Button onClick={() => void handleCreate()} disabled={creating || !newTeamName.trim()} className="bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-bold shrink-0">
              {creating ? t("team.creating") : t("team.createTeam")}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* Pool balance */}
          <Card className="p-6 bg-gradient-to-br from-[#C9A84C]/15 to-transparent border-[#C9A84C]/30">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-white/40 font-semibold">{t("team.teamPool")}</p>
                <p className="text-4xl font-black text-[#C9A84C] flex items-center gap-2">
                  <VisualBucsIcon className="h-7 w-7" /> {activeTeam.credits.toLocaleString()}
                </p>
                <p className="text-xs text-white/40 mt-1">{t("team.poolHint")}</p>
              </div>
              {(activeTeam.myRole === "owner" || activeTeam.myRole === "admin") && (
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    min={1}
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    placeholder={t("team.fundPlaceholder")}
                    className="w-28 bg-white/[0.05] border-white/10 text-white"
                  />
                  <Button onClick={() => void handleFund()} disabled={funding} className="bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-bold">
                    {funding ? t("team.funding") : t("team.fundPool")}
                  </Button>
                </div>
              )}
            </div>
            {(activeTeam.myRole === "owner" || activeTeam.myRole === "admin") && (
              <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-white">{t("team.fallbackTitle")}</p>
                  <p className="text-xs text-white/40">
                    {activeTeam.allowPersonalFallback
                      ? t("team.fallbackOnHint")
                      : t("team.fallbackOffHint")}
                  </p>
                </div>
                <Button
                  onClick={() => void handleToggleFallback()}
                  variant="outline"
                  className={activeTeam.allowPersonalFallback ? "border-[#C9A84C]/50 text-[#C9A84C]" : "border-white/10 text-white/60"}
                >
                  {activeTeam.allowPersonalFallback ? t("team.fallbackOn") : t("team.fallbackOff")}
                </Button>
              </div>
            )}
          </Card>

          {/* Invite */}
          {(activeTeam.myRole === "owner" || activeTeam.myRole === "admin") && (
            <Card className="p-5 bg-white/[0.03] border-white/10">
              <h2 className="font-bold text-white mb-3 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[#C9A84C]" /> {t("team.inviteTitle")}
              </h2>
              <div className="flex gap-2 flex-wrap">
                <Input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={t("team.inviteEmailPlaceholder")}
                  type="email"
                  className="flex-1 min-w-[200px] bg-white/[0.05] border-white/10 text-white"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="rounded-lg bg-white/[0.05] border border-white/10 text-white px-3 py-2 text-sm"
                >
                  <option value="member">{t("team.roleMember")}</option>
                  <option value="admin">{t("team.roleAdmin")}</option>
                </select>
                <Button onClick={() => void handleInvite()} disabled={inviting || !inviteEmail.trim()} className="bg-[#C9A84C] text-black hover:bg-[#C9A84C]/90 font-bold">
                  {inviting ? t("team.sendingInvite") : t("team.sendInvite")}
                </Button>
              </div>
            </Card>
          )}

          {/* Members */}
          <Card className="p-5 bg-white/[0.03] border-white/10">
            <h2 className="font-bold text-white mb-3">
              {t("team.membersTitle")} <span className="text-white/40 font-normal">({members.length})</span>
            </h2>
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-4 py-3">
                  <div className="flex items-center gap-3">
                    {roleIcon(m.role)}
                    <div>
                      <p className="text-white text-sm font-semibold">{m.email}</p>
                      <p className="text-xs text-white/40 capitalize">
                        {m.role}{m.status === "invited" ? t("team.invitePendingSuffix") : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeTeam.myRole === "owner" && m.role !== "owner" && m.status === "active" && (
                      <select
                        value={m.role}
                        onChange={(e) => void handleRoleChange(m.id, e.target.value)}
                        className="rounded-lg bg-white/[0.05] border border-white/10 text-white px-2 py-1 text-xs"
                      >
                        <option value="member">{t("team.roleMember")}</option>
                        <option value="admin">{t("team.roleAdmin")}</option>
                      </select>
                    )}
                    {(activeTeam.myRole === "owner" || (activeTeam.myRole === "admin" && m.role === "member")) &&
                      m.role !== "owner" && (
                        <Button size="sm" variant="ghost" onClick={() => void handleRemove(m.id, m.email)} className="text-red-400/70 hover:text-red-300">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Spending */}
          {spending.length > 0 && (
            <Card className="p-5 bg-white/[0.03] border-white/10">
              <h2 className="font-bold text-white mb-3">{t("team.poolSpendingTitle")}</h2>
              <div className="space-y-1.5">
                {spending.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-sm rounded bg-white/[0.03] px-3 py-2">
                    <span className="text-white/70">{s.email ?? s.userId.slice(0, 8)} · <span className="text-white/40">{s.action}</span></span>
                    <span className="text-[#C9A84C] font-bold">{t("team.spendingAmount", { amount: s.total.toLocaleString() })}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Danger zone */}
          <Card className="p-5 bg-white/[0.03] border-white/10">
            <div className="flex gap-3 flex-wrap">
              {activeTeam.myRole !== "owner" ? (
                <Button variant="ghost" onClick={() => void handleLeave()} className="text-white/60">
                  <LogOut className="h-4 w-4 mr-2" /> {t("team.leaveTeam")}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => void handleDelete()} className="text-red-400/80 hover:text-red-300">
                  <Trash2 className="h-4 w-4 mr-2" /> {t("team.deleteTeam")}
                </Button>
              )}
            </div>
            <p className="text-xs text-white/30 mt-3">
              {t("team.sharedVaultsNote")}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
