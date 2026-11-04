import { plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
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
  type SuccessionStrings,
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
  const { t } = useTranslation();
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

  const successionStrings: SuccessionStrings = {
    problemHeirEmpty: t("worldIdentityMisc.sucProblemHeirEmpty"),
    problemHeirShape: t("worldIdentityMisc.sucProblemHeirShape"),
    problemInstructionsCap: t("worldIdentityMisc.sucProblemInstructionsCap"),
    problemNameEmpty: t("worldIdentityMisc.sucProblemNameEmpty"),
    problemNameCap: t("worldIdentityMisc.sucProblemNameCap"),
    problemEmailEmpty: t("worldIdentityMisc.sucProblemEmailEmpty"),
    problemEmailShape: t("worldIdentityMisc.sucProblemEmailShape"),
    problemNoteCap: t("worldIdentityMisc.sucProblemNoteCap"),
    designationNone: t("worldIdentityMisc.sucDesigNone"),
    designationCurrent: t("worldIdentityMisc.sucDesigCurrent"),
  };

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
    const problem = designationProblem(heir, instructions, successionStrings);
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
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldIdentityMisc.sucErrorSave")));
      if (!parseLegacyDesignationAnswer(data)) throw new Error(t("worldIdentityMisc.sucErrorSave"));
      setDesNote(t("worldIdentityMisc.sucNoteSaved"));
      await loadDesignation();
    } catch (e) {
      setDesError(plainErrorText(e, t("worldIdentityMisc.sucErrorSave")));
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
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldIdentityMisc.sucErrorRemove")));
      setDesNote(t("worldIdentityMisc.sucNoteRemoved"));
      setHeir("");
      setInstructions("");
      await loadDesignation();
    } catch (e) {
      setDesError(plainErrorText(e, t("worldIdentityMisc.sucErrorRemove")));
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
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldIdentityMisc.sucErrorRespond")));
      setDesNote(response === "accept" ? t("worldIdentityMisc.sucNoteAccepted") : t("worldIdentityMisc.sucNoteDeclined"));
      await loadDesignation();
    } catch (e) {
      setDesError(plainErrorText(e, t("worldIdentityMisc.sucErrorRespond")));
    } finally { setDesBusy(null); }
  };

  const saveContact = async () => {
    if (contactBusy) return;
    const problem = legacyContactProblem(cName, cEmail, cNote, successionStrings);
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
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldIdentityMisc.sucContactErrorSave")));
      setContactNote(t("worldIdentityMisc.sucContactNoteSaved"));
      await loadContact();
    } catch (e) {
      setContactError(plainErrorText(e, t("worldIdentityMisc.sucContactErrorSave")));
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
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldIdentityMisc.sucContactErrorRemove")));
      setContactNote(t("worldIdentityMisc.sucContactNoteRemoved"));
      setConfirmingRemove(false);
      setCName("");
      setCEmail("");
      setCNoteText("");
      await loadContact();
    } catch (e) {
      setContactError(plainErrorText(e, t("worldIdentityMisc.sucContactErrorRemove")));
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
      <NativeCard isLight={isLight} title={t("worldIdentityMisc.sucTitle")}>
        <div data-testid="world-succession-desk">
          <p className={`text-xs ${muted}`}>
            {t("worldIdentityMisc.sucIntroA")}
            <strong>{t("worldIdentityMisc.sucIntroStrong")}</strong>
            {t("worldIdentityMisc.sucIntroB")}
          </p>
          {stateFailed ? (
            <p className={`mt-2 text-xs ${muted}`}>
              {t("worldIdentityMisc.sucLoadFailed")}{" "}
              <button type="button" data-testid="world-succession-retry" onClick={() => void loadDesignation()} className="font-bold text-[#d4af37]">{t("worldIdentityMisc.tryAgain")}</button>
            </p>
          ) : state === null ? (
            <p className={`mt-2 inline-flex items-center gap-2 text-xs ${muted}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> {t("worldIdentityMisc.sucReading")}
            </p>
          ) : (
            <>
              <p className={`mt-2 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                {legacyDesignationLine(state, successionStrings)}
              </p>
              {state.includes.length > 0 && (
                <p className={`mt-1 text-[11px] ${muted}`}>{t("worldIdentityMisc.sucCovers", { list: state.includes.join(t("worldIdentityMisc.sucJoinAnd")) })}</p>
              )}
              {state.excludes.length > 0 && (
                <p className={`mt-0.5 text-[11px] ${muted}`}>{t("worldIdentityMisc.sucNeverCovers", { list: state.excludes.join(", ") })}</p>
              )}
              <div className="mt-3 grid gap-2">
                <input aria-label={t("worldIdentityMisc.sucHeirLabel")} value={heir}
                  onChange={(e) => setHeir(e.target.value)}
                  placeholder={t("worldIdentityMisc.sucHeirPlaceholder")}
                  className={inputCls} />
                <textarea aria-label={t("worldIdentityMisc.sucInstructionsLabel")} value={instructions} rows={3}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder={t("worldIdentityMisc.sucInstructionsPlaceholder")}
                  className={inputCls} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" data-testid="world-succession-save" disabled={desBusy !== null || !heir.trim()}
                    onClick={() => void saveDesignation()} className={chip(true)}>
                    {desBusy === "save" ? t("worldIdentityMisc.saving") : t("worldIdentityMisc.sucSave")}
                  </button>
                  {standing && (
                    <button type="button" data-testid="world-succession-remove" disabled={desBusy !== null}
                      onClick={() => void revokeDesignation()} className={chip(false)}>
                      {desBusy === "revoke" ? t("worldIdentityMisc.removing") : t("worldIdentityMisc.sucRemove")}
                    </button>
                  )}
                </div>
              </div>
              {desNote && <p className={`mt-2 text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>{desNote}</p>}
              {desError && <p className="mt-2 text-xs font-semibold text-red-400">{desError}</p>}

              {inbox !== null && inbox.length > 0 && (
                <div className={`mt-3 border-t pt-3 ${isLight ? "border-[#7A5A12]/15" : "border-white/10"}`}>
                  <p className={`text-[11px] font-bold uppercase tracking-wide ${muted}`}>{t("worldIdentityMisc.sucInboxTitle")}</p>
                  <div className="mt-1.5 space-y-2">
                    {inbox.map((row) => (
                      <div key={row.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className={isLight ? "text-[#2a1e07]" : "text-white/85"}>
                          {t("worldIdentityMisc.sucInboxRow", { userId: row.userId })}<strong>{row.status}</strong>
                        </span>
                        {row.status === "pending" && (
                          <>
                            <button type="button" data-testid="world-succession-accept" disabled={desBusy !== null}
                              onClick={() => void respond(row, "accept")} className={chip(false)}>
                              {desBusy === row.id ? t("worldIdentityMisc.sucWorking") : t("worldIdentityMisc.sucAccept")}
                            </button>
                            <button type="button" data-testid="world-succession-decline" disabled={desBusy !== null}
                              onClick={() => void respond(row, "decline")} className={chip(false)}>
                              {t("worldIdentityMisc.sucDecline")}
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

      <NativeCard isLight={isLight} title={t("worldIdentityMisc.sucContactTitle")}>
        <div data-testid="world-legacy-contact-desk">
          <p className={`text-xs ${muted}`}>
            {t("worldIdentityMisc.sucContactIntroA")}
            <strong>{t("worldIdentityMisc.sucContactIntroStrong")}</strong>
            {t("worldIdentityMisc.sucContactIntroB")}
          </p>
          {contactFailed ? (
            <p className={`mt-2 text-xs ${muted}`}>
              {t("worldIdentityMisc.sucContactLoadFailed")}{" "}
              <button type="button" data-testid="world-legacy-contact-retry" onClick={() => void loadContact()} className="font-bold text-[#d4af37]">{t("worldIdentityMisc.tryAgain")}</button>
            </p>
          ) : !contactLoaded ? (
            <p className={`mt-2 inline-flex items-center gap-2 text-xs ${muted}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> {t("worldIdentityMisc.sucContactReading")}
            </p>
          ) : (
            <>
              {contact ? (
                <p className={`mt-2 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                  {t("worldIdentityMisc.sucContactCurrentPrefix")} <strong>{contact.name}</strong>{t("worldIdentityMisc.sucContactCurrentSuffix", { email: contact.email })}
                </p>
              ) : (
                <p className={`mt-2 text-xs ${muted}`}>{t("worldIdentityMisc.sucContactNone")}</p>
              )}
              <div className="mt-3 grid gap-2">
                <input aria-label={t("worldIdentityMisc.sucContactNameLabel")} value={cName}
                  onChange={(e) => setCName(e.target.value)} placeholder={t("worldIdentityMisc.sucContactNamePlaceholder")} className={inputCls} />
                <input aria-label={t("worldIdentityMisc.sucContactEmailLabel")} value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)} placeholder={t("worldIdentityMisc.sucContactEmailPlaceholder")} className={inputCls} />
                <input aria-label={t("worldIdentityMisc.sucContactNoteLabel")} value={cNote}
                  onChange={(e) => setCNoteText(e.target.value)} placeholder={t("worldIdentityMisc.sucContactNotePlaceholder")} className={inputCls} />
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" data-testid="world-legacy-contact-save" disabled={contactBusy || !cName.trim() || !cEmail.trim()}
                    onClick={() => void saveContact()} className={chip(true)}>
                    {contactBusy && !confirmingRemove ? t("worldIdentityMisc.saving") : t("worldIdentityMisc.sucContactSave")}
                  </button>
                  {contact && !confirmingRemove && (
                    <button type="button" data-testid="world-legacy-contact-remove" disabled={contactBusy}
                      onClick={() => setConfirmingRemove(true)} className={chip(false)}>
                      {t("worldIdentityMisc.sucContactRemove")}
                    </button>
                  )}
                  {contact && confirmingRemove && (
                    <>
                      <span className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
                        {t("worldIdentityMisc.sucContactRemoveAsk", { name: contact.name })}
                      </span>
                      <button type="button" data-testid="world-legacy-contact-remove-confirm" disabled={contactBusy}
                        onClick={() => void removeContact()} className={chip(true)}>
                        {contactBusy ? t("worldIdentityMisc.removing") : t("worldIdentityMisc.sucContactRemoveConfirm")}
                      </button>
                      <button type="button" data-testid="world-legacy-contact-remove-cancel" disabled={contactBusy}
                        onClick={() => setConfirmingRemove(false)} className={chip(false)}>
                        {t("worldIdentityMisc.sucContactKeep")}
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
