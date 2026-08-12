/* =========================================================================
   Centrus Sizing Tool — Calculation Engine
   =========================================================================
   Loads the two data files, provides lookup helpers, and does the sizing
   math + builds every point the chart needs to draw:
     - The Building Load Line (straight line + vertical drop)
     - The Unit Capacity Curve (6 real breakpoints, -4°F to 77°F)
     - Two "Intersection" points (see note below)
     - Two shaded regions: Design Load (blue) and Supplemental Heat Load (red)
   ========================================================================= */

let COUNTIES = [];
let CAPACITY = null;

async function loadData() {
  const [countiesRes, capacityRes] = await Promise.all([
    fetch('data/counties.json'),
    fetch('data/capacity.json')
  ]);
  COUNTIES = await countiesRes.json();
  CAPACITY = await capacityRes.json();
}

/* ------------------------- Simple lookups ------------------------- */

function getStates() {
  return [...new Set(COUNTIES.map(c => c.state))].sort();
}
function getCounties(state) {
  return COUNTIES.filter(c => c.state === state).map(c => c.county).sort();
}
function getCountyData(state, county) {
  return COUNTIES.find(c => c.state === state && c.county === county);
}

/* ------------------------- Capacity curve ------------------------- */

// The 6 real breakpoints for a given water temp (-4, 5, 18, 36, 45, 77°F),
// sorted ascending. This is exactly what's plotted as the capacity curve.
function getCapacityCurvePoints(waterTemp) {
  return CAPACITY.heating[String(waterTemp)]
    .map(r => ({ x: r.od, y: r.capacity }))
    .sort((a, b) => a.x - b.x);
}

// Capacity at any temperature, straight-line interpolated between the two
// breakpoints that bracket it. Temperatures colder than -4° or warmer than
// 77° are clamped flat to the nearest end breakpoint (no extrapolation).
function getCapacityAtTemp(waterTemp, odTemp) {
  const points = getCapacityCurvePoints(waterTemp);
  if (odTemp <= points[0].x) return points[0].y;
  if (odTemp >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (odTemp >= a.x && odTemp <= b.x) {
      const frac = (odTemp - a.x) / (b.x - a.x);
      return a.y + frac * (b.y - a.y);
    }
  }
  return null;
}

/* ------------------------- Load line ------------------------- */

// The building's heat load is one straight line: 0 BTU at the Shutdown
// Temp, rising to the full Design Load at the Design Temp. It's a single
// line with a constant slope — the Worst Case Load is just this same
// line evaluated further out at a colder temperature, not a separate
// segment with a different slope.
function loadAtTemp(temp, designLoad, shutdownTemp, designTemp) {
  if (shutdownTemp === designTemp) return designLoad;
  const val = designLoad * (shutdownTemp - temp) / (shutdownTemp - designTemp);
  return Math.max(0, val);
}

// The full line as drawn on the chart: the diagonal ramp, then a straight
// vertical drop to 0 at whichever temperature the ramp ends on (Worst
// Case Temp if enabled, otherwise Design Temp).
function buildLoadLinePoints(shutdownTemp, designTemp, designLoad, worstCaseEnabled, worstCaseTemp, worstCaseLoad) {
  const points = [{ x: shutdownTemp, y: 0 }, { x: designTemp, y: designLoad }];
  if (worstCaseEnabled) points.push({ x: worstCaseTemp, y: worstCaseLoad });
  const lastPoint = points[points.length - 1];
  points.push({ x: lastPoint.x, y: 0 });
  return points;
}

/* ------------------------- Shaded regions ------------------------- */

// Builds an evenly-spaced set of x-values between the two active
// endpoints of the load line (Shutdown Temp on the warm end, Design Temp
// or Worst Case Temp on the cold end). We sample the load line and the
// capacity curve at each of these x-values to build smooth shaded areas —
// with enough points, the straight-line segments are visually
// indistinguishable from an exact geometric fill.
function buildSampleGrid(coldEnd, warmEnd, steps) {
  const grid = [];
  for (let i = 0; i <= steps; i++) {
    grid.push(coldEnd + (warmEnd - coldEnd) * (i / steps));
  }
  return grid;
}

/**
 * Builds the two shaded-region datasets plus the "true" line-crossing
 * point, all sampled from the same grid of x-values across the load
 * line's active range.
 *   - designLoadPoints: y = min(load, capacity) at each x, filled down to
 *     0. This is the portion of the load the unit supplies on its own —
 *     the "Design Load" region.
 *   - supplementalPoints: y = load at each x (filled up from the
 *     designLoadPoints line). Since load >= min(load, capacity) always,
 *     this shades exactly the gap where capacity falls short — the
 *     "Supplemental Heat Load" region. It has zero height wherever
 *     capacity already covers the load.
 *   - trueIntersection: the point where the load line and capacity curve
 *     actually cross, found by scanning the grid for a sign change and
 *     interpolating between the two straddling samples.
 */
