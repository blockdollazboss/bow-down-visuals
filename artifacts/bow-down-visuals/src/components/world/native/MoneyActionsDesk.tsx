import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import {
  CLAIM_ACTION_LABELS,
  apiErrorLine,
  catalogPermanencePath,
  claimActionPath,
  claimActionPayload,
  claimActionProblem,
  claimActionsFor,
  otherElection,
  parseClaimRows,
  parsePermanenceState,
  permanencePayload,
  releasePermanencePath,
  type ClaimAction,
  type ClaimRow,
  type PermanenceElection,
  type PermanenceState,
} from "@/lib/world/money-desks-2";

/* ─── MoneyActionsDesk — permanence elections + Content-ID claim
   work, in the Get Paid Room (Stack-100 #67). Until now the
   EarningsBoard showed both as READ-ONLY status rows; this desk is
   the management surface, on the exact rails the 2D surfaces use:
   - Permanence: GET /api/distribution/permanence, then PUT
     /api/distribution/permanence/catalog for the catalog-wide
     election and PUT /api/distribution/releases/:id/permanence per
     release — { election } with the server's own enum (permanent |
     standard). The guarantee's covers/excludes copy renders from
     the payload itself, the way TrustPanels' PermanenceSettings
     and the distribute page's ReleasePermanencePanel render it:
     the guarantee is on-platform, and the desk says what it does
     not cover.
   - Claims: GET /api/content-id/claims, then PATCH
     /api/content-id/claims/:id { action, note } with the
     ClaimsPanel's own gating (uploader disputes a pending match;
     owner accepts a pending match; owner resolves a disputed or
     accepted match — and a resolution records its reason, so the
     desk refuses a note-less resolve before the server has to).
   Every write re-reads its rail before the desk believes it — the
   list changes only from server truth. The desk renders inside
   the EarningsBoard, which already pitches guests. */

