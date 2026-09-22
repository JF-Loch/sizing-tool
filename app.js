/* =========================================================================
   Heat Pump Sizing Tool — UI wiring
   =========================================================================
   PER-MODE INPUT STATE
   --------------------
   Heating and Cooling each keep their own completely independent set of
   inputs. Typing 10,000 BTU in Cooling does not touch the 100,000 you left
   in Heating; changing the Cooling Lockout Temp doesn't disturb the Heater
   Shutdown Temp; and so on.

   That lives in `modeState`, a small store holding one snapshot per mode:

       captureState(mode)  DOM  ->  modeState[mode]
       applyState(mode)    modeState[mode]  ->  DOM

   Switching modes captures the outgoing mode first, then applies the
   incoming one. Nothing is shared between the two snapshots.

   WHAT IS *NOT* PER-MODE (deliberately)
     - Heat Pump Model, State, and County are shared. They describe the
       physical unit and the physical building, which don't change when you
       flip between heating and cooling season. Changing the county updates
       BOTH modes' design temps from that county's HDD/CDD columns.

   RESET TO DEFAULTS
     Resets only the current mode's inputs and stays on the current mode.
     The other mode's snapshot is left untouched.
   ========================================================================= */

let chartInstance = null;
let currentMode = 'heating';
let initialized = false;   // guards captureState() before the DOM is seeded

/* Shared (not per-mode) defaults. */
const SHARED_DEFAULTS = { unitKey: 'centrus', state: 'Tennessee', county: 'Wilson' };

/* Starting values for each mode's independent snapshot.
   designTemp / worstCaseTemp are null = "derive from the county lookup". */
function freshModeState(mode) {
  const cfg = modeConfig(mode);
  return {
    conditionsMode: 'region',
    waterTemp: cfg.defaultWaterTemp,
    shutdownTemp: cfg.defaultShutdownTemp,
    btuLoad: 100000,
    designTemp: null,
    worstCaseEnabled: false,
    worstCaseTemp: null,
    showCompetitors: false
  };
}

let modeState = { heating: freshModeState('heating'), cooling: freshModeState('cooling') };

/* ------------------------- Formatting ------------------------- */

function fmtBTU(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Math.round(v).toLocaleString() + ' BTU/h';
}

/* ------------------------- Per-mode state capture / apply ------------------------- */

function captureState(mode) {
  if (!initialized) return;
  const s = modeState[mode];
  s.conditionsMode   = s.conditionsMode; // set by setDesignConditionsMode
  s.waterTemp        = document.getElementById('deliveryWaterTemp').value;
  s.shutdownTemp     = document.getElementById('shutdownTemp').value;
  s.btuLoad          = document.getElementById('btuLoad').value;
  s.designTemp       = document.getElementById('designTempOverride').value;
  s.worstCaseEnabled = document.getElementById('worstCaseToggle').checked;
  s.worstCaseTemp    = document.getElementById('worstCaseTemp').value;
  s.showCompetitors  = document.getElementById('showCompetitorsToggle').checked;
}

function applyState(mode) {
  const s = modeState[mode];

  // Water temps must be rebuilt for this mode before we can select one.
  populateWaterTemps();
  const sel = document.getElementById('deliveryWaterTemp');
  const opts = [...sel.options].map(o => o.value);
  sel.value = opts.includes(String(s.waterTemp))
    ? String(s.waterTemp) : String(modeConfig(mode).defaultWaterTemp);

  document.getElementById('shutdownTemp').value = s.shutdownTemp;
  document.getElementById('btuLoad').value = s.btuLoad;
  document.getElementById('worstCaseToggle').checked = s.worstCaseEnabled;
  document.getElementById('showCompetitorsToggle').checked = s.showCompetitors;

  // Applies readonly/visibility rules for this mode's conditions source.
  applyDesignConditionsMode(s.conditionsMode);

  if (s.conditionsMode === 'region') {
    // Region drives the temps — refill from the county for THIS mode.
    updateLookup();
  } else {
    // Manual entry — restore exactly what the user typed for this mode.
    if (s.designTemp !== null) document.getElementById('designTempOverride').value = s.designTemp;
    if (s.worstCaseTemp !== null) document.getElementById('worstCaseTemp').value = s.worstCaseTemp;
  }

  toggleWorstCaseRow();
}

/* ------------------------- Mode switching ------------------------- */

function setMode(mode) {
  if (mode === currentMode && initialized) return;
  captureState(currentMode);          // bank the outgoing mode's inputs
  currentMode = mode;
  applyModeChrome(mode);              // labels, colors, tile visibility
  applyState(mode);                   // restore this mode's own inputs
}

// Everything cosmetic/structural that differs between modes.
function applyModeChrome(mode) {
  const cfg = modeConfig(mode);
  const cooling = mode === 'cooling';

  document.querySelectorAll('.mode-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  document.body.classList.toggle('cooling-mode', cooling);

  document.getElementById('designTempLabel').textContent = cfg.designTempLabel + ' (°F)';
  document.getElementById('shutdownTempLabel').textContent = cfg.shutdownLabel + ' (°F)';
  document.getElementById('worstCaseTempLabel').textContent = cfg.worstCaseLabel + ' (°F)';
  document.getElementById('resSupplementalLabel').textContent = cfg.supplementalLabel;
  document.getElementById('resSupplementalWorstCaseLabel').textContent =
    cooling ? 'Supplemental Cooling (Worst Case)' : 'Supplemental Heat (Worst Case)';
  document.getElementById('btuLoadLabel').textContent =
    cooling ? 'BTU Cooling Design Load' : 'BTU Design Load';
  document.getElementById('chartCardTitle').textContent =
    cooling ? 'Cooling Load vs. Capacity Curve' : 'Load vs. Capacity Curve';

  // Show only the lookup tiles that actually drive the current mode —
  // the irrelevant pair is hidden outright rather than greyed out.
  document.getElementById('tileHeatDesign').style.display = cooling ? 'none' : '';
  document.getElementById('tileLowest').style.display     = cooling ? 'none' : '';
  document.getElementById('tileCoolDesign').style.display = cooling ? '' : 'none';
  document.getElementById('tileHighest').style.display    = cooling ? '' : 'none';

  // Competitor UI is heating-only until cooling data exists.
  const show = competitorsAvailable(mode);
  document.getElementById('competitorCard').style.display = show ? '' : 'none';
  document.getElementById('competitorToggleRow').style.display = show ? '' : 'none';
  document.getElementById('competitorUnavailableNote').style.display = show ? 'none' : '';
}

function populateWaterTemps() {
  const unitKey = document.getElementById('unitSelect').value;
  const sel = document.getElementById('deliveryWaterTemp');
  sel.innerHTML = '';
  getWaterTemps(unitKey, currentMode).forEach(t => {
    const o = document.createElement('option');
    o.value = String(t); o.textContent = String(t);
    sel.appendChild(o);
  });
}

/* ------------------------- Dropdowns + lookup ------------------------- */

function populateUnits() {
  const sel = document.getElementById('unitSelect');
  sel.innerHTML = '';
  getUnits().forEach(u => {
    const o = document.createElement('option');
    o.value = u.key; o.textContent = u.displayName;
    sel.appendChild(o);
  });
  sel.value = SHARED_DEFAULTS.unitKey;
}

function populateStates() {
  const sel = document.getElementById('stateSelect');
  sel.innerHTML = '';
  getStates().forEach(s => {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    sel.appendChild(o);
  });
  if (getStates().includes(SHARED_DEFAULTS.state)) sel.value = SHARED_DEFAULTS.state;
}

function populateCounties(preferred) {
  const state = document.getElementById('stateSelect').value;
  const sel = document.getElementById('countySelect');
  const list = getCounties(state);
  sel.innerHTML = '';
  list.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  if (preferred && list.includes(preferred)) sel.value = preferred;
  updateLookup();
}

function updateLookup() {
  const d = getCountyData(
    document.getElementById('stateSelect').value,
    document.getElementById('countySelect').value);
  if (!d) return;

  document.getElementById('lookupRegion').textContent = d.region;
  document.getElementById('lookupDesignTemp').textContent = d.designTemp + ' °F';
  document.getElementById('lookupCoolingTemp').textContent = d.coolingDesignTemp + ' °F';
  document.getElementById('lookupLowestTemp').textContent = d.estimatedLowestTemp + ' °F';
  document.getElementById('lookupHighestTemp').textContent = d.estimatedHighestTemp + ' °F';

  // Only the region lookup overwrites the editable fields, and only for
  // the mode currently on screen.
  if (modeState[currentMode].conditionsMode === 'region') {
    const cfg = modeConfig(currentMode);
    document.getElementById('designTempOverride').value = d[cfg.designTempField];
    document.getElementById('worstCaseTemp').value = d[cfg.worstCaseField];
    modeState[currentMode].designTemp = d[cfg.designTempField];
    modeState[currentMode].worstCaseTemp = d[cfg.worstCaseField];
  }
}

function toggleWorstCaseRow() {
  const on = document.getElementById('worstCaseToggle').checked;
  document.getElementById('worstCaseTempRow').style.display = on ? 'flex' : 'none';
}

/* ------------------------- Design Conditions source ------------------------- */

// Pure presentation — no state writes, so applyState() can reuse it.
function applyDesignConditionsMode(source) {
  const cfg = modeConfig(currentMode);
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === source);
  });
  const manual = source === 'manual';
  document.getElementById('regionFields').style.display = manual ? 'none' : '';
  document.getElementById('designTempOverride').readOnly = !manual;
  document.getElementById('worstCaseSection').style.display = manual ? 'none' : '';
  document.getElementById('designTempHint').textContent = manual
    ? `Type your own ${cfg.designTempLabel}.`
    : 'Auto-filled from county — switch to Manual Entry to type your own.';
}

// User-initiated change — records it against the current mode only.
function setDesignConditionsMode(source) {
  modeState[currentMode].conditionsMode = source;
  applyDesignConditionsMode(source);
  if (source === 'region') {
    updateLookup();
  } else {
    document.getElementById('worstCaseToggle').checked = false;
    modeState[currentMode].worstCaseEnabled = false;
    toggleWorstCaseRow();
  }
}

/* ------------------------- Validation + warning ------------------------- */

function showValidationErrors(errors) {
  const el = document.getElementById('validationErrors');
  if (errors.length === 0) { el.style.display = 'none'; el.innerHTML = ''; return false; }
  el.innerHTML = '⚠ Please fix the following before results can be calculated:<ul>'
    + errors.map(e => `<li>${e}</li>`).join('') + '</ul>';
  el.style.display = 'block';
  return true;
}

function showLimitWarning(result, designTemp, wcEnabled, wcTemp) {
  const el = document.getElementById('minTempWarning');
  const cooling = currentMode === 'cooling';
  const limit = result.demandLimitTemp;
  const beyond = t => cooling ? (t > limit) : (t < limit);
  const word = cooling ? 'above' : 'below';
  const noun = cooling ? 'cooling' : 'heat';
  const msgs = [];

  if (beyond(designTemp)) {
    msgs.push(`${modeConfig(currentMode).designTempLabel} (${designTemp}°F) is ${word} the selected unit's operating limit (${limit}°F) — the unit cannot run at this condition, so supplemental ${noun} must cover the entire Design Load.`);
  }
  if (wcEnabled && beyond(wcTemp)) {
    msgs.push(`Outdoor Worst Case Temp (${wcTemp}°F) is ${word} the selected unit's operating limit (${limit}°F) — the unit cannot run at this condition, so supplemental ${noun} must cover the entire Worst Case Load.`);
  }
  if (msgs.length) { el.textContent = '⚠ ' + msgs.join(' '); el.style.display = 'block'; }
  else el.style.display = 'none';
}

/* ------------------------- Chart ------------------------- */

const COMPETITOR_COLORS = {
  '3-3.5 Ton': { 'Competitor Unit A': '#8d99ae', 'Competitor Unit B': '#adb5bd' },
  '5-5.5 Ton': { 'Competitor Unit A': '#5c4742', 'Competitor Unit B': '#8a7267' }
};

function renderChart(result, competitorCurves) {
  const ctx = document.getElementById('sizingChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  const cooling = result.mode === 'cooling';
  const loadColor = cooling ? '#0b6fa5' : '#c8102e';
  const fillLoad = cooling ? 'rgba(11, 111, 165, 0.15)' : 'rgba(200, 16, 46, 0.15)';

  const datasets = [
    { label: cooling ? 'Cooling Load Met' : 'Design Load',
      data: result.designLoadPoints, borderWidth: 0, pointRadius: 0,
      backgroundColor: fillLoad, fill: 'origin', tension: 0 },
    { label: cooling ? 'Supplemental Cooling Load' : 'Supplemental Heat Load',
      data: result.supplementalPoints, borderWidth: 0, pointRadius: 0,
      backgroundColor: 'rgba(35, 31, 32, 0.18)', fill: { target: 0 }, tension: 0 },
    { label: 'Building Load Line', data: result.loadLinePoints,
      borderColor: loadColor, backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 3, fill: false, tension: 0 },
    { label: 'Unit Capacity Curve', data: result.capacityCurvePoints,
      borderColor: '#231f20', backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 3, fill: false, tension: 0 },
    { label: 'Operating Range Limit', data: result.minOperatingLine,
      borderColor: '#231f20', borderDash: [6, 4], borderWidth: 2,
      pointRadius: 0, fill: false, tension: 0 },
    { label: 'Operating Range Limit', data: result.maxOperatingLine,
      borderColor: '#231f20', borderDash: [6, 4], borderWidth: 2,
      pointRadius: 0, fill: false, tension: 0, hideFromLegend: true },
    { label: 'Design Point', data: [result.designPoint],
      borderColor: '#1a7a3c', backgroundColor: '#1a7a3c',
      pointRadius: 6, pointStyle: 'circle', showLine: false }
  ];

  if (result.designDayLine) {
    datasets.push({ label: 'Design Day Reference', data: result.designDayLine,
      borderColor: loadColor, borderDash: [6, 4], borderWidth: 2,
      pointRadius: 0, fill: false, tension: 0 });
  }

  (competitorCurves || []).forEach(c => {
    const color = (COMPETITOR_COLORS[c.className] || {})[c.displayName] || '#9d9d9d';
    datasets.push({ label: `${c.displayName} (${c.className})`, data: c.points,
      borderColor: color, backgroundColor: 'transparent', borderWidth: 2,
      borderDash: [3, 3], pointRadius: 2, fill: false, tension: 0 });
  });

  chartInstance = new Chart(ctx, {
    type: 'line', data: { datasets },
    options: {
      responsive: true,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        // Heating reads right-to-left (colder right, matching the workbook);
        // cooling is the inverse so the demanding end stays on the right.
        x: { type: 'linear', reverse: !cooling,
             title: { display: true, text: 'Outdoor Temperature (°F)' } },
        y: { title: { display: true, text: 'BTU/h' }, beginAtZero: true }
      },
      plugins: {
        legend: { position: 'bottom',
          labels: { filter: (i, d) => !d.datasets[i.datasetIndex].hideFromLegend } },
        tooltip: { callbacks: {
          label: i => `${i.dataset.label}: ${Math.round(i.parsed.y).toLocaleString()} BTU/h @ ${i.parsed.x.toFixed(1)}°F`
        } }
      }
    }
  });
}

/* ------------------------- Results + table ------------------------- */

function renderResults(result, wcEnabled) {
  document.getElementById('resSupplemental').textContent = fmtBTU(result.supplementalAtDesign);
  document.getElementById('resCapacityDesign').textContent = fmtBTU(result.capacityAtDesign);

  ['worstCaseResultBlock', 'worstCaseCapBlock', 'worstCaseSupBlock'].forEach(id => {
    document.getElementById(id).style.display = wcEnabled ? 'flex' : 'none';
  });
  if (wcEnabled) {
    document.getElementById('resWorstCaseLoad').textContent = fmtBTU(result.worstCaseLoad);
    document.getElementById('resCapacityWorstCase').textContent = fmtBTU(result.capacityAtWorstCase);
    document.getElementById('resSupplementalWorstCase').textContent = fmtBTU(result.supplementalAtWorstCase);
  }

  const dp = result.designPoint;
  const verb = result.mode === 'cooling' ? 'Supplemental Cooling' : 'Supplemental Heat';
  document.getElementById('balancePointNote').textContent =
    `Design Point: ${dp.x.toFixed(1)}°F at ${Math.round(dp.y).toLocaleString()} BTU/h `
    + `(unit capacity at your selected Design Temp — this drives the ${verb} Required figure above).`;
}

function renderComparisonTable(rows, capDesign, capWorst, wcEnabled) {
  const tbody = document.getElementById('comparisonTableBody');
  tbody.innerHTML = '';
  const sel = document.getElementById('unitSelect');
  const unitName = sel.options[sel.selectedIndex].textContent;

  const own = document.createElement('tr');
  own.classList.add('centrus-row');
  own.innerHTML = `<td>${unitName}</td><td>—</td><td>${fmtBTU(capDesign)}</td>`
    + `<td class="worstcase-col">${wcEnabled ? fmtBTU(capWorst) : '—'}</td>`;
  tbody.appendChild(own);

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.displayName}</td><td>${r.className}</td>`
      + `<td>${fmtBTU(r.capDesign)}</td>`
      + `<td class="worstcase-col">${wcEnabled ? fmtBTU(r.capWorst) : '—'}</td>`;
    tbody.appendChild(tr);
  });
}

/* ------------------------- Print / export ------------------------- */

function openPrintView() {
  const cfg = modeConfig(currentMode);
  const sel = document.getElementById('unitSelect');
  const unitName = sel.options[sel.selectedIndex].textContent;
  const state = document.getElementById('stateSelect').value;
  const county = document.getElementById('countySelect').value;
  const waterTemp = document.getElementById('deliveryWaterTemp').value;
  const shutdownTemp = document.getElementById('shutdownTemp').value;
  const designTemp = document.getElementById('designTempOverride').value;
  const btuLoad = document.getElementById('btuLoad').value;
  const wcEnabled = document.getElementById('worstCaseToggle').checked;
  const wcTemp = document.getElementById('worstCaseTemp').value;

  const supplemental = document.getElementById('resSupplemental').textContent;
  const capDesign = document.getElementById('resCapacityDesign').textContent;
  const wcLoad = document.getElementById('resWorstCaseLoad').textContent;
  const capWC = document.getElementById('resCapacityWorstCase').textContent;
  const supWC = document.getElementById('resSupplementalWorstCase').textContent;
  const chartImage = document.getElementById('sizingChart').toDataURL('image/png');

  const location = modeState[currentMode].conditionsMode === 'region'
    ? `${county} County, ${state}` : 'Manually entered design conditions';
  const modeName = currentMode === 'cooling' ? 'Cooling' : 'Heating';
  const accent = currentMode === 'cooling' ? '#0b6fa5' : '#c8102e';

  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>${modeName} Sizing Summary</title><style>
    body{font-family:Arial,sans-serif;color:#231f20;padding:32px;max-width:800px;margin:0 auto}
    h1{color:${accent};border-bottom:3px solid ${accent};padding-bottom:8px}
    h2{font-size:1rem;text-transform:uppercase;letter-spacing:.03em;margin-top:28px}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    td,th{padding:8px 10px;text-align:left;border-bottom:1px solid #e0e0e0}
    th{background:#f5f5f5}.v{font-weight:700;color:${accent}}
    img{max-width:100%;margin-top:16px;border:1px solid #e0e0e0}
    .b{background:${accent};color:#fff;border:none;padding:10px 20px;border-radius:6px;font-weight:700;cursor:pointer;margin-bottom:20px}
    @media print{.b{display:none}}
  </style></head><body>
    <button class="b" onclick="window.print()">Print this summary</button>
    <h1>${modeName} Sizing Summary</h1>
    <p><strong>Mode:</strong> ${modeName} &nbsp;|&nbsp; <strong>Unit:</strong> ${unitName} &nbsp;|&nbsp; <strong>Location:</strong> ${location}</p>
    <h2>Inputs</h2><table>
      <tr><td>Delivery Water Temp</td><td>${waterTemp} °F</td></tr>
      <tr><td>${cfg.shutdownLabel}</td><td>${shutdownTemp} °F</td></tr>
      <tr><td>${cfg.designTempLabel}</td><td>${designTemp} °F</td></tr>
      <tr><td>BTU Design Load</td><td>${Number(btuLoad).toLocaleString()} BTU/h</td></tr>
      ${wcEnabled ? `<tr><td>Outdoor Worst Case Temp</td><td>${wcTemp} °F</td></tr>` : ''}
    </table>
    <h2>Results</h2><table>
      <tr><td>${cfg.supplementalLabel}</td><td class="v">${supplemental}</td></tr>
      <tr><td>Unit Capacity at Design Temp</td><td>${capDesign}</td></tr>
      ${wcEnabled ? `<tr><td>Worst Case BTU Load</td><td>${wcLoad}</td></tr>
      <tr><td>Unit Capacity at Worst Case</td><td>${capWC}</td></tr>
      <tr><td>${cfg.supplementalLabel} (Worst Case)</td><td class="v">${supWC}</td></tr>` : ''}
    </table>
    <h2>Load vs. Capacity Curve</h2>
    <img src="${chartImage}" alt="Load vs Capacity chart">
  </body></html>`);
  w.document.close();
}

