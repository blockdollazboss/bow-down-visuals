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
    rolldownOptions: {
      output: {
        // Rolldown (Vite 8's bundler) code splitting. The three vendor
        // pins below began life as a manualChunks function (Stack-28
        // #51 / Stack1000 N3); World-perf round 3 converted them to
        // codeSplitting groups — same names, same tests, same order —
        // because manualChunks is only a compat transform into groups
        // and cannot express the one flag round 3 needs
        // (includeDependenciesRecursively: false on the world-kit
        // group). If both are specified, manualChunks is ignored, so
        // the vendor pins live here now. Matches both npm-style
        // (@radix-ui/react-dialog) and pnpm-style
        // (@radix-ui+react-dialog@1.x) module paths.
        codeSplitting: {
          groups: [
            {
              name: "vendor-radix",
              test: /@radix-ui[\\/+]react-(accordion|alert-dialog|dialog|dropdown-menu|select|tabs|tooltip)/,
              priority: 30,
            },
            // Speed-truth (Stack1000 N3): two tiny shared leaves — clsx
            // (the cn() helper nearly every component imports) and
            // use-sync-external-store/shim (wouter + react-i18next
            // import it) — are ALSO imported inside recharts'
            // dependency tree (clsx directly; the shim via
            // react-redux). Rolldown's grouping parks an unpinned
            // shared leaf inside the manual chunk of its heaviest
            // importer: both leaves landed inside vendor-recharts, so
            // every first load statically dragged the whole chart
            // library (373,439 B, modulepreloaded in index.html) for
            // ~6 KB of helpers, though recharts is used only by the
            // lazy analytics-hub route. Pin both leaves to one tiny
            // shared vendor chunk so vendor-recharts stays behind the
            // route that uses it. (Chunk name kept as "vendor-clsx" —
            // the first pin's name: renaming the target to
            // "vendor-shared" was measured to make Rolldown merge the
            // leaves straight back into vendor-recharts, so the proven
            // name stays and this comment carries the truth about
            // what's inside.)
            {
              name: "vendor-clsx",
              test: /[\\/]node_modules[\\/](?:clsx|use-sync-external-store)[\\/]/,
              priority: 20,
            },
            // Stack-28 #51: recharts is used ONLY by the
            // analytics-hub route — keep it in its own vendor chunk so
            // the hub's panel code stays lean and the chart library's
            // size is visible on its own line.
            {
              name: "vendor-recharts",
              test: /[\\/]node_modules[\\/]recharts[\\/]/,
              priority: 10,
            },
            // World-perf round 3: the World panel's true shared
            // leaves. Rolldown parks an unpinned shared leaf inside
            // the chunk of its heaviest importer (the vendor-clsx pin
            // above exists for the same reason): the panel frame kit
            // (NativeBoard / NativeCard / NativePlaceholder /
            // NativeShelf / NativeStates), the Create desks' two leaf
            // halves (CreateDeskLeaf + CreateResultLeaf, split out of
            // CreateDeskShared so neither imports a desk), the pure
            // lib/world data modules they and the money desks share
            // (create-desks / audio-benches / audio-ab / money-desks
            // / shop-stands), and the creator-profile-create card
            // were all parked inside the ~613 kB Create/Shop/Business
            // family-web chunk, so opening ANY station — and the
            // Studio board — statically dragged the whole web.
            // includeDependenciesRecursively MUST stay false here:
            // with the default (true) the group chunk absorbs the
            // leaves' shared dependencies (AuthContext, api-error,
            // lib/shops, …), the whole app entry then statically
            // imports this chunk to reach them, and first load
            // REGRESSES (measured +27 kB raw during this lane). With
            // it false the chunk holds only the named leaves; their
            // dependencies keep their own homes and are imported
            // normally. The set is cycle-safe: no member imports a
            // desk or a panel component, and none of their outside
            // dependencies imports a member. Keep CreateDeskShared
            // (ResultChips) OUT: it imports the Release/Scheduler
            // desks on purpose and must stay parked with them.
            {
              name: "world-kit",
              test: /[\\/]src[\\/](?:components[\\/]world[\\/]native[\\/](?:NativeBoard|NativeCard|NativePlaceholder|NativeShelf|NativeStates|CreateDeskLeaf|CreateResultLeaf|CreatorProfileCreate)\.tsx|lib[\\/]world[\\/](?:create-desks|audio-benches|audio-ab|money-desks|shop-stands|creator-profile-create)\.ts)$/,
              priority: 0,
              includeDependenciesRecursively: false,
            },
          ],
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
