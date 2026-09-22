# Lochinvar Heat Pump Sizing Tool

Static site (HTML/CSS/JS). No server, build step, or Python script.

```bash
cd site && python3 -m http.server 8080   # open http://localhost:8080
```

## Heating vs. Cooling

A Heating/Cooling switch sits in the page header. The two modes are mirror
images of one another:

|                       | Heating                   | Cooling                    |
|-----------------------|---------------------------|----------------------------|
| Outdoor Design Temp   | county **HDD** column     | county **CDD** column      |
| Worst Case Temp       | HDD **−** Regional Adj.   | CDD **+** Regional Adj.    |
| Capacity curve        | `unit.heating` (−4…77°F)  | `unit.cooling` (61…110°F)  |
| Delivery Water Temps  | 86/95/105/120/140         | 44/57/64                   |
| Load line             | rises as it gets colder   | rises as it gets hotter    |
| Chart x-axis          | reversed (cold → right)   | normal (hot → right)       |
| Operating limit       | below −4°F ⇒ 0 capacity   | above 110°F ⇒ 0 capacity   |
| Accent color          | red                       | blue                       |
| Competitor comparison | shown                     | hidden (no data yet)       |

## Independent inputs per mode

Heating and Cooling each keep a **completely separate set of inputs**. Typing
10,000 BTU in Cooling doesn't touch the 100,000 sitting in Heating; changing
the Cooling Lockout Temp doesn't disturb the Heater Shutdown Temp. Switching
modes banks the outgoing mode's values and restores the incoming mode's.

Per-mode: Design Conditions source, Delivery Water Temp, Shutdown/Lockout
Temp, BTU Design Load, Design Temp, Worst Case toggle + temp, competitor
graph toggle.

**Shared** (deliberately): Heat Pump Model, State, County. These describe the
physical unit and the physical building, which don't change between heating
and cooling season. Changing the county updates both modes' design temps from
that county's HDD/CDD columns.

**Reset to Defaults** resets only the current mode's inputs and stays on the
current mode. The other mode's values are left untouched.

## Competitor data in cooling mode

Competitor cooling capacities haven't been supplied, so in cooling mode the
comparison table, the graph checkbox, and the chart series are hidden. **No
code was deleted.** To enable later:
1. Add a `"coolingPoints": [ {"od": <F>, "capacity": <BTU/h>}, ... ]` array
   next to the existing `"points"` array for each competitor in
   `data/capacity.json`.
2. Set `COMPETITORS_HAVE_COOLING = true` at the top of `calc.js`.

## Editing capacity.json

```json
{
  "units": {
    "centrus": {
      "displayName": "Centrus",
      "heating": { "120": [ {"od": -4, "capacity": 34804}, ... ] },
      "cooling": { "44":  [ {"od": 61, "capacity": 37713}, ... ] }
    }
  },
  "competitorsSmall": { "CC32-40": { "displayName": "Competitor Unit A", "points": [...] } },
  "competitorsLarge": { ... }
}
```

Add a unit by copying a block and giving it a new key; remove one by deleting
its block. Water-temp dropdown options are read directly from whatever keys
exist under `heating`/`cooling`, so a unit with different rated water temps
just works. **Watch your commas/brackets** — nothing validates the JSON.

## Change log

- **v2.1**
  - **Independent inputs per mode.** All system/design inputs are now stored
    per mode and restored on switch (see above). Previously BTU load and
    shutdown temp bled across modes or snapped back to defaults.
  - **Lookup tiles toggle visibility** instead of greying out — cooling mode
    shows only Cooling Design Temp + Est. Highest Temp, heating shows only
    Heating Design Temp + Est. Lowest Temp.
  - **Reset to Defaults no longer changes mode.** It resets only the current
    mode's inputs and leaves the other mode's snapshot alone.
- **v2.0** — Cooling mode added (CDD design temp, CDD + adj worst case,
  cooling capacity curve, flipped validation/axis, blue accent, competitor
  UI hidden behind `COMPETITORS_HAVE_COOLING`).
- **v1.7** — Renamed to Heat Pump Sizing Tool; input validation;
  print/export; reset button; warning banner under Design Conditions.
- **v1.6** — Design Conditions source toggle; competitor graphing;
  anonymized competitor names; Lochinvar theming; build script removed.
- **v1.5** — Multi-unit support; Design Day reference line.
- **v1.4** — Zero capacity beyond rated limit; operating range lines.
- **v1.3** — Auto-recalculation; shaded load regions.
- **v1.2** — Chart corrected to match workbook data.
- **v1.1** — Chart x-axis direction.
- **v1.0** — Initial build.
