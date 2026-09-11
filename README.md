# NestEgg

Vibe-coded financial simulator in Spanish that projects personal wealth — savings, mortgage and investments — over time. Includes a savings simulator, a retirement age calculator, an affordability calculator, a banking "data importer/aggregator" and a joint-expenses view.

## Stack

- **Astro 7** — static generation, React islands via `@astrojs/react`
- **React 19** — interactive components
- **Tailwind CSS v4** — styling via `@tailwindcss/vite` (no PostCSS config, no `tailwind.config.*` — Tailwind theme lives in `global.css` `@theme`)
- **TypeScript** — strict mode
- **Recharts** — evolution charts
- **Vitest + jsdom** — unit tests in `src/lib/__tests__/`
- **Node >=22.12.0**

## Architecture

- **`src/pages/index.astro`** — single page, nav between simulators (desktop pill bar, mobile collapsed dropdown)
- **`src/components/SavingsSimulator.tsx`** — savings simulator (house purchase, mortgage, family loan, savings distribution)
- **`src/components/RetirementSimulator.tsx`** — retirement calculator (optimal retirement age, pension, residency expenses)
- **`src/components/AffordabilitySimulator.tsx`** — affordability calculator (max house price given income & savings)
- **`src/components/InvestmentsSimulator.tsx`** — bank statement import (CSV/XLS) + portfolio P&L, interest and expense aggregation
- **`src/components/JointSimulator.tsx`** — joint finances: aggregated income/expenses/savings across profiles (Convivencia)
- **`src/components/ProfileSelector.tsx`** — manage family profiles, per-profile color and contributions
- **`src/components/BackupRestore.tsx`** — export/restore full or per-profile backups (JSON)
- **`src/components/common/`** — shared UI: custom `Select` (replaces native `<select>`), `DateRangeFilter` + `DateInput`, `SummaryCard`, `ExpenseCategoryIcon`, tooltips, scrollable tables, form/result sections
- **`src/lib/calculations.ts`** — pure functions: savings projection, mortgage, taxes
- **`src/lib/retirement.ts`** — retirement logic: pension estimation, age simulation, required savings
- **`src/lib/affordability.ts`** — affordability logic: max mortgage, down payment, constraint analysis
- **`src/lib/investments.ts`** — portfolio P&L, interest & expense aggregation, category detection, shared time-window math
- **`src/lib/joint.ts`** — joint expense aggregation and per-member contributions
- **`src/lib/bankImports.ts`** — bank CSV/XLS parsers (Trade Republic, MyInvestor, CaixaBank)
- **`src/lib/prices.ts`** — current price fetch (Yahoo via CORS proxies)
- **`src/lib/sharedStore.ts`** — cross-simulator state sync + `useLocalStorage` hook
- **`src/lib/profiles.ts`** — profile model, colors, default config
- **`src/styles/global.css`** — Tailwind theme, brand palette, fonts, global styles

## Styling tokens

- Fonts: **Signika** (headings) + **IBM Plex Sans** (body)
- Brand palette: emerald `#00bc7d` / red `#ff637e` (warm scales in `@theme`)
- Warm gray scale: body text ~`#706f6c`, titles `#1b1b18`
- Surfaces: cards `bg-zinc-100` with `border-[#e3e3e0]/70`, sections `bg-[#fdfdfc]`, body `#fdfdfc`

## Local development

```sh
npm run dev          # Dev server at localhost:4321
npm run build        # Static build to ./dist/
npm run preview      # Preview the production build
npm run test         # Vitest unit tests
```

## Deployment

Automatically deployed to GitHub Pages on every push to `main` via `.github/workflows/deploy.yml`.

## Regional settings

- Language: Spanish (`es-ES`)
- Currency: Euro (EUR)
- Tax: Spanish savings scale (19%–26%)