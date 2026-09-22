/* =========================================================================
   Heat Pump Sizing Tool — Calculation Engine
   =========================================================================
   Two modes, HEATING and COOLING, which are mirror images of each other.

   HEATING                              COOLING
   ------------------------------------ ------------------------------------
   Design Temp = county HDD column      Design Temp = county CDD column
   Worst Case  = HDD - Regional Adj     Worst Case  = CDD + Regional Adj
   Curve       = unit.heating (-4..77)  Curve       = unit.cooling (61..110)
   Load rises as it gets COLDER         Load rises as it gets HOTTER
   Shortfall -> backup BOILER           Shortfall -> supplemental COOLING

   `modeDir()` returns +1 for heating and -1 for cooling; every directional
   comparison multiplies through it so one code path serves both.
   ========================================================================= */

let COUNTIES = [];
let CAPACITY = null;

/* Competitor cooling data doesn't exist yet, so competitor UI is hidden in
   cooling mode. All competitor code paths remain intact — when the data
   arrives, add a "coolingPoints" array per competitor in capacity.json and
   flip this to true. */
const COMPETITORS_HAVE_COOLING = false;

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

// Water temps available for a unit+mode, read straight from capacity.json.
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

/* ------------------------- Capacity curve ------------------------- */

function getCapacityCurvePoints(unitKey, mode, waterTemp) {
  const table = CAPACITY.units[unitKey][modeConfig(mode).curveKey];
  const rows = table[String(waterTemp)] || [];
  return rows.map(r => ({ x: r.od, y: r.capacity })).sort((a, b) => a.x - b.x);
}

// Straight-line interpolation between bracketing breakpoints, clamped flat
// beyond either end. Pure math — doesn't know the operating range.
function getCapacityAtTemp(unitKey, mode, waterTemp, odTemp) {
  const pts = getCapacityCurvePoints(unitKey, mode, waterTemp);
  if (pts.length === 0) return 0;
  if (odTemp <= pts[0].x) return pts[0].y;
  if (odTemp >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (odTemp >= a.x && odTemp <= b.x) {
      const frac = (odTemp - a.x) / (b.x - a.x);
      return a.y + frac * (b.y - a.y);
    }
  }
  return null;
}

// Past the rated limit in the "demanding" direction the unit produces
// nothing: colder than the coldest point in heating, hotter than the
// hottest in cooling. The easy end stays clamped flat.
function getEffectiveCapacityAtTemp(unitKey, mode, waterTemp, odTemp) {
  const pts = getCapacityCurvePoints(unitKey, mode, waterTemp);
  if (pts.length === 0) return 0;
  const coldest = pts[0].x, hottest = pts[pts.length - 1].x;
  if (mode === 'cooling') { if (odTemp > hottest) return 0; }
  else { if (odTemp < coldest) return 0; }
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

// 0 BTU at the Shutdown/Lockout Temp rising to the full Design Load at the
// Design Temp. Same formula both modes — heating has Shutdown > Design,
// cooling has Shutdown < Design, so the sign works itself out.
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
  let balancePoint = null, prevDiff = null, prevX = null, prevLoad = null;

  grid.forEach(x => {
    const load = loadAtTemp(x, designLoad, shutdownTemp, designTemp);
    const cap = getEffectiveCapacityAtTemp(unitKey, mode, waterTemp, x);
    designLoadPoints.push({ x, y: Math.min(load, cap) });
    supplementalPoints.push({ x, y: load });
    const diff = load - cap;
    if (prevDiff !== null && balancePoint === null && prevDiff * diff < 0) {
      const frac = prevDiff / (prevDiff - diff);
      balancePoint = { x: prevX + frac * (x - prevX), y: prevLoad + frac * (load - prevLoad) };
    }
    prevDiff = diff; prevX = x; prevLoad = load;
  });

  return { designLoadPoints, supplementalPoints, balancePoint };
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
  const { designLoadPoints, supplementalPoints, balancePoint } =
    buildShadedRegions(unitKey, mode, waterTemp, designLoad, shutdownTemp, designTemp, worstCaseEnabled, worstCaseTemp);

  // Only meaningful when Worst Case is on — that's the only time the load
  // line continues past the original Design Day point.
  const designDayLine = worstCaseEnabled
    ? [{ x: designTemp, y: designLoad }, { x: designTemp, y: 0 }] : null;

  return {
    mode,
    capacityAtDesign, supplementalAtDesign,
    worstCaseLoad, capacityAtWorstCase, supplementalAtWorstCase,
    loadLinePoints, capacityCurvePoints,
    designLoadPoints, supplementalPoints,
    designPoint: { x: designTemp, y: capacityAtDesign },
    balancePoint, designDayLine,
    minOperatingTemp: limits.minOperatingTemp,
    maxOperatingTemp: limits.maxOperatingTemp,
    demandLimitTemp: limits.demandLimitTemp,
    minOperatingLine: limits.minOperatingLine,
    maxOperatingLine: limits.maxOperatingLine
  };
}

/* ------------------------- Competitors (heating only for now) ------------------------- */

function competitorsAvailable(mode) {
  return mode !== 'cooling' || COMPETITORS_HAVE_COOLING;
}
function getCompetitorEntry(model) {
  return CAPACITY.competitorsSmall[model] || CAPACITY.competitorsLarge[model];
}
function getCompetitorClass(model) {
  return CAPACITY.competitorsSmall[model] ? '3-3.5 Ton' : '5-5.5 Ton';
}
function getCompetitorCurvePoints(model, mode) {
  const entry = getCompetitorEntry(model);
  if (!entry) return [];
  const raw = (mode === 'cooling') ? (entry.coolingPoints || []) : entry.points;
  return raw.filter(p => p.capacity !== null && p.capacity !== undefined)
            .map(p => ({ x: p.od, y: p.capacity }))
            .sort((a, b) => a.x - b.x);
}
function interpolateCompetitor(model, mode, odTemp) {
  const pts = getCompetitorCurvePoints(model, mode);
  if (pts.length === 0) return null;
  if (odTemp <= pts[0].x) return pts[0].y;
  if (odTemp >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (odTemp >= a.x && odTemp <= b.x) {
      const frac = (odTemp - a.x) / (b.x - a.x);
      return a.y + frac * (b.y - a.y);
    }
  }
  return null;
}
function buildCompetitorComparison(mode, designTemp, worstCaseTemp, worstCaseEnabled) {
  if (!competitorsAvailable(mode)) return [];
  const models = [...Object.keys(CAPACITY.competitorsSmall), ...Object.keys(CAPACITY.competitorsLarge)];
  return models.map(model => ({
    model,
    displayName: getCompetitorEntry(model).displayName,
    className: getCompetitorClass(model),
    capDesign: interpolateCompetitor(model, mode, designTemp),
    capWorst: worstCaseEnabled ? interpolateCompetitor(model, mode, worstCaseTemp) : null
  }));
}
function getAllCompetitorCurves(mode) {
  if (!competitorsAvailable(mode)) return [];
  const models = [...Object.keys(CAPACITY.competitorsSmall), ...Object.keys(CAPACITY.competitorsLarge)];
  return models.map(model => ({
    model,
    displayName: getCompetitorEntry(model).displayName,
    className: getCompetitorClass(model),
    points: getCompetitorCurvePoints(model, mode)
  }));
}
