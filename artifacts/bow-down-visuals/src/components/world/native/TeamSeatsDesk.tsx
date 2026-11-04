import { useEffect, useState } from "react";
import {
  Check, Copy, Loader2, MailWarning, ShieldCheck, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { NativeCard } from "@/components/world/native/NativeCard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native/NativeStates";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  TEAM_SEATS_ACCEPT_PATH,
  TEAM_SEATS_INVITE_PATH,
  TEAM_SEATS_PATH,
  TEAM_SEAT_ASSIGNABLE_ROLES,
  TEAM_SEAT_PERMISSIONS,
  TEAM_SEAT_PERMISSION_ROWS,
  TEAM_SEAT_ROLE_LABELS,
  TEAM_SEAT_ROLE_ORDER,
  buildTeamSeatAcceptBody,
  buildTeamSeatInviteBody,
  buildTeamSeatRoleBody,
  canChangeTeamSeatRole,
  canRevokeTeamSeat,
  extractTeamSeatInviteToken,
  parseTeamSeatAcceptResult,
  parseTeamSeatInviteResult,
  parseTeamSeatResult,
  parseTeamSeatsList,
  teamSeatInviteReady,
  teamSeatPath,
  teamSeatRevokeLabel,
  teamSeatStatusLabel,
  TEAM_SEATS_ACCEPTED_ALREADY,
  TEAM_SEATS_ACCEPTED_DESC,
  TEAM_SEATS_ACCEPTED_TITLE,
  TEAM_SEATS_AUTH_GAP_NOTE,
  TEAM_SEATS_COPIED,
  TEAM_SEATS_COPY_FAILED,
  TEAM_SEATS_COPY_LINK,
  TEAM_SEATS_EMAIL_PLACEHOLDER,
  TEAM_SEATS_EMPTY,
  TEAM_SEATS_FREE_BADGE,
  TEAM_SEATS_INVITE_BUTTON,
  TEAM_SEATS_INVITE_HEADING,
  TEAM_SEATS_LOAD_ERROR,
  TEAM_SEATS_LOADING,
  TEAM_SEATS_MATRIX_HEADING,
  TEAM_SEATS_NAME_PLACEHOLDER,
  TEAM_SEATS_NO_EMAIL_NOTE,
  TEAM_SEATS_ROLE_LABEL,
  TEAM_SEATS_SUBTITLE,
  type TeamSeat,
  type TeamSeatAssignableRole,
  type TeamSeatsList,
} from "@/lib/world/team-seats-desk";

/* ─── Team Seats, in-world (stack1500 world parity, wave 4a follow-on) ──
   The Settings team-seats surface native at the My Studio board, on
   the seats router's own rails — the same endpoints
   components/TeamSeats.tsx calls from pages/settings.tsx: the
   permission matrix, invite by email (the rail returns the invite
   link every time; it is shown here for copying, with the rail's
   own email verdict), accept a pasted invite link in-desk, role
   changes, and revoke / cancel — plus the memberOf half of the list
   read (seats held on other accounts), which the 2D component
   doesn't render, shown read-only.

   PRICE: FREE, like the 2D surface — no registry row exists for
   /api/team-seats and no money rail rides this surface, so nothing
   here reaches for the confirmed-spend seam.

   COMPOSITION AT JOIN: this desk stacks in the My Studio board
   directly after the wave-4a TeamDesk (stack1500/parity-team),
   which mounts at the same anchor on its own branch — the Team
   Workspace (pool family) first, then Team Seats (the Settings
   family), the two halves of the website's team story side by side.

   Every seats rail is requireAuth — members only, exactly the 2D
   surface's boundary (Settings sits behind the site's sign-in
   gate); a failed read reads as failed with a retry, never as
   "no seats". Revokes are two-tap, spoken in-world — the house
   pattern for destructive verbs. */

const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

