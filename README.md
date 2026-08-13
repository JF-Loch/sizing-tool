# Lochinvar Heat Pump Sizing Tool — Web App

A working web version of the heat pump sizing workbook. Static site
(HTML/CSS/JS) — no server, build step, or Python script required.

## ✅ Full data set in this delivery

`data/counties.json` contains the **complete 3,142-county dataset across
all 51 states/DC**, re-extracted directly from the freshly re-uploaded
`Centrus Sizing Tool V1.1.xlsx` workbook. (A prior delivery in this
thread only had a partial 16-state set due to a workspace reset — that
issue is resolved here.)

All core math was re-verified against two independent examples straight
from the workbook after this rebuild:
- **Wilson, TN** — 100,000 BTU load, 120°F water → 35,958.64 BTU/h
  capacity at design temp, 64,041.36 BTU/h supplemental heat required.
- **Amite, MS** — 120,000 BTU load, 120°F water, Design Temp 28°F →
  37,849.46 BTU/h capacity, 82,150.54 BTU/h supplemental heat (matches
  the workbook's "User Entry" tab exactly); with Worst Case Temp 20°F
  and 100,000 BTU load → 121,621.62 BTU/h worst case load (matches the
  "Advanced" tab exactly).

## Running it locally

```bash
cd site
python3 -m http.server 8080
# then open http://localhost:8080
```

## Files

```
index.html      Page structure / layout
style.css       Lochinvar-themed styling
calc.js         Calculation engine, chart data-point construction, input validation
app.js          UI wiring, mode toggle, reset button, print/export view
data/
  counties.json   All 3,142 US counties across 51 states/DC
  capacity.json   Heat pump unit + competitor capacity curves. Hand-edit
                  this directly (no build script) — see structure below.
```

## Editing capacity.json directly

There's no build script — just open `data/capacity.json` in a text editor
and edit it. Structure:

```json
{
  "units": {
    "centrus":   { "displayName": "Centrus",   "heating": {...}, "cooling": {...} },
    "test-unit": { "displayName": "Test unit", "heating": {...}, "cooling": {...} }
  },
  "competitorsSmall": {
    "CC32-40": { "displayName": "Competitor Unit A", "points": [...] },
    "SIM-036": { "displayName": "Competitor Unit B", "points": [...] }
  },
  "competitorsLarge": {
    "CC32-60": { "displayName": "Competitor Unit A", "points": [...] },
    "SIM-060": { "displayName": "Competitor Unit B", "points": [...] }
  }
}
```

**To add a heat pump unit:** copy the `"centrus"` block under `"units"`,
paste it as a new entry with a new key, give it a `displayName`, and fill
in its own `heating`/`cooling` breakpoints. Save and refresh — the new
unit shows up automatically in the "Heat Pump Model" dropdown.

**To remove a unit:** delete its block. Same for competitor entries.

**⚠️ Watch your commas/brackets** — a stray missing comma or bracket will
break the whole file. Any text editor with JSON syntax highlighting, or
pasting into jsonlint.com, will catch this quickly.

The `"test-unit"` entry is a placeholder (duplicate of the Centrus data)
kept around to verify the multi-unit dropdown works. Delete it whenever
it's no longer useful.

## Change log

- **v1.7** (this release, rebuilt from the re-uploaded source workbook):
  - **Full 51-state county dataset** restored (previously a partial
    16-state set due to a mid-thread workspace reset).
  - **Renamed** the app from "Centrus Sizing Tool" to **"Heat Pump
    Sizing Tool"** everywhere (page title, header, footer).
  - **Removed the logo placeholder** from the header — ready for a real
    logo whenever provided.
  - **Removed the Balance Point** marker — only the Design Point remains
    on the chart.
  - **Moved the minimum-operating-temp warning banner** to directly
    below the Design Conditions card in the input column.
  - **Input validation**: BTU Design Load must be positive; Shutdown
    Temp must be warmer than Design Temp; Worst Case Temp (if enabled)
    must be colder than Design Temp. Errors show in an amber banner and
    hide Results/Chart/Table until fixed.
  - **Print / Export Summary button**: opens a clean, static one-page
    summary (inputs, results, chart snapshot) in a new tab with its own
    print button.
  - **Reset to Defaults button**: restores unit, region, all system
    inputs, and both toggles back to their starting values in one click.
- **v1.6** — Removed the Python build script; added the Design
  Conditions mode toggle (By Region vs. Manual Entry); competitor units
  can be graphed directly on the chart; competitor names anonymized as
  "Competitor Unit A/B" per size class; Lochinvar red/charcoal theming.
- **v1.5** — Multi-unit support added; Design Day reference line.
- **v1.4** — Capacity correctly drops to zero below the unit's minimum
  rated temp; warning banner; dashed Operating Range Limit lines;
  Design Point / Balance Point labeling.
- **v1.3** — No Calculate button (auto-recalculates); shaded Design
  Load / Supplemental Heat Load regions.
- **v1.2** — Fixed chart to match the workbook's actual data.
- **v1.1** — Fixed chart x-axis direction.
- **v1.0** — Initial build.
