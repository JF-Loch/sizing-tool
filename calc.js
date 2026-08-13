/* =========================================================================
   Heat Pump Sizing Tool — Calculation Engine
   =========================================================================
   Loads capacity.json (hand-edited directly — no build script), provides
   lookup helpers, does the sizing math, builds every point the chart
   needs to draw, and validates user inputs before calculating.

   ADDING / REMOVING A HEAT PUMP UNIT
   ------------------------------------
   Edit data/capacity.json directly. Under "units", each entry looks like:
     "some-key": {
       "displayName": "Whatever shows in the dropdown",
       "heating": { "<water temp>": [ {"od": <outdoor temp>, "capacity": <BTU/h>}, ... ] },
       "cooling": { "<water temp>": [ {"od": <outdoor temp>, "capacity": <BTU/h>}, ... ] }
     }
   To add a unit, copy an existing block, give it a new key, and fill in
   its own heating/cooling breakpoints. To remove one, delete its block.
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

function getUnits() {
  return Object.keys(CAPACITY.units).map(key => ({
    key,
    displayName: CAPACITY.units[key].displayName
  }));
}

/* ------------------------- Capacity curve ------------------------- */

function getCapacityCurvePoints(unitKey, waterTemp) {
  const unit = CAPACITY.units[unitKey];
  return unit.heating[String(waterTemp)]
    .map(r => ({ x: r.od, y: r.capacity }))
    .sort((a, b) => a.x - b.x);
}

