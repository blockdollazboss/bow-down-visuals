/**
 * ClipContextMenu — reusable custom right-click context menu for the video
 * editor (timeline clips + preview player).
 *
 * Custom gold marble styling (NOT the browser default menu):
 *   - dark tone: bg-[#0a0a0a] marble body, gold (#C9A84C) borders
 *   - light tone: ivory marble body, bronze ink (the house light panel
 *     recipe) — the dark panel's text classes are repainted to bronze
 *     by the light theme's global remaps while its arbitrary-value
 *     black background is not, which made labels dark-on-black on
 *     theme-adaptive surfaces (Lane V4 item 3)
 *   - positioned at the cursor, clamped to the viewport
 *   - closes on click-away, Escape, or window scroll/resize
 *   - supports nested submenus (hover to open, flips to the left near the edge)
 *   - supports custom row content (e.g. a volume slider) via `custom`
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { menuToneClasses, type MenuToneClasses } from "@/lib/context-menu-tone";
import { Check, ChevronRight } from "lucide-react";

export interface ContextMenuItem {
  key: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Shown as the native title tooltip when disabled. */
  disabledTitle?: string;
  /** Renders a gold checkmark on the left. */
  checked?: boolean;
  /** Renders the row highlighted as the active choice. */
  active?: boolean;
  danger?: boolean;
  /** When true the menu stays open after this item is clicked (e.g. sliders). */
  keepOpen?: boolean;
  children?: ContextMenuItem[];
  /** Fully custom row body — rendered in place of the label row. */
  custom?: React.ReactNode;
  divider?: boolean;
}

interface ClipContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  testId?: string;
  /** Panel treatment. Defaults to the site theme (light → ivory).
      The video editor passes "dark" explicitly: its gold/black look
      is protected in both site themes. */
  tone?: "dark" | "light";
}

const MENU_W = 232;
const SUB_W = 208;

export function ClipContextMenu({ x, y, items, onClose, testId, tone: toneProp }: ClipContextMenuProps) {
  const siteLight = useIsLightTheme();
  const tone = toneProp ?? (siteLight ? "light" : "dark");
  const tc = menuToneClasses(tone);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState<string | null>(null);

  /* ── Clamp to the viewport after measuring ── */
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 8) left = Math.max(8, vw - rect.width - 8);
    if (top + rect.height > vh - 8) top = Math.max(8, vh - rect.height - 8);
    setPos({ left, top });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  /* ── Dismiss: click-away, Escape, scroll, resize ── */
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll() { onClose(); }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  function handleItemClick(item: ContextMenuItem) {
    if (item.disabled || item.children) return;
    item.onClick?.();
    if (!item.keepOpen) onClose();
  }

  return (
    <div
      ref={rootRef}
      data-testid={testId ?? "clip-context-menu"}
      className={`fixed z-[200] rounded-xl border backdrop-blur-md py-1.5 overflow-visible select-none ${tc.panel}`}
      style={{ left: pos.left, top: pos.top, width: MENU_W }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {/* marble sheen */}
      <div className={`pointer-events-none absolute inset-0 rounded-xl ${tc.sheen}`} aria-hidden />
      <div className="relative">
        {items.map((item) =>
          item.divider ? (
            <div key={item.key} className={`mx-3 my-1.5 h-px ${tc.divider}`} />
          ) : (
            <MenuRow
              key={item.key}
              item={item}
              tc={tc}
              tone={tone}
              openSub={openSub}
              setOpenSub={setOpenSub}
              onItemClick={handleItemClick}
              onClose={onClose}
            />
          ),
        )}
      </div>
    </div>
  );
}

