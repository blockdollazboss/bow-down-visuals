import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Camera, Check, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "@/components/world/native/NativeStates";
import { normalizeVaultCharacters, type VaultCharacter } from "@/lib/world/characters";
import {
  ARTIST_VAULTS_PATH,
  IDENTITY_ANGLES,
  IDENTITY_EXPRESSIONS,
  IDENTITY_PHOTO_SOURCES,
  buildIdentityAddPayload,
  buildIdentityRelabelPayload,
  buildIdentitySelectPayload,
  identityAddReady,
  identityAngleLabel,
  identityExpressionLabel,
  identityPhotoPath,
  identityPhotosCost,
  identityPhotosPath,
  identitySelectPath,
  identitySelectionOfResponse,
  identitySetOfResponse,
  type IdentityAddDraft,
  type IdentityPhoto,
  type IdentityRelabelDraft,
  type IdentitySelectionView,
  type IdentitySetView,
  type IdentityShotDraft,
} from "@/lib/world/identity-sets-desk";

/* ─── Identity sets desk — World parity wave #4b, census item 38 ─
   A vault character's identity set (the identity half of
   pages/artist-vault.tsx), native in the My Studio stack on the
   artist-vault identity rails (lib/world/identity-sets-desk
   carries the seam):
   - the vault picker rides the character picker's own vault
     read (normalizeVaultCharacters);
   - the set grid with the rail's labels, the main photo badged
     (it joins every pick), generated photos badged as generated;
   - the coverage checklist in the rail's own words;
   - add / relabel / remove on the member's OWN characters only
     — the manage rails are strict-owner; a team-shared character
     reads + picks here and says why it can't be edited;
   - pick-for-a-shot: describe the shot, the rail picks by label
     fit and SAYS WHY; any pool photo can override with one tap,
     and the rail refuses an override that isn't in the set.
   The whole desk is free (the registry's cost-0 pattern row).
   Members only — every rail is requireAuth. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getAccessToken]);
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

const EMPTY_ADD: IdentityAddDraft = { imageUrl: "", angle: "front", expression: "neutral", wardrobe: "", source: "upload" };
const EMPTY_SHOT: IdentityShotDraft = { cameraMovement: "", promptText: "", actionText: "", mood: "", wardrobeHint: "" };

/* The rail's angle/expression labels render from the catalog;
   the seam's label tables stay the fallback for any value the
   rail sends that the catalog has no word for. */
const ANGLE_LABEL_KEYS: Record<string, string> = {
  front: "worldCreatorRooms.identityAngleFront",
  three_quarter_left: "worldCreatorRooms.identityAngleThreeQuarterLeft",
  three_quarter_right: "worldCreatorRooms.identityAngleThreeQuarterRight",
  left_profile: "worldCreatorRooms.identityAngleLeftProfile",
  right_profile: "worldCreatorRooms.identityAngleRightProfile",
  back: "worldCreatorRooms.identityAngleBack",
  full_body: "worldCreatorRooms.identityAngleFullBody",
  close_up: "worldCreatorRooms.identityAngleCloseUp",
};
const EXPRESSION_LABEL_KEYS: Record<string, string> = {
  neutral: "worldCreatorRooms.identityExprNeutral",
  smile: "worldCreatorRooms.identityExprSmile",
  laughing: "worldCreatorRooms.identityExprLaughing",
  serious: "worldCreatorRooms.identityExprSerious",
  intense: "worldCreatorRooms.identityExprIntense",
  singing: "worldCreatorRooms.identityExprSinging",
  sad: "worldCreatorRooms.identityExprSad",
  surprised: "worldCreatorRooms.identityExprSurprised",
};

function PhotoLabels({ angle, expression, wardrobe, source }: { angle: string; expression: string; wardrobe: string | null; source: string }) {
  const { t } = useTranslation();
  const angleLabel = ANGLE_LABEL_KEYS[angle] ? t(ANGLE_LABEL_KEYS[angle]!) : identityAngleLabel(angle);
  const expressionLabel = EXPRESSION_LABEL_KEYS[expression]
    ? t(EXPRESSION_LABEL_KEYS[expression]!)
    : identityExpressionLabel(expression);
  return (
    <p className="text-[11px] leading-snug opacity-80">
      {angleLabel} · {expressionLabel}
      {wardrobe ? ` · ${wardrobe}` : ""}
      {source === "generated" ? t("worldCreatorRooms.identityGeneratedBadge") : ""}
    </p>
  );
}

