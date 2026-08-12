# Centrus Sizing Tool — Web App

A working web version of **Centrus Sizing Tool V1.1.xlsx**. Static site
(HTML/CSS/JS) — no server or build step required.

## Running it locally

```bash
cd site
python3 -m http.server 8080
# then open http://localhost:8080
```

## Files

```
index.html      Page structure / layout
style.css       Styling
calc.js         Calculation engine + chart data-point construction
app.js          UI wiring (dropdowns, chart rendering, event listeners)
data/
  counties.json   3,142 US counties
  capacity.json   Centrus heating/cooling capacity curves + competitor data
```

## Change log

- **v1.3**:
  - **No more Calculate button.** Every input now recalculates and
    re-renders automatically as soon as it changes.
  - **Both intersection points shown**, temporarily both labeled
    "Intersection" (single legend entry, two dots):
      1. The workbook's actual "Design Load Supplemental Calculation"
         point — the unit's capacity interpolated AT the Design Temp.
      2. The true geometric point where the Building Load Line and Unit
         Capacity Curve cross.
  - **Two shaded regions added** to the chart:
      - **Design Load** (blue) — the area under both the load line and
        the capacity curve. Represents the portion of the heat load the
        unit supplies on its own.
      - **Supplemental Heat Load** (red) — the area between the capacity
        curve and the load line, wherever the load exceeds capacity.
        Zero-height wherever the unit alone covers the load.
    Both are built by sampling ~120 points across the load line's active
    range (Shutdown Temp down to Design/Worst Case Temp) — enough points
    to look like a smooth, exact fill.
- **v1.2** — Fixed chart to match the workbook's actual data: Capacity
  Curve now plots the 6 real breakpoints (-4 to 77°F); Load Line now
  ramps up then drops straight down at the end; dropdowns now trigger
  chart updates (previously only the button did).
- **v1.1** — Fixed chart x-axis direction (negative temps plot right).
- **v1.0** — Initial build.
