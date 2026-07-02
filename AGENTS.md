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

## Project files

```
.github/workflows/deploy.yml    — GitHub Pages deployment
astro.config.mjs                 — Astro config (site/base for GH Pages)
src/
  pages/index.astro              — Single page, nav between simulators
  components/
    SavingsSimulator.tsx         — Savings projection form + results
    RetirementSimulator.tsx      — Retirement age calculator
  lib/
    calculations.ts              — Mortgage/tax/savings pure functions
    retirement.ts                — Pension estimation, path simulation
    sharedStore.ts               — Cross-simulator state sync
  styles/global.css              — Tailwind CSS, fonts (Signika, Heebo)
```

## Stack

- **Astro 7** with SSR (React islands via `@astrojs/react`)
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin (no PostCSS config, no `tailwind.config.*` — use `@import "tailwindcss"` in CSS)
- **React 19** — interactive components
- **TypeScript** — strict mode, JSX with `react-jsx` transform
- **Recharts** — line charts for savings evolution
- **Node >=22.12.0**

## Architecture

- Single page (`src/pages/index.astro`) — two calculators in Spanish
- Nav: two clickable cards (desktop side-by-side, mobile collapsed dropdown)
- Savings simulator: house purchase + mortgage + family loan + savings distribution
- Retirement simulator: optimal retirement age, pension estimates, residency expenses
- Shared store syncs data between simulators (mortgage params, contribution, rates)
- Locale: `es-ES`, currency: `EUR`
- Tax: Spanish savings bracket scale (19%–26%)
- No tests, no linter/formatter config
- CI: GitHub Actions → GitHub Pages on push to `main`

## Skills

Loaded via `skills-lock.json`:

- **`astro`** — Astro component/page patterns, content collections, routing
- **`frontend-design`** — visual design guidance
- **`tailwind-css-patterns`** — Tailwind utility/component/layout patterns
- Skills are in `.agents/skills/`