function MenuRow({
  item, tc, tone, openSub, setOpenSub, onItemClick, onClose,
}: {
  item: ContextMenuItem;
  tc: MenuToneClasses;
  tone: "dark" | "light";
  openSub: string | null;
  setOpenSub: React.Dispatch<React.SetStateAction<string | null>>;
  onItemClick: (item: ContextMenuItem) => void;
  onClose: () => void;
}) {
  const hasSub = !!item.children?.length;
  const isOpen = openSub === item.key;
  const subRef = useRef<HTMLDivElement | null>(null);
  const [subDir, setSubDir] = useState<"right" | "left">("right");

  useLayoutEffect(() => {
    if (!isOpen || !subRef.current) return;
    // Flip the submenu to the left when it would overflow the viewport.
    const vw = window.innerWidth;
    const rect = subRef.current.getBoundingClientRect();
    if (rect.right > vw - 8) setSubDir("left");
    else setSubDir("right");
  }, [isOpen]);

  const rowCls = [
    "relative flex items-center gap-2.5 w-full px-3 py-2 text-left text-[12px] font-semibold transition-colors",
    item.disabled
      ? tc.rowDisabled
      : item.danger
        ? tc.rowDanger
        : `${tc.row} ${tc.rowHover} cursor-pointer`,
    item.active && !item.disabled ? (tone === "light" ? "text-[#7A5A12]" : "text-[#f3d98b]") : "",
  ].join(" ");

  return (
    <div
      className="relative"
      onMouseEnter={() => hasSub && !item.disabled && setOpenSub(item.key)}
      onMouseLeave={() => hasSub && setOpenSub((prev: string | null) => (prev === item.key ? null : prev))}
    >
      {item.custom ? (
        <div
          className="px-3 py-2"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {item.custom}
        </div>
      ) : (
        <button
          type="button"
          className={rowCls}
          disabled={item.disabled}
          title={item.disabled ? item.disabledTitle : undefined}
          onClick={() => onItemClick(item)}
          data-testid={`ctx-item-${item.key}`}
        >
          <span className="w-4 h-4 shrink-0 flex items-center justify-center">
            {item.checked ? (
              <Check className={`h-3.5 w-3.5 ${tc.check}`} strokeWidth={3} />
            ) : (
              <span className={item.disabled ? tc.iconDisabled : tc.icon}>{item.icon}</span>
            )}
          </span>
          <span className="flex-1 min-w-0 truncate">{item.label}</span>
          {hasSub && <ChevronRight className={`h-3.5 w-3.5 ${tc.chevron} shrink-0`} />}
        </button>
      )}
      {hasSub && isOpen && (
        <div
          ref={subRef}
          className={`absolute top-[-6px] z-[201] rounded-xl border backdrop-blur-md py-1.5 ${tc.panel}`}
          style={subDir === "right" ? { left: MENU_W - 4 } : { right: MENU_W - 4, width: SUB_W }}
        >
          <div className={`pointer-events-none absolute inset-0 rounded-xl ${tc.sheen}`} aria-hidden />
          <div className="relative" style={{ width: SUB_W }}>
            {item.children!.map((sub) =>
              sub.divider ? (
                <div key={sub.key} className={`mx-3 my-1.5 h-px ${tc.divider}`} />
              ) : (
                <button
                  key={sub.key}
                  type="button"
                  disabled={sub.disabled}
                  title={sub.disabled ? sub.disabledTitle : undefined}
                  onClick={() => {
                    if (sub.disabled) return;
                    sub.onClick?.();
                    if (!sub.keepOpen) onClose();
                  }}
                  data-testid={`ctx-item-${item.key}-${sub.key}`}
                  className={[
                    "flex items-center gap-2.5 w-full px-3 py-2 text-left text-[12px] font-semibold transition-colors",
                    sub.disabled
                      ? tc.rowDisabled
                      : sub.danger
                        ? tc.rowDanger
                        : `${tc.row} ${tc.rowHover} cursor-pointer`,
                  ].join(" ")}
                >
                  <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                    {sub.checked ? (
                      <Check className={`h-3.5 w-3.5 ${tc.check}`} strokeWidth={3} />
                    ) : (
                      <span className={tc.icon}>{sub.icon}</span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{sub.label}</span>
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
