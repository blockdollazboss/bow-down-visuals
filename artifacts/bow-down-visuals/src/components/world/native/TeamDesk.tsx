import { useCallback, useEffect, useState } from "react";
import {
  Crown, Eye, Loader2, LogOut, PackagePlus, Shield, Trash2, User as UserIcon,
  UserPlus, Users,
} from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState, NativeErrorState, NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  TEAMS_PATH,
  TEAM_FALLBACK_OFF_HINT,
  TEAM_FALLBACK_ON_HINT,
  TEAM_NAME_MAX,
  TEAM_SHARED_VAULTS_NOTE,
  TEAM_TIER_GATE_MESSAGE,
  activeTeamFromList,
  buildCreateTeamPayload,
  buildFallbackPayload,
  buildFundPayload,
  buildGroupProductPayload,
  buildInvitePayload,
  buildRenamePayload,
  buildRolePayload,
  canChangeRoles,
  canRemoveMember,
  fundAmountFromInput,
  fundIdempotencyKey,
  inviteEmailValid,
  isTeamAdmin,
  isTeamOwner,
  isTierGateError,
  parseFundResult,
  parseGroupOwn,
  parseSpending,
  parseTeamDetail,
  parseTeamList,
  teamAcceptPath,
  teamDeclinePath,
  teamDetailPath,
  teamFundPath,
  teamGroupProductsPath,
  teamGroupProfilePath,
  teamInvitePath,
  teamLeavePath,
  teamMemberPath,
  teamNameReady,
  teamSpendingPath,
  type TeamDetail,
  type TeamList,
  type TeamSpendRow,
} from "@/lib/world/team-desk";
import {
  GROUP_PRODUCT_KINDS,
  buildSplitTerms,
  canManageGroupProfile,
  fetchPublicGroupProfile,
  formatGroupPrice,
  groupKindLabel,
  normalizeGroupSlugInput,
  parsePriceToCents,
  splitTermRows,
  GroupProfileFetchError,
  type GroupProfileOwnDto,
  type GroupProfilePageDto,
} from "@/lib/group-profile-view";

/* ─── The Team Workspace, in-world (stack1500 world parity, wave
   #4a item 19) ─────────────────────────────────────────────────────
   Census feature `team` — ABSENT in-World, the largest remaining
   parity gap — native at the My Studio board, stacked under the
   Studio Board with the My Profile / Account / Academy desks. The
   desk rides the 2D /team page's own rails end to end (the seam
   pins every path): my teams + pending invites with accept /
   decline, team creation, the shared pool with funding, the
   personal-fallback switch, member invites, role changes and
   removals under the page's own role rules, per-member pool
   spending with the page's honest failure state, leave / delete
   with an in-desk second confirmation, and the duo/group public
   profile (identity + written split terms + the shared store)
   that the page docks on the same screen — its public page read
   IN the desk through the page's own lib fetcher, never a walk
   out of the palace.

   CHARGES: no team rail carries a price — the registry has no
   /api/teams rows and the desk invents none. Funding the pool is
   the one money move: the member's own chosen amount, confirmed
   through the confirmed-spend seam with the amount as the explicit
   override (the Books print-total precedent) before the rail moves
   it; the rail refunds the personal debit itself if crediting the
   pool fails, and a 402 reads as out-of-Visual-Bucs naming the
   Treasury's Packs desk, like its neighbours.

   ENTITLEMENT: under Shot Caller the rail fails closed with its
   own sentence; the desk renders that as a locked state in the
   rail's words — never a load error, never an empty workspace.
   Members only, like the board itself: a guest never reaches the
   board pattern. ────────────────────────────────────────────────── */

type Phase = "loading" | "tier" | "failed" | "ready";
type GroupPhase = "loading" | "failed" | "ready";
type PreviewState = "idle" | "loading" | "ready" | "missing" | "failed";

