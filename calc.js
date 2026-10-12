/* =========================================================================
   Heat Pump Sizing Tool — Calculation Engine
   =========================================================================
   Two modes, HEATING and COOLING, mirror images of each other.

   HEATING                              COOLING
   ------------------------------------ ------------------------------------
   Design Temp = county HDD column      Design Temp = county CDD column
   Worst Case  = HDD - Regional Adj     Worst Case  = CDD + Regional Adj
   Curve       = unit.heating (-4..77)  Curve       = unit.cooling (61..110)
   Load rises as it gets COLDER         Load rises as it gets HOTTER

   `modeDir()` returns +1 for heating and -1 for cooling; every directional
   comparison multiplies through it so one code path serves both.

   COMPETITOR WATER-TEMP MATCHING (cooling)
   ----------------------------------------
   Competitor cooling data is published at different leaving-water temps
   than the Centrus (CC32: 45/48/54°F, SIM: 45/59°F vs Centrus 44/57/64°F).
   So the competitor curve is interpolated to whatever Delivery Water Temp
   the user has selected:
     1. At each outdoor temp, take the competitor's capacity at the two
        published water temps that bracket the selected one.
     2. Interpolate linearly between them.
     3. If the selected water temp is outside the published range, the two
        nearest columns are used to linearly EXTRAPOLATE, and the result is
        flagged `extrapolated: true` so the UI can mark it as an estimate.
   Heating competitor data is unchanged (fixed 105°F reference column).
   ========================================================================= */

let COUNTIES = [];
let CAPACITY = null;

/* Competitor cooling data is now supplied (Competitor Cooling Data tab). */
const COMPETITORS_HAVE_COOLING = true;

/* Competitors can't deliver water temps far outside what they publish, so
   extrapolation is capped. With 3°F: 44°F and 57°F are estimated, 64°F
   shows N/A for every competitor. */
const MAX_COOLING_WATER_EXTRAPOLATION_F = 3;

async function loadData() {
  const [countiesRes, capacityRes] = await Promise.all([
    fetch('data/counties.json'),
    fetch('data/capacity.json')
  ]);
  COUNTIES = await countiesRes.json();
  CAPACITY = await capacityRes.json();
}

/* ------------------------- Mode helpers ------------------------- */

function modeDir(mode) { return mode === 'cooling' ? -1 : 1; }

function modeConfig(mode) {
  if (mode === 'cooling') {
    return {
      curveKey: 'cooling',
      designTempField: 'coolingDesignTemp',
      worstCaseField: 'estimatedHighestTemp',
      designTempLabel: 'Outdoor Cooling Design Temp',
      worstCaseLabel: 'Outdoor Worst Case Temp (hottest)',
      shutdownLabel: 'Outdoor Cooling Lockout Temp',
      supplementalLabel: 'Supplemental Cooling Required',
      defaultShutdownTemp: 65,
      defaultWaterTemp: '44'
    };
  }
  return {
    curveKey: 'heating',
    designTempField: 'designTemp',
    worstCaseField: 'estimatedLowestTemp',
    designTempLabel: 'Outdoor Design Temp',
    worstCaseLabel: 'Outdoor Worst Case Temp (coldest)',
    shutdownLabel: 'Outdoor Heater Shutdown Temp',
    supplementalLabel: 'Supplemental Heat Required',
    defaultShutdownTemp: 65,
    defaultWaterTemp: '120'
  };
}

function getWaterTemps(unitKey, mode) {
  const table = CAPACITY.units[unitKey][modeConfig(mode).curveKey] || {};
  return Object.keys(table).map(Number).sort((a, b) => a - b);
}

/* ------------------------- Lookups ------------------------- */

function getStates() { return [...new Set(COUNTIES.map(c => c.state))].sort(); }
function getCounties(state) {
  return COUNTIES.filter(c => c.state === state).map(c => c.county).sort();
}
function getCountyData(state, county) {
  return COUNTIES.find(c => c.state === state && c.county === county);
}
function getUnits() {
  return Object.keys(CAPACITY.units).map(key => ({
    key, displayName: CAPACITY.units[key].displayName
  }));
}

/* ------------------------- Generic 1-D interpolation ------------------------- */

// pts: [{x, y}] sorted ascending. Clamped flat beyond either end.
function interp1D(pts, x) {
  if (pts.length === 0) return null;
  if (x <= pts[0].x) return pts[0].y;
  if (x >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (x >= a.x && x <= b.x) return a.y + (x - a.x) / (b.x - a.x) * (b.y - a.y);
  }
  return null;
}

