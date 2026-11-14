# Lunar Landing Site Navigator — Vi@bility42

Tool for **rapidly comparing lunar landing sites and dates**: how much Sun a site
gets, when Earth is above the horizon (direct-to-Earth communication), and how
those windows change when the mission date slips.

Built for the **NASA Space Apps Challenge 2026** challenge
[*Lunar Landing Site Navigator*](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).
Not an official NASA product.

## Why

Mission planners routinely have to move a landing date or a landing site. Existing
tools (QuickMap, Moon Trek, JPL Horizons) are built for detailed analysis of one
place at one time, not for "what happens to my power and comms budget if we slip
three weeks?".

This app answers that with a time-first workflow: pick a site and an instant, get
continuous Sun and Earth elevation curves, the resulting sunlight and
direct-to-Earth windows, the next sunset / Earthset, and the same comparison run
across the whole site catalogue at once.

## What it does

Two views share one site and one instant, so switching between them never resets
what you were looking at.

### Explorer

- **Moon globe** (NASA SVS / LRO imagery) with the lunar rotation axis drawn on
  it; drag to spin, click anywhere to drop the site there.
- **Named site markers**: round, outlined points with hover names and exact
  catalogue selection. Only the selected marker is shown; **Browse all sites**
  restores the catalogue, with a keyboard/touch picker for overlapping points.
- **Alternatives**: up to three comparable sites beneath the globe in both modes.
  Resource and calendar results carry their search criteria and dates into the
  comparison. Otherwise, sites in the same category must be within 20 percentage
  points of the selected site's sunlight, Earth visibility and joint availability.
  The list uses the current mast and 1 h sampling; it can contain fewer than three
  matches. Saved criteria are labeled and can be cleared to use the current range.
  Jumping to an operation window also carries its start and duration: alternatives
  must have 100% modeled simultaneous visibility throughout that same interval.
- **30-day lunar-cycle scrubber**: one slider through a full day/night cycle,
  plus the UTC day.
- **Plain-language verdict**: whether the site has Sun, Earth, both, and when the
  next sunset and Earthset are.
- **What you would see**: first-person sky from the site at the chosen instant,
  standing on a 300 km patch of real LOLA terrain sampled around the site. Earth
  is a textured 3D globe (Blue Marble day / Black Marble night) with a live
  terminator, and the three Deep Space Network complexes are drawn on it. The
  same elevation grid sets the skyline that the sunlight and link flags use.
- **Solar array card**: recommended tilt, 16-point heading, the azimuth turn rate
  a Sun-tracking array needs, and average W/m².
- **Mission-window planner**: searches 1–72 hours of continuous sunlight plus
  direct Earth visibility from the playhead, jumps to the earliest match, and
  writes a printable HTML mission brief.

### Expert

- **Timeline chart**: Sun and Earth elevation above the local skyline, sunlight
  and link lanes, shaded direct-to-Earth bands, hover readout with azimuth,
  skyline and Earth distance, and a click that pins the instant for the sky view.
- **Ranking**: the seven south-pole candidates scored over the same range at 1 h
  resolution, sortable by sunlight %, Earth-link %, both %, or longest unbroken
  link. Click a row to open that site.
- **Find windows (inverse search)**: set the mission length and the minimum
  joint / sunlight / Earth percentages, and a site × start-date calendar scores
  every candidate at 3 h resolution, rings the cells that clear the bar, and
  lists the earliest feasible start per site. Click a cell or a result to open
  that scenario in the single-site view.
- **Solar panel**: best fixed tilt and heading for the range, plus a W/m²
  comparison of two-axis tracking, that fixed panel and a flat deck.
- **Resources**: compare south-pole candidates using regional FeO, Ti, or Th
  abundances cataloged by NASA Moon Trek, with original Lunar Prospector numeric
  source bins. Set sunlight/Earth minimums and a resource weight; inspect source
  footprints or nearby regional maxima without implying lander-scale deposits.
  See [data provenance, reproducible import, and scoring](docs/MINERAL_DATA.md).
- **Sky view** for any instant pinned on the timeline: drag to look around,
  scroll to zoom, and station labels appear once the field of view is narrow
  enough.

The first-person Sun and Earth use their true angular diameters. Focus Sun/Earth
zooms to frame a visible disc at 30% of the shorter viewport dimension and
keeps the camera following that body while time changes; dragging restores a
free camera. Focusing a hidden body keeps the current zoom, including in cutaway
mode. Ground and celestial pixels are clipped against the same skyline
profile as the visibility calculations, including mast dip while terrain loads.
The regional foreground remains illustrative. See-through ground deliberately
reveals occulted bodies and is labeled as a cutaway, not physical visibility.
Earth line of sight means some part of the disc clears the skyline; an actual
DSN link additionally requires an antenna in view (shown in the station list).
Manual zoom reaches a 0.5° field of view (about 160× magnification relative to the
initial view). Reset zoom restores the wide 70° view.

**Mast height** (0–20 m) is set in the header and applies to both views: it lifts
the eye above the terrain skyline, lowering the horizon in every direction, and
that skyline feeds sunlight, Earth visibility, power, the fixed-panel search and
the ranking.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5180
npm test           # model regression suite (vitest)
npm run build      # type-check + static build in dist/
npm run typecheck  # tsc --noEmit
npm run check      # tests and build together
```

No API keys, no server: the ephemeris is computed in the browser.

## Sites

22 curated sites in `src/lib/astro/sites.ts`, plus arbitrary selenographic
coordinates:

| Group | Entries |
| --- | --- |
| Apollo | 11, 12, 14, 15, 16, 17 |
| International | Luna 9, Surveyor 7, Chang'e 4, 5, 6, Chandrayaan-3, SLIM |
| CLPS / commercial | IM-1 Odysseus (Malapert A), Blue Ghost 1 |
| Artemis / south pole | Mons Mouton, Malapert Massif, Connecting Ridge, Shackleton rim, de Gerlache rim, Cabeus (LCROSS impact), Lunar South Pole |

`approx: true` marks coordinates rounded from public maps (QuickMap, mission fact
sheets) rather than published landing-site solutions: good to a few km, fine for
lighting and link studies, not to be quoted as a precise landing solution.

## Model

| Piece | Approach |
| --- | --- |
| Sun/Moon position | `astronomy-engine` (VSOP87 / ELP-2000 series), geometric J2000 vectors |
| Moon body-fixed frame | IAU WGCCRE 2015 orientation (pole + W) with periodic libration terms |
| Observer position | The site's own radius vector is used explicitly; from the surface, Earth's parallax reaches 0.26°, about half of Earth's own apparent diameter, so the Moon-centre direction is not enough |
| Horizon | Terrain skyline from the LOLA `ldem_4` grid: 120 azimuth bins (3°), radial march to 400 km (0.25 km steps for the first 8 km) with exact lunar curvature, the eye raised by the mast. Near the poles the grid is low-passed in longitude to its real ~7.6 km resolution, because the raw 17–80 m polar columns carry noise that reads as cliffs. Falls back to the flat tangent plane while the grid loads or if it fails |
| Map layers | Buttons on the Moon globe: **Light / shadow** = % of a year that some part of the Sun clears the LOLA terrain skyline at ground level, precomputed for every 0.25° cell (`scripts/build-illumination-map.ts`, Sun every 4 h over 2026; ~7.6 km cells near the poles, 1° below 60°) → 0% marks permanent shadow (Cabeus, Shackleton floor). **Temperature** uses the nearest two-hour map sample to the selected instant: radiative equilibrium with LOLA slopes by day (subsolar ≈ 385 K), a cooling curve by night (~120 → 95 K at the equator), 40 K in permanently shadowed cells; a model, not Diviner data. The displayed site temperature uses that same map sample. **Altitude**: LOLA `ldem_4`. Named landing-site markers remain selectable on every layer. |
| High-res poles | 80–90° caps rebuilt from NASA LOLA `ldem_16` (1.9 km, 4× the global grid) in polar stereographic (`scripts/build_polar.py`): altitude at 0.75 km, year-round sunlight recomputed at 1.5 km with skylines on the 1.9 km DEM (`scripts/build-polar-illumination.ts`), temperature with the finer slopes. These caps are map layers; site planning still uses its existing `ldem_4` horizon model and validated site coordinates. The photo layer uses the 8K LROC colour mosaic where the GPU allows. |
| Sunlight | Upper limb of the 0.53° solar disc above the skyline; a partly risen Sun still lights the site, weighted by visible-disc area |
| Power | Visible-disc fraction × incidence × (1 AU / r)², for a vertical Sun-tracking array (cos e, polar-lander practice) and a flat panel (sin e). A flat panel at the pole gets ~1% of the solar constant; a vertical one ~50% |
| Fixed panel | Score = integral of max(0, normal · Sun) over the range, relative to a perfect two-axis Sun-tracking panel; searched on a 1° tilt × 10° azimuth grid |
| Earth in the sky | Textured globe oriented from Greenwich sidereal time plus precession/nutation into the site frame; matches the sub-lunar point to < 0.4° |
| DSN link | Goldstone DSS-14, Madrid DSS-63, Canberra DSS-43: a complex can talk to the site when the site sees Earth and the Moon is ≥ 10° above the station horizon |
| Windows | Boolean scan plus bisection refinement of every horizon crossing (~1 s) |
| Sampling | At most 2,400 samples per range, so a one-year curve costs the same as a month |
| Ranking | 1 h step over the full catalogue |

Two consequences worth stating plainly:

- **Libration is not bolted on.** Earth's direction from the Moon is `-r_moon`
  rotated into the body-fixed frame, so the sub-Earth point wanders out of the
  rotation model itself. That drift is exactly what makes Earth visibility from a
  polar site time dependent.
- **Terrain, not the ephemeris, decides polar lighting.** Inside a few degrees of
  the pole the Sun circles the sky instead of rising and setting, so a crater rim
  two degrees high sets whether a site is lit at all. The skyline comes from the
  LOLA grid, which is why a floor site and a rim site can differ by tens of
  percent while their ephemerides are identical.
- **The grid is 0.25°, about 7.6 km north–south.** It shows massifs and crater
  rims, not the ridge beside a lander; sites at `|lat| ≥ 80°` stay flagged in the
  UI and polar percentages are still called preliminary.

## Validation

`src/lib/astro/horizons.test.ts` checks the engine against **JPL Horizons
(DE441)** with reference values captured from the Horizons API on 2026-11-13
(`CENTER='coord@301'`, `QUANTITIES='4'` airless apparent az/el, `QUANTITIES='14'`
sub-Earth point). Because the engine uses geometric J2000 vectors while Horizons
applies light-time, aberration and deflection, a few arcseconds of difference is
expected; elevation tolerance is 0.02°, azimuth 0.05°, Earth distance 100 km.

| Case | Result |
| --- | --- |
| Sun/Earth azimuth & elevation at the Apollo 11 site and Shackleton rim, four epochs across 2028 | within tolerance, typically far inside it |
| Earth distance from the site | < 100 km |
| Sub-Earth point at ten epochs across a libration cycle | < 0.02° in latitude and longitude |
| Apollo 11 landing, 1969-07-20 20:17 UTC | Sun ≈ 10.7°, matching the historical record |

`npm test` runs 14 files / 89 tests:

| File | Covers |
| --- | --- |
| `horizons.test.ts` | the JPL comparison and the physical sanity anchors above |
| `horizon.test.ts` | skyline from a synthetic grid: curvature, crater rims, mast, azimuth interpolation, flat-model fallback |
| `skyline.validation.test.ts` | skyline on the real LOLA grid: agrees with an independent 0.1 km brute-force march (< 0.6°), no polar column cliffs, Cabeus and Shackleton floor stay at 0% sunlight, rim and ridge crests lit 70–97% of a year at 10 m (published 80–92%) |
| `timeline.test.ts` | sampling, horizon crossings, window edges, metrics |
| `earthView.test.ts` | Earth orientation, DSN geometry, station coverage |
| `panel.test.ts`, `power.test.ts`, `mast.test.ts` | fixed vs tracking power, mast dip, pointing |
| `ranking.test.ts` | far side reports 0% direct-to-Earth, sort keys, one row per site |
| `opportunity.test.ts` | mission-length search, start grid, closest attempts |
| `sites.test.ts` | coordinate provenance, east-positive longitudes, unique ids |
| `globeMath.test.ts`, `scrub.test.ts`, `terrain.test.ts`, `mission.test.ts` | globe framing, scrub conversions, LOLA interpolation, mission-window search |

## Structure

```
src/
  lib/astro/          ephemeris and geometry — no React, no Three.js
    vec.ts            vector helpers
    lunarFrame.ts     IAU Moon orientation, body-fixed <-> selenographic frames
    observer.ts       topocentric Sun/Earth geometry, skyline flags, disc visibility
    horizon.ts        LOLA terrain skyline: azimuth bins, curvature march
    timeline.ts       sampling, window search, metrics
    sites.ts          curated landing sites, terrain-critical flag
    ranking.ts        score many sites over one range
    panel.ts          fixed-panel search, tracking pointing
    scrub.ts          lunar-cycle scrubber conversions
    globeMath.ts      lat/lon <-> lunar vector, yaw to face a longitude
    earthView.ts      Earth orientation in the lunar sky, DSN stations
    mission.ts        continuous-operation window search
    opportunity.ts    site x start-date calendar search
    terrain.ts        LOLA elevation grid sampling
    types.ts          shared types
  lib/
    format.ts         duration / angle / UTC formatting
    missionBrief.ts   printable HTML mission brief
    terrainData.ts    one shared download of the elevation grid
  components/
    MoonGlobe.tsx     three.js Moon with the real LRO map
    SkyView.tsx       first-person horizon view (three.js), Earth, DSN, zoom
    lunarTerrain.ts   regional LOLA terrain patch for the sky view
    TimelineChart.tsx Sun/Earth elevation chart with bands and hover readout
    RankingTable.tsx  sortable candidate ranking
    ArrayPower.tsx    solar array and fixed-panel cards
    MissionPlanner.tsx operation-window search and brief download
    OpportunityPanel.tsx site x start-date calendar for the inverse search
  modes/
    ExplorerMode.tsx  globe, scrubber, sky, plain-language verdict
    ExpertMode.tsx    timeline, ranking, panel analysis, sky
  App.tsx             shell, mode toggle, mast control, shared site + instant
  styles.css          night mission-control theme
