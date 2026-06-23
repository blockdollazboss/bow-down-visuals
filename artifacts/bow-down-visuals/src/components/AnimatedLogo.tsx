export function AnimatedLogo({ className }: { className?: string }) {
  return (
    <>
      <style>{`
        @keyframes bdv-in {
          0%   { opacity: 0; transform: scale(0.88) translateY(14px);
                 filter: brightness(0.4) drop-shadow(0 0 0px rgba(218,165,32,0)); }
          55%  { opacity: 1; transform: scale(1.04) translateY(-3px);
                 filter: brightness(1.08) drop-shadow(0 0 40px rgba(218,165,32,0.7)); }
          100% { opacity: 1; transform: scale(1) translateY(0);
                 filter: brightness(1) drop-shadow(0 0 16px rgba(218,165,32,0.28)); }
        }
        @keyframes bdv-glow {
          0%,100% { filter: drop-shadow(0 0 8px  rgba(218,165,32,0.18))
                            drop-shadow(0 0 2px  rgba(255,215,0,0.10)); }
          50%     { filter: drop-shadow(0 0 32px rgba(218,165,32,0.60))
                            drop-shadow(0 0 10px rgba(255,215,0,0.35)); }
        }
        @keyframes bdv-float {
          0%,100% { transform: translateY(0px); }
          50%     { transform: translateY(-5px); }
        }
        .bdv-animated {
          animation:
            bdv-in    1.05s cubic-bezier(0.22,1,0.36,1) both,
            bdv-glow  3.6s  ease-in-out 1.1s infinite,
            bdv-float 4.8s  ease-in-out 1.1s infinite;
        }
      `}</style>
      <img
        src={`${import.meta.env.BASE_URL}logo-static.png`}
        alt="Bow Down Visuals"
        className={`bdv-animated${className ? ` ${className}` : ""}`}
        draggable={false}
      />
    </>
  );
}