/* ------------------------- Unit capacity curve ------------------------- */

function getCapacityCurvePoints(unitKey, mode, waterTemp) {
  const table = CAPACITY.units[unitKey][modeConfig(mode).curveKey];
  const rows = table[String(waterTemp)] || [];
  return rows.map(r => ({ x: r.od, y: r.capacity })).sort((a, b) => a.x - b.x);
}

function getCapacityAtTemp(unitKey, mode, waterTemp, odTemp) {
  const v = interp1D(getCapacityCurvePoints(unitKey, mode, waterTemp), odTemp);
  return v === null ? 0 : v;
}

// Past the rated limit in the "demanding" direction the unit produces
// nothing: colder than the coldest point in heating, hotter than the
// hottest in cooling. The easy end stays clamped flat.
function getEffectiveCapacityAtTemp(unitKey, mode, waterTemp, odTemp) {
  const pts = getCapacityCurvePoints(unitKey, mode, waterTemp);
  if (pts.length === 0) return 0;
  if (mode === 'cooling') { if (odTemp > pts[pts.length - 1].x) return 0; }
  else { if (odTemp < pts[0].x) return 0; }
  return getCapacityAtTemp(unitKey, mode, waterTemp, odTemp);
}

function getOperatingLimits(unitKey, mode, waterTemp) {
  const pts = getCapacityCurvePoints(unitKey, mode, waterTemp);
  if (pts.length === 0) return null;
  const lo = pts[0], hi = pts[pts.length - 1];
  return {
    minOperatingTemp: lo.x,
    maxOperatingTemp: hi.x,
    demandLimitTemp: mode === 'cooling' ? hi.x : lo.x,
    minOperatingLine: [{ x: lo.x, y: lo.y }, { x: lo.x, y: 0 }],
    maxOperatingLine: [{ x: hi.x, y: hi.y }, { x: hi.x, y: 0 }]
  };
}

/* ------------------------- Load line ------------------------- */

function loadAtTemp(temp, designLoad, shutdownTemp, designTemp) {
  if (shutdownTemp === designTemp) return designLoad;
  return Math.max(0, designLoad * (shutdownTemp - temp) / (shutdownTemp - designTemp));
}

function buildLoadLinePoints(shutdownTemp, designTemp, designLoad, wcEnabled, wcTemp, wcLoad) {
  const pts = [{ x: shutdownTemp, y: 0 }, { x: designTemp, y: designLoad }];
  if (wcEnabled) pts.push({ x: wcTemp, y: wcLoad });
  const last = pts[pts.length - 1];
  pts.push({ x: last.x, y: 0 });
  return pts;
}

/* ------------------------- Shaded regions ------------------------- */

function buildSampleGrid(a, b, steps) {
  const g = [];
  for (let i = 0; i <= steps; i++) g.push(a + (b - a) * (i / steps));
  return g;
}

function buildShadedRegions(unitKey, mode, waterTemp, designLoad, shutdownTemp, designTemp, wcEnabled, wcTemp) {
  const farEnd = wcEnabled ? wcTemp : designTemp;
  const grid = buildSampleGrid(Math.min(farEnd, shutdownTemp), Math.max(farEnd, shutdownTemp), 120);
  const designLoadPoints = [], supplementalPoints = [];
  grid.forEach(x => {
    const load = loadAtTemp(x, designLoad, shutdownTemp, designTemp);
    const cap = getEffectiveCapacityAtTemp(unitKey, mode, waterTemp, x);
    designLoadPoints.push({ x, y: Math.min(load, cap) });
    supplementalPoints.push({ x, y: load });
  });
  return { designLoadPoints, supplementalPoints };
}

/* ------------------------- Validation ------------------------- */

