## Development

```sh
astro dev --background     # Start dev server in background
astro dev stop             # Stop background server
astro dev status           # Check if running
astro dev logs             # View logs
```

## Commands

| Command | Action |
|---------|--------|
| `npm run dev` | Start dev server (`localhost:4321`) |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview production build locally |
| `npm run astro` | Run any Astro CLI command |

## Stack

- **Astro 7** with SSR (React islands via `@astrojs/react`)
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin (no PostCSS config, no `tailwind.config.*` — use `@import "tailwindcss"` in CSS)
- **React 19** — interactive component in `src/components/`
- **TypeScript** — strict mode, JSX with `react-jsx` transform
- **Node >=22.12.0**

## Architecture

- Single page (`src/pages/index.astro`) — savings simulator in Spanish
- Core logic: `src/lib/calculations.ts` — pure functions for mortgage/house expense/savings projection
- UI component: `src/components/SavingsSimulator.tsx` — single `useState`-driven React form
- Fonts: **Signika** (headings), **Heebo** (body) — loaded via Google Fonts in `src/styles/global.css`
- Locale: `es-ES`, currency: `EUR`
- No tests, no linter/formatter config, no CI — minimal template

## Skills

Loaded via `skills-lock.json`:

- **`astro`** — Astro component/page patterns, content collections, routing
- **`frontend-design`** — visual design guidance
- **`tailwind-css-patterns`** — Tailwind utility/component/layout patterns