# Lunar Landing Site Navigator — Viability42

Tool for **rapidly comparing lunar landing sites and dates**: how much Sun a site
gets, when Earth is above the horizon (direct-to-Earth communication), and how
those windows change when the mission date slips.

Built for the **NASA Space Apps Challenge 2026** challenge
[*Lunar Landing Site Navigator*](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

## Why

Mission planners routinely have to move a landing date or a landing site. Existing
tools (Quickmap, Moon Trek, JPL Horizons) are built for detailed analysis, not for
"what happens to my power and comms budget if we slip three weeks?".

This app answers that with a time-first workflow: pick a site and a date range,
get continuous Sun and Earth elevation curves, the resulting power and
communication windows, and the next sunset / Earthset.

## Run

```bash
npm install
npm run dev      # http://localhost:5180
npm test         # ephemeris regression tests
npm run build    # static build in dist/
```

## What is implemented

- **Curated sites** (Apollo, CLPS, international, Artemis candidate regions at the
  south pole) plus arbitrary selenographic coordinates.
- **Date range scanner** with 5 min – 1 h resolution, from a week to a year.
- **Visual timeline**: Sun and Earth elevation above the local horizon, direct-to-
  Earth bands, sunlight lanes, hover readout with azimuth and Earth distance.
- **Explorer and Expert modes** with a first-person sky view over the horizon,
  plus a solar-panel analysis that recommends the best fixed tilt and heading
  for the selected range.
- **Metrics**: % sunlight, % direct-to-Earth, % with both, longest continuous
  window, mean/max Sun height, solar power proxy, next sunset and next Earthset.

Not yet: terrain horizon masks (LOLA), multi-site side-by-side comparison,
export.

## Model

| Piece | Approach |
| --- | --- |
| Sun/Moon position | `astronomy-engine` (VSOP87 / ELP-2000 series), geometric J2000 vectors |
| Moon body-fixed frame | IAU WGCCRE 2015 orientation (pole + W) **with periodic libration terms** |
| Observer parallax | Site radius vector used explicitly; the Moon-centre direction is *not* enough — Earth's parallax from the surface reaches 0.26°, i.e. half of Earth's own disc |
| Horizon | Local tangent plane, **no atmospheric refraction** (the Moon has no atmosphere) |
| Sunlight | Upper limb of the 0.53° solar disc above the horizon; partial disc weighted by visible area |
| Power | Visible-disc fraction × incidence × (1 AU / r)², for a **vertical Sun-tracking array** (cos e, polar-lander practice) and a flat panel (sin e). A flat panel at the pole gets ~1% of the solar constant; a vertical one ~50% |
| Fixed panel | Score = integral of max(0, normal · Sun) over the range, relative to a perfect two-axis Sun-tracking panel; searched on a 1° tilt × 10° azimuth grid |
| Polar caveat | Sites at \|lat\| ≥ 80° are flagged: there the flat-horizon numbers are a first guess, terrain dominates |
| Windows | Boolean scan + bisection refinement of every horizon crossing (~1 s) |

Earth's direction from the Moon is simply `-r_moon` rotated into the body-fixed
frame, so libration comes out of the rotation model instead of being bolted on.

## Validation

`src/lib/astro/horizons.test.ts` checks the engine against **JPL Horizons (DE441)**
using `CENTER='coord@301'`, `QUANTITIES='4'` (airless apparent az/el) and
`QUANTITIES='14'` (sub-Earth point):

| Case | Result |
| --- | --- |
| Sun/Earth azimuth & elevation, Apollo 11 site and Shackleton rim | agreement < 0.02° (typically < 0.005°) |
| Earth distance from the site | agreement < 100 km |
| Sub-Earth point across a libration cycle | agreement < 0.02° |
| Apollo 11 landing, 1969-07-20 20:17 UTC | Sun ≈ 10.7°, matching the historical record |

## Structure

```
src/lib/astro/     ephemeris engine (no React, no Three.js)
  vec.ts           vector helpers
  lunarFrame.ts    IAU Moon orientation + body-fixed frame
  observer.ts      topocentric Sun/Earth geometry from a site
  timeline.ts      sampling, window detection, metrics
  sites.ts         curated landing sites
src/components/    UI (timeline chart)
src/App.tsx        screen composition
```

## Data sources

- Ephemerides: JPL Horizons / DE441, `astronomy-engine`.
- Landing site coordinates: published mission coordinates; `approx: true` marks
  values rounded from public maps (good to a few km, not to be quoted as precise).
- Next: LOLA topography for horizon masks (Quickmap / Moon Trek), which is what
  turns "flat horizon" percentages into real illumination numbers at the poles.
