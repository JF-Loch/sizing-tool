# Lochinvar Heat Pump Sizing Tool

Static site (HTML/CSS/JS). `cd site && python3 -m http.server 8080`

## Competitor cooling comparison — water-temp matching

Competitor cooling data is published at different leaving-water temps than
the Centrus, so competitor capacity is interpolated to the user's selected
Delivery Water Temp:

| Unit            | Published water out | Centrus 44°F | Centrus 57°F | Centrus 64°F |
|-----------------|---------------------|--------------|--------------|--------------|
| CC32-40 / CC32-60 | 45 / 48 / 54°F    | extrapolated | extrapolated | extrapolated |
| SIM-036 / SIM-060 | 45 / 59°F         | extrapolated | interpolated | extrapolated |

At each outdoor temp the two published water columns that bracket the
selected temp are linearly interpolated. Outside the published range the two
nearest columns are linearly extrapolated and the value is marked `*` in the
table and chart legend. Above a competitor's hottest published outdoor temp
(CC32: 110°F, SIM: 104°F) its value is N/A.

Heating competitor comparison is unchanged (fixed 105°F reference column).

To add competitor cooling data: each competitor in `data/capacity.json` has a
`"cooling": { "<water temp>": [ {"od": <F>, "capacity": <BTU/h>}, ... ] }`
block. Add or edit water-temp columns there; the interpolation picks them up
automatically.

## Change log
- **v2.2** — Competitor cooling comparison added (Competitor Cooling Data
  tab), interpolated/extrapolated to the selected delivery water temp.
  Competitor table and graph toggle now shown in cooling mode. "Unavailable
  in cooling" note removed.
- **v2.1** — Independent per-mode inputs; lookup tiles toggle visibility;
  Reset stays on current mode.
- **v2.0** — Cooling mode.
- **v1.7** — Rename, validation, print/export, reset.
- Earlier: see previous releases.
