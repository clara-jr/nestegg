# NestEgg

Vibe-coded financial simulator in Spanish that projects personal wealth — savings, mortgage and investments — over time. Includes a savings simulator, a retirement age calculator and an affordability calculator.

## Stack

- **Astro 7** — static generation, React islands via `@astrojs/react`
- **React 19** — interactive components
- **Tailwind CSS v4** — styling via `@tailwindcss/vite`
- **TypeScript** — strict mode
- **Recharts** — wealth evolution charts
- **Node >=22.12.0**

## Architecture

- **`src/pages/index.astro`** — single page with navigation between simulators
- **`src/components/SavingsSimulator.tsx`** — savings simulator (house purchase, mortgage, family loan, savings distribution)
- **`src/components/RetirementSimulator.tsx`** — retirement calculator (optimal retirement age, pension, residency expenses)
- **`src/components/AffordabilitySimulator.tsx`** — affordability calculator (max house price given income & savings)
- **`src/lib/calculations.ts`** — pure functions: savings projection, mortgage, taxes
- **`src/lib/retirement.ts`** — retirement logic: pension estimation, age simulation, required savings
- **`src/lib/affordability.ts`** — affordability logic: max mortgage, down payment, constraint analysis
- **`src/lib/sharedStore.ts`** — simple store to share data between simulators
- **`src/styles/global.css`** — global styles, fonts (Signika + Heebo), Tailwind setup

## Local development

```sh
npm run dev          # Dev server at localhost:4321
npm run build        # Static build to ./dist/
npm run preview      # Preview the production build
```

## Deployment

Automatically deployed to GitHub Pages on every push to `main` via `.github/workflows/deploy.yml`.

## Regional settings

- Language: Spanish (`es-ES`)
- Currency: Euro (EUR)
- Tax: Spanish savings scale (19%–26%)
