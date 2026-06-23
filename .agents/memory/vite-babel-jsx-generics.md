---
name: Vite babel JSX generic type arguments
description: Generic type args on JSX elements typecheck but break Vite's babel parser
---

Generic type arguments written directly on a JSX element — e.g. `<Segmented<ExportResolution> value=... />` — pass `tsc --noEmit` cleanly but crash the `vite:react-babel` plugin with `Unexpected token` at runtime/HMR. The replit-cartographer metadata transform makes it worse (it injects attributes before the `<T>`).

**Why:** `tsc` parses JSX generics fine, but the babel parser used by `@vitejs/plugin-react` does not support generic type arguments on JSX opening elements. So typecheck passing is NOT sufficient proof the app compiles — always confirm via the dev-server logs / a screenshot.

**How to apply:** Never put `<T>` type args on a JSX element. Let the generic infer from props instead: extract typed option/value arrays (e.g. `const OPTS: { value: T; label: string }[] = [...]`) and pass them as props so TypeScript infers the component's type parameter. If inference fails, cast the handler arg rather than annotating the JSX tag.
