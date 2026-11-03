import { plainErrorText } from "../../../lib/api-error";
import { useEffect, useState } from "react";
import {
  ArrowUpCircle, Check, Loader2, Magnet, Pencil, Plus, RefreshCw, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { centsToDisplay } from "@/lib/shops";
import {
  ADDON_FEE_LABEL, LEAD_MAGNET_KINDS,
  addonSummary, applyGrowthProductSave, buildBumpPayload,
  buildLeadMagnetConvertPayload, buildLeadMagnetCreatePayload,
  buildLeadMagnetRestorePayload, bumpCandidates, bumpPercentProblem,
  bumpUnitCents, emptyLeadMagnetForm, isLeadMagnet, leadMagnetConvertible,
  leadMagnetFormProblem, leadMagnetRestoreProblem, leadMagnets,
  parseBumpPercent, parseBumpSave, parseGrowthProducts, parseSavedGrowthProduct, parseStoreSlug,
  type GrowthProduct, type LeadMagnetFormState,
} from "@/lib/world/store-growth";

/* ─── StoreGrowthDesk — the store's three growth tools, in-World ──
   Stack1400 parity wave #1, item 3. The store dashboard's three
   conversion tools had no World form (parity census 2026-11-02:
   lead-magnets / order-bumps / post-purchase-upsell ABSENT); this
   desk is their native manage surface, docked at the Marketplace
   stand in ShopStands (the ShopStand manage side) and riding the
   EXISTING 2D store rails end to end — no parallel API, no page
   pull-up, everything completes right here:
   - the seller's store is found the dashboard's way: GET
     /api/storefront/money-checklist → links.storeUrl → the slug,
     then GET /api/storefront/products?slug=… (the dashboard's own
     list read, bumpConfig + resolved bump offer included). A
     genuine no-profile account answers the checklist 404 — the
     desk says "make your creator profile first" and stops, it
     never renders an invented empty store;
   - LEAD MAGNETS: a $0 product, claimed by fans with their email
     (POST /api/storefront/claim is the fan's rail; the seller's
     side is the price). Create one here (POST
     /api/storefront/products, priceCents 0), turn a paid product
     into one, or price one again — both by PATCH
     /api/storefront/products/:id { priceCents }, behind an armed
     confirm, because a price change is a money move;
   - ORDER BUMPS: PUT /api/storefront/products/:id/bump with the
     dashboard's exact body — one of your own priced products as
     the add-on, at its price or your % off it (0–90);
   - POST-PURCHASE UPSELL: the SAME designation (the api rail
     reuses the bump attachment) — the upsell section edits the
     same attachment under its own framing and says so plainly:
     a buyer who skips the tick is offered the add-on once after
     paying, one click on the card they just used.
   Prices are the rails' own: the form's add-on price preview is
   the rail's formula shown for reading; the server recomputes
   every figure at save and at checkout, and the flat 5% platform
   fee on an add-on sale is the rail's, named in copy only.
   The list moves ONLY from server-confirmed rows. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function goldBtn(disabled = false) {
  return `inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target ${disabled ? "opacity-50 hover:scale-100" : ""}`;
}
function chipBtn(isLight: boolean) {
  return `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
}
function standTabBtn(isLight: boolean, active: boolean) {
  if (active) return "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-black text-black transition bdv-touch-target";
  return chipBtn(isLight);
}
function inputCls(isLight: boolean) {
  return `w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#7A5A12]"
      : "border-white/15 bg-black/50 text-white placeholder:text-white/30 focus:border-[#d4af37]/60"
  }`;
}
function muted(isLight: boolean) {
  return isLight ? "text-[#6B5B36]" : "text-white/50";
}
function rowCls(isLight: boolean) {
  return `rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`;
}

type DeskState = "loading" | "ready" | "no-profile" | "failed";
type GrowthSection = "lead" | "bumps" | "upsell";

export function StoreGrowthDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const [state, setState] = useState<DeskState>("loading");
  const [products, setProducts] = useState<GrowthProduct[]>([]);
  const [section, setSection] = useState<GrowthSection>("lead");

  const load = async () => {
    setState("loading");
    try {
      const headers = await authHeaders();
      const checkRes = await fetch("/api/storefront/money-checklist", { headers });
      if (checkRes.status === 404) { setState("no-profile"); return; }
      const checkData = (await checkRes.json().catch(() => ({}))) as unknown;
      if (!checkRes.ok) throw new Error("checklist");
      const slug = parseStoreSlug(checkData);
      if (!slug) throw new Error("checklist");
      const listRes = await fetch(`/api/storefront/products?slug=${encodeURIComponent(slug)}`);
      const listData = (await listRes.json().catch(() => ({}))) as unknown;
      if (!listRes.ok) throw new Error("products");
      const parsed = parseGrowthProducts(listData);
      if (!parsed) throw new Error("products");
      setProducts(parsed);
      setState("ready");
    } catch {
      setState("failed");
    }
  };
  useEffect(() => {
    if (isGuest) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  /* Guests have no store to grow — the desk simply isn't there. */
  if (isGuest) return null;

  const onSaved = (saved: GrowthProduct) =>
    setProducts((ps) => applyGrowthProductSave(ps, saved));

  return (
    <NativeCard isLight={isLight} title="Grow your store — lead magnets, add-ons, one-click offers">
      <div className="space-y-2" data-testid="world-store-growth">
        <p className={`text-xs ${muted(isLight)}`}>
          The three conversion tools from your store dashboard, run from right here on the same rails.
          Nothing here leaves the World — every change saves on your real store the moment it lands.
        </p>

        {state === "loading" && <NativeLoadingState isLight={isLight} message="Opening your growth tools…" />}
        {state === "failed" && (
          <NativeErrorState
            isLight={isLight}
            title="Your growth tools wouldn't open"
            message="Your store itself is fine — its tools couldn't be brought to the stand just now. Nothing about your store changed."
            onRetry={() => void load()}
          />
        )}
        {state === "no-profile" && (
          <div data-testid="world-store-growth-no-profile">
            <NativeEmptyState
              isLight={isLight}
              message="These tools grow the store on your creator profile — and there's no creator profile on this account yet."
              detail="Make your creator profile first (it's the free setup in My Studio), stock it with a product or two, and this desk opens on your store."
            />
          </div>
        )}

        {state === "ready" && (
          <>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Store growth tools">
              <button type="button" role="tab" aria-selected={section === "lead"} data-testid="world-store-growth-tab-lead" onClick={() => setSection("lead")} className={standTabBtn(isLight, section === "lead")}>
                <Magnet className="h-3 w-3" /> Lead magnets
              </button>
              <button type="button" role="tab" aria-selected={section === "bumps"} data-testid="world-store-growth-tab-bumps" onClick={() => setSection("bumps")} className={standTabBtn(isLight, section === "bumps")}>
                <Plus className="h-3 w-3" /> Add-on offers
              </button>
              <button type="button" role="tab" aria-selected={section === "upsell"} data-testid="world-store-growth-tab-upsell" onClick={() => setSection("upsell")} className={standTabBtn(isLight, section === "upsell")}>
                <ArrowUpCircle className="h-3 w-3" /> After-purchase offer
              </button>
            </div>

            {section === "lead" && (
              <LeadMagnetsSection isLight={isLight} products={products} onSaved={onSaved} />
            )}
            {section === "bumps" && (
              <AddonSection
                mode="bump"
                isLight={isLight}
                products={products}
                onSaved={onSaved}
              />
            )}
            {section === "upsell" && (
              <AddonSection
                mode="upsell"
                isLight={isLight}
                products={products}
                onSaved={onSaved}
              />
            )}
          </>
        )}
      </div>
    </NativeCard>
  );
}

