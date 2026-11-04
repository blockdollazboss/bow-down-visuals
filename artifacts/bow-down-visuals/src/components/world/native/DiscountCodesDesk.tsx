/**
 * DiscountCodesDesk — the shop stand's native Discount Codes
 * desk (stack1500 world parity wave #3, census item 45).
 *
 * Run your storefront's discount codes from the stand:
 * create a code (percent off, a use limit, an expiry),
 * switch one off or back on, retire one for good. Codes are
 * profile-wide — they apply to every active product in your
 * shop, exactly as the rail itself says.
 *
 * Everything is free; the desk rides plain authed fetches
 * and re-reads the list after every action. A duplicate code
 * answers with the rail's own words. Deleting is two taps —
 * the button arms first. Mounted beside the Store Growth
 * desk inside the shop stand, members only.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import {
  DISCOUNTS_PATH,
  buildDiscountPayload,
  discountCodeState,
  discountCodesOf,
  discountPath,
  discountUsageLine,
  type DiscountCode,
  type DiscountCodeState,
  type DiscountForm,
} from "@/lib/world/discounts-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

const EMPTY_FORM: DiscountForm = { code: "", percentOff: "", maxUses: "", expiresDate: "" };

/** Rail state → catalog key (the seam's DISCOUNT_STATE_LABELS
 *  remain its English defaults). */
const DISCOUNT_STATE_KEYS: Record<DiscountCodeState, string> = {
  live: "worldCommerceStands.discountsStateLive",
  inactive: "worldCommerceStands.discountsStateInactive",
  expired: "worldCommerceStands.discountsStateExpired",
  "used-up": "worldCommerceStands.discountsStateUsedUp",
};