function getCapacityAtTemp(unitKey, waterTemp, odTemp) {
  const points = getCapacityCurvePoints(unitKey, waterTemp);
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

function getEffectiveCapacityAtTemp(unitKey, waterTemp, odTemp) {
  const points = getCapacityCurvePoints(unitKey, waterTemp);
  const minOperatingTemp = points[0].x;
  if (odTemp < minOperatingTemp) return 0;
  return getCapacityAtTemp(unitKey, waterTemp, odTemp);
}

/* ------------------------- Load line ------------------------- */

function loadAtTemp(temp, designLoad, shutdownTemp, designTemp) {
  if (shutdownTemp === designTemp) return designLoad;
  const val = designLoad * (shutdownTemp - temp) / (shutdownTemp - designTemp);
  return Math.max(0, val);
}

function buildLoadLinePoints(shutdownTemp, designTemp, designLoad, worstCaseEnabled, worstCaseTemp, worstCaseLoad) {
  const points = [{ x: shutdownTemp, y: 0 }, { x: designTemp, y: designLoad }];
  if (worstCaseEnabled) points.push({ x: worstCaseTemp, y: worstCaseLoad });
  const lastPoint = points[points.length - 1];
  points.push({ x: lastPoint.x, y: 0 });
  return points;
}

/* ------------------------- Shaded regions ------------------------- */

function buildSampleGrid(coldEnd, warmEnd, steps) {
  const grid = [];
  for (let i = 0; i <= steps; i++) {
    grid.push(coldEnd + (warmEnd - coldEnd) * (i / steps));
  }
  return grid;
}

function buildShadedRegions(unitKey, waterTemp, designLoad, shutdownTemp, designTemp, worstCaseEnabled, worstCaseTemp) {
  const coldEnd = worstCaseEnabled ? worstCaseTemp : designTemp;
  const warmEnd = shutdownTemp;
  const grid = buildSampleGrid(coldEnd, warmEnd, 120);

  const designLoadPoints = [];
  const supplementalPoints = [];
  let balancePoint = null;
  let prevDiff = null, prevX = null, prevLoad = null;

  grid.forEach(x => {
    const load = loadAtTemp(x, designLoad, shutdownTemp, designTemp);
    const cap = getEffectiveCapacityAtTemp(unitKey, waterTemp, x);
    designLoadPoints.push({ x, y: Math.min(load, cap) });
    supplementalPoints.push({ x, y: load });

    const diff = load - cap;
    if (prevDiff !== null && balancePoint === null && prevDiff * diff < 0) {
      const frac = prevDiff / (prevDiff - diff);
      balancePoint = {
        x: prevX + frac * (x - prevX),
        y: prevLoad + frac * (load - prevLoad)
      };
    }
    prevDiff = diff; prevX = x; prevLoad = load;
  });

  return { designLoadPoints, supplementalPoints, balancePoint };
}

/* ------------------------- Input validation ------------------------- */

function validateInputs(inputs) {
  const { designLoad, shutdownTemp, designTemp, waterTemp, worstCaseEnabled, worstCaseTemp } = inputs;
  const errors = [];

  if (isNaN(designLoad) || designLoad <= 0) {
    errors.push('BTU Design Load must be a positive number.');
  }
  if (isNaN(waterTemp)) {
    errors.push('Delivery Water Temp must be a valid number.');
  }
  if (isNaN(shutdownTemp)) {
    errors.push('Outdoor Heater Shutdown Temp must be a valid number.');
  }
  if (isNaN(designTemp)) {
    errors.push('Outdoor Design Temp must be a valid number.');
  }

  if (!isNaN(shutdownTemp) && !isNaN(designTemp) && shutdownTemp <= designTemp) {
    errors.push('Outdoor Heater Shutdown Temp must be warmer than the Outdoor Design Temp.');
  }

  if (worstCaseEnabled) {
    if (isNaN(worstCaseTemp)) {
      errors.push('Outdoor Worst Case Temp must be a valid number.');
    } else if (!isNaN(designTemp) && worstCaseTemp >= designTemp) {
      errors.push('Outdoor Worst Case Temp must be colder than the Outdoor Design Temp.');
    }
  }

  return errors;
}

/* ------------------------- Main sizing calculation ------------------------- */

function runSizingCalculation(inputs) {
  const { unitKey, designLoad, shutdownTemp, designTemp, waterTemp, worstCaseEnabled, worstCaseTemp } = inputs;

  const capacityCurvePoints = getCapacityCurvePoints(unitKey, waterTemp);
  const minOperatingTemp = capacityCurvePoints[0].x;
  const maxOperatingTemp = capacityCurvePoints[capacityCurvePoints.length - 1].x;

  const capacityAtDesign = getEffectiveCapacityAtTemp(unitKey, waterTemp, designTemp);
  const supplementalAtDesign = Math.max(0, designLoad - capacityAtDesign);

  let worstCaseLoad = null, capacityAtWorstCase = null, supplementalAtWorstCase = null;
  if (worstCaseEnabled) {
    worstCaseLoad = loadAtTemp(worstCaseTemp, designLoad, shutdownTemp, designTemp);
    capacityAtWorstCase = getEffectiveCapacityAtTemp(unitKey, waterTemp, worstCaseTemp);
    supplementalAtWorstCase = Math.max(0, worstCaseLoad - capacityAtWorstCase);
  }

  const loadLinePoints = buildLoadLinePoints(shutdownTemp, designTemp, designLoad, worstCaseEnabled, worstCaseTemp, worstCaseLoad);

  const { designLoadPoints, supplementalPoints, balancePoint } =
    buildShadedRegions(unitKey, waterTemp, designLoad, shutdownTemp, designTemp, worstCaseEnabled, worstCaseTemp);

  const minOperatingLine = [
    { x: minOperatingTemp, y: capacityCurvePoints[0].y },
    { x: minOperatingTemp, y: 0 }
  ];
  const maxOperatingLine = [
    { x: maxOperatingTemp, y: capacityCurvePoints[capacityCurvePoints.length - 1].y },
    { x: maxOperatingTemp, y: 0 }
  ];

  const designDayLine = worstCaseEnabled
    ? [{ x: designTemp, y: designLoad }, { x: designTemp, y: 0 }]
    : null;

  const designPoint = { x: designTemp, y: capacityAtDesign };

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
    designPoint,
    balancePoint,
    minOperatingTemp,
    maxOperatingTemp,
    minOperatingLine,
    maxOperatingLine,
    designDayLine
  };
}

/* ------------------------- Competitor comparison + curves ------------------------- */

function getCompetitorEntry(model) {
  return CAPACITY.competitorsSmall[model] || CAPACITY.competitorsLarge[model];
}
function getCompetitorClass(model) {
  return CAPACITY.competitorsSmall[model] ? '3-3.5 Ton' : '5-5.5 Ton';
}
function getCompetitorCurvePoints(model) {
  const entry = getCompetitorEntry(model);
  if (!entry) return [];
  return entry.points
    .filter(p => p.capacity !== null && p.capacity !== undefined)
    .map(p => ({ x: p.od, y: p.capacity }))
    .sort((a, b) => a.x - b.x);
}
function interpolateCompetitor(model, odTemp) {
  const points = getCompetitorCurvePoints(model);
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
    displayName: getCompetitorEntry(model).displayName,
    className: getCompetitorClass(model),
    capDesign: interpolateCompetitor(model, designTemp),
    capWorst: worstCaseEnabled ? interpolateCompetitor(model, worstCaseTemp) : null
  }));
}
function getAllCompetitorCurves() {
  const allModels = [...Object.keys(CAPACITY.competitorsSmall), ...Object.keys(CAPACITY.competitorsLarge)];
  return allModels.map(model => ({
    model,
    displayName: getCompetitorEntry(model).displayName,
    className: getCompetitorClass(model),
    points: getCompetitorCurvePoints(model)
  }));
}