public/
  moon.jpg            LRO colour map (NASA SVS)
  moon-elevation.f32  LOLA ldem_4 elevation, 1440x720 float32
  earth-day.jpg       Blue Marble
  earth-night.jpg     Black Marble
  TERRAIN_SOURCES.md  provenance and resolution of the terrain data
```

## Data sources and credits

- **Ephemerides**: JPL Horizons / DE441 for validation; `astronomy-engine` for the
  runtime.
- **Terrain**: NASA Scientific Visualization Studio CGI Moon Kit, LOLA `ldem_4`
  resampled to 0.25° (~7.6 km). It drives the skyline used by the metrics, not
  just the sky view. Provenance in `public/TERRAIN_SOURCES.md`.
- **Earth and Moon imagery**: NASA Blue Marble / Black Marble and the LRO colour
  map, both from NASA SVS.
- **Landing site coordinates**: published mission coordinates and landing-site
  solutions, with `approx` flags where they are rounded from public maps.

## Limits

- **The skyline is real but coarse.** The grid is 0.25° (7.6 km) and the march is
  sampled every 1–4 km out to 400 km, so massifs and crater rims are captured,
  a ridge beside the lander is not. Polar percentages stay preliminary, and
  Shackleton's near-continuous illumination is not reproduced if the catalogued
  coordinate lands on the crater wall rather than the true rim crest.
- The grid supplies the ground datum wherever a skyline exists, so the site's
  catalogue elevation is replaced by the interpolated LOLA value (a kilometre or
  more at the poles). Without the grid the flat tangent plane and the catalogue
  elevation are used.
- The sky view exaggerates angular sizes ×3 (minimum 0.5°) so the Sun and Earth
  stay visible at a 70° field of view; the caption says so.
- One site at a time: the ranking compares metrics, not side-by-side charts.
- Ranking samples at 1 h — it is a shortlist, not a final analysis.
- Earth link windows use Earth's centre elevation; sunlight uses the visible solar
  disc.
- No export of the metrics or chart data. The mission brief is printable HTML
  only.
- A mission-window search that finds nothing means "no match in this range", not
  that the site is unusable.

## Team

Vi@bility42 — NASA Space Apps Challenge 2026.
