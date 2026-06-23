---
name: Vite react-babel JSX generics
description: Why generic JSX call sites break the Bow Down Vite build
---

The Vite `vite:react-babel` parser throws `BABEL_PARSER_SYNTAX_ERROR` on generic component call sites written as `<Segmented<MyType> .../>`.

**Rule:** keep generic components (e.g. `Segmented<T extends string>`) but never instantiate the type parameter in JSX. Instead pass a typed `options: {value: T; label: string}[]` array (often built with `as T`) so T is inferred.

**Why:** the JSX transform can't parse the angle-bracket generic at the call site.

**How to apply:** see `artifacts/bow-down-visuals/src/components/editor/controls.tsx` (`Segmented`) and its callers in `editor/music/*` and `editor/sections/*`.
