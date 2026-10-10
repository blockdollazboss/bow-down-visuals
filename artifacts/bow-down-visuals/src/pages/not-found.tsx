import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home, FolderOpen } from "lucide-react";
import { useTiltOnHover } from "@/hooks/use-tilt-on-hover";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const { t } = useTranslation();
  usePageTitle(t("notFound.pageTitle"), t("notFound.pageDescription"));
  /* Same cursor-tilt + gold-glow treatment as the header brand mark. */
  const logoTilt = useTiltOnHover<HTMLImageElement>({ maxDeg: 8, maxShift: 6 });
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-black text-white px-5">
      {/* Ambient gold glow */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-yellow-600/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 text-center max-w-md mx-auto">
        <img
          ref={logoTilt}
          src={`${import.meta.env.BASE_URL}images/shark-king-clean-authority.png`}
          alt="Thy Cheat Code - Lost?"
          className="h-48 w-48 rounded-3xl object-cover mx-auto mb-8 border-2 border-primary/30 shadow-[0_0_60px_rgba(201,168,76,0.3)]"
        />
        <p className="text-primary text-sm font-bold tracking-[0.3em] uppercase mb-4">404</p>
        <h1 className="text-4xl font-black text-white mb-3">{t("notFound.heading")}</h1>
        <p className="text-white/50 leading-relaxed mb-8">
          {t("notFound.description")}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button className="gold-glow font-bold gap-2">
              <Home className="h-4 w-4" /> {t("notFound.backToHome")}
            </Button>
          </Link>
          <Link href="/my-projects">
            <Button variant="outline" className="border-white/10 text-white/70 hover:text-white hover:bg-white/5 font-semibold gap-2">
              <FolderOpen className="h-4 w-4" /> {t("notFound.myProjects")}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