function validateInputs(inputs) {
  const { mode, designLoad, shutdownTemp, designTemp, waterTemp, worstCaseEnabled, worstCaseTemp } = inputs;
  const cfg = modeConfig(mode), dir = modeDir(mode), errors = [];

  if (isNaN(designLoad) || designLoad <= 0) errors.push('BTU Design Load must be a positive number.');
  if (isNaN(waterTemp)) errors.push('Delivery Water Temp must be a valid number.');
  if (isNaN(shutdownTemp)) errors.push(`${cfg.shutdownLabel} must be a valid number.`);
  if (isNaN(designTemp)) errors.push(`${cfg.designTempLabel} must be a valid number.`);

  if (!isNaN(shutdownTemp) && !isNaN(designTemp) && dir * (shutdownTemp - designTemp) <= 0) {
    errors.push(mode === 'cooling'
      ? `${cfg.shutdownLabel} must be cooler than the ${cfg.designTempLabel}.`
      : `${cfg.shutdownLabel} must be warmer than the ${cfg.designTempLabel}.`);
  }
  if (worstCaseEnabled) {
    if (isNaN(worstCaseTemp)) {
      errors.push('Outdoor Worst Case Temp must be a valid number.');
    } else if (!isNaN(designTemp) && dir * (designTemp - worstCaseTemp) <= 0) {
      errors.push(mode === 'cooling'
        ? `Outdoor Worst Case Temp must be hotter than the ${cfg.designTempLabel}.`
        : `Outdoor Worst Case Temp must be colder than the ${cfg.designTempLabel}.`);
    }
  }
  return errors;
}

/* ------------------------- Main calculation ------------------------- */

function runSizingCalculation(inputs) {
  const { unitKey, mode, designLoad, shutdownTemp, designTemp, waterTemp, worstCaseEnabled, worstCaseTemp } = inputs;

  const capacityCurvePoints = getCapacityCurvePoints(unitKey, mode, waterTemp);
  const limits = getOperatingLimits(unitKey, mode, waterTemp);

  const capacityAtDesign = getEffectiveCapacityAtTemp(unitKey, mode, waterTemp, designTemp);
  const supplementalAtDesign = Math.max(0, designLoad - capacityAtDesign);

  let worstCaseLoad = null, capacityAtWorstCase = null, supplementalAtWorstCase = null;
  if (worstCaseEnabled) {
    worstCaseLoad = loadAtTemp(worstCaseTemp, designLoad, shutdownTemp, designTemp);
    capacityAtWorstCase = getEffectiveCapacityAtTemp(unitKey, mode, waterTemp, worstCaseTemp);
    supplementalAtWorstCase = Math.max(0, worstCaseLoad - capacityAtWorstCase);
  }

  const loadLinePoints = buildLoadLinePoints(shutdownTemp, designTemp, designLoad, worstCaseEnabled, worstCaseTemp, worstCaseLoad);
  const { designLoadPoints, supplementalPoints } =
    buildShadedRegions(unitKey, mode, waterTemp, designLoad, shutdownTemp, designTemp, worstCaseEnabled, worstCaseTemp);

  const designDayLine = worstCaseEnabled
    ? [{ x: designTemp, y: designLoad }, { x: designTemp, y: 0 }] : null;

  return {
    mode,
    capacityAtDesign, supplementalAtDesign,
    worstCaseLoad, capacityAtWorstCase, supplementalAtWorstCase,
    loadLinePoints, capacityCurvePoints,
    designLoadPoints, supplementalPoints,
    designPoint: { x: designTemp, y: capacityAtDesign },
    designDayLine,
    minOperatingTemp: limits.minOperatingTemp,
    maxOperatingTemp: limits.maxOperatingTemp,
    demandLimitTemp: limits.demandLimitTemp,
    minOperatingLine: limits.minOperatingLine,
    maxOperatingLine: limits.maxOperatingLine
  };
}

/* ------------------------- Competitors ------------------------- */

function competitorsAvailable(mode) {
  return mode !== 'cooling' || COMPETITORS_HAVE_COOLING;
}
function getCompetitorEntry(model) {
  return CAPACITY.competitorsSmall[model] || CAPACITY.competitorsLarge[model];
}
function getCompetitorClass(model) {
  return CAPACITY.competitorsSmall[model] ? '3-3.5 Ton' : '5-5.5 Ton';
}
function allCompetitorModels() {
  return [...Object.keys(CAPACITY.competitorsSmall), ...Object.keys(CAPACITY.competitorsLarge)];
}

/* ---- Cooling: interpolate across published water temps ---- */

function competitorCoolingWaterTemps(entry) {
  return Object.keys(entry.cooling || {}).map(Number).sort((a, b) => a - b);
}

// Capacity at a single published water column. Returns null above the
// hottest published OD (outside the rated range, like the Centrus), and
// clamps flat below the coolest.
function competitorColumnAt(entry, wt, od) {
  const pts = (entry.cooling[String(wt)] || [])
    .filter(p => p.capacity !== null && p.capacity !== undefined)
    .map(p => ({ x: p.od, y: p.capacity }))
    .sort((a, b) => a.x - b.x);
  if (pts.length === 0) return null;
  if (od > pts[pts.length - 1].x) return null;
  return interp1D(pts, od);
}

