# AGENTS.md

Vi@bility42 — Lunar Landing Site Navigator. Vite + React 19 + TypeScript app
that compares lunar landing sites by sunlight and direct-to-Earth visibility.
Physics lives in `src/lib/astro/` and is validated against JPL Horizons.

Two views share one site and one instant: **Explorer** (globe, sky, timeline,
plain-language verdict) and **Expert** (timeline, ranking table, panel tilt).

## Commands

| Task | Command |
| --- | --- |
| Dev server | `npm run dev` → http://localhost:5180 |
| Tests | `npm test` (Vitest: 7 files, 43 tests) |
| One test | `npx vitest run src/lib/astro/horizons.test.ts -t "Apollo 11"` |
| Types | `npm run typecheck` |
| Full gate | `npm run check` (tests + build) |
| Build | `npm run build` → `dist/` |

`dist/` is generated; never edit it.

### Windows shell note

Node is at `C:\Program Files\nodejs` and may not be on PATH. PowerShell blocks
`.ps1` shims, so call `npm.cmd`:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"; & npm.cmd test
```

## Layout

```
src/lib/astro/       pure physics — no React, no DOM, no three
  vec.ts             Vec3 helpers, RAD / DEG constants
  lunarFrame.ts      IAU Moon pole + W; body-fixed <-> inertial
  observer.ts        siteVector, localFrame, skyAt(t), subEarthPoint(t)
  timeline.ts        sampleRange, findWindows, metrics, buildTimeline()
  panel.ts           fixed solar-panel tilt, best panel heading
  ranking.ts         rankSites + sort keys for the comparison table
  scrub.ts           day/minute <-> epoch helpers
  globeMath.ts       lat/lon <-> lunar vector, yaw-to-face-longitude
  sites.ts           curated sites, customSite, isTerrainCritical
  types.ts           shared interfaces
src/lib/format.ts    duration / UTC / day / degree / hours / percent
src/components/      MoonGlobe (three.js), SkyView (three.js),
                     TimelineChart (SVG + hover), RankingTable
src/modes/           ExplorerMode, ExpertMode — screen composition
src/App.tsx          shell, Explorer/Expert toggle, shared site + instant
```

Data flow: `site → createObserver → sampleRange → findWindows → metrics → chart`.
`buildTimeline(site, t0, t1, stepMs)` is the single entry point for all of it.
`three` is only allowed in `src/components/` (globe and sky dome).

## Invariants — do not break

- Public API uses **degrees**; internal math uses radians (`RAD` / `DEG`).
- `lat` north-positive, `lon` **east-positive** selenographic.
- `azimuth`: 0 = north, 90 = east, clockwise. Compare with angular wrap
  (`angleDelta`), never plain subtraction.
- All times are **UTC epoch ms**. No `Date.now()` or local `Date` getters in
  `src/lib/astro`.
- `elevation` is measured from the flat local tangent plane; negative = below
  the horizon.
- No atmospheric refraction. The Moon has no atmosphere.
- Earth direction is topocentric: use `siteVector`, not the Moon centre
  (0.26° error, half of Earth's disc).
- Earth direction = `-r_moon` rotated into the body-fixed frame.
- Window edges are bisection-refined to ~1 s; keep that behaviour.
- The two modes share state in `App.tsx`; switching views must not reset site,
  day, or time.

## Testing

- Reference is JPL Horizons (`DE441`, `CENTER='coord@301'`, `QUANTITIES='4'`);
  recipe in `.opencode/skills/lunar-astro-validation/references/horizons.md`.
- Tolerances: 0.02° elevation, 0.05° azimuth, 100 km Earth distance.
- Never loosen a tolerance to get green. State expected / actual / delta first.
- Do not mock `astronomy-engine`; use fixed dates and captured reference values.
- New physics needs a table-driven test plus one physical sanity anchor.
- Pure helpers (globe, panel, ranking, scrub) are unit-tested; components are
  verified by props and a manual render, not snapshots.

## Style

- TypeScript strict, ESM, no semicolons, single quotes, 2-space indent.
- Named exports in `lib/`; default export for React components.
- `src/lib/astro` must not import React, `three`, or touch the DOM.
- Numeric literals use separators: `86_400_000`, `149_597_870.7`.
- Format user-facing numbers through `src/lib/format.ts`; no ad-hoc `toFixed`
  in JSX.
- Memoize `buildTimeline` on `(site id, lat, lon, elevationM, from, to, step)`.

## UI / visual rules

- Tokens live in `src/styles.css` `:root`; no new hex values in components.
- `--sun` / `--earth` / `--joint` are data, not accents. One meaning each.
- Changing numbers use `font-variant-numeric: tabular-nums`.
- Contrast: 4.5:1 text, 3:1 meaningful lines, checked at 1280×720 on a
  projector and in greyscale.
- `prefers-reduced-motion: reduce` removes every transition and reveal.
- Colour never encodes meaning alone; bands are labelled in a legend.
- WebGL surfaces must degrade to a readable message, never a blank canvas.

## Scope / honesty

- Flat horizon only. No LOLA terrain masks, so polar illumination is a proxy;
  `isTerrainCritical` sites are flagged in the UI.
- `approx: true` coordinates are km-accurate; never tune physics to them.
- Not implemented: terrain shadowing from real DEMs, export, live Horizons.
- UI copy must not imply precision the model does not have.

## Skills (`.opencode/skills/`)

**Design / frontend**

| Skill | Use |
| --- | --- |
| `impeccable` | Full design pass: shape, critique, audit, polish, typeset, colorize, layout, animate, harden, document. Apache-2.0, from `pbakaus/impeccable`. |
| `design-taste-frontend` | Anti-slop taste system for marketing/landing surfaces. Heavy (assets + browser gate); use for the submission page, not the tool UI. MIT. |
| `frontend-design` | Aesthetic direction, typography, palette, layout; avoids templated defaults. Anthropic, Apache-2.0. |
| `web-interface-guidelines` | ~120 MUST/SHOULD/NEVER craft rules: focus, targets, forms, motion, dark mode, contrast. Vercel Labs, MIT. |
| `emil-design-eng` | Interaction polish: press/hover, popover origin, transitions vs keyframes, timing. Emil Kowalski. |
| `better-ui` | Exact polish values: concentric radii, optical alignment, layered shadows, icon states, enter/exit motion, cheap transition properties. Jakub Krehel, MIT. |
| `visual-identity` | This app's own tokens, chart colour semantics, spacing, motion budget, anti-patterns. |

**Engineering**

`grill-me` / `grilling` plan interviews · `token-optimization` context hygiene ·
`tdd` · `diagnosing-bugs` · `code-review` · `lunar-astro-validation` ·
`svg-timeline` chart work · `hackathon-demo` demo prep · `handoff` continuity.

Rule of thumb: `visual-identity` and `web-interface-guidelines` govern the tool
screens; `design-taste-frontend` and `frontend-design` govern landing/submission
copy. When they conflict with `styles.css`, the tokens win.
