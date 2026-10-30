import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import {
  apiErrorLine,
  designationPayload,
  designationProblem,
  legacyContactPath,
  legacyContactPayload,
  legacyContactProblem,
  legacyDesignationLine,
  legacyDesignationPath,
  legacyInboxPath,
  legacyRespondPath,
  legacyRespondPayload,
  parseLegacyContact,
  parseLegacyDesignationAnswer,
  parseLegacyDesignationState,
  parseLegacyInbox,
  type LegacyContact,
  type LegacyDesignation,
  type LegacyDesignationState,
} from "@/lib/world/get-paid-tail";

/* ─── SuccessionDesk — legacy & succession settings, in the
   Get Paid Room (World Parity P3-F). Until now the palace had
   no surface for either rail; the desk is TrustPanels'
   LegacySettings + LegacyContactSettings promoted in-world, on
   the exact routes/trust.ts rails the Settings page uses:
   - The designation: GET/POST/DELETE /api/legacy/designation —
     name the creator account that would take over your catalog
     and your page. Covers catalog + page only (the rail's own
     includes/excludes ride the read and render from it); never
     private messages, never payment rails or payout
     credentials; nothing transfers automatically — activation
     is a manual review, and this desk only records the
     designation and its instructions, like the page.
   - The inbox: GET /api/legacy/inbox + POST
     /api/legacy/inbox/:id/respond — designations naming YOU,
     answered accept/decline in-world while they're pending.
   - The legacy contact: GET/PUT/DELETE /api/legacy/contact —
     any person's name + email the team should contact if you
     no longer can. A different record from the designation: it
     promises no transfer, no payout and no legal effect, and
     the email is private — it never joins a public profile.
   Every write re-reads its rail before the desk believes it.
   The EarningsBoard already pitches guests. */

