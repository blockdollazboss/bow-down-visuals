import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Megaphone } from "lucide-react";
import { isValidPixelId, type PixelKind } from "@/lib/smartlink-pixels";
import type { CommercePixels } from "@/lib/commerce-pixels";

/* Commerce tracking pixels (wave-4 #41) — the settings form shared by
   the two commerce docks: My Shop (per shop) and the Store Dashboard
   (per storefront). Same fields the release rail carries per release:
   the seller's OWN Meta / TikTok / Google IDs.
 *
 * Honesty rules, stated in the UI and enforced by the server:
 *   - Only IDs entered here ever fire — there are no platform pixels.
 *   - Blank everywhere = nothing fires, ever.
 *   - A malformed ID is refused (client hint here, server truth on
 *     save), never stored bent.
 * The parent owns the wire format: onSave receives trimmed strings
 * ("" = clear) and throws an Error with the server's message on a
 * refused save. */

export interface CommercePixelsFormValue {
  metaPixelId: string;
  tiktokPixelId: string;
  googleTagId: string;
}

const FIELDS: Array<{
  kind: PixelKind;
  key: keyof CommercePixelsFormValue;
  labelKey: string;
  placeholder: string;
}> = [
  { kind: "meta", key: "metaPixelId", labelKey: "commercePixels.metaLabel", placeholder: "123456789012345" },
  { kind: "tiktok", key: "tiktokPixelId", labelKey: "commercePixels.tiktokLabel", placeholder: "C9ABCDEFGHIJKLMN12" },
  { kind: "google", key: "googleTagId", labelKey: "commercePixels.googleLabel", placeholder: "G-ABC123XYZ9" },
];

export function pixelsToForm(pixels: CommercePixels | null | undefined): CommercePixelsFormValue {
  return {
    metaPixelId: pixels?.metaPixelId ?? "",
    tiktokPixelId: pixels?.tiktokPixelId ?? "",
    googleTagId: pixels?.googleTagId ?? "",
  };
}

export default function CommercePixelsSettings({
  initial,
  onSave,
  testIdPrefix = "commerce-pixels",
}: {
  initial: CommercePixelsFormValue;
  onSave: (value: CommercePixelsFormValue) => Promise<void>;
  testIdPrefix?: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<CommercePixelsFormValue>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidKind = FIELDS.find((f) => !isValidPixelId(f.kind, value[f.key]));

  async function save() {
    if (saving || invalidKind) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        metaPixelId: value.metaPixelId.trim(),
        tiktokPixelId: value.tiktokPixelId.trim(),
        googleTagId: value.googleTagId.trim(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("commercePixels.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/70">
        <Megaphone className="h-4 w-4 text-amber-300" /> {t("commercePixels.title")}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-white/50">{t("commercePixels.blurb")}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`${testIdPrefix}-${f.key}`} className="text-xs font-semibold text-white/50">
              {t(f.labelKey)}
            </label>
            <input
              id={`${testIdPrefix}-${f.key}`}
              data-testid={`${testIdPrefix}-${f.key}`}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              value={value[f.key]}
              onChange={(e) => setValue((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ))}
      </div>
      {invalidKind && (
        <p className="mt-2 text-xs text-red-300">
          {t("commercePixels.invalidId", { field: t(invalidKind.labelKey) })}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !!invalidKind}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-5 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? t("commercePixels.saved") : t("commercePixels.save")}
        </button>
        <span className="text-[11px] text-white/40">{t("commercePixels.blankNote")}</span>
      </div>
    </div>
  );
}