function buildShadedRegions(waterTemp, designLoad, shutdownTemp, designTemp, worstCaseEnabled, worstCaseTemp) {
  const coldEnd = worstCaseEnabled ? worstCaseTemp : designTemp;
  const warmEnd = shutdownTemp;
  const grid = buildSampleGrid(coldEnd, warmEnd, 120);

  const designLoadPoints = [];
  const supplementalPoints = [];
  let trueIntersection = null;
  let prevDiff = null, prevX = null, prevLoad = null, prevCap = null;

  grid.forEach(x => {
    const load = loadAtTemp(x, designLoad, shutdownTemp, designTemp);
    const cap = getCapacityAtTemp(waterTemp, x);
    designLoadPoints.push({ x, y: Math.min(load, cap) });
    supplementalPoints.push({ x, y: load });

    const diff = load - cap;
    if (prevDiff !== null && trueIntersection === null && prevDiff * diff < 0) {
      // Sign changed between the previous sample and this one — the line
      // crosses somewhere in between. Interpolate to find where.
      const frac = prevDiff / (prevDiff - diff);
      trueIntersection = {
        x: prevX + frac * (x - prevX),
        y: prevLoad + frac * (load - prevLoad)
      };
    }
    prevDiff = diff; prevX = x; prevLoad = load; prevCap = cap;
  });

  return { designLoadPoints, supplementalPoints, trueIntersection };
}

/* ------------------------- Main sizing calculation ------------------------- */

function runSizingCalculation(inputs) {
  const { designLoad, shutdownTemp, designTemp, waterTemp, worstCaseEnabled, worstCaseTemp } = inputs;

  const capacityAtDesign = getCapacityAtTemp(waterTemp, designTemp);
  const supplementalAtDesign = Math.max(0, designLoad - capacityAtDesign);

  let worstCaseLoad = null, capacityAtWorstCase = null, supplementalAtWorstCase = null;
  if (worstCaseEnabled) {
    worstCaseLoad = loadAtTemp(worstCaseTemp, designLoad, shutdownTemp, designTemp);
    capacityAtWorstCase = getCapacityAtTemp(waterTemp, worstCaseTemp);
    supplementalAtWorstCase = Math.max(0, worstCaseLoad - capacityAtWorstCase);
  }

  const loadLinePoints = buildLoadLinePoints(shutdownTemp, designTemp, designLoad, worstCaseEnabled, worstCaseTemp, worstCaseLoad);
  const capacityCurvePoints = getCapacityCurvePoints(waterTemp);

  const { designLoadPoints, supplementalPoints, trueIntersection } =
    buildShadedRegions(waterTemp, designLoad, shutdownTemp, designTemp, worstCaseEnabled, worstCaseTemp);

  // Two points, both currently labeled "Intersection":
  //   1. dropIntersection — matches the workbook's "Design Load
  //      Supplemental Calculation" (Data Hold tab): the unit's capacity
  //      interpolated AT the Design Temp. The vertical gap between this
  //      point and the Design Day load point is the Supplemental Heat
  //      Required.
  //   2. trueIntersection — the actual point where the load line and
  //      capacity curve geometrically cross (may land at a different
  //      temperature than the Design Temp).
  const dropIntersection = { x: designTemp, y: capacityAtDesign };
  const intersectionPoints = [dropIntersection];
  if (trueIntersection) intersectionPoints.push(trueIntersection);

  return {
    capacityAtDesign,
    supplementalAtDesign,
    worstCaseLoad,
    capacityAtWorstCase,
    supplementalAtWorstCase,
    loadLinePoints,
    capacityCurvePoints,
    designLoadPoints,
    supplementalPoints,
    intersectionPoints
  };
}

/* ------------------------- Competitor comparison ------------------------- */

function interpolateCompetitor(model, odTemp) {
  const rows = CAPACITY.competitorsSmall[model] || CAPACITY.competitorsLarge[model];
  if (!rows) return null;
  const points = rows
    .filter(p => p.capacity !== null && p.capacity !== undefined)
    .map(p => ({ x: p.od, y: p.capacity }))
    .sort((a, b) => a.x - b.x);
  if (points.length === 0) return null;
  if (odTemp <= points[0].x) return points[0].y;
  if (odTemp >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (odTemp >= a.x && odTemp <= b.x) {
      const frac = (odTemp - a.x) / (b.x - a.x);
      return a.y + frac * (b.y - a.y);
    }
  }
  return null;
}

function buildCompetitorComparison(designTemp, worstCaseTemp, worstCaseEnabled) {
  const allModels = [...Object.keys(CAPACITY.competitorsSmall), ...Object.keys(CAPACITY.competitorsLarge)];
  return allModels.map(model => ({
    model,
    capDesign: interpolateCompetitor(model, designTemp),
    capWorst: worstCaseEnabled ? interpolateCompetitor(model, worstCaseTemp) : null
  }));
}
