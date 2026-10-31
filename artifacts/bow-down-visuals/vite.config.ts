import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT ?? "19157";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const apiOrigin = process.env.API_ORIGIN ?? `http://127.0.0.1:${process.env.API_PORT ?? "8080"}`;

export default defineConfig({
  base: basePath,
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"] ?? ""
    ),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
      process.env["VITE_SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_ANON_KEY"] ?? ""
    ),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Stack-28 #51 (A5-P5) — chunk budget: any single chunk over 650 kB
    // raw warns at build time so first-load regressions surface instead
    // of silently shipping. Known oversize exceptions at the time of
    // setting: the World route chunk (scene graph) — tracked separately
    // by the World lane; everything else must stay under or be split
    // along a natural seam like the ones below.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // Rolldown (Vite 8's bundler) only accepts the function form of
        // manualChunks. Matches both npm-style (@radix-ui/react-dialog) and
        // pnpm-style (@radix-ui+react-dialog@1.x) module paths.
        manualChunks(id) {
          if (
            /@radix-ui[\\/+]react-(accordion|alert-dialog|dialog|dropdown-menu|select|tabs|tooltip)/.test(
              id
            )
          ) {
            return "vendor-radix";
          }
          // Speed-truth (Stack1000 N3): two tiny shared leaves — clsx (the
          // cn() helper nearly every component imports) and
          // use-sync-external-store/shim (wouter + react-i18next import it)
          // — are ALSO imported inside recharts' dependency tree (clsx
          // directly; the shim via react-redux). Rolldown's grouping parks
          // an unpinned shared leaf inside the manual chunk of its
          // heaviest importer: both leaves landed inside vendor-recharts,
          // so every first load statically dragged the whole chart library
          // (373,439 B, modulepreloaded in index.html) for ~6 KB of
          // helpers, though recharts is used only by the lazy
          // analytics-hub route. Pin both leaves to one tiny shared vendor
          // chunk so vendor-recharts stays behind the route that uses it.
          // (Chunk name kept as "vendor-clsx" — the first pin's name:
          // renaming the target to "vendor-shared" was measured to make
          // Rolldown merge the leaves straight back into vendor-recharts,
          // so the proven name stays and this comment carries the truth
          // about what's inside.)
          if (
            /[\\/]node_modules[\\/]clsx[\\/]/.test(id) ||
            /[\\/]node_modules[\\/]use-sync-external-store[\\/]/.test(id)
          ) {
            return "vendor-clsx";
          }
          // Stack-28 #51: recharts is used ONLY by the analytics-hub route — keep it in
          // its own vendor chunk so the hub's panel code stays lean and
          // the chart library's size is visible on its own line.
          if (/[\\/]node_modules[\\/]recharts[\\/]/.test(id)) {
            return "vendor-recharts";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      // Direct Vite previews need /api to reach the Express service instead of
      // falling through to index.html/HTML errors. Replit production still
      // routes /api through the API artifact service.
      "/api": {
        target: apiOrigin,
        changeOrigin: true,
        secure: false,
      },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