export function TeamDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();

  const [phase, setPhase] = useState<Phase>("loading");
  const [failMessage, setFailMessage] = useState("");
  const [list, setList] = useState<TeamList | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [spending, setSpending] = useState<TeamSpendRow[]>([]);
  const [spendingFailed, setSpendingFailed] = useState(false);

  const [groupPhase, setGroupPhase] = useState<GroupPhase>("loading");
  const [groupDto, setGroupDto] = useState<GroupProfileOwnDto | null>(null);

  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [newTeamName, setNewTeamName] = useState("");
  const [renameName, setRenameName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [fundAmount, setFundAmount] = useState("");

  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  /* group profile form (mirrors GroupProfileSettings' own fields) */
  const [gSlug, setGSlug] = useState("");
  const [gName, setGName] = useState("");
  const [gBio, setGBio] = useState("");
  const [gAvatar, setGAvatar] = useState("");
  const [gBanner, setGBanner] = useState("");
  const [gPublished, setGPublished] = useState(false);
  const [gShares, setGShares] = useState<Record<string, string>>({});
  const [pKind, setPKind] = useState<string>("download");
  const [pTitle, setPTitle] = useState("");
  const [pPrice, setPPrice] = useState("");

  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [preview, setPreview] = useState<GroupProfilePageDto | null>(null);

  const goldBtn =
    "rounded-xl bg-[#C9A84C] px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50";
  const ghostBtn = `rounded-xl border px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${
    isLight
      ? "border-[#C9A84C]/50 text-[#7A5A12] hover:bg-[#C9A84C]/10"
      : "border-white/15 text-white/70 hover:bg-white/5"
  }`;
  const labelCls = `block text-xs font-semibold uppercase tracking-wider ${
    isLight ? "text-[#6B5B36]" : "text-white/40"
  }`;
  const selectCls = `rounded-lg border px-3 py-2 text-sm ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/80 text-[#241C0A]"
      : "border-white/10 bg-white/[0.05] text-white"
  }`;
  const rowCls = `flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${
    isLight ? "bg-black/[0.03]" : "bg-white/[0.04]"
  }`;
  const subCls = isLight ? "text-[#6B5B36]" : "text-white/40";

  /* ── fetch helper — the page's own shape (Bearer + JSON), with
        errors carried by apiErrorMessage, never raw body fields ── */
  const api = useCallback(
    async (path: string, opts?: RequestInit): Promise<unknown> => {
      const res = await fetch(path, {
        ...opts,
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders()),
          ...(opts?.headers ?? {}),
        },
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));
      }
      return data;
    },
    [authHeaders],
  );

  const loadSpending = useCallback(
    async (teamId: string) => {
      try {
        const rows = parseSpending(await api(teamSpendingPath(teamId)));
        if (rows === null) throw new Error("spending shape");
        setSpending(rows);
        setSpendingFailed(false);
      } catch {
        setSpending([]);
        setSpendingFailed(true);
      }
    },
    [api],
  );

  const fillGroupForm = useCallback((dto: GroupProfileOwnDto) => {
    setGroupDto(dto);
    const g = dto.group;
    setGSlug(g?.slug ?? "");
    setGName(g?.displayName ?? "");
    setGBio(g?.bio ?? "");
    setGAvatar(g?.avatarUrl ?? "");
    setGBanner(g?.bannerUrl ?? "");
    setGPublished(g?.isPublished ?? false);
    const next: Record<string, string> = {};
    for (const m of dto.members) {
      next[m.userId] = m.sharePct != null ? String(m.sharePct) : "";
    }
    setGShares(next);
  }, []);

  const loadGroup = useCallback(
    async (teamId: string) => {
      setGroupPhase("loading");
      try {
        const dto = parseGroupOwn(await api(teamGroupProfilePath(teamId)));
        if (!dto) throw new Error("group shape");
        fillGroupForm(dto);
        setGroupPhase("ready");
      } catch {
        setGroupPhase("failed");
      }
    },
    [api, fillGroupForm],
  );

  const loadAll = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      /* The list call is classified by hand: a 403 carrying the
         rail's own Shot Caller sentence is the entitlement gate,
         not a failure. */
      const res = await fetch(TEAMS_PATH, { headers: await authHeaders() });
      const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const message = apiErrorMessage(raw, `Request failed (${res.status})`);
        if (isTierGateError(res.status, message)) {
          setPhase("tier");
          return;
        }
        throw new Error(message);
      }
      const parsedList = parseTeamList(raw);
      if (!parsedList) throw new Error("teams shape");
      setList(parsedList);

      const active = activeTeamFromList(parsedList.teams);
      if (!active) {
        setDetail(null);
        setSpending([]);
        setSpendingFailed(false);
        setPhase("ready");
        return;
      }
      const parsedDetail = parseTeamDetail(await api(teamDetailPath(active.id)));
      if (!parsedDetail) throw new Error("team shape");
      setDetail(parsedDetail);
      setRenameName(parsedDetail.team.name);
      if (isTeamAdmin(parsedDetail.myRole)) {
        await loadSpending(active.id);
      } else {
        setSpending([]);
        setSpendingFailed(false);
      }
      setPhase("ready");
      await loadGroup(active.id);
    } catch (e) {
      setFailMessage(plainErrorText(e, "Failed to load teams."));
      setPhase("failed");
    }
  }, [api, authHeaders, loadGroup, loadSpending]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const team = detail?.team ?? null;
  const myRole = detail?.myRole ?? null;
  const iAmAdmin = isTeamAdmin(myRole);
  const iAmOwner = isTeamOwner(myRole);
  const canManageGroup = canManageGroupProfile(myRole);

  /* ── actions ─────────────────────────────────────────────────── */

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await work();
    } catch (e) {
      setError(plainErrorText(e, "That didn't go through — try again."));
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    if (!teamNameReady(newTeamName)) return;
    await run("create", async () => {
      await api(TEAMS_PATH, {
        method: "POST",
        body: JSON.stringify(buildCreateTeamPayload(newTeamName)),
      });
      setNewTeamName("");
      await loadAll();
      setNote("Team created.");
    });
  }

  async function handleAccept(teamId: string) {
    await run(`accept-${teamId}`, async () => {
      await api(teamAcceptPath(teamId), { method: "POST" });
      await loadAll();
      setNote("Welcome to the team.");
    });
  }

  async function handleDecline(teamId: string) {
    await run(`decline-${teamId}`, async () => {
      await api(teamDeclinePath(teamId), { method: "POST" });
      await loadAll();
    });
  }

  async function handleInvite() {
    if (!team) return;
    /* The server's own email rule, applied before the trip — the
       page's gate, so the form never sends what the rail refuses. */
    if (!inviteEmailValid(inviteEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    await run("invite", async () => {
      await api(teamInvitePath(team.id), {
        method: "POST",
        body: JSON.stringify(buildInvitePayload(inviteEmail, inviteRole)),
      });
      setInviteEmail("");
      await loadAll();
      setNote("Invite sent.");
    });
  }

  async function handleRoleChange(memberId: string, role: string) {
    if (!team) return;
    await run(`role-${memberId}`, async () => {
      await api(teamMemberPath(team.id, memberId), {
        method: "PATCH",
        body: JSON.stringify(buildRolePayload(role)),
      });
      await loadAll();
    });
  }

  async function handleRemove(memberId: string) {
    if (!team) return;
    if (confirmRemoveId !== memberId) {
      setConfirmRemoveId(memberId);
      return;
    }
    await run(`remove-${memberId}`, async () => {
      await api(teamMemberPath(team.id, memberId), { method: "DELETE" });
      setConfirmRemoveId(null);
      await loadAll();
      setNote("Member removed.");
    });
  }

  async function handleRename() {
    if (!team || !teamNameReady(renameName)) return;
    await run("rename", async () => {
      await api(teamDetailPath(team.id), {
        method: "PATCH",
        body: JSON.stringify(buildRenamePayload(renameName)),
      });
      await loadAll();
      setNote("Team name saved.");
    });
  }

  async function handleToggleFallback() {
    if (!team) return;
    const next = !team.allowPersonalFallback;
    await run("fallback", async () => {
      await api(teamDetailPath(team.id), {
        method: "PATCH",
        body: JSON.stringify(buildFallbackPayload(next)),
      });
      await loadAll();
      setNote(
        next
          ? "Personal credit fallback enabled."
          : "Personal credit fallback disabled — pool-only spending.",
      );
    });
  }

  async function handleFund() {
    if (!team) return;
    const amount = fundAmountFromInput(fundAmount);
    if (amount === null) {
      setError("Enter a credit amount greater than 0.");
      return;
    }
    setBusy("fund");
    setError(null);
    setNote(null);
    setOutOfCredits(false);
    try {
      /* The confirmed-spend seam: the member confirms the exact
         amount (the override) before the rail moves anything.
         A null answer is a decline — nothing runs. */
      const res = await confirmedFetch(teamFundPath(team.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildFundPayload(amount, fundIdempotencyKey())),
        overrideCost: amount,
        overrideFeature: "Team Pool Funding",
      });
      if (res === null) return;
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 402 || data["error"] === "out_of_credits") {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));
      }
      const result = parseFundResult(data);
      if (!result) throw new Error("fund shape");
      setFundAmount("");
      await loadAll();
      setNote(
        result.duplicate
          ? "Already funded — no duplicate charge."
          : `${amount.toLocaleString()} Visual Bucs added to the team pool.`,
      );
    } catch (e) {
      setError(plainErrorText(e, "Failed to fund the pool."));
    } finally {
      setBusy(null);
    }
  }

  async function handleLeave() {
    if (!team) return;
    if (!confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    await run("leave", async () => {
      await api(teamLeavePath(team.id), { method: "POST" });
      setConfirmLeave(false);
      await loadAll();
      setNote("You left the team.");
    });
  }

  async function handleDelete() {
    if (!team) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await run("delete", async () => {
      await api(teamDetailPath(team.id), { method: "DELETE" });
      setConfirmDelete(false);
      await loadAll();
      setNote("Team deleted.");
    });
  }

  /* ── group profile actions (the page editor's own flow) ─────── */

  const groupOwnerUserId =
    groupDto?.members.find((m) => m.role === "owner")?.userId ?? "";

  async function handleGroupSave() {
    if (!team || !groupDto) return;
    setError(null);
    setNote(null);
    const normalized = normalizeGroupSlugInput(gSlug);
    if (!normalized) {
      setError(
        "The group handle needs 3–64 characters: lowercase letters, numbers and dashes, starting and ending with a letter or number.",
      );
      return;
    }
    const built = buildSplitTerms(
      groupOwnerUserId,
      groupDto.members.map((m) => ({ userId: m.userId, pct: gShares[m.userId] ?? "" })),
    );
    if (!built.ok) {
      setError(built.error);
      return;
    }
    await run("group-save", async () => {
      await api(teamGroupProfilePath(team.id), {
        method: "POST",
        body: JSON.stringify({
          slug: normalized,
          displayName: gName.trim(),
          bio: gBio,
          avatarUrl: gAvatar.trim() ? gAvatar.trim() : null,
          bannerUrl: gBanner.trim() ? gBanner.trim() : null,
          isPublished: gPublished,
          splitTerms: built.terms,
        }),
      });
      await loadGroup(team.id);
      setNote("Group profile saved.");
    });
  }

  async function handleAddProduct() {
    if (!team || !groupDto?.group) return;
    const title = pTitle.trim();
    if (!title) {
      setError("Give the product a title.");
      return;
    }
    const priceCents = parsePriceToCents(pPrice);
    if (priceCents === null) {
      setError("The price must be 0 or more, in dollars (e.g. 5 or 5.25).");
      return;
    }
    await run("group-product", async () => {
      await api(teamGroupProductsPath(team.id), {
        method: "POST",
        body: JSON.stringify(buildGroupProductPayload({ kind: pKind, title, priceCents })),
      });
      setPTitle("");
      setPPrice("");
      await loadGroup(team.id);
      setNote("Added to the shared store — it sells under the group's split terms.");
    });
  }

  async function handlePreview() {
    const slug = groupDto?.group?.slug;
    if (!slug) return;
    setPreviewState("loading");
    try {
      setPreview(await fetchPublicGroupProfile(slug));
      setPreviewState("ready");
    } catch (e) {
      setPreview(null);
      setPreviewState(
        e instanceof GroupProfileFetchError && e.status === 404 ? "missing" : "failed",
      );
    }
  }

  const roleIcon = (role: string) =>
    role === "owner" ? (
      <Crown className="h-3.5 w-3.5 text-[#C9A84C]" />
    ) : role === "admin" ? (
      <Shield className="h-3.5 w-3.5 text-blue-400" />
    ) : (
      <UserIcon className={`h-3.5 w-3.5 ${isLight ? "text-black/30" : "text-white/40"}`} />
    );

  /* ── render ──────────────────────────────────────────────────── */

  return (
    <div data-testid="world-team-desk" className="flex flex-col gap-4">
      <div className="flex items-center gap-3 px-1">
        <Users className="h-6 w-6 text-[#C9A84C]" />
        <div>
          <p className={`text-base font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            Team Workspace
          </p>
          <p className={`text-xs ${subCls}`}>Shared credit pool, shared vaults, one crew.</p>
        </div>
      </div>

      {phase === "loading" ? (
        <NativeLoadingState isLight={isLight} message="Loading your team…" />
      ) : phase === "tier" ? (
        <NativeCard isLight={isLight} title="Team Workspace">
          <div data-testid="world-team-tier-gate">
            <p className={`text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {TEAM_TIER_GATE_MESSAGE}
            </p>
            <p className={`mt-1 text-sm ${subCls}`}>
              The Team Workspace — a shared Visual Buc pool, member roles and shared
              vaults — unlocks at Shot Caller (★4) and up. Shot Caller is an earned
              Creator Rank, never a plan you can buy: rank points come from
              publishing work, completed exports, followers, streams, tips, sales
              and paid memberships — ★4 takes 300 points.
            </p>
          </div>
        </NativeCard>
      ) : phase === "failed" ? (
        <NativeErrorState
          isLight={isLight}
          title="Your team wouldn't open in the palace"
          message={failMessage}
          onRetry={() => void loadAll()}
        />
      ) : (
        <>
          {note ? (
            <p className="rounded-lg bg-green-500/10 px-4 py-2 text-sm text-green-300">
              ✓ {note}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>
          ) : null}
          {outOfCredits ? (
            <p
              data-testid="world-team-out-of-credits"
              className="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-300"
            >
              You&rsquo;re out of Visual Bucs — top up at the Visual Buc Packs desk
              in the Treasury and the Team Desk is ready again.
            </p>
          ) : null}

          {/* Pending invites */}
          {list && list.invites.length > 0 ? (
            <NativeCard isLight={isLight} title="Pending invites">
              <div data-testid="world-team-invites" className="flex flex-col gap-2">
                {list.invites.map((inv) => (
                  <div key={inv.id} className={rowCls}>
                    <div>
                      <p className={`text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                        {inv.team?.name ?? "Team"}
                      </p>
                      <p className={`text-xs ${subCls}`}>Invited as {inv.role}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={goldBtn}
                        disabled={busy === `accept-${inv.teamId}`}
                        onClick={() => void handleAccept(inv.teamId)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className={ghostBtn}
                        disabled={busy === `decline-${inv.teamId}`}
                        onClick={() => void handleDecline(inv.teamId)}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </NativeCard>
          ) : null}

          {!team ? (
            <NativeCard isLight={isLight} title="Create a team">
              <div data-testid="world-team-create">
                <p className={`text-sm ${subCls}`}>
                  Included with Shot Caller (★4) — the earned Creator Rank. Pool
                  your Visual Bucs, share artist vaults, and create together.
                </p>
                {list && list.teams.length > 0 ? (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {list.teams.map((t) => (
                      <p key={t.id} className={`text-xs ${subCls}`}>
                        {t.name} — {t.myRole ?? "member"} · {t.myStatus ?? ""}
                      </p>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <input
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    placeholder="Team name — e.g. Blockdollaz Media"
                    maxLength={TEAM_NAME_MAX}
                    className={deskInputCls(isLight)}
                    aria-label="Team name"
                  />
                  <button
                    type="button"
                    className={goldBtn}
                    disabled={busy === "create" || !teamNameReady(newTeamName)}
                    onClick={() => void handleCreate()}
                  >
                    {busy === "create" ? "Creating…" : "Create team"}
                  </button>
                </div>
              </div>
            </NativeCard>
          ) : (
            <>
              {/* Pool */}
              <NativeCard isLight={isLight} title="Team pool">
                <div data-testid="world-team-pool">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-3xl font-black text-[#C9A84C]">
                        {team.credits.toLocaleString()}{" "}
                        <span className="text-sm font-bold">Visual Bucs</span>
                      </p>
                      <p className={`mt-1 text-xs ${subCls}`}>
                        Visual Bucs shared across all members
                      </p>
                    </div>
                    <p className={`text-xs ${subCls}`}>
                      {team.name} · you are {myRole ?? "member"}
                    </p>
                  </div>

                  {iAmAdmin ? (
                    <div
                      data-testid="world-team-fund"
                      className="mt-4 flex flex-wrap items-center gap-2"
                    >
                      <input
                        type="number"
                        min={1}
                        value={fundAmount}
                        onChange={(e) => setFundAmount(e.target.value)}
                        placeholder="Visual Bucs"
                        className={`${deskInputCls(isLight)} w-32`}
                        aria-label="Visual Bucs to move into the pool"
                      />
                      <button
                        type="button"
                        className={goldBtn}
                        disabled={busy === "fund" || fundAmountFromInput(fundAmount) === null}
                        onClick={() => void handleFund()}
                      >
                        {busy === "fund" ? "Moving…" : "Fund pool"}
                      </button>
                      <span className={`text-xs ${subCls}`}>
                        Moves Bucs from your own balance into the pool — you confirm
                        the exact amount first.
                      </span>
                    </div>
                  ) : null}

                  {iAmAdmin ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                      <div>
                        <p className={`text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                          Personal credit fallback
                        </p>
                        <p className={`text-xs ${subCls}`}>
                          {team.allowPersonalFallback
                            ? TEAM_FALLBACK_ON_HINT
                            : TEAM_FALLBACK_OFF_HINT}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-pressed={team.allowPersonalFallback}
                        data-testid="world-team-fallback-toggle"
                        className={ghostBtn}
                        disabled={busy === "fallback"}
                        onClick={() => void handleToggleFallback()}
                      >
                        {team.allowPersonalFallback ? "Fallback ON" : "Fallback OFF"}
                      </button>
                    </div>
                  ) : null}

                  {iAmAdmin ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <input
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        maxLength={TEAM_NAME_MAX}
                        className={deskInputCls(isLight)}
                        aria-label="Team name"
                      />
                      <button
                        type="button"
                        className={ghostBtn}
                        disabled={
                          busy === "rename" ||
                          !teamNameReady(renameName) ||
                          renameName.trim() === team.name
                        }
                        onClick={() => void handleRename()}
                      >
                        Rename team
                      </button>
                    </div>
                  ) : null}
                </div>
              </NativeCard>

              {/* Invite */}
              {iAmAdmin ? (
                <NativeCard isLight={isLight} title="Invite a member">
                  <div
                    data-testid="world-team-invite-form"
                    className="flex flex-wrap gap-2"
                  >
                    <input
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="teammate@email.com"
                      type="email"
                      className={`${deskInputCls(isLight)} min-w-[200px] flex-1`}
                      aria-label="Invite email"
                    />
                    <select
                      aria-label="Invite role"
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className={selectCls}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      type="button"
                      className={goldBtn}
                      disabled={busy === "invite" || !inviteEmail.trim()}
                      onClick={() => void handleInvite()}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <UserPlus className="h-4 w-4" />
                        {busy === "invite" ? "Sending…" : "Send invite"}
                      </span>
                    </button>
                  </div>
                </NativeCard>
              ) : null}

              {/* Members */}
              <NativeCard isLight={isLight} title={`Members (${detail?.members.length ?? 0})`}>
                <div data-testid="world-team-members" className="flex flex-col gap-2">
                  {(detail?.members ?? []).map((m) => (
                    <div key={m.id} className={rowCls}>
                      <div className="flex items-center gap-3">
                        {roleIcon(m.role)}
                        <div>
                          <p className={`text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                            {m.email}
                          </p>
                          <p className={`text-xs capitalize ${subCls}`}>
                            {m.role}
                            {m.status === "invited" ? " · invite pending" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {detail && canChangeRoles(myRole, m) ? (
                          <select
                            aria-label="Member role"
                            value={m.role}
                            disabled={busy === `role-${m.id}`}
                            onChange={(e) => void handleRoleChange(m.id, e.target.value)}
                            className={selectCls}
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : null}
                        {detail && canRemoveMember(myRole, m) ? (
                          <button
                            type="button"
                            className={
                              confirmRemoveId === m.id
                                ? "rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-bold text-red-300"
                                : "rounded-lg px-2 py-1.5 text-red-400/70 transition hover:text-red-300"
                            }
                            disabled={busy === `remove-${m.id}`}
                            onClick={() => void handleRemove(m.id)}
                            aria-label={`Remove ${m.email} from the team`}
                          >
                            {confirmRemoveId === m.id ? (
                              "Tap again to remove"
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </NativeCard>

              {/* Spending — a failed load shows its note in place of
                  the section, exactly like the page (never a silent
                  vanish, never dressed up as "spent nothing") */}
              {iAmAdmin && spendingFailed && spending.length === 0 ? (
                <NativeCard isLight={isLight} title="Pool spending">
                  <div data-testid="world-team-spending-error">
                    <p className="text-sm text-red-300">
                      Team spending couldn&rsquo;t load — it isn&rsquo;t hidden, it
                      just didn&rsquo;t arrive.
                    </p>
                    <button
                      type="button"
                      className={`${goldBtn} mt-3`}
                      onClick={() => void loadSpending(team.id)}
                    >
                      Try again
                    </button>
                  </div>
                </NativeCard>
              ) : iAmAdmin && spending.length > 0 ? (
                <NativeCard isLight={isLight} title="Pool spending">
                  <div data-testid="world-team-spending" className="flex flex-col gap-1.5">
                    {spending.map((s, i) => (
                      <div key={i} className={rowCls}>
                        <span className={`text-sm ${isLight ? "text-[#2a1e07]" : "text-white/70"}`}>
                          {s.email ?? s.userId.slice(0, 8)} ·{" "}
                          <span className={subCls}>{s.action}</span>
                        </span>
                        <span className="text-sm font-bold text-[#C9A84C]">
                          {s.total.toLocaleString()} cr
                        </span>
                      </div>
                    ))}
                  </div>
                </NativeCard>
              ) : null}

              {/* Group public profile — the team's public half,
                  managed where the team itself is managed, exactly
                  as the page docks it under the members. */}
              <NativeCard isLight={isLight} title="Group public profile">
                {groupPhase === "loading" ? (
                  <NativeLoadingState isLight={isLight} message="Loading the group's public profile…" />
                ) : groupPhase === "failed" || !groupDto ? (
                  <div data-testid="world-team-group-error">
                    <p className="text-sm text-red-300">
                      The group profile couldn&rsquo;t load — it isn&rsquo;t hidden,
                      it just didn&rsquo;t arrive.
                    </p>
                    <button
                      type="button"
                      className={`${goldBtn} mt-3`}
                      onClick={() => void loadGroup(team.id)}
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <div data-testid="world-team-group">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className={`text-xs ${subCls}`}>
                        One public page and one shared store under the group&rsquo;s
                        name. The split terms written here are published on the page
                        and divide every shared-store sale.
                      </p>
                      {groupDto.group?.isPublished ? (
                        <button
                          type="button"
                          className={ghostBtn}
                          disabled={previewState === "loading"}
                          onClick={() => void handlePreview()}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <Eye className="h-3.5 w-3.5" />
                            {previewState === "loading" ? "Opening…" : "Preview the public page"}
                          </span>
                        </button>
                      ) : (
                        <span className={`text-xs ${subCls}`}>
                          {groupDto.group ? "Draft — not public yet" : "Not set up yet"}
                        </span>
                      )}
                    </div>

                    {previewState === "ready" && preview ? (
                      <div
                        data-testid="world-team-public-preview"
                        className={`mt-3 rounded-lg px-4 py-3 ${isLight ? "bg-black/[0.03]" : "bg-white/[0.04]"}`}
                      >
                        <p className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                          {preview.group.displayName}
                        </p>
                        <p className={`text-xs ${subCls}`}>@{preview.group.slug}</p>
                        {preview.group.bio ? (
                          <p className={`mt-2 text-sm ${isLight ? "text-[#2a1e07]" : "text-white/70"}`}>
                            {preview.group.bio}
                          </p>
                        ) : null}
                        {splitTermRows(preview.group.splitTerms, preview.members).length > 0 ? (
                          <div className="mt-2 flex flex-col gap-1">
                            {splitTermRows(preview.group.splitTerms, preview.members).map((r) => (
                              <p key={r.userId} className={`text-xs ${subCls}`}>
                                {r.displayName} — {r.sharePct}%
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {preview.products.length > 0 ? (
                          <p className={`mt-2 text-xs ${subCls}`}>
                            {preview.products.length} product
                            {preview.products.length === 1 ? "" : "s"} in the shared store
                          </p>
                        ) : null}
                      </div>
                    ) : previewState === "missing" ? (
                      <p className={`mt-3 text-sm ${subCls}`}>
                        The public page isn&rsquo;t answering yet — it may still be
                        switching on.
                      </p>
                    ) : previewState === "failed" ? (
                      <p className="mt-3 text-sm text-red-300">
                        The public page couldn&rsquo;t load — try the preview again.
                      </p>
                    ) : null}

                    {!canManageGroup ? (
                      <div className={`mt-4 text-sm ${isLight ? "text-[#2a1e07]" : "text-white/60"}`}>
                        {groupDto.group ? (
                          <>
                            <p className="font-semibold">{groupDto.group.displayName}</p>
                            <p className="mt-1">
                              Handle: @{groupDto.group.slug} ·{" "}
                              {groupDto.group.isPublished ? "Published" : "Draft"}
                            </p>
                            <p className="mt-2">
                              Only the team&rsquo;s owner and admins can change the
                              public profile.
                            </p>
                          </>
                        ) : (
                          <p>The team&rsquo;s owner and admins set up the public profile here.</p>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className={labelCls} htmlFor="world-team-gp-name">Group name</label>
                            <input
                              id="world-team-gp-name"
                              className={`${deskInputCls(isLight)} mt-1`}
                              value={gName}
                              maxLength={120}
                              onChange={(e) => setGName(e.target.value)}
                              placeholder="e.g. Crown Duo"
                            />
                          </div>
                          <div>
                            <label className={labelCls} htmlFor="world-team-gp-slug">
                              Public handle — bowdownvisuals.com/group/…
                            </label>
                            <input
                              id="world-team-gp-slug"
                              className={`${deskInputCls(isLight)} mt-1`}
                              value={gSlug}
                              maxLength={64}
                              onChange={(e) => setGSlug(e.target.value)}
                              placeholder="crown-duo"
                            />
                            <p className={`mt-1 text-xs ${subCls}`}>
                              3–64 characters: lowercase letters, numbers and dashes,
                              starting and ending with a letter or number.
                            </p>
                          </div>
                          <div className="sm:col-span-2">
                            <label className={labelCls} htmlFor="world-team-gp-bio">Bio</label>
                            <textarea
                              id="world-team-gp-bio"
                              className={`${deskInputCls(isLight)} mt-1`}
                              value={gBio}
                              maxLength={2000}
                              rows={3}
                              onChange={(e) => setGBio(e.target.value)}
                              placeholder="Who the group is, in the group's own words."
                            />
                          </div>
                          <div>
                            <label className={labelCls} htmlFor="world-team-gp-avatar">Avatar image URL</label>
                            <input
                              id="world-team-gp-avatar"
                              className={`${deskInputCls(isLight)} mt-1`}
                              value={gAvatar}
                              onChange={(e) => setGAvatar(e.target.value)}
                              placeholder="https://…"
                            />
                          </div>
                          <div>
                            <label className={labelCls} htmlFor="world-team-gp-banner">Banner image URL</label>
                            <input
                              id="world-team-gp-banner"
                              className={`${deskInputCls(isLight)} mt-1`}
                              value={gBanner}
                              onChange={(e) => setGBanner(e.target.value)}
                              placeholder="https://…"
                            />
                          </div>
                        </div>

                        {/* Written split terms — one share per credited member */}
                        <div className="mt-5">
                          <p className={labelCls}>Split terms — % of each shared-store sale</p>
                          <div className="mt-2 flex flex-col gap-2">
                            {groupDto.members.map((m) => (
                              <div key={m.userId} className={rowCls}>
                                <span className="min-w-0">
                                  <span className={`block truncate text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                                    {m.displayName}
                                  </span>
                                  <span className={`block text-xs capitalize ${subCls}`}>{m.role}</span>
                                </span>
                                <span className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step="0.01"
                                    value={gShares[m.userId] ?? ""}
                                    onChange={(e) =>
                                      setGShares((prev) => ({ ...prev, [m.userId]: e.target.value }))
                                    }
                                    className={`${deskInputCls(isLight)} w-24`}
                                    placeholder="—"
                                    aria-label={`Share for ${m.displayName}`}
                                  />
                                  <span className={`text-sm ${subCls}`}>%</span>
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className={`mt-2 text-xs ${subCls}`}>
                            Leave every share blank for no written terms. When shares
                            are set they must total exactly 100%, and the team owner
                            must hold one.
                          </p>
                        </div>

                        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                          <label className={`flex cursor-pointer items-center gap-2 text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                            <input
                              type="checkbox"
                              checked={gPublished}
                              onChange={(e) => setGPublished(e.target.checked)}
                              className="h-4 w-4 accent-[#C9A84C]"
                            />
                            Publish the public page
                          </label>
                          <button
                            type="button"
                            className={goldBtn}
                            disabled={busy === "group-save"}
                            onClick={() => void handleGroupSave()}
                          >
                            {groupDto.group ? "Save group profile" : "Create group profile"}
                          </button>
                        </div>

                        {/* Shared store */}
                        {groupDto.group ? (
                          <div className={`mt-6 border-t pt-5 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                            <h3 className={`text-sm font-bold uppercase tracking-wider ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                              Shared store
                            </h3>
                            {groupDto.products.length > 0 ? (
                              <div className="mt-3 flex flex-col gap-1.5">
                                {groupDto.products.map((p) => (
                                  <div key={p.id} className={rowCls}>
                                    <span className={`text-sm font-semibold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                                      {p.title}
                                    </span>
                                    <span className={`text-sm ${subCls}`}>
                                      {groupKindLabel(p.kind)} ·{" "}
                                      <span className="font-bold text-[#C9A84C]">
                                        {formatGroupPrice(p.priceCents)}
                                      </span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className={`mt-2 text-sm ${subCls}`}>
                                Nothing in the shared store yet.
                              </p>
                            )}
                            <div
                              data-testid="world-team-group-product"
                              className="mt-4 flex flex-wrap items-end gap-2"
                            >
                              <div>
                                <label className={labelCls} htmlFor="world-team-gp-kind">Kind</label>
                                <select
                                  id="world-team-gp-kind"
                                  value={pKind}
                                  onChange={(e) => setPKind(e.target.value)}
                                  className={`${selectCls} mt-1`}
                                >
                                  {GROUP_PRODUCT_KINDS.map((k) => (
                                    <option key={k} value={k}>{groupKindLabel(k)}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="min-w-[180px] flex-1">
                                <label className={labelCls} htmlFor="world-team-gp-ptitle">Title</label>
                                <input
                                  id="world-team-gp-ptitle"
                                  className={`${deskInputCls(isLight)} mt-1`}
                                  value={pTitle}
                                  maxLength={200}
                                  onChange={(e) => setPTitle(e.target.value)}
                                  placeholder="Product title"
                                />
                              </div>
                              <div>
                                <label className={labelCls} htmlFor="world-team-gp-price">Price ($)</label>
                                <input
                                  id="world-team-gp-price"
                                  className={`${deskInputCls(isLight)} mt-1 w-28`}
                                  value={pPrice}
                                  inputMode="decimal"
                                  onChange={(e) => setPPrice(e.target.value)}
                                  placeholder="5.00"
                                />
                              </div>
                              <button
                                type="button"
                                className={ghostBtn}
                                disabled={busy === "group-product" || !pTitle.trim()}
                                onClick={() => void handleAddProduct()}
                              >
                                <span className="inline-flex items-center gap-1.5">
                                  {busy === "group-product" ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <PackagePlus className="h-4 w-4" />
                                  )}
                                  Add product
                                </span>
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </NativeCard>

              {/* Danger zone */}
              <NativeCard isLight={isLight} title="Team">
                <div data-testid="world-team-danger" className="flex flex-wrap gap-3">
                  {!iAmOwner ? (
                    <button
                      type="button"
                      className={
                        confirmLeave
                          ? "rounded-xl bg-red-500/20 px-4 py-2 text-sm font-bold text-red-300"
                          : ghostBtn
                      }
                      disabled={busy === "leave"}
                      onClick={() => void handleLeave()}
                    >
                      <span className="inline-flex items-center gap-2">
                        <LogOut className="h-4 w-4" />
                        {confirmLeave ? `Tap again to leave ${team.name}` : "Leave team"}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={
                        confirmDelete
                          ? "rounded-xl bg-red-500/20 px-4 py-2 text-sm font-bold text-red-300"
                          : "rounded-xl border border-red-400/30 px-4 py-2 text-sm font-bold text-red-400/80 transition hover:text-red-300 disabled:opacity-50"
                      }
                      disabled={busy === "delete"}
                      onClick={() => void handleDelete()}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Trash2 className="h-4 w-4" />
                        {confirmDelete ? `Tap again to delete ${team.name}` : "Delete team"}
                      </span>
                    </button>
                  )}
                </div>
                <p className={`mt-3 text-xs ${subCls}`}>{TEAM_SHARED_VAULTS_NOTE}</p>
              </NativeCard>
            </>
          )}
        </>
      )}
    </div>
  );
}
