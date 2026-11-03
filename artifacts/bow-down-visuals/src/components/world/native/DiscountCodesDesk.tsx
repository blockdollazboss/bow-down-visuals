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
import { apiErrorMessage } from "../../../lib/api-error";
import {
  DISCOUNTS_PATH,
  DISCOUNT_STATE_LABELS,
  buildDiscountPayload,
  discountCodeState,
  discountCodesOf,
  discountPath,
  discountUsageLine,
  type DiscountCode,
  type DiscountForm,
} from "@/lib/world/discounts-desk";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

const EMPTY_FORM: DiscountForm = { code: "", percentOff: "", maxUses: "", expiresDate: "" };

export function DiscountCodesDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
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
    if (!res.ok) throw new Error(apiErrorMessage(data, "That didn't land. Try again in a moment."));
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
      setError(e instanceof Error ? e.message : "That didn't land. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  const create = () => {
    const payload = buildDiscountPayload(form);
    if (!payload) {
      setError("Check the code: 2–40 characters (letters, numbers, - or _), a percent between 1 and 90, and a use limit of blank (no limit) or a whole number.");
      return;
    }
    void run(
      "create",
      async () => {
        await send("POST", DISCOUNTS_PATH, payload);
        setForm(EMPTY_FORM);
      },
      "Code created — it works at checkout right away.",
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
    void run(`delete-${code.id}`, () => send("DELETE", discountPath(code.id)), "Code deleted.");
  };

  const set = (patch: Partial<DiscountForm>) => setForm((f) => ({ ...f, ...patch }));

  if (loadFailed) {
    return (
      <div className="space-y-3" data-testid="world-discounts-desk">
        <p className={`text-base font-black ${strong}`}>Discount Codes</p>
        <p className={errCls} data-testid="world-discounts-desk-failed">
          Your codes wouldn&rsquo;t load. Give it another shot.
        </p>
        <button type="button" className={chipCls(false)} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="world-discounts-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>Discount Codes</p>
        <p className={`text-xs ${muted}`}>
          Codes for your shop — profile-wide, good on every active product.
        </p>
      </div>
      {notice ? (
        <p className={`text-xs font-semibold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{notice}</p>
      ) : null}
      {error ? <p className={errCls}>{error}</p> : null}

      {noProfile ? (
        <p className={`text-sm ${muted}`} data-testid="world-discounts-desk-noprofile">
          Discount codes ride on your creator profile — set yours up and this desk opens.
        </p>
      ) : codes === null ? (
        <p className={`text-sm ${muted}`}>Reading your codes…</p>
      ) : (
        <>
          {codes.length === 0 ? (
            <p className={`text-sm ${muted}`}>No codes yet — make your first one below.</p>
          ) : (
            <ul className="space-y-1.5">
              {codes.map((code) => {
                const state = discountCodeState(code);
                return (
                  <li key={code.id} className={`rounded-xl border px-3 py-2 ${cardCls}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-mono text-sm font-black ${strong}`}>{code.code}</span>
                      <span className={chipCls(state === "live")}>
                        {code.percentOff}% off · {DISCOUNT_STATE_LABELS[state]}
                      </span>
                      <span className={`text-xs ${muted}`}>{discountUsageLine(code)}</span>
                      <span className="ml-auto flex gap-1.5">
                        <button
                          type="button"
                          data-testid={`world-discounts-desk-toggle-${code.id}`}
                          className={chipCls(false)}
                          disabled={busy !== null}
                          onClick={() => toggle(code)}
                        >
                          {code.isActive ? "Switch off" : "Switch on"}
                        </button>
                        <button
                          type="button"
                          data-testid={`world-discounts-desk-delete-${code.id}`}
                          className={chipCls(confirmDeleteId === code.id)}
                          disabled={busy !== null}
                          onClick={() => remove(code)}
                        >
                          {confirmDeleteId === code.id ? "Tap again to delete" : "Delete"}
                        </button>
                      </span>
                    </div>
                    <p className={`mt-1 text-xs ${muted}`}>
                      {code.appliesTo ? `Applies to ${code.appliesTo}. ` : ""}
                      {code.expiresAt
                        ? `Expires ${new Date(code.expiresAt).toLocaleDateString()}.`
                        : "No expiry."}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          <section className={`rounded-xl border p-3 ${cardCls}`}>
            <p className={`text-sm font-bold ${strong}`}>New code</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className={`text-xs ${muted}`}>
                Code
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
                Percent off (1–90)
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
                Use limit (blank = no limit)
                <input
                  className={`${inputCls} mt-1`}
                  inputMode="numeric"
                  placeholder="No limit"
                  value={form.maxUses}
                  onChange={(e) => set({ maxUses: e.target.value })}
                />
              </label>
              <label className={`text-xs ${muted}`}>
                Expires (optional)
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
              {busy === "create" ? "Creating…" : "Create the code"}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