export function SuccessionDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const [state, setState] = useState<LegacyDesignationState | null>(null);
  const [stateFailed, setStateFailed] = useState(false);
  const [inbox, setInbox] = useState<LegacyDesignation[] | null>(null);
  const [heir, setHeir] = useState("");
  const [instructions, setInstructions] = useState("");
  const [desBusy, setDesBusy] = useState<string | null>(null);
  const [desNote, setDesNote] = useState<string | null>(null);
  const [desError, setDesError] = useState<string | null>(null);

  const [contact, setContact] = useState<LegacyContact | null>(null);
  const [contactLoaded, setContactLoaded] = useState(false);
  const [contactFailed, setContactFailed] = useState(false);
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cNote, setCNoteText] = useState("");
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactNote, setContactNote] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);

  const loadDesignation = useCallback(async () => {
    try {
      const res = await fetch(legacyDesignationPath(), { headers: await authHeaders() });
      if (!res.ok) throw new Error("designation");
      const parsed = parseLegacyDesignationState(await res.json());
      if (!parsed) throw new Error("designation");
      setState(parsed);
      setStateFailed(false);
      if (parsed.designation && parsed.designation.status !== "revoked") {
        setHeir(parsed.designation.heirUserId);
        setInstructions(parsed.designation.instructions);
      }
      const inboxRes = await fetch(legacyInboxPath(), { headers: await authHeaders() });
      if (inboxRes.ok) setInbox(parseLegacyInbox(await inboxRes.json()));
    } catch { setStateFailed(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadContact = useCallback(async () => {
    try {
      const res = await fetch(legacyContactPath(), { headers: await authHeaders() });
      if (!res.ok) throw new Error("contact");
      const parsed = parseLegacyContact(await res.json());
      setContact(parsed);
      setContactFailed(false);
      setContactLoaded(true);
      if (parsed) { setCName(parsed.name); setCEmail(parsed.email); setCNoteText(parsed.note); }
    } catch { setContactFailed(true); setContactLoaded(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadDesignation(); void loadContact(); }, [loadDesignation, loadContact]);

  const saveDesignation = async () => {
    if (desBusy) return;
    const problem = designationProblem(heir, instructions);
    if (problem) { setDesError(problem); setDesNote(null); return; }
    setDesBusy("save");
    setDesError(null);
    setDesNote(null);
    try {
      const res = await fetch(legacyDesignationPath(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(designationPayload(heir, instructions)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Could not save your designation."));
      if (!parseLegacyDesignationAnswer(data)) throw new Error("Could not save your designation.");
      setDesNote("Saved. Your heir sees a pending designation and chooses whether to accept.");
      await loadDesignation();
    } catch (e) {
      setDesError(e instanceof Error ? e.message : "Could not save your designation.");
    } finally { setDesBusy(null); }
  };

  const revokeDesignation = async () => {
    if (desBusy) return;
    setDesBusy("revoke");
    setDesError(null);
    setDesNote(null);
    try {
      const res = await fetch(legacyDesignationPath(), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Could not remove your designation."));
      setDesNote("Designation removed.");
      setHeir("");
      setInstructions("");
      await loadDesignation();
    } catch (e) {
      setDesError(e instanceof Error ? e.message : "Could not remove your designation.");
    } finally { setDesBusy(null); }
  };

  const respond = async (row: LegacyDesignation, response: "accept" | "decline") => {
    if (desBusy) return;
    setDesBusy(row.id);
    setDesError(null);
    setDesNote(null);
    try {
      const res = await fetch(legacyRespondPath(row.id), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(legacyRespondPayload(response)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Could not record your answer."));
      setDesNote(response === "accept" ? "You accepted the designation." : "You declined the designation.");
      await loadDesignation();
    } catch (e) {
      setDesError(e instanceof Error ? e.message : "Could not record your answer.");
    } finally { setDesBusy(null); }
  };

  const saveContact = async () => {
    if (contactBusy) return;
    const problem = legacyContactProblem(cName, cEmail, cNote);
    if (problem) { setContactError(problem); setContactNote(null); return; }
    setContactBusy(true);
    setContactError(null);
    setContactNote(null);
    try {
      const res = await fetch(legacyContactPath(), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(legacyContactPayload(cName, cEmail, cNote)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Could not save your legacy contact."));
      setContactNote("Legacy contact saved.");
      await loadContact();
    } catch (e) {
      setContactError(e instanceof Error ? e.message : "Could not save your legacy contact.");
    } finally { setContactBusy(false); }
  };

  const removeContact = async () => {
    if (contactBusy) return;
    setContactBusy(true);
    setContactError(null);
    setContactNote(null);
    try {
      const res = await fetch(legacyContactPath(), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, "Could not remove your legacy contact."));
      setContactNote("Legacy contact removed.");
      setConfirmingRemove(false);
      setCName("");
      setCEmail("");
      setCNoteText("");
      await loadContact();
    } catch (e) {
      setContactError(e instanceof Error ? e.message : "Could not remove your legacy contact.");
    } finally { setContactBusy(false); }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const inputCls = deskInputCls(isLight);
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-[11px] font-bold transition disabled:opacity-50 bdv-touch-target ${
      active ? "bg-[#d4af37] text-black" : isLight ? "border border-[#7A5A12]/30 text-[#6B5B36]" : "border border-white/15 text-white/75"
    }`;
  const standing = state?.designation && state.designation.status !== "revoked" ? state.designation : null;

  return (
    <div className="space-y-3">
      <NativeCard isLight={isLight} title="Legacy & succession">
        <div data-testid="world-succession-desk">
          <p className={`text-xs ${muted}`}>
            Name the creator who should take over your catalog and your page if you can&rsquo;t. Your heir would
            control your <strong>catalog and page</strong> — never your private messages, and never your payment
            rails or payout credentials. Nothing transfers automatically: activation is a manual review by our
            team, and this desk only records your designation and your instructions.
          </p>
          {stateFailed ? (
            <p className={`mt-2 text-xs ${muted}`}>
              Couldn&rsquo;t load your legacy settings — nothing about them changed.{" "}
              <button type="button" data-testid="world-succession-retry" onClick={() => void loadDesignation()} className="font-bold text-[#d4af37]">Try again</button>
            </p>
          ) : state === null ? (
            <p className={`mt-2 inline-flex items-center gap-2 text-xs ${muted}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Reading your designation…
            </p>
          ) : (
            <>
              <p className={`mt-2 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                {legacyDesignationLine(state)}
              </p>
              {state.includes.length > 0 && (
                <p className={`mt-1 text-[11px] ${muted}`}>Covers: {state.includes.join(" and ")}.</p>
              )}
              {state.excludes.length > 0 && (
                <p className={`mt-0.5 text-[11px] ${muted}`}>Never covers: {state.excludes.join(", ")}.</p>
              )}
              <div className="mt-3 grid gap-2">
                <input aria-label="Heir's account ID" value={heir}
                  onChange={(e) => setHeir(e.target.value)}
                  placeholder="Heir's account ID (ask them for it from their settings)"
                  className={inputCls} />
                <textarea aria-label="Instructions for your heir" value={instructions} rows={3}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Your instructions for your heir (optional)"
                  className={inputCls} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" data-testid="world-succession-save" disabled={desBusy !== null || !heir.trim()}
                    onClick={() => void saveDesignation()} className={chip(true)}>
                    {desBusy === "save" ? "Saving…" : "Save designation"}
                  </button>
                  {standing && (
                    <button type="button" data-testid="world-succession-remove" disabled={desBusy !== null}
                      onClick={() => void revokeDesignation()} className={chip(false)}>
                      {desBusy === "revoke" ? "Removing…" : "Remove designation"}
                    </button>
                  )}
                </div>
              </div>
              {desNote && <p className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>{desNote}</p>}
              {desError && <p className="mt-2 text-xs font-semibold text-red-400">{desError}</p>}

              {inbox !== null && inbox.length > 0 && (
                <div className={`mt-3 border-t pt-3 ${isLight ? "border-[#7A5A12]/15" : "border-white/10"}`}>
                  <p className={`text-[11px] font-bold uppercase tracking-wide ${muted}`}>Designations naming you</p>
                  <div className="mt-1.5 space-y-2">
                    {inbox.map((row) => (
                      <div key={row.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className={isLight ? "text-[#2a1e07]" : "text-white/85"}>
                          Account {row.userId} named you — status: <strong>{row.status}</strong>
                        </span>
                        {row.status === "pending" && (
                          <>
                            <button type="button" data-testid="world-succession-accept" disabled={desBusy !== null}
                              onClick={() => void respond(row, "accept")} className={chip(false)}>
                              {desBusy === row.id ? "Working…" : "Accept"}
                            </button>
                            <button type="button" data-testid="world-succession-decline" disabled={desBusy !== null}
                              onClick={() => void respond(row, "decline")} className={chip(false)}>
                              Decline
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title="Legacy contact">
        <div data-testid="world-legacy-contact-desk">
          <p className={`text-xs ${muted}`}>
            The name and email of any person Bow Down Visuals should contact about your account and your work if
            you no longer can. It does <strong>not</strong> transfer your account, your catalog, or any money,
            and it has no legal effect — and the email stays private, never on any public profile.
          </p>
          {contactFailed ? (
            <p className={`mt-2 text-xs ${muted}`}>
              Couldn&rsquo;t load your legacy contact — it&rsquo;s unchanged.{" "}
              <button type="button" data-testid="world-legacy-contact-retry" onClick={() => void loadContact()} className="font-bold text-[#d4af37]">Try again</button>
            </p>
          ) : !contactLoaded ? (
            <p className={`mt-2 inline-flex items-center gap-2 text-xs ${muted}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Reading your legacy contact…
            </p>
          ) : (
            <>
              {contact ? (
                <p className={`mt-2 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                  Current legacy contact: <strong>{contact.name}</strong> ({contact.email})
                </p>
              ) : (
                <p className={`mt-2 text-xs ${muted}`}>No legacy contact recorded.</p>
              )}
              <div className="mt-3 grid gap-2">
                <input aria-label="Legacy contact name" value={cName}
                  onChange={(e) => setCName(e.target.value)} placeholder="Their name" className={inputCls} />
                <input aria-label="Legacy contact email" value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)} placeholder="Their email" className={inputCls} />
                <input aria-label="Legacy contact note" value={cNote}
                  onChange={(e) => setCNoteText(e.target.value)} placeholder="Note (optional)" className={inputCls} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" data-testid="world-legacy-contact-save" disabled={contactBusy || !cName.trim() || !cEmail.trim()}
                    onClick={() => void saveContact()} className={chip(true)}>
                    {contactBusy && !confirmingRemove ? "Saving…" : "Save legacy contact"}
                  </button>
                  {contact && !confirmingRemove && (
                    <button type="button" data-testid="world-legacy-contact-remove" disabled={contactBusy}
                      onClick={() => setConfirmingRemove(true)} className={chip(false)}>
                      Remove legacy contact
                    </button>
                  )}
                  {contact && confirmingRemove && (
                    <>
                      <span className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                        Remove {contact.name} as your legacy contact?
                      </span>
                      <button type="button" data-testid="world-legacy-contact-remove-confirm" disabled={contactBusy}
                        onClick={() => void removeContact()} className={chip(true)}>
                        {contactBusy ? "Removing…" : "Yes, remove"}
                      </button>
                      <button type="button" data-testid="world-legacy-contact-remove-cancel" disabled={contactBusy}
                        onClick={() => setConfirmingRemove(false)} className={chip(false)}>
                        Keep
                      </button>
                    </>
                  )}
                </div>
              </div>
              {contactNote && <p className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>{contactNote}</p>}
              {contactError && <p className="mt-2 text-xs font-semibold text-red-400">{contactError}</p>}
            </>
          )}
        </div>
      </NativeCard>
    </div>
  );
}