/* ═══ Lead magnets — the $0 door into the store ═══════════════════ */

function LeadMagnetsSection({
  isLight, products, onSaved,
}: {
  isLight: boolean;
  products: GrowthProduct[];
  onSaved: (saved: GrowthProduct) => void;
}) {
  const authHeaders = useAuthHeaders();
  const magnets = leadMagnets(products);
  const convertible = leadMagnetConvertible(products);

  const [form, setForm] = useState<LeadMagnetFormState>(emptyLeadMagnetForm());
  const [creating, setCreating] = useState(false);
  const [convertId, setConvertId] = useState("");
  const [convertArmed, setConvertArmed] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restorePrice, setRestorePrice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const set = (patch: Partial<LeadMagnetFormState>) => setForm((f) => ({ ...f, ...patch }));

  const patchPrice = async (p: GrowthProduct, payload: { priceCents: number }, done: string) => {
    if (busyId) return;
    setBusyId(p.id);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/storefront/products/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "That price change didn't save — the product is unchanged.");
      const saved = parseSavedGrowthProduct(data);
      if (!saved) throw new Error("The save came back without your product — reopen the desk to see its true state.");
      onSaved(saved);
      setNote(done);
      setConvertArmed(false);
      setConvertId("");
      setRestoreId(null);
      setRestorePrice("");
    } catch (e) {
      setError(plainErrorText(e, "That price change didn't save — the product is unchanged."));
    } finally {
      setBusyId(null);
    }
  };

  const create = async () => {
    if (creating) return;
    const problem = leadMagnetFormProblem(form);
    if (problem) { setError(problem); return; }
    const payload = buildLeadMagnetCreatePayload(form);
    if (!payload) { setError("That free product can't be made as-is — check the title."); return; }
    setCreating(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/storefront/products", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "That free product didn't save — nothing was created.");
      const saved = parseSavedGrowthProduct(data);
      if (!saved) throw new Error("The save came back without your product — reopen the desk to see its true state.");
      onSaved(saved);
      setForm(emptyLeadMagnetForm());
      setNote(`“${saved.title}” is live as a free lead magnet — fans claim it with their email, and the claim joins your list.`);
    } catch (e) {
      setError(plainErrorText(e, "That free product didn't save — nothing was created."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="world-store-growth-lead">
      <p className={`text-xs ${muted(isLight)}`}>
        A lead magnet is a product priced at $0: instead of checking out, fans claim it with their email
        address — and the claim joins your audience list. No checkout, no card. The free sample door into your store.
      </p>
      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
      {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}

      <div className="space-y-1.5">
        {magnets.map((p) => (
          <div key={p.id} data-testid="world-store-growth-lead-row" className={rowCls(isLight)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.title}</span>
              <span className="shrink-0 rounded-full bg-[#d4af37]/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#e8c86a]">
                <Magnet className="mr-1 inline h-3 w-3" />Lead magnet · FREE
              </span>
              {restoreId !== p.id && (
                <button type="button" data-testid="world-store-growth-lead-restore-open" onClick={() => { setRestoreId(p.id); setRestorePrice(""); setError(null); }} className={chipBtn(isLight)}>
                  <Pencil className="h-3 w-3" /> Make it paid again
                </button>
              )}
            </div>
            {restoreId === p.id && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="world-store-growth-lead-restore">
                <input
                  value={restorePrice}
                  onChange={(e) => setRestorePrice(e.target.value)}
                  placeholder="New price — like 9.99"
                  aria-label="New price"
                  inputMode="decimal"
                  className={`${inputCls(isLight)} max-w-[180px]`}
                />
                <button
                  type="button"
                  data-testid="world-store-growth-lead-restore-save"
                  disabled={busyId === p.id}
                  onClick={() => {
                    const problem = leadMagnetRestoreProblem(restorePrice);
                    if (problem) { setError(problem); return; }
                    const payload = buildLeadMagnetRestorePayload(restorePrice);
                    if (payload) void patchPrice(p, payload, `“${p.title}” sells again at ${centsToDisplay(payload.priceCents)} — it's a paid product now, not a lead magnet.`);
                  }}
                  className={goldBtn(busyId === p.id)}
                >
                  {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save price
                </button>
                <button type="button" onClick={() => setRestoreId(null)} className={chipBtn(isLight)}>
                  <X className="h-3 w-3" /> Keep it free
                </button>
              </div>
            )}
          </div>
        ))}
        {magnets.length === 0 && (
          <p className={`text-xs ${muted(isLight)}`}>No lead magnets yet — make one below, or turn a paid product free.</p>
        )}
      </div>

      <div className="space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-store-growth-lead-create">
        <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Make a lead magnet</p>
        <input
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="Title — the free thing fans claim"
          aria-label="Lead magnet title"
          maxLength={160}
          className={inputCls(isLight)}
        />
        <textarea
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="Description — what they get, and why it's worth their email"
          aria-label="Lead magnet description"
          maxLength={5000}
          rows={2}
          className={inputCls(isLight)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={form.kind}
            onChange={(e) => set({ kind: e.target.value as LeadMagnetFormState["kind"] })}
            aria-label="Lead magnet kind"
            className={`${inputCls(isLight)} max-w-[180px]`}
          >
            {LEAD_MAGNET_KINDS.map((k) => (
              <option key={k} value={k}>{k === "digital" ? "Digital" : "Download"}</option>
            ))}
          </select>
          <span className={`text-xs ${muted(isLight)}`}>Price: FREE — $0 is what makes it a lead magnet.</span>
          <button type="button" data-testid="world-store-growth-lead-create-submit" onClick={() => void create()} disabled={creating} className={goldBtn(creating)}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Magnet className="h-4 w-4" />} Put it out free
          </button>
        </div>
      </div>

      {convertible.length > 0 && (
        <div className="space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-store-growth-lead-convert">
          <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Turn a product into a lead magnet</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={convertId}
              onChange={(e) => { setConvertId(e.target.value); setConvertArmed(false); }}
              aria-label="Product to make free"
              className={`${inputCls(isLight)} max-w-[320px]`}
            >
              <option value="">Pick one of your paid products…</option>
              {convertible.map((p) => (
                <option key={p.id} value={p.id}>{p.title} — {centsToDisplay(p.priceCents)}</option>
              ))}
            </select>
            {convertId && !convertArmed && (
              <button type="button" data-testid="world-store-growth-lead-convert-arm" onClick={() => setConvertArmed(true)} className={chipBtn(isLight)}>
                Make it free
              </button>
            )}
            {convertId && convertArmed && (
              <>
                <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                  Its price becomes $0 — fans claim it by email instead of buying it.
                </span>
                <button
                  type="button"
                  data-testid="world-store-growth-lead-convert-confirm"
                  disabled={busyId !== null}
                  onClick={() => {
                    const p = convertible.find((q) => q.id === convertId);
                    if (p) void patchPrice(p, buildLeadMagnetConvertPayload(), `“${p.title}” is a lead magnet now — free to claim by email.`);
                  }}
                  className={goldBtn(busyId !== null)}
                >
                  {busyId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Yes, make it free
                </button>
                <button type="button" onClick={() => setConvertArmed(false)} className={chipBtn(isLight)}>
                  <X className="h-3 w-3" /> Keep its price
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ Add-ons — one editor, two doors (checkout bump + the
       after-purchase offer share the one designation) ════════════ */

function AddonSection({
  mode, isLight, products, onSaved,
}: {
  mode: "bump" | "upsell";
  isLight: boolean;
  products: GrowthProduct[];
  onSaved: (saved: GrowthProduct) => void;
}) {
  const authHeaders = useAuthHeaders();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [percentRaw, setPercentRaw] = useState("0");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const openEditor = (p: GrowthProduct) => {
    setError(null);
    setNote(null);
    if (editingId === p.id) { setEditingId(null); return; }
    setEditingId(p.id);
    setTargetId(p.bumpConfig?.bumpProductId ?? "");
    setPercentRaw(String(p.bumpConfig?.percentOff ?? 0));
  };

  const put = async (p: GrowthProduct, payload: { bumpProductId: string | null; percentOff: number }) => {
    if (busyId) return;
    setBusyId(p.id);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/storefront/products/${p.id}/bump`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "That add-on didn't save — the product is unchanged.");
      const saved = parseBumpSave(data);
      if (!saved) throw new Error("The save came back without your product — reopen the desk to see its true state.");
      onSaved(saved.product);
      setEditingId(null);
      setNote(
        payload.bumpProductId === null
          ? `The add-on is off “${p.title}” — no checkout offer and no after-purchase offer for it now.`
          : saved.offerLive
            ? `“${p.title}” carries its add-on — buyers see it at checkout, and anyone who skips it is offered it once after paying.`
            : `The add-on is attached to “${p.title}”, but it isn't offered yet — the add-on itself is paused, sold out or gone. It lights up the moment the add-on is live.`,
      );
    } catch (e) {
      setError(plainErrorText(e, "That add-on didn't save — the product is unchanged."));
    } finally {
      setBusyId(null);
    }
  };

  const save = (p: GrowthProduct) => {
    if (!targetId) { setError("Pick the add-on product first — or hit Remove to clear it."); return; }
    const problem = bumpPercentProblem(percentRaw);
    if (problem) { setError(problem); return; }
    const payload = buildBumpPayload(targetId, percentRaw);
    if (!payload) { setError("That add-on can't be saved as-is — check the product and the % off."); return; }
    void put(p, payload);
  };

  const target = targetId ? (products.find((q) => q.id === targetId) ?? null) : null;

  return (
    <div className="space-y-2" data-testid={mode === "bump" ? "world-store-growth-bumps" : "world-store-growth-upsell"}>
      {mode === "bump" ? (
        <p className={`text-xs ${muted(isLight)}`}>
          Attach ONE of your own products as an add-on: at checkout, buyers see it with a tick box — same single
          charge, delivered together. Its price is its own listed price, or your % off it. The {ADDON_FEE_LABEL}{" "}
          applies to the add-on too, out of your cut — the buyer never pays extra. Free lead magnets can&rsquo;t
          ride as add-ons; they&rsquo;re claimed by email instead.
        </p>
      ) : (
        <p className={`text-xs ${muted(isLight)}`}>
          If a buyer skips the add-on at checkout, they&rsquo;re offered it once more right after paying — one
          click on the card they just used, at the same price with the same {ADDON_FEE_LABEL}. There&rsquo;s no
          second switch to flip: the after-purchase offer rides the SAME add-on designation as the checkout
          offer, so setting it here sets both, and removing it removes both.
        </p>
      )}
      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
      {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}

      <div className="space-y-1.5">
        {products.map((p) => {
          const summary = addonSummary(products, p);
          return (
            <div key={p.id} data-testid={mode === "bump" ? "world-store-growth-bump-row" : "world-store-growth-upsell-row"} className={rowCls(isLight)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.title}</span>
                <span className="text-sm font-black text-[#d4af37]">{isLeadMagnet(p) ? "FREE" : centsToDisplay(p.priceCents)}</span>
                <span className={`text-xs ${summary.live ? (isLight ? "text-[#92600a]" : "text-amber-300") : muted(isLight)}`}>{summary.line}</span>
                <button type="button" data-testid={mode === "bump" ? "world-store-growth-bump-edit" : "world-store-growth-upsell-edit"} onClick={() => openEditor(p)} className={chipBtn(isLight)}>
                  <Pencil className="h-3 w-3" /> {p.bumpConfig ? "Change add-on" : "Attach add-on"}
                </button>
              </div>
              {editingId === p.id && (
                <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-2" data-testid={mode === "bump" ? "world-store-growth-bump-editor" : "world-store-growth-upsell-editor"}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      aria-label="Add-on product"
                      className={`${inputCls(isLight)} max-w-[320px]`}
                    >
                      <option value="">Pick one of your products…</option>
                      {bumpCandidates(products, p.id).map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.title} — {centsToDisplay(q.priceCents)}{q.isActive ? "" : " (draft)"}
                        </option>
                      ))}
                    </select>
                    <label className={`inline-flex items-center gap-1.5 text-xs ${muted(isLight)}`}>
                      % off
                      <input
                        value={percentRaw}
                        onChange={(e) => setPercentRaw(e.target.value)}
                        inputMode="numeric"
                        aria-label="Percent off the add-on"
                        className={`${inputCls(isLight)} max-w-[72px]`}
                      />
                    </label>
                    <button type="button" data-testid={mode === "bump" ? "world-store-growth-bump-save" : "world-store-growth-upsell-save"} onClick={() => save(p)} disabled={busyId === p.id} className={goldBtn(busyId === p.id)}>
                      {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save add-on
                    </button>
                    {p.bumpConfig && (
                      <button
                        type="button"
                        data-testid={mode === "bump" ? "world-store-growth-bump-remove" : "world-store-growth-upsell-remove"}
                        onClick={() => {
                          const payload = buildBumpPayload(null, "0");
                          if (payload) void put(p, payload);
                        }}
                        disabled={busyId === p.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-400/10 disabled:opacity-60 bdv-touch-target"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {target && !bumpPercentProblem(percentRaw) && (
                    <p className={`text-[11px] ${muted(isLight)}`}>
                      Buyers see “{target.title}” at {centsToDisplay(bumpUnitCents(target.priceCents, parseBumpPercent(percentRaw)))}
                      {parseBumpPercent(percentRaw) > 0 ? ` — ${parseBumpPercent(percentRaw)}% off its ${centsToDisplay(target.priceCents)} list price` : ""}.
                      The rail recomputes this at checkout; the {ADDON_FEE_LABEL} comes out of your cut.
                    </p>
                  )}
                  <button type="button" onClick={() => setEditingId(null)} className={chipBtn(isLight)}>
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {products.length === 0 && (
          <NativeEmptyState isLight={isLight} message="No products on your store yet — stock it from the Products bench, then come back and attach add-ons." />
        )}
      </div>
      <p className={`flex items-center gap-2 text-[11px] ${muted(isLight)}`}>
        <RefreshCw className="h-3 w-3 shrink-0" />
        Both offers are the one designation — that&rsquo;s the rail&rsquo;s own design, not a shortcut here.
      </p>
    </div>
  );
}
