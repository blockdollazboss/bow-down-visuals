import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/** A titled panel block used throughout the editor. */
export function EditorCard({
  title,
  subtitle,
  icon,
  right,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden ${className}`}>
      {(title || right) && (
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.05]">
          {icon && (
            <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 text-primary">
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            {title && <h3 className="text-xs font-black text-white uppercase tracking-wider">{title}</h3>}
            {subtitle && <p className="text-[11px] text-white/35 mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

/** Collapsible advanced-controls block (closed by default). */
export function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        data-testid={`collapsible-${title.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span className="text-[11px] font-black text-white/50 uppercase tracking-widest">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-4">{children}</div>}
    </div>
  );
}

/** Segmented selector for a small set of options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex p-0.5 rounded-xl border border-white/[0.08] bg-white/[0.03] ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors capitalize ${
            value === opt.value
              ? "bg-primary text-black"
              : "text-white/45 hover:text-white/80"
          }`}
          data-testid={`segmented-${opt.value}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Field label + control row. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-black text-white/45 uppercase tracking-widest">{label}</label>
        {hint && <span className="text-[10px] text-white/25">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Toggleable pill used for multi-select chip groups. */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/20 hover:text-white/70"
      }`}
    >
      {children}
    </button>
  );
}

/** Single-line text input matching the dark theme. */
export function TextInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testId}
      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-primary/40 transition-colors"
    />
  );
}

/** Native styled <select> matching the dark theme. */
export function Dropdown({
  value,
  options,
  onChange,
  testId,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  testId?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
      className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-primary/40 transition-colors"
      style={{ colorScheme: "dark" }}
    >
      {options.map((o) => (
        <option key={o} value={o} className="bg-[#0d0d0d]">
          {o}
        </option>
      ))}
    </select>
  );
}