// Picks the two published water columns that bracket waterTemp (or the two
// nearest if it's outside the range) and interpolates/extrapolates.
function competitorCoolingAt(entry, waterTemp, od) {
  const wts = competitorCoolingWaterTemps(entry);
  if (wts.length === 0) return { value: null, extrapolated: false };
  if (wts.length === 1) return { value: competitorColumnAt(entry, wts[0], od), extrapolated: waterTemp !== wts[0] };

  let lo, hi;
  const extrapolated = waterTemp < wts[0] || waterTemp > wts[wts.length - 1];
  const beyond = Math.max(wts[0] - waterTemp, waterTemp - wts[wts.length - 1], 0);
  if (beyond > MAX_COOLING_WATER_EXTRAPOLATION_F) return { value: null, extrapolated: true };
  if (waterTemp <= wts[0]) { lo = wts[0]; hi = wts[1]; }
  else if (waterTemp >= wts[wts.length - 1]) { lo = wts[wts.length - 2]; hi = wts[wts.length - 1]; }
  else {
    for (let i = 0; i < wts.length - 1; i++) {
      if (waterTemp >= wts[i] && waterTemp <= wts[i + 1]) { lo = wts[i]; hi = wts[i + 1]; break; }
    }
  }
  const a = competitorColumnAt(entry, lo, od), b = competitorColumnAt(entry, hi, od);
  if (a === null || b === null) return { value: null, extrapolated };
  const v = a + (waterTemp - lo) / (hi - lo) * (b - a);
  return { value: Math.max(0, v), extrapolated };
}

function competitorCoolingRange(entry) {
  const wts = competitorCoolingWaterTemps(entry);
  return wts.length ? { min: wts[0], max: wts[wts.length - 1], temps: wts } : null;
}

/* ---- Mode-aware public API ---- */

function getCompetitorCurvePoints(model, mode, waterTemp) {
  const entry = getCompetitorEntry(model);
  if (!entry) return [];
  if (mode === 'cooling') {
    if (!entry.cooling) return [];
    const ods = new Set();
    Object.values(entry.cooling).forEach(col => col.forEach(p => ods.add(p.od)));
    return [...ods].sort((a, b) => a - b)
      .map(od => ({ x: od, y: competitorCoolingAt(entry, waterTemp, od).value }))
      .filter(p => p.y !== null);
  }
  return entry.points
    .filter(p => p.capacity !== null && p.capacity !== undefined)
    .map(p => ({ x: p.od, y: p.capacity }))
    .sort((a, b) => a.x - b.x);
}

function interpolateCompetitor(model, mode, odTemp, waterTemp) {
  const entry = getCompetitorEntry(model);
  if (!entry) return { value: null, extrapolated: false };
  if (mode === 'cooling') return competitorCoolingAt(entry, waterTemp, odTemp);
  return { value: interp1D(getCompetitorCurvePoints(model, 'heating'), odTemp), extrapolated: false };
}

function buildCompetitorComparison(mode, designTemp, worstCaseTemp, worstCaseEnabled, waterTemp) {
  if (!competitorsAvailable(mode)) return [];
  return allCompetitorModels().map(model => {
    const d = interpolateCompetitor(model, mode, designTemp, waterTemp);
    const w = worstCaseEnabled ? interpolateCompetitor(model, mode, worstCaseTemp, waterTemp) : { value: null, extrapolated: false };
    const entry = getCompetitorEntry(model);
    return {
      model,
      displayName: entry.displayName,
      className: getCompetitorClass(model),
      capDesign: d.value,
      capWorst: w.value,
      extrapolated: mode === 'cooling' && (d.extrapolated || w.extrapolated),
      range: mode === 'cooling' ? competitorCoolingRange(entry) : null
    };
  });
}

function getAllCompetitorCurves(mode, waterTemp) {
  if (!competitorsAvailable(mode)) return [];
  return allCompetitorModels().map(model => {
    const entry = getCompetitorEntry(model);
    const range = mode === 'cooling' ? competitorCoolingRange(entry) : null;
    return {
      model,
      displayName: entry.displayName,
      className: getCompetitorClass(model),
      points: getCompetitorCurvePoints(model, mode, waterTemp),
      extrapolated: !!range && (waterTemp < range.min || waterTemp > range.max)
    };
  });
}