/* ------------------------- Reset ------------------------- */

// Resets ONLY the current mode's inputs. Stays on the current mode and
// leaves the other mode's snapshot completely alone.
function resetToDefaults() {
  modeState[currentMode] = freshModeState(currentMode);
  applyState(currentMode);
  calculate();
}

/* ------------------------- calculate() ------------------------- */

function calculate() {
  captureState(currentMode);   // keep this mode's snapshot current

  const unitKey = document.getElementById('unitSelect').value;
  const designTemp = parseFloat(document.getElementById('designTempOverride').value);
  const shutdownTemp = parseFloat(document.getElementById('shutdownTemp').value);
  const waterTemp = parseFloat(document.getElementById('deliveryWaterTemp').value);
  const designLoad = parseFloat(document.getElementById('btuLoad').value);
  const worstCaseEnabled = modeState[currentMode].conditionsMode === 'region'
    && document.getElementById('worstCaseToggle').checked;
  const worstCaseTemp = parseFloat(document.getElementById('worstCaseTemp').value);
  const showCompetitors = document.getElementById('showCompetitorsToggle').checked;

  const inputs = { unitKey, mode: currentMode, designLoad, shutdownTemp,
                   designTemp, waterTemp, worstCaseEnabled, worstCaseTemp };

  const hasErrors = showValidationErrors(validateInputs(inputs));
  document.getElementById('resultsContent').style.display = hasErrors ? 'none' : '';
  if (hasErrors) { document.getElementById('minTempWarning').style.display = 'none'; return; }

  const result = runSizingCalculation(inputs);
  showLimitWarning(result, designTemp, worstCaseEnabled, worstCaseTemp);
  renderResults(result, worstCaseEnabled);
  renderChart(result, showCompetitors ? getAllCompetitorCurves(currentMode) : null);
  renderComparisonTable(
    buildCompetitorComparison(currentMode, designTemp, worstCaseTemp, worstCaseEnabled),
    result.capacityAtDesign, result.capacityAtWorstCase, worstCaseEnabled);
}

/* ------------------------- init ------------------------- */

async function init() {
  await loadData();
  populateUnits();
  populateStates();
  populateCounties(SHARED_DEFAULTS.county);

  applyModeChrome('heating');
  applyState('heating');
  initialized = true;

  document.querySelectorAll('.mode-pill').forEach(btn => {
    btn.addEventListener('click', () => { setMode(btn.dataset.mode); calculate(); });
  });
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => { setDesignConditionsMode(btn.dataset.mode); calculate(); });
  });

  // Unit is shared, but the water-temp list is per-mode, so rebuild + restore.
  document.getElementById('unitSelect').addEventListener('change', () => {
    applyState(currentMode); calculate();
  });
  // State/County are shared; changing them refreshes the on-screen mode's
  // temps now, and the other mode picks up the new county when switched to.
  document.getElementById('stateSelect').addEventListener('change', () => {
    populateCounties(); calculate();
  });
  document.getElementById('countySelect').addEventListener('change', () => {
    updateLookup(); calculate();
  });
  document.getElementById('worstCaseToggle').addEventListener('change', () => {
    toggleWorstCaseRow(); calculate();
  });
  document.getElementById('showCompetitorsToggle').addEventListener('change', calculate);
  document.getElementById('resetBtn').addEventListener('click', resetToDefaults);
  document.getElementById('printBtn').addEventListener('click', openPrintView);

  ['deliveryWaterTemp', 'shutdownTemp', 'designTempOverride', 'btuLoad', 'worstCaseTemp']
    .forEach(id => document.getElementById(id).addEventListener('input', calculate));

  calculate();
}

init();
