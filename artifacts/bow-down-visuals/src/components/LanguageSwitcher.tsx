import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Check, ChevronDown } from "lucide-react";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export function LanguageSwitcher({ variant = "icon" }: { variant?: "icon" | "full" }) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language)
    ?? SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const changeLanguage = (code: SupportedLanguage) => {
    i18n.changeLanguage(code);
    localStorage.setItem("bdv-language", code);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size={variant === "icon" ? "icon" : "sm"}
        className="gap-1.5"
        aria-label={t("language.select")}
        title={t("language.select")}
        onClick={() => setOpen(!open)}
      >
        <Globe className="h-4 w-4" />
        {variant === "full" ? (
          <>
            <span className="text-sm">{current.flag} {current.name}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </>
        ) : (
          <span className="text-xs">{current.flag}</span>
        )}
      </Button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[170px] rounded-lg border border-white/10 bg-[#1a1a1a] p-1 shadow-xl">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => changeLanguage(lang.code)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-white/10 transition-colors"
            >
              <span className="text-base">{lang.flag}</span>
              <span className="flex-1">{lang.name}</span>
              {i18n.language === lang.code && (
                <Check className="h-4 w-4 text-[#C9A84C]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
