# ADR 0008 — UI stack for the renderer (`apps/ui`)

**Status:** accepted · **Date:** 2026-10-30

**Context.** The screens are specified by the `aios-product-designs` prototype: a React app with
its own design system (tokens, components, motion). The first renderer in `apps/ui` was a plain
status page with hand-written CSS. Porting the prototype's screens one to one means using the
same building blocks, within this repo's rules: the renderer has no network and no Node, is
loaded from `file://`, and runs under a strict CSP (`default-src 'none'`, `font-src 'self'`).

**Decision.**

| Need | Choice | Why |
| --- | --- | --- |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`), tokens in `src/styles/app.css` | Same tokens and class names as the prototype, so screens port without rewriting |
| Accessible primitives | Radix UI (`radix-ui`) | Radio cards, checkbox, tooltip and menu with keyboard and screen-reader support |
| Icons | `lucide-react` | Used by the prototype |
| Motion | `motion` | Step transitions, drawn check marks; honours reduced motion |
| Routing | `react-router` 7 with `HashRouter` | Path routing cannot work under `file://`; hash routes can |
| Feature state | `zustand`, one store per feature | Small; holds simulated data until each endpoint exists |
| Server state | `@tanstack/react-query` (already present) | For bridge calls once endpoints land |
| Fonts | `@fontsource` packages (Public Sans, IBM Plex Mono, Gloock) | Bundled into `dist`, so `font-src 'self'` holds; no font CDN |

Versions are pinned to majors that support React 18, which the app already uses.

Structure: one feature = one folder in `src/features/` with an `index.ts` as its public surface.
Features never import each other; `src/app/` joins them (routes, `session.ts`). Design-system
primitives live in `src/components/ui/`. `src/bridge/index.ts` stays the only file that touches
`window.aios`.

**Consequences.**
- The built UI keeps the strict CSP: fonts, wordmark and styles are local files or inlined.
- Assets must be imported (`import url from "@/assets/..."`), never referenced as `/path`,
  because `/` does not resolve under `file://`.
- The single JS bundle is about 580 KB. That is fine for a desktop app loaded from disk; split it
  only if start-up time shows a problem.
- Screens are ported from the prototype's code, so design changes are made there first and then
  copied across.

**Update (2026-11-05): all prototype screens ported, one simulated store.**
- Every remaining screen was ported from the prototype's code: chat, evidence, project settings
  and project dialogs, models, settings, search and restore.
- The per-feature stores were replaced by the prototype's single simulated backend, now in
  `src/bridge/sim/`, behind the endpoint façade `src/bridge/api.ts`. One store keeps the screens
  consistent (a model installed in setup appears in Models; an archived project leaves the
  sidebar). As endpoints land, `api.ts` functions become `window.aios` calls.
- The app shell (sidebar, project header, global dialogs, toasts) moved to `src/app/`, which is
  the only code that imports features. Pieces two features share live in `src/components/app/`.
- New dependencies for chat: `react-markdown`, `remark-gfm` and `prism-react-renderer`. The
  bundle is about 1.1 MB, still loaded from disk.
- Shortcut hints read "Ctrl" (Windows) where the prototype shows "⌘".
