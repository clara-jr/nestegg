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
  pages/index.astro              — Single page, nav between simulators (4 tabs)
  components/
    SavingsSimulator.tsx         — Savings projection form + results
    RetirementSimulator.tsx      — Retirement age calculator
    AffordabilitySimulator.tsx   — Affordability calculator (max house price)
    InvestmentsSimulator.tsx     — Bank statement import (CSV/XLS) + portfolio/interest/expenses
    JointSimulator.tsx           — Aggregated income/expenses/savings + joint expenses (Convivencia)
    ProfileSelector.tsx          — Family profiles, colors, contributions
    BackupRestore.tsx            — Export/restore backups (JSON, full or per-profile)
    common/
      form/Select.tsx            — Custom Select (replaces native <select>) with groups/icons/sizes
      form/DateRangeFilter.tsx   — Preset time filter (month/3m/6m/year/custom)
      form/DateInput.tsx         — Custom date picker
      info/                      — Tooltip, ChartTooltip, IncomeExpenseTooltip, NoteBanner/NoteCard
      results/                   — SummaryCard, ScenarioCard, ChartRangeSummary, CategoryBreakdownSections,
                                   CategoryIcon (ExpenseCategoryIcon + category colors), ScrollableTable, sections
      layout/SimulatorLayout.tsx — Shared layout for simulators
  lib/
    calculations.ts              — Mortgage/tax/savings pure functions
    retirement.ts                — Pension estimation, path simulation
    affordability.ts             — Max mortgage, down payment, constraint analysis
    investments.ts               — Portfolio P&L, interest & expense aggregation/categories + time-window utils
    joint.ts                     — Joint expense aggregation and per-member contributions
    bankImports.ts               — Bank CSV/XLS parsers (Trade Republic, MyInvestor, CaixaBank)
    prices.ts                    — Current price fetch (Yahoo via CORS proxies)
    sharedStore.ts               — Cross-simulator state sync + useLocalStorage hook
    profiles.ts                  — Profile model, colors, default config
    utils.ts                     — Shared helpers
    __tests__/                   — Vitest unit tests (calculations, retirement, affordability, investments, bankImports, prices, profiles)
  styles/global.css              — Tailwind v4 theme, fonts (Signika + IBM Plex Sans), brand palette, surfaces
```

## Stack

- **Astro 7** with SSR (React islands via `@astrojs/react`)
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin (no PostCSS config, no `tailwind.config.*` — theme in `@theme` inside `global.css`)
- **React 19** — interactive components
- **TypeScript** — strict mode, JSX with `react-jsx` transform
- **Recharts** — line/bar charts
- **Vitest + jsdom** — tests (`npm run test`)
- **Node >=22.12.0**

## Styling

- Design tokens live in `global.css` `@theme`: brand emerald `#00bc7d` and red `#ff637e` scales, warm gray scale (body text ~`#706f6c`, titles `#1b1b18`), zinc backgrounds
- Fonts: Signika (headings), IBM Plex Sans (body) — `var(--font-sans)`
- Surfaces: cards/inputs use `from-zinc` backgrounds, sections `rounded-2xl` on `#fdfdfc`, body `#fdfdfc`
- Custom `<Select>` components are preferred over native `<select>` and must keep a fixed width (e.g. `w-44`) so they don't resize on selection
- Form field wrappers for shared inputs: InputField, HouseTypeField, SingleRangeSlider, DistributionSlider, MemberCard, AddMemberButton

## Architecture

- Single page (`src/pages/index.astro`) — nav between four simulators
- Nav: clickable cards (desktop side-by-side, mobile collapsed dropdown), active tab state
- Savings simulator: house purchase + mortgage + family loan + savings distribution
- Retirement simulator: optimal retirement age, pension estimates, residency expenses
- Affordability simulator: max house price given income & savings, mortgage & tax estimates
- Investments simulator: import bank statements (CSV/XLS) and analyze portfolio, interests and expenses by category
- Joint simulator (Convivencia): aggregated income/expenses/savings across profiles + per-member contribution to shared categories
- Shared store syncs data between simulators (mortgage params, contribution, rates, profiles)
- Locale: `es-ES`, currency: `EUR`
- Tax: Spanish savings bracket scale (19%–26%)
- Tests: Vitest unit tests for pure libs; no linter/formatter config
- CI: GitHub Actions → GitHub Pages on push to `main`

## Skills

Loaded via `skills-lock.json`:

- **`astro`** — Astro component/page patterns, content collections, routing
- **`frontend-design`** — visual design guidance
- **`tailwind-css-patterns`** — Tailwind utility/component/layout patterns
- Skills are in `.agents/skills/`
