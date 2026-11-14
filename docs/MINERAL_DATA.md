# South-pole resource selection

Expert → Resources combines the existing one-hour sunlight/Earth-visibility
ranking with a user-selected Lunar Prospector abundance objective. This is an
exploratory planning score, not a mineral reserve or extraction estimate.

## Sources

Primary discovery and provenance: [NASA Moon Trek](https://trek.nasa.gov/moon/),
its [service catalog](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon),
and the layer metadata linked below. Numeric inputs are the original ASCII
products at [NASA PDS Geosciences](https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html).
The source team identifies these as special products, not a PDS peer-reviewed dataset.

| Objective | Trek layer | Numeric table | Original units and bins |
| --- | --- | --- | --- |
| Iron oxide | [LP_GRS_Fe_Clr_Global_2ppd](https://trek.nasa.gov/moon/TrekWS/rest/cat/metadata/fgdc/html?label=LP_GRS_Fe_Clr_Global_2ppd) | [ironhd.txt](https://pds-geosciences.wustl.edu/missions/lunarp/reduced/ironhd.txt) | FeO weight percent; 0.5° cells |
| Titanium | [LP_GRS_TitaniumAbundance_2ppd](https://trek.nasa.gov/moon/TrekWS/rest/cat/metadata/fgdc/html?label=LP_GRS_TitaniumAbundance_2ppd) | [titanium2d.txt](https://pds-geosciences.wustl.edu/missions/lunarp/reduced/titanium2d.txt) | Elemental Ti weight percent; approximately 60 × 60 km equal-area bins |
| Thorium | [LP_GRS_Th_Clr_Global_2ppd](https://trek.nasa.gov/moon/TrekWS/rest/cat/metadata/fgdc/html?label=LP_GRS_Th_Clr_Global_2ppd) | [thoriumhd.txt](https://pds-geosciences.wustl.edu/missions/lunarp/reduced/thoriumhd.txt) | Th parts per million; 0.5° cells |

Reviewed 2026-11-14. Trek's Fe layer description says Fe weight percent, but the
original ironhd ASCII header and PDS product description explicitly say **FeO**.
The application follows the numeric product header without converting it.
Trek's 0.5° titanium display raster does not improve the approximately 60 km
source bins. The original Ti cap is one bin from 90° S to 89° S across every
longitude. Several candidates therefore share exactly the same Ti measurement.

Trek's Kaguya MI mineral-deconvolution products, including olivine, pyroxene,
and plagioclase weight percentages, cover only ±50° latitude. They are not used
to invent mineral-species abundances at south-pole sites. Thorium is not a
measurement of rare-earth reserves; hydrogen is not substituted for water ice.

## Import and reproducibility

`python3 scripts/import-lunar-minerals.py` downloads the three original tables,
checks pinned SHA-256 hashes and full row counts, verifies units and grid order,
and writes `public/resources/lp-south-pole.json`. `--cache /tmp` can reuse
`lunar-ironhd.txt`, `lunar-thoriumhd.txt`, and `lunar-titanium2d.txt`.
The manifest stores each source URL, SHA-256 and Trek layer ID. No account or
runtime network API is needed: the ~298 kB numeric subset ships with the app.

The subset retains 90° S to 75° S, all longitudes, original numeric values and
bin boundaries. FeO and Th retain 21,600 cells each; Ti retains 195 bins. FeO/Th
arrays remain south-to-north and west-to-east at 720 columns and 30 rows. No
interpolation, color-map decoding, upsampling, smoothing, or imputation occurs.
The importer fails if upstream bytes change; review the scientific product before
replacing pinned hashes. This also detects truncated or substituted downloads.

Sampling uses containing bins with half-open boundaries and east-positive
longitude wrapped to [-180, 180). The south pole is included; 75° S is outside
this subset. Missing, corrupt, or unavailable data never becomes zero abundance.
Grid spacing is not the instrument's physical resolving power. No per-cell
uncertainty is supplied by these three ASCII products; small numerical differences
cannot establish statistically significant enrichment.

## Nearby regional maxima

The default samples only the landing site's containing bin. Optional 25/50 km
searches consider that bin plus other source bins whose **centres** lie within
the chosen lunar great-circle distance (reference radius 1737.4 km). The highest
value wins; ties retain the containing bin. Displayed off-site distances refer
to bin centres, not deposits or traversable paths. At-site abundances remain
visible for all three products even when using nearby context for the score.
No illumination, radio coverage, rover travel, or accessibility at the other bin
is inferred from the landing site's operational metrics.

## Planning score and feasibility

Candidates must have a loaded terrain skyline, source coverage, some simultaneous
Sun/Earth visibility, and pass all three configurable percentage thresholds.
Initial minimums: sunlight 50%, Earth visibility 50%, simultaneous visibility 25%.
These apply to the selected date range and mast height, using the existing
operational ranking. They are percentage filters, not continuous mission windows.

For eligible candidates:

```
resourceScore = min(100, abundance / targetAbundance × 100)
planningScore = (1 − resourceWeight) × simultaneousVisibilityPct
              + resourceWeight × resourceScore
```

The initial resource weight is 35%. Initial target abundances are FeO 10 wt.%,
Ti 1 wt.%, and Th 2 ppm. These are editable normalization targets chosen for this
UI, not NASA recommendations, detection thresholds, ore grades, or profitability
limits. Resource weight 0% reproduces ordering by simultaneous visibility among
eligible candidates; 100% orders eligible candidates by target attainment.
Missing or infeasible candidates have no score and are listed with reasons.
Equal scores use simultaneous visibility as a tiebreaker. No min/max stretching
amplifies the difference between the shortlist's minimum and maximum readings.

This module does not change the ephemeris, terrain horizon, existing operational
ranking, mission calendar, or mission brief. Use the mission planner for a
continuous operation window. Tests anchor source samples and verify coordinate
boundaries, source-bin ties, search radii, score changes, feasibility gating and
failure behavior. UI loading and retry states leave the operational ranking usable.