export function MoneyActionsDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const [permanence, setPermanence] = useState<PermanenceState | null>(null);
  const [permFailed, setPermFailed] = useState(false);
  const [permBusy, setPermBusy] = useState<string | null>(null);
  const [permNote, setPermNote] = useState<string | null>(null);
  const [permError, setPermError] = useState<string | null>(null);

  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [claimsFailed, setClaimsFailed] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [claimBusy, setClaimBusy] = useState<string | null>(null);
  const [claimNote, setClaimNote] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const loadPermanence = useCallback(async () => {
    try {
      const res = await fetch("/api/distribution/permanence", { headers: await authHeaders() });
      if (!res.ok) throw new Error("permanence");
      const parsed = parsePermanenceState(await res.json());
      if (!parsed) throw new Error("permanence");
      setPermanence(parsed);
      setPermFailed(false);
    } catch { setPermFailed(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadClaims = useCallback(async () => {
    try {
      const res = await fetch("/api/content-id/claims", { headers: await authHeaders() });
      if (!res.ok) throw new Error("claims");
      setClaims(parseClaimRows(await res.json()));
      setClaimsFailed(false);
    } catch { setClaimsFailed(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadPermanence(); void loadClaims(); }, [loadPermanence, loadClaims]);

  const chooseCatalog = async (election: PermanenceElection) => {
    if (permBusy) return;
    setPermBusy("catalog");
    setPermNote(null);
    setPermError(null);
    try {
      const res = await fetch(catalogPermanencePath(), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(permanencePayload(election)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Couldn't save the catalog election."));
      setPermNote("Catalog permanence election saved.");
      await loadPermanence();
    } catch (e) {
      setPermError(e instanceof Error ? e.message : "Couldn't save the catalog election.");
    } finally { setPermBusy(null); }
  };

  const chooseRelease = async (releaseId: string, election: PermanenceElection) => {
    if (permBusy) return;
    setPermBusy(releaseId);
    setPermNote(null);
    setPermError(null);
    try {
      const res = await fetch(releasePermanencePath(releaseId), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(permanencePayload(election)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Couldn't save the election."));
      setPermNote("Permanence election recorded for this release.");
      await loadPermanence();
    } catch (e) {
      setPermError(e instanceof Error ? e.message : "Couldn't save the election.");
    } finally { setPermBusy(null); }
  };

  const actOnClaim = async (claim: ClaimRow, action: ClaimAction) => {
    if (claimBusy) return;
    const note = notes[claim.id] ?? "";
    const problem = claimActionProblem(action, note);
    if (problem) { setClaimError(problem); setClaimNote(null); return; }
    setClaimBusy(claim.id);
    setClaimError(null);
    setClaimNote(null);
    try {
      const res = await fetch(claimActionPath(claim.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(claimActionPayload(action, note)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "That action didn't land — the claim is unchanged."));
      setClaimNote(
        action === "dispute" ? "Match disputed — it's recorded, and the owner sees your note."
        : action === "accept" ? "Match accepted."
        : "Claim resolved — the resolution and its reason are on record.",
      );
      await loadClaims();
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "That action didn't land — the claim is unchanged.");
    } finally { setClaimBusy(null); }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const inputCls = deskInputCls(isLight);
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-50 ${
      active ? "bg-[#d4af37] text-black" : isLight ? "border border-[#7A5A12]/30 text-[#6B5B36]" : "border border-white/15 text-white/75"
    }`;

  return (
    <div className="space-y-3">
      <NativeCard isLight={isLight} title="Permanence — your catalog, forever">
        <div data-testid="world-permanence-desk">
          <p className={`text-xs ${muted}`}>
            Permanence says how long your catalog stays. The guarantee is on-platform: your release pages and
            smartlinks stay live, your catalog records stay attached, and no plan lapse takes a release down.
          </p>
          {permFailed ? (
            <p className={`mt-2 text-xs ${muted}`}>
              Couldn&rsquo;t load your permanence settings — your elections are unchanged.{" "}
              <button type="button" data-testid="world-permanence-retry" onClick={() => void loadPermanence()} className="font-bold text-[#d4af37]">Try again</button>
            </p>
          ) : permanence === null ? (
            <p className={`mt-2 inline-flex items-center gap-2 text-xs ${muted}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Reading your elections…
            </p>
          ) : (
            <>
              {permanence.covers.length > 0 && (
                <ul className={`mt-2 list-disc space-y-0.5 pl-5 text-[11px] ${muted}`}>
                  {permanence.covers.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
              {permanence.excludes.length > 0 && (
                <p className={`mt-1 text-[11px] ${muted}`}>It does not cover: {permanence.excludes.join(" ")}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={isLight ? "text-[#2a1e07]" : "text-white/80"}>
                  Whole catalog: <strong>{permanence.catalogElection ?? "no election recorded"}</strong>
                </span>
                <button type="button" data-testid="world-permanence-catalog-permanent" disabled={permBusy !== null}
                  onClick={() => void chooseCatalog("permanent")} className={chip(permanence.catalogElection === "permanent")}>
                  Keep permanently
                </button>
                <button type="button" data-testid="world-permanence-catalog-standard" disabled={permBusy !== null}
                  onClick={() => void chooseCatalog("standard")} className={chip(permanence.catalogElection === "standard")}>
                  Standard
                </button>
                {permBusy === "catalog" && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" />}
              </div>
              {permanence.releases.map((r) => (
                <div key={r.rowId} className={`mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-xs ${isLight ? "border-[#7A5A12]/15" : "border-white/10"}`}>
                  <span className={`flex-1 ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                    {r.title}: <strong>{r.election}</strong>
                  </span>
                  <button type="button" data-testid="world-permanence-release-toggle" disabled={permBusy !== null}
                    onClick={() => void chooseRelease(r.releaseId, otherElection(r.election))} className={chip(false)}>
                    {permBusy === r.releaseId ? "Saving…" : r.election === "permanent" ? "Switch to standard" : "Keep permanently"}
                  </button>
                </div>
              ))}
              {permanence.releases.length === 0 && (
                <p className={`mt-2 text-[11px] ${muted}`}>No per-release elections yet — the catalog election above covers everything until a release gets its own.</p>
              )}
              {permNote && <p className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>{permNote}</p>}
              {permError && <p className="mt-2 text-xs font-semibold text-red-400">{permError}</p>}
            </>
          )}
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title="Content-ID matches & claims">
        <div data-testid="world-claims-desk">
          <p className={`inline-flex items-start gap-1.5 text-xs ${muted}`}>
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
            Fingerprint matches found when audio is uploaded, with the evidence both sides see. Either side&rsquo;s
            claim carries the same weight; a match moves no money until it&rsquo;s resolved, and every resolution
            records its reason.
          </p>
          {claimsFailed ? (
            <p className={`mt-2 text-xs ${muted}`}>
              Couldn&rsquo;t load your matches &amp; claims — nothing about them changed.{" "}
              <button type="button" data-testid="world-claims-retry" onClick={() => void loadClaims()} className="font-bold text-[#d4af37]">Retry</button>
            </p>
          ) : claims === null ? (
            <p className={`mt-2 inline-flex items-center gap-2 text-xs ${muted}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Reading your claims…
            </p>
          ) : claims.length === 0 ? (
            <p className={`mt-2 text-xs ${muted}`}>No matches recorded yet. Matches are made when audio is scanned at upload — your catalog is clear.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {claims.map((claim) => {
                const actions = claimActionsFor(claim);
                return (
                  <div key={claim.id} className={`rounded-xl border px-3 py-2.5 text-xs ${isLight ? "border-[#7A5A12]/25" : "border-white/10"}`}>
                    <p className={`flex flex-wrap items-baseline justify-between gap-2 ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                      <span><strong>{claim.label}</strong> — you are the {claim.youAre || "—"}</span>
                      <span className="font-bold">{claim.status}</span>
                    </p>
                    {claim.detail && <p className={`mt-0.5 ${muted}`}>{claim.detail}</p>}
                    {claim.disputeNote && <p className={`mt-0.5 ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>Dispute: {claim.disputeNote}</p>}
                    {claim.resolutionNote && <p className={`mt-0.5 ${isLight ? "text-[#2a1e07]" : "text-white/75"}`}>Resolution: {claim.resolutionNote}</p>}
                    {actions.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <input aria-label="Claim note" value={notes[claim.id] ?? ""}
                          onChange={(e) => setNotes((n) => ({ ...n, [claim.id]: e.target.value }))}
                          placeholder="Note (required to resolve; recorded for review)"
                          className={`${inputCls} min-w-44 flex-1`} />
                        {actions.map((action) => (
                          <button key={action} type="button" data-testid={`world-claim-action-${action}`}
                            disabled={claimBusy !== null}
                            onClick={() => void actOnClaim(claim, action)} className={chip(false)}>
                            {claimBusy === claim.id ? "Working…" : CLAIM_ACTION_LABELS[action]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {claimNote && <p className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>{claimNote}</p>}
          {claimError && <p className="mt-2 text-xs font-semibold text-red-400">{claimError}</p>}
        </div>
      </NativeCard>
    </div>
  );
}