export function IdentitySetsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const angleLabel = (a: string): string =>
    ANGLE_LABEL_KEYS[a] ? t(ANGLE_LABEL_KEYS[a]!) : identityAngleLabel(a);
  const expressionLabel = (e: string): string =>
    EXPRESSION_LABEL_KEYS[e] ? t(EXPRESSION_LABEL_KEYS[e]!) : identityExpressionLabel(e);
  const { user } = useAuth();
  const authHeaders = useAuthHeaders();
  const [vaults, setVaults] = useState<VaultCharacter[] | null>(null);
  const [vaultsFailed, setVaultsFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [set, setSet] = useState<IdentitySetView | null>(null);
  const [setFailed, setSetFailed] = useState(false);
  const [addDraft, setAddDraft] = useState<IdentityAddDraft>(EMPTY_ADD);
  const [relabelId, setRelabelId] = useState<string | null>(null);
  const [relabel, setRelabel] = useState<IdentityRelabelDraft>({ angle: "", expression: "", wardrobe: "" });
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [shot, setShot] = useState<IdentityShotDraft>(EMPTY_SHOT);
  const [selection, setSelection] = useState<IdentitySelectionView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const noteCls = `text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`;
  const cardCls = `rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`;

  const selected = vaults?.find((v) => v.id === selectedId) ?? null;

  const loadVaults = useCallback(async () => {
    if (isGuest) return;
    setVaultsFailed(false);
    try {
      const res = await fetch(ARTIST_VAULTS_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("vaults");
      const data = await res.json().catch(() => ({}));
      setVaults(normalizeVaultCharacters(data, user?.id));
    } catch {
      setVaultsFailed(true);
    }
  }, [authHeaders, isGuest, user?.id]);

  const loadSet = useCallback(async (vaultId: string) => {
    setSetFailed(false);
    setSet(null);
    setSelection(null);
    setRelabelId(null);
    setConfirmRemoveId(null);
    try {
      const res = await fetch(identityPhotosPath(vaultId), { headers: await authHeaders() });
      if (!res.ok) throw new Error("set");
      const parsed = identitySetOfResponse(await res.json().catch(() => ({})));
      if (!parsed) throw new Error("set");
      setSet(parsed);
    } catch {
      setSetFailed(true);
    }
  }, [authHeaders]);

  useEffect(() => { void loadVaults(); }, [loadVaults]);
  useEffect(() => { if (selectedId) void loadSet(selectedId); }, [selectedId, loadSet]);

  const runSetOp = async (key: string, fn: () => Promise<void>, okNote: string) => {
    if (busy || !selectedId) return;
    setBusy(key);
    setNote(null);
    try {
      await fn();
      await loadSet(selectedId);
      setNote(okNote);
    } catch (err) {
      setNote(plainErrorText(err, t("worldCreatorRooms.identityOpFallback")));
    } finally {
      setBusy(null);
    }
  };

  const addPhoto = () => {
    if (!selected) return;
    void runSetOp("add", async () => {
      const res = await fetch(identityPhotosPath(selected.id), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(buildIdentityAddPayload(addDraft)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreatorRooms.identityAddFallback")));
      setAddDraft(EMPTY_ADD);
    }, t("worldCreatorRooms.identityAddedNote"));
  };

  const saveRelabel = (photo: IdentityPhoto) => {
    if (!selected) return;
    void runSetOp(`relabel-${photo.id}`, async () => {
      const res = await fetch(identityPhotoPath(selected.id, photo.id), {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify(buildIdentityRelabelPayload(relabel)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreatorRooms.identityRelabelFallback")));
      setRelabelId(null);
    }, t("worldCreatorRooms.identityLabelsSavedNote"));
  };

  const removePhoto = (photo: IdentityPhoto) => {
    if (!selected) return;
    void runSetOp(`remove-${photo.id}`, async () => {
      const res = await fetch(identityPhotoPath(selected.id, photo.id), {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreatorRooms.identityRemoveFallback")));
      setConfirmRemoveId(null);
    }, t("worldCreatorRooms.identityRemovedNote"));
  };

  const pickForShot = (overridePhotoId?: string) => {
    if (!selected || busy) return;
    void (async () => {
      setBusy("select");
      setNote(null);
      try {
        const res = await fetch(identitySelectPath(selected.id), {
          method: "POST",
          headers: await authHeaders(),
          body: JSON.stringify(buildIdentitySelectPayload(shot, overridePhotoId)),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreatorRooms.identityPickFallback")));
        const parsed = identitySelectionOfResponse(data);
        if (!parsed) throw new Error(t("worldCreatorRooms.identityPickFallback"));
        setSelection(parsed);
      } catch (err) {
        setNote(plainErrorText(err, t("worldCreatorRooms.identityPickFallbackRetry")));
      } finally {
        setBusy(null);
      }
    })();
  };

  const setAdd = (patch: Partial<IdentityAddDraft>) => setAddDraft((d) => ({ ...d, ...patch }));
  const setShotField = (patch: Partial<IdentityShotDraft>) => setShot((d) => ({ ...d, ...patch }));

  if (isGuest) {
    return (
      <div className="space-y-2" data-testid="world-identity-sets-desk">
        <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
          <Camera className="h-4 w-4 text-[#d4af37]" /> {t("worldCreatorRooms.identityTitle")}
        </p>
        <p className={`text-sm ${muted}`}>
          {t("worldCreatorRooms.identityGuestIntro")}
        </p>
      </div>
    );
  }

  const atCap = set !== null && set.photos.length >= set.maxPhotos;

  return (
    <div className="space-y-3" data-testid="world-identity-sets-desk">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <Camera className="h-4 w-4 text-[#d4af37]" /> {t("worldCreatorRooms.identityTitle")}
      </p>
      <p className={`text-sm ${muted}`}>
        {t("worldCreatorRooms.identityIntro")}
        {" "}
        {t("worldCreatorRooms.identityFreeLine", { cost: identityPhotosCost() })}
      </p>

      {vaultsFailed ? (
        <NativeErrorState
          isLight={isLight}
          title={t("worldCreatorRooms.identityVaultsFailedTitle")}
          message={t("worldCreatorRooms.identityVaultsFailedMessage")}
          onRetry={() => void loadVaults()}
        />
      ) : vaults === null ? (
        <NativeLoadingState isLight={isLight} message={t("worldCreatorRooms.identityLoadingCharacters")} />
      ) : vaults.length === 0 ? (
        <NativeEmptyState
          isLight={isLight}
          message={t("worldCreatorRooms.identityNoCharacters")}
          detail={t("worldCreatorRooms.identityNoCharactersDetail")}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2" data-testid="world-identity-sets-picker">
            {vaults.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                data-testid={`world-identity-sets-vault-${v.id}`}
                aria-pressed={selectedId === v.id}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
                  selectedId === v.id
                    ? "border-[#d4af37] bg-[#d4af37] text-black"
                    : isLight
                      ? "border-[#7A5A12]/30 text-[#6B5B36]"
                      : "border-white/15 text-white/75"
                }`}
              >
                {v.portraitUrl ? (
                  <img src={v.portraitUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : null}
                {v.name}
                {!v.isOwn ? <span className="opacity-70">{t("worldCreatorRooms.identitySharedSuffix")}</span> : null}
              </button>
            ))}
          </div>

          {selected ? (
            setFailed ? (
              <NativeErrorState
                isLight={isLight}
                title={t("worldCreatorRooms.identitySetFailedTitle")}
                message={t("worldCreatorRooms.identitySetFailedMessage")}
                onRetry={() => void loadSet(selected.id)}
              />
            ) : set === null ? (
              <NativeLoadingState isLight={isLight} message={t("worldCreatorRooms.identityLoadingSet", { name: selected.name })} />
            ) : (
              <>
                {!selected.isOwn ? (
                  <p className={`text-sm ${muted}`} data-testid="world-identity-sets-shared-note">
                    {t("worldCreatorRooms.identitySharedNote")}
                  </p>
                ) : null}

                {/* Coverage — the rail's own checklist + words. */}
                <div className={cardCls} data-testid="world-identity-sets-coverage">
                  <p className={`text-sm font-bold ${strong}`}>
                    {t("worldCreatorRooms.identityCoverageTitle", { count: set.photos.length, max: set.maxPhotos })}
                  </p>
                  {set.coverageSummary ? <p className={`mt-0.5 text-sm ${muted}`}>{set.coverageSummary}</p> : null}
                  <div className="mt-2 space-y-1.5">
                    {set.coverage.map((item) => (
                      <div key={item.key} className="flex items-start gap-2 text-sm">
                        {item.covered ? (
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        ) : (
                          <X className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        )}
                        <span className={item.covered ? strong : muted}>
                          {item.label}
                          {!item.covered && item.missingMessage ? (
                            <span className="block text-xs">{item.missingMessage}</span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* The set grid. */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="world-identity-sets-grid">
                  {set.mainPhotoUrl ? (
                    <div className={`overflow-hidden rounded-2xl border ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
                      <img src={set.mainPhotoUrl} alt={t("worldCreatorRooms.identityMainAlt", { name: selected.name })} className="aspect-square w-full object-cover" />
                      <div className="px-2.5 py-2">
                        <p className={`text-xs font-bold ${strong}`}>{t("worldCreatorRooms.identityMainPhoto")}</p>
                        <p className={`text-[11px] ${muted}`}>{t("worldCreatorRooms.identityMainPhotoNote")}</p>
                      </div>
                    </div>
                  ) : null}
                  {set.photos.map((photo) => (
                    <div key={photo.id} className={`overflow-hidden rounded-2xl border ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`} data-testid={`world-identity-sets-photo-${photo.id}`}>
                      <img src={photo.imageUrl} alt={t("worldCreatorRooms.identityPhotoAlt", { name: selected.name, angle: angleLabel(photo.angle) })} className="aspect-square w-full object-cover" />
                      <div className="px-2.5 py-2">
                        <div className={strong}>
                          <PhotoLabels angle={photo.angle} expression={photo.expression} wardrobe={photo.wardrobe} source={photo.source} />
                        </div>
                        {selected.isOwn ? (
                          relabelId === photo.id ? (
                            <div className="mt-2 space-y-1.5" data-testid="world-identity-sets-relabel">
                              <select value={relabel.angle} onChange={(e) => setRelabel((r) => ({ ...r, angle: e.target.value }))} className={inputCls(isLight)} aria-label={t("worldCreatorRooms.identityAngleAria")}>
                                {IDENTITY_ANGLES.map((a) => (
                                  <option key={a} value={a}>{angleLabel(a)}</option>
                                ))}
                              </select>
                              <select value={relabel.expression} onChange={(e) => setRelabel((r) => ({ ...r, expression: e.target.value }))} className={inputCls(isLight)} aria-label={t("worldCreatorRooms.identityExpressionAria")}>
                                {IDENTITY_EXPRESSIONS.map((e2) => (
                                  <option key={e2} value={e2}>{expressionLabel(e2)}</option>
                                ))}
                              </select>
                              <input value={relabel.wardrobe} onChange={(e) => setRelabel((r) => ({ ...r, wardrobe: e.target.value }))} maxLength={120} className={inputCls(isLight)} aria-label={t("worldCreatorRooms.identityWardrobeAria")} placeholder={t("worldCreatorRooms.identityWardrobePlaceholder")} />
                              <div className="flex gap-1.5">
                                <button type="button" className={goldBtn} disabled={busy !== null} onClick={() => saveRelabel(photo)} data-testid="world-identity-sets-relabel-save">
                                  {busy === `relabel-${photo.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t("worldCreatorRooms.identitySave")}
                                </button>
                                <button type="button" className={chipBtn(isLight)} onClick={() => setRelabelId(null)}>{t("worldCreatorRooms.identityCancel")}</button>
                              </div>
                            </div>
                          ) : confirmRemoveId === photo.id ? (
                            <div className="mt-2 space-y-1.5">
                              <p className={`text-[11px] ${muted}`}>{t("worldCreatorRooms.identityRemoveCopy")}</p>
                              <div className="flex gap-1.5">
                                <button type="button" className={goldBtn} disabled={busy !== null} onClick={() => removePhoto(photo)} data-testid="world-identity-sets-remove-confirm">
                                  {busy === `remove-${photo.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t("worldCreatorRooms.identityRemoveIt")}
                                </button>
                                <button type="button" className={chipBtn(isLight)} onClick={() => setConfirmRemoveId(null)}>{t("worldCreatorRooms.identityKeepIt")}</button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 flex gap-1.5">
                              <button
                                type="button"
                                className={chipBtn(isLight)}
                                onClick={() => {
                                  setRelabelId(photo.id);
                                  setRelabel({ angle: photo.angle, expression: photo.expression, wardrobe: photo.wardrobe ?? "" });
                                }}
                                data-testid={`world-identity-sets-relabel-btn-${photo.id}`}
                              >
                                <Pencil className="h-3 w-3" /> {t("worldCreatorRooms.identityRelabel")}
                              </button>
                              <button type="button" className={chipBtn(isLight)} onClick={() => setConfirmRemoveId(photo.id)} data-testid={`world-identity-sets-remove-btn-${photo.id}`}>
                                <Trash2 className="h-3 w-3" /> {t("worldCreatorRooms.identityRemove")}
                              </button>
                            </div>
                          )
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                {set.photos.length === 0 && !set.mainPhotoUrl ? (
                  <NativeEmptyState
                    isLight={isLight}
                    message={t("worldCreatorRooms.identityNoPhotos")}
                    detail={t("worldCreatorRooms.identityNoPhotosDetail")}
                  />
                ) : null}

                {/* Add a photo — owner only, capped honestly. */}
                {selected.isOwn ? (
                  <div className={cardCls} data-testid="world-identity-sets-add">
                    <p className={`text-sm font-bold ${strong}`}>{t("worldCreatorRooms.identityAddTitle")}</p>
                    {atCap ? (
                      <p className={`mt-1 text-sm ${muted}`}>
                        {t("worldCreatorRooms.identitySetFull", { max: set.maxPhotos })}
                      </p>
                    ) : (
                      <>
                        <input value={addDraft.imageUrl} onChange={(e) => setAdd({ imageUrl: e.target.value })} className={`${inputCls(isLight)} mt-2`} placeholder={t("worldCreatorRooms.identityPhotoLinkPlaceholder")} aria-label={t("worldCreatorRooms.identityPhotoLinkAria")} data-testid="world-identity-sets-add-url" />
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <select value={addDraft.angle} onChange={(e) => setAdd({ angle: e.target.value })} className={inputCls(isLight)} aria-label={t("worldCreatorRooms.identityAngleAria")}>
                            {IDENTITY_ANGLES.map((a) => (
                              <option key={a} value={a}>{angleLabel(a)}</option>
                            ))}
                          </select>
                          <select value={addDraft.expression} onChange={(e) => setAdd({ expression: e.target.value })} className={inputCls(isLight)} aria-label={t("worldCreatorRooms.identityExpressionAria")}>
                            {IDENTITY_EXPRESSIONS.map((e2) => (
                              <option key={e2} value={e2}>{expressionLabel(e2)}</option>
                            ))}
                          </select>
                          <input value={addDraft.wardrobe} onChange={(e) => setAdd({ wardrobe: e.target.value })} maxLength={120} className={inputCls(isLight)} placeholder={t("worldCreatorRooms.identityWardrobeOptionalPlaceholder")} aria-label={t("worldCreatorRooms.identityWardrobeAria")} />
                          <select value={addDraft.source} onChange={(e) => setAdd({ source: e.target.value })} className={inputCls(isLight)} aria-label={t("worldCreatorRooms.identitySourceAria")}>
                            {IDENTITY_PHOTO_SOURCES.map((src) => (
                              <option key={src} value={src}>{src === "generated" ? t("worldCreatorRooms.identitySourceGenerated") : t("worldCreatorRooms.identitySourceUploaded")}</option>
                            ))}
                          </select>
                        </div>
                        <p className={`mt-1.5 text-xs ${muted}`}>
                          {t("worldCreatorRooms.identitySaveNote")}
                          {addDraft.source === "generated" ? t("worldCreatorRooms.identityGeneratedNote") : ""}
                        </p>
                        <button type="button" className={`${goldBtn} mt-2`} disabled={busy !== null || !identityAddReady(addDraft)} onClick={addPhoto} data-testid="world-identity-sets-add-btn">
                          {busy === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t("worldCreatorRooms.identityAddButton")}
                        </button>
                      </>
                    )}
                  </div>
                ) : null}

                {/* Pick for a shot — the explainable selection. */}
                <div className={cardCls} data-testid="world-identity-sets-pick">
                  <p className={`inline-flex items-center gap-2 text-sm font-bold ${strong}`}>
                    <Sparkles className="h-4 w-4 text-[#d4af37]" /> {t("worldCreatorRooms.identityPickTitle")}
                  </p>
                  <p className={`mt-1 text-sm ${muted}`}>
                    {t("worldCreatorRooms.identityPickIntro")}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input value={shot.cameraMovement} onChange={(e) => setShotField({ cameraMovement: e.target.value })} maxLength={500} className={inputCls(isLight)} placeholder={t("worldCreatorRooms.identityCameraPlaceholder")} aria-label={t("worldCreatorRooms.identityCameraAria")} />
                    <input value={shot.mood} onChange={(e) => setShotField({ mood: e.target.value })} maxLength={200} className={inputCls(isLight)} placeholder={t("worldCreatorRooms.identityMoodPlaceholder")} aria-label={t("worldCreatorRooms.identityMoodAria")} />
                    <input value={shot.actionText} onChange={(e) => setShotField({ actionText: e.target.value })} maxLength={2000} className={inputCls(isLight)} placeholder={t("worldCreatorRooms.identityActionPlaceholder")} aria-label={t("worldCreatorRooms.identityActionAria")} />
                    <input value={shot.wardrobeHint} onChange={(e) => setShotField({ wardrobeHint: e.target.value })} maxLength={120} className={inputCls(isLight)} placeholder={t("worldCreatorRooms.identityWardrobeHintPlaceholder")} aria-label={t("worldCreatorRooms.identityWardrobeHintAria")} />
                  </div>
                  <textarea value={shot.promptText} onChange={(e) => setShotField({ promptText: e.target.value })} maxLength={5000} rows={2} className={`${inputCls(isLight)} mt-2`} placeholder={t("worldCreatorRooms.identityPromptPlaceholder")} aria-label={t("worldCreatorRooms.identityPromptAria")} />
                  <button type="button" className={`${goldBtn} mt-2`} disabled={busy !== null} onClick={() => pickForShot()} data-testid="world-identity-sets-pick-btn">
                    {busy === "select" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {t("worldCreatorRooms.identityPickButton")}
                  </button>

                  {selection ? (
                    <div className="mt-3 space-y-2" data-testid="world-identity-sets-selection">
                      {selection.chosen ? (
                        <div className="flex items-start gap-3">
                          <img src={selection.chosen.imageUrl} alt={t("worldCreatorRooms.identityPickedAlt")} className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                          <div className="min-w-0">
                            <p className={`text-sm font-bold ${strong}`}>
                              {selection.overridden ? t("worldCreatorRooms.identityYourPick") : t("worldCreatorRooms.identityBestMatch")}
                              {selection.chosen.isMain ? t("worldCreatorRooms.identityMainSuffix") : ""}
                            </p>
                            <div className={strong}>
                              <PhotoLabels angle={selection.chosen.angle} expression={selection.chosen.expression} wardrobe={selection.chosen.wardrobe} source={selection.chosen.source} />
                            </div>
                            <p className={`mt-1 text-sm ${muted}`}>{selection.reason}</p>
                          </div>
                        </div>
                      ) : (
                        <p className={`text-sm ${muted}`}>{selection.reason}</p>
                      )}
                      {selection.pool.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {selection.pool.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              disabled={busy !== null || selection.chosen?.id === c.id}
                              onClick={() => pickForShot(c.id)}
                              className={chipBtn(isLight)}
                              data-testid={`world-identity-sets-override-${c.id}`}
                              title={`${angleLabel(c.angle)} · ${expressionLabel(c.expression)}${c.score !== null ? t("worldCreatorRooms.identityMatchSuffix", { score: c.score }) : ""}`}
                            >
                              <img src={c.imageUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                              {c.isMain ? t("worldCreatorRooms.identityMainChip") : angleLabel(c.angle)}
                              {c.score !== null ? ` · ${c.score}` : ""}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <p className={`text-xs ${muted}`}>{t("worldCreatorRooms.identityOverrideNote")}</p>
                    </div>
                  ) : null}
                </div>

                {note ? <p className={noteCls} data-testid="world-identity-sets-note">{note}</p> : null}
              </>
            )
          ) : (
            <p className={`text-sm ${muted}`}>{t("worldCreatorRooms.identityPickCharacterPrompt")}</p>
          )}
        </>
      )}
    </div>
  );
}