export function DiscountCodesDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  const deskHeaders = useDeskAuthHeaders();
  const [codes, setCodes] = useState<DiscountCode[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [noProfile, setNoProfile] = useState(false);
  const [form, setForm] = useState<DiscountForm>(EMPTY_FORM);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const inputCls = `w-full rounded-lg border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/70 text-[#3D2E0A] placeholder:text-[#6B5B36]/60"
      : "border-white/15 bg-black/30 text-white placeholder:text-white/35"
  }`;
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const goldBtn =
    "bdv-touch-target rounded-lg bg-[#d4af37] px-4 py-2 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50";
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;

  const load = useCallback(async () => {
    try {
      const headers = await deskHeaders();
      const res = await fetch(DISCOUNTS_PATH, { headers });
      const data: unknown = await res.json().catch(() => ({}));
      if (res.status === 404 && (data as { error?: string })?.error === "NO_PROFILE") {
        setNoProfile(true);
        setCodes([]);
        setLoadFailed(false);
        return;
      }
      if (!res.ok) throw new Error("load failed");
      const parsed = discountCodesOf(data);
      if (!parsed) throw new Error("load failed");
      setCodes(parsed);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [deskHeaders]);

  useEffect(() => {
    if (!isGuest) void load();
  }, [load, isGuest]);

  if (isGuest) return null;

  async function send(method: string, path: string, body?: unknown): Promise<unknown> {
    const headers = await deskHeaders();
    const res = await fetch(path, {
      method,
      headers: body !== undefined ? { ...headers, "Content-Type": "application/json" } : headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.discountsErrorFallback")));
    return data;
  }

  async function run(key: string, action: () => Promise<unknown>, okNotice?: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      if (okNotice) setNotice(okNotice);
    } catch (e) {
      setError(plainErrorText(e, t("worldCommerceStands.discountsErrorFallback")));
    } finally {
      setBusy(null);
    }
  }

  const create = () => {
    const payload = buildDiscountPayload(form);
    if (!payload) {
      setError(t("worldCommerceStands.discountsCheckCode"));
      return;
    }
    void run(
      "create",
      async () => {
        await send("POST", DISCOUNTS_PATH, payload);
        setForm(EMPTY_FORM);
      },
      t("worldCommerceStands.discountsCreatedNotice"),
    );
  };

  const toggle = (code: DiscountCode) =>
    void run(`toggle-${code.id}`, () =>
      send("PATCH", discountPath(code.id), { isActive: !code.isActive }),
    );

  const remove = (code: DiscountCode) => {
    if (confirmDeleteId !== code.id) {
      setConfirmDeleteId(code.id);
      return;
    }
    setConfirmDeleteId(null);
    void run(`delete-${code.id}`, () => send("DELETE", discountPath(code.id)), t("worldCommerceStands.discountsDeletedNotice"));
  };

  const set = (patch: Partial<DiscountForm>) => setForm((f) => ({ ...f, ...patch }));

  if (loadFailed) {
    return (
      <div className="space-y-3" data-testid="world-discounts-desk">
        <p className={`text-base font-black ${strong}`}>{t("worldCommerceStands.discountsTitle")}</p>
        <p className={errCls} data-testid="world-discounts-desk-failed">
          {t("worldCommerceStands.discountsLoadFailed")}
        </p>
        <button type="button" className={chipCls(false)} onClick={() => void load()}>
          {t("worldCommerceStands.discountsTryAgain")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="world-discounts-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>{t("worldCommerceStands.discountsTitle")}</p>
        <p className={`text-xs ${muted}`}>
          {t("worldCommerceStands.discountsSubtitle")}
        </p>
      </div>
      {notice ? (
        <p className={`text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{notice}</p>
      ) : null}
      {error ? <p className={errCls}>{error}</p> : null}

      {noProfile ? (
        <p className={`text-sm ${muted}`} data-testid="world-discounts-desk-noprofile">
          {t("worldCommerceStands.discountsNoProfile")}
        </p>
      ) : codes === null ? (
        <p className={`text-sm ${muted}`}>{t("worldCommerceStands.discountsLoading")}</p>
      ) : (
        <>
          {codes.length === 0 ? (
            <p className={`text-sm ${muted}`}>{t("worldCommerceStands.discountsEmpty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {codes.map((code) => {
                const state = discountCodeState(code);
                return (
                  <li key={code.id} className={`rounded-xl border px-3 py-2 ${cardCls}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-mono text-sm font-black ${strong}`}>{code.code}</span>
                      <span className={chipCls(state === "live")}>
                        {t("worldCommerceStands.discountsOffChip", { percent: code.percentOff, state: t(DISCOUNT_STATE_KEYS[state]) })}
                      </span>
                      <span className={`text-xs ${muted}`}>{discountUsageLine(code, { ofLimit: t("worldCommerceStands.discountsUsageOf"), noLimit: t("worldCommerceStands.discountsUsageNoLimit") })}</span>
                      <span className="ml-auto flex gap-1.5">
                        <button
                          type="button"
                          data-testid={`world-discounts-desk-toggle-${code.id}`}
                          className={chipCls(false)}
                          disabled={busy !== null}
                          onClick={() => toggle(code)}
                        >
                          {code.isActive ? t("worldCommerceStands.discountsSwitchOff") : t("worldCommerceStands.discountsSwitchOn")}
                        </button>
                        <button
                          type="button"
                          data-testid={`world-discounts-desk-delete-${code.id}`}
                          className={chipCls(confirmDeleteId === code.id)}
                          disabled={busy !== null}
                          onClick={() => remove(code)}
                        >
                          {confirmDeleteId === code.id ? t("worldCommerceStands.discountsDeleteConfirm") : t("worldCommerceStands.discountsDelete")}
                        </button>
                      </span>
                    </div>
                    <p className={`mt-1 text-xs ${muted}`}>
                      {code.appliesTo ? `${t("worldCommerceStands.discountsAppliesTo", { target: code.appliesTo })} ` : ""}
                      {code.expiresAt
                        ? t("worldCommerceStands.discountsExpires", { date: new Date(code.expiresAt).toLocaleDateString(i18n.language) })
                        : t("worldCommerceStands.discountsNoExpiry")}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          <section className={`rounded-xl border p-3 ${cardCls}`}>
            <p className={`text-sm font-bold ${strong}`}>{t("worldCommerceStands.discountsNewCode")}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className={`text-xs ${muted}`}>
                {t("worldCommerceStands.discountsCodeLabel")}
                <input
                  className={`${inputCls} mt-1 font-mono uppercase`}
                  data-testid="world-discounts-desk-code"
                  placeholder="CROWN20"
                  maxLength={40}
                  value={form.code}
                  onChange={(e) => set({ code: e.target.value })}
                />
              </label>
              <label className={`text-xs ${muted}`}>
                {t("worldCommerceStands.discountsPercentLabel")}
                <input
                  className={`${inputCls} mt-1`}
                  data-testid="world-discounts-desk-percent"
                  inputMode="numeric"
                  placeholder="20"
                  value={form.percentOff}
                  onChange={(e) => set({ percentOff: e.target.value })}
                />
              </label>
              <label className={`text-xs ${muted}`}>
                {t("worldCommerceStands.discountsUseLimitLabel")}
                <input
                  className={`${inputCls} mt-1`}
                  inputMode="numeric"
                  placeholder={t("worldCommerceStands.discountsNoLimitPlaceholder")}
                  value={form.maxUses}
                  onChange={(e) => set({ maxUses: e.target.value })}
                />
              </label>
              <label className={`text-xs ${muted}`}>
                {t("worldCommerceStands.discountsExpiresLabel")}
                <input
                  className={`${inputCls} mt-1`}
                  type="date"
                  value={form.expiresDate}
                  onChange={(e) => set({ expiresDate: e.target.value })}
                />
              </label>
            </div>
            <button
              type="button"
              data-testid="world-discounts-desk-create"
              className={`mt-2 ${goldBtn}`}
              disabled={busy !== null}
              onClick={create}
            >
              {busy === "create" ? t("worldCommerceStands.discountsCreating") : t("worldCommerceStands.discountsCreateBtn")}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