function roleBadgeCls(isLight: boolean, role: string): string {
  switch (role) {
    case "owner":
      return isLight
        ? "border-[#7A5A12]/40 bg-[#d4af37]/15 text-[#7A5A12]"
        : "border-[#d4af37]/50 bg-[#d4af37]/15 text-[#e8c86a]";
    case "manager":
      return isLight
        ? "border-amber-600/40 bg-amber-500/10 text-amber-700"
        : "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "collaborator":
      return isLight
        ? "border-[#7A5A12]/25 bg-black/5 text-[#6B5B36]"
        : "border-white/20 bg-white/5 text-white/70";
    default:
      return isLight
        ? "border-[#7A5A12]/15 bg-black/[0.03] text-[#6B5B36]/70"
        : "border-white/10 bg-white/[0.03] text-white/40";
  }
}

export function TeamSeatsDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const errCls = isLight ? "text-[#8a2f1b]" : "text-red-300";

  const [list, setList] = useState<TeamSeatsList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /* Invite */
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<TeamSeatAssignableRole>("collaborator");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteEmailNote, setInviteEmailNote] = useState("");
  const [inviteEmailSent, setInviteEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  /* Accept */
  const [acceptInput, setAcceptInput] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptNote, setAcceptNote] = useState<string | null>(null);

  /* Seat actions */
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [armedRevokeId, setArmedRevokeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    (async () => {
      try {
        const res = await fetch(TEAM_SEATS_PATH, { headers: await authHeaders() });
        if (!res.ok) throw new Error(`team seats ${res.status}`);
        const parsed = parseTeamSeatsList(await res.json());
        if (!parsed) throw new Error("team seats shape");
        if (!cancelled) setList(parsed);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  async function invite() {
    if (!teamSeatInviteReady(email, role) || inviting) return;
    setInviting(true);
    setError(null);
    setNote(null);
    setInviteLink(null);
    setCopied(false);
    setCopyFailed(false);
    try {
      const res = await fetch(TEAM_SEATS_INVITE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildTeamSeatInviteBody(email, name, role)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't create the invite (${res.status})`));
      const made = parseTeamSeatInviteResult(data);
      if (!made) throw new Error("invite shape");
      setList((prev) =>
        prev ? { ...prev, seats: [made.seat, ...prev.seats] } : prev,
      );
      setInviteLink(made.inviteLink);
      setInviteEmailNote(made.emailNote);
      setInviteEmailSent(made.emailSent);
      setEmail("");
      setName("");
    } catch (err) {
      setError(plainErrorText(err, "Couldn't create the invite — try again."));
    } finally {
      setInviting(false);
    }
  }

  function copyLink() {
    if (!inviteLink) return;
    setCopyFailed(false);
    try {
      void navigator.clipboard.writeText(inviteLink).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        },
        () => setCopyFailed(true),
      );
    } catch {
      setCopyFailed(true);
    }
  }

  async function accept() {
    const token = extractTeamSeatInviteToken(acceptInput);
    if (!token || accepting) return;
    setAccepting(true);
    setError(null);
    setAcceptNote(null);
    try {
      const res = await fetch(TEAM_SEATS_ACCEPT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildTeamSeatAcceptBody(token)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't accept the invite (${res.status})`));
      const result = parseTeamSeatAcceptResult(data);
      if (!result) throw new Error("accept shape");
      setAcceptNote(
        `${TEAM_SEATS_ACCEPTED_TITLE} — ${
          result.alreadyActive ? TEAM_SEATS_ACCEPTED_ALREADY : TEAM_SEATS_ACCEPTED_DESC
        }`,
      );
      setAcceptInput("");
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Couldn't accept the invite — try again."));
    } finally {
      setAccepting(false);
    }
  }

  async function changeRole(seat: TeamSeat, next: string) {
    if (!canChangeTeamSeatRole(seat)) return;
    if (next !== "manager" && next !== "collaborator" && next !== "viewer") return;
    setChangingRoleId(seat.id);
    setError(null);
    try {
      const res = await fetch(teamSeatPath(seat.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildTeamSeatRoleBody(next)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, `Couldn't change the role (${res.status})`));
      const updated = parseTeamSeatResult(data);
      if (!updated) throw new Error("role shape");
      setList((prev) =>
        prev
          ? { ...prev, seats: prev.seats.map((s) => (s.id === seat.id ? updated : s)) }
          : prev,
      );
    } catch (err) {
      setError(plainErrorText(err, "Couldn't change the role — try again."));
    } finally {
      setChangingRoleId(null);
    }
  }

  async function revoke(seat: TeamSeat) {
    if (!canRevokeTeamSeat(seat) || revokingId) return;
    if (armedRevokeId !== seat.id) {
      setArmedRevokeId(seat.id);
      return;
    }
    setRevokingId(seat.id);
    setError(null);
    try {
      const res = await fetch(teamSeatPath(seat.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(apiErrorMessage(data, `Couldn't revoke the seat (${res.status})`));
      }
      setArmedRevokeId(null);
      setTick((t) => t + 1);
    } catch (err) {
      setError(plainErrorText(err, "Couldn't revoke — try again."));
    } finally {
      setRevokingId(null);
    }
  }

  const seats = list?.seats ?? [];
  const memberOf = list?.memberOf ?? [];

  return (
    <NativeCard isLight={isLight} title="Team Seats — roles for collaborators & managers">
      <div data-testid="world-team-seats" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-[#d4af37]" />
          <p className={`text-sm ${muted}`}>{TEAM_SEATS_SUBTITLE}</p>
          <span
            className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
              isLight
                ? "border-[#7A5A12]/40 bg-[#d4af37]/10 text-[#7A5A12]"
                : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"
            }`}
          >
            {TEAM_SEATS_FREE_BADGE}
          </span>
        </div>

        {error ? (
          <p data-testid="world-team-seats-error" className={`text-sm font-semibold ${errCls}`}>
            {error}
          </p>
        ) : null}
        {note ? <p className={`text-sm ${muted}`}>{note}</p> : null}

        {list === null && !loadFailed ? (
          <NativeLoadingState isLight={isLight} message={TEAM_SEATS_LOADING} />
        ) : loadFailed ? (
          <NativeErrorState
            isLight={isLight}
            message={TEAM_SEATS_LOAD_ERROR}
            onRetry={() => setTick((t) => t + 1)}
          />
        ) : (
          <>
            {/* Permission matrix — the schema's table, the page's words */}
            <div data-testid="world-team-seats-matrix">
              <p className={`mb-2 text-xs font-bold uppercase tracking-[0.12em] ${muted}`}>
                {TEAM_SEATS_MATRIX_HEADING}
              </p>
              <div
                className={`overflow-x-auto rounded-xl border ${
                  isLight ? "border-[#C9A84C]/30" : "border-white/10"
                }`}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className={isLight ? "bg-[#d4af37]/[0.08] text-left" : "bg-[#d4af37]/[0.06] text-left"}>
                      <th className={`px-3 py-2 font-semibold ${muted}`}>{TEAM_SEATS_MATRIX_HEADING}</th>
                      {TEAM_SEAT_ROLE_ORDER.map((r) => (
                        <th key={r} className="px-3 py-2 text-center font-semibold whitespace-nowrap">
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${roleBadgeCls(isLight, r)}`}>
                            {TEAM_SEAT_ROLE_LABELS[r]}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TEAM_SEAT_PERMISSION_ROWS.map((row) => (
                      <tr
                        key={row.key}
                        className={`border-t ${isLight ? "border-[#7A5A12]/10" : "border-white/[0.06]"}`}
                      >
                        <td className={`px-3 py-2 ${isLight ? "text-[#2a1e07]/80" : "text-white/70"}`}>
                          {row.label}
                        </td>
                        {TEAM_SEAT_ROLE_ORDER.map((r) => (
                          <td key={r} className="px-3 py-2 text-center">
                            {TEAM_SEAT_PERMISSIONS[r][row.key] ? (
                              <Check className="inline h-4 w-4 text-[#d4af37]" />
                            ) : (
                              <X
                                className={`inline h-4 w-4 ${
                                  isLight ? "text-[#6B5B36]/30" : "text-white/20"
                                }`}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Invite */}
            <div
              data-testid="world-team-seats-invite"
              className={`rounded-xl border p-3 ${
                isLight ? "border-[#C9A84C]/40 bg-[#d4af37]/[0.05]" : "border-[#d4af37]/25 bg-[#d4af37]/[0.05]"
              }`}
            >
              <p className={`mb-2 inline-flex items-center gap-1.5 text-sm font-semibold ${strong}`}>
                <UserPlus className="h-4 w-4 text-[#d4af37]" /> {TEAM_SEATS_INVITE_HEADING}
              </p>
              <div className="flex flex-col gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={TEAM_SEATS_EMAIL_PLACEHOLDER}
                  className={deskInputCls(isLight)}
                  aria-label={TEAM_SEATS_EMAIL_PLACEHOLDER}
                />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={TEAM_SEATS_NAME_PLACEHOLDER}
                  maxLength={80}
                  className={deskInputCls(isLight)}
                  aria-label={TEAM_SEATS_NAME_PLACEHOLDER}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className={`text-xs font-bold ${muted}`} htmlFor="world-team-seats-role">
                    {TEAM_SEATS_ROLE_LABEL}
                  </label>
                  <select
                    id="world-team-seats-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as TeamSeatAssignableRole)}
                    className={`rounded-full border px-2.5 py-1 text-xs bdv-touch-target ${roleBadgeCls(isLight, role)} ${
                      isLight ? "bg-white/60" : "bg-black/40"
                    }`}
                  >
                    {TEAM_SEAT_ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {TEAM_SEAT_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void invite()}
                    disabled={inviting || !teamSeatInviteReady(email, role)}
                    className={`${goldBtn} ml-auto`}
                  >
                    {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {TEAM_SEATS_INVITE_BUTTON}
                  </button>
                </div>
              </div>

              {inviteLink ? (
                <div
                  data-testid="world-team-seats-invite-link"
                  className={`mt-3 rounded-lg border p-3 ${
                    isLight ? "border-[#C9A84C]/40 bg-white/60" : "border-[#d4af37]/30 bg-black/40"
                  }`}
                >
                  <p className={`flex items-start gap-2 text-xs ${isLight ? "text-amber-700" : "text-amber-200/90"}`}>
                    <MailWarning className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{inviteEmailNote || (inviteEmailSent ? "" : TEAM_SEATS_NO_EMAIL_NOTE)}</span>
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code
                      className={`min-w-0 flex-1 truncate rounded px-2 py-1.5 text-[11px] ${
                        isLight ? "bg-black/[0.05] text-[#2a1e07]/80" : "bg-black/60 text-white/70"
                      }`}
                    >
                      {inviteLink}
                    </code>
                    <button type="button" onClick={copyLink} className={chipBtn(isLight)}>
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? TEAM_SEATS_COPIED : TEAM_SEATS_COPY_LINK}
                    </button>
                  </div>
                  {copyFailed ? <p className={`mt-1 text-xs ${errCls}`}>{TEAM_SEATS_COPY_FAILED}</p> : null}
                </div>
              ) : null}
            </div>

            {/* Accept an invite in-desk */}
            <div data-testid="world-team-seats-accept" className="flex flex-col gap-2">
              <p className={`text-xs font-bold uppercase tracking-[0.12em] ${muted}`}>
                {TEAM_SEATS_ACCEPTED_TITLE}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={acceptInput}
                  onChange={(e) => setAcceptInput(e.target.value)}
                  placeholder="Paste an invite link"
                  className={`${deskInputCls(isLight)} min-w-0 flex-1`}
                  aria-label="Paste an invite link"
                />
                <button
                  type="button"
                  onClick={() => void accept()}
                  disabled={accepting || extractTeamSeatInviteToken(acceptInput) === ""}
                  className={chipBtn(isLight)}
                >
                  {accepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Accept invite
                </button>
              </div>
              {acceptNote ? <p className={`text-sm ${muted}`}>{acceptNote}</p> : null}
            </div>

            {/* My seats */}
            <div data-testid="world-team-seats-list" className="flex flex-col gap-2">
              {seats.length === 0 ? (
                <NativeEmptyState isLight={isLight} message={TEAM_SEATS_EMPTY} />
              ) : (
                seats.map((seat) => (
                  <div
                    key={seat.id}
                    className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                      isLight ? "border-[#C9A84C]/25 bg-white/40" : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-semibold ${strong}`}>
                        {seat.displayName || seat.email}
                      </p>
                      {seat.displayName ? (
                        <p className={`truncate text-xs ${muted}`}>{seat.email}</p>
                      ) : null}
                      <p className={`mt-0.5 text-xs ${muted}`}>{teamSeatStatusLabel(seat.status)}</p>
                    </div>
                    {canChangeTeamSeatRole(seat) ? (
                      <select
                        value={seat.role}
                        disabled={changingRoleId === seat.id}
                        onChange={(e) => void changeRole(seat, e.target.value)}
                        className={`rounded-full border px-2.5 py-1 text-xs bdv-touch-target ${roleBadgeCls(isLight, seat.role)} ${
                          isLight ? "bg-white/60" : "bg-black/40"
                        }`}
                        aria-label={TEAM_SEATS_ROLE_LABEL}
                      >
                        {TEAM_SEAT_ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {TEAM_SEAT_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`rounded-full border px-2.5 py-1 text-xs ${roleBadgeCls(isLight, seat.role)}`}>
                        {TEAM_SEAT_ROLE_LABELS[seat.role]}
                      </span>
                    )}
                    {canRevokeTeamSeat(seat) ? (
                      <button
                        type="button"
                        onClick={() => void revoke(seat)}
                        disabled={revokingId === seat.id}
                        className={`${chipBtn(isLight)} ${
                          armedRevokeId === seat.id
                            ? isLight
                              ? "border-red-400/60 text-red-700"
                              : "border-red-400/50 text-red-300"
                            : ""
                        }`}
                      >
                        {revokingId === seat.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        {armedRevokeId === seat.id
                          ? `${teamSeatRevokeLabel(seat)}? Tap again`
                          : teamSeatRevokeLabel(seat)}
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {/* Seats I hold on other accounts — the rail's memberOf
                half, read-only: the account owner manages them. */}
            {memberOf.length > 0 ? (
              <div data-testid="world-team-seats-memberof" className="flex flex-col gap-2">
                <p className={`text-xs font-bold uppercase tracking-[0.12em] ${muted}`}>
                  Teams you&apos;re on
                </p>
                {memberOf.map((seat) => (
                  <div
                    key={seat.id}
                    className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${
                      isLight ? "border-[#C9A84C]/25 bg-white/40" : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-semibold ${strong}`}>{seat.email}</p>
                      <p className={`mt-0.5 text-xs ${muted}`}>{teamSeatStatusLabel(seat.status)}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${roleBadgeCls(isLight, seat.role)}`}>
                      {TEAM_SEAT_ROLE_LABELS[seat.role]}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div
              className={`flex items-start gap-2 rounded-xl border p-3 text-xs ${
                isLight
                  ? "border-[#7A5A12]/15 bg-black/[0.02] text-[#6B5B36]"
                  : "border-white/[0.07] bg-white/[0.02] text-white/40"
              }`}
            >
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#d4af37]/70" />
              <span>{TEAM_SEATS_AUTH_GAP_NOTE}</span>
            </div>
          </>
        )}
      </div>
    </NativeCard>
  );
}
