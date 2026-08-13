/* =========================================================================
   Heat Pump Sizing Tool — UI wiring
   =========================================================================
   1. Small formatting helper
   2. Dropdown population (unit / states / counties) + auto-fill of
      climate data
   3. Design Conditions mode (By Region vs. Manual Entry)
   4. Input validation display
   5. Minimum-operating-temp warning banner
   6. Chart rendering
   7. Results panel + competitor table rendering
   8. Print/export view
   9. Reset to defaults
   10. The main calculate() function that ties it all together
   11. init() — wires up event listeners, auto-recalculates on any change
   ========================================================================= */

let chartInstance = null;

const DEFAULTS = {
  unitKey: 'centrus',
  mode: 'region',
  state: 'Tennessee',
  county: 'Wilson',
  waterTemp: '120',
  shutdownTemp: 65,
  btuLoad: 100000,
  worstCaseEnabled: false,
  showCompetitors: false
};

/* ------------------------- 1. Formatting helper ------------------------- */

function fmtBTU(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Math.round(v).toLocaleString() + ' BTU/h';
}

/* ------------------------- 2. Dropdowns + lookups ------------------------- */

function populateUnits() {
  const unitSelect = document.getElementById('unitSelect');
  unitSelect.innerHTML = '';
  getUnits().forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.key;
    opt.textContent = u.displayName;
    unitSelect.appendChild(opt);
  });
}

function populateStates() {
  const stateSelect = document.getElementById('stateSelect');
  stateSelect.innerHTML = '';
  getStates().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    stateSelect.appendChild(opt);
  });
  if (getStates().includes(DEFAULTS.state)) stateSelect.value = DEFAULTS.state;
}

function populateCounties() {
  const state = document.getElementById('stateSelect').value;
  const countySelect = document.getElementById('countySelect');
  countySelect.innerHTML = '';
  getCounties(state).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    countySelect.appendChild(opt);
  });
  if (getCounties(state).includes(DEFAULTS.county)) countySelect.value = DEFAULTS.county;
  updateLookup();
}

function updateLookup() {
  const state = document.getElementById('stateSelect').value;
  const county = document.getElementById('countySelect').value;
  const data = getCountyData(state, county);
  if (!data) return;

  document.getElementById('lookupRegion').textContent = data.region;
  document.getElementById('lookupDesignTemp').textContent = data.designTemp + ' °F';
  document.getElementById('lookupCoolingTemp').textContent = data.coolingDesignTemp + ' °F';
  document.getElementById('lookupLowestTemp').textContent = data.estimatedLowestTemp + ' °F';

  document.getElementById('designTempOverride').value = data.designTemp;
  document.getElementById('worstCaseTemp').value = data.estimatedLowestTemp;
}

function toggleWorstCaseRow() {
  const enabled = document.getElementById('worstCaseToggle').checked;
  document.getElementById('worstCaseTempRow').style.display = enabled ? 'flex' : 'none';
}

/* ------------------------- 3. Design Conditions mode ------------------------- */

let designConditionsMode = 'region';

function setDesignConditionsMode(mode) {
  designConditionsMode = mode;

  const regionFields = document.getElementById('regionFields');
  const designTempInput = document.getElementById('designTempOverride');
  const worstCaseSection = document.getElementById('worstCaseSection');
  const designTempHint = document.getElementById('designTempHint');

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (mode === 'region') {
    regionFields.style.display = '';
    designTempInput.readOnly = true;
    designTempHint.textContent = 'Auto-filled from county — switch to Manual Entry to type your own.';
    worstCaseSection.style.display = '';
    updateLookup();
  } else {
    regionFields.style.display = 'none';
    designTempInput.readOnly = false;
    designTempHint.textContent = 'Type your own Outdoor Design Temp.';
    worstCaseSection.style.display = 'none';
    document.getElementById('worstCaseToggle').checked = false;
    toggleWorstCaseRow();
  }
}

/* ------------------------- 4. Input validation display ------------------------- */

function showValidationErrors(errors) {
  const el = document.getElementById('validationErrors');
  if (errors.length === 0) {
    el.style.display = 'none';
    el.innerHTML = '';
    return false;
  }
  el.innerHTML = '⚠ Please fix the following before results can be calculated:<ul>' +
    errors.map(e => `<li>${e}</li>`).join('') + '</ul>';
  el.style.display = 'block';
  return true;
}

/* ------------------------- 5. Minimum operating temp warning ------------------------- */

function showMinTempWarning(result, designTemp, worstCaseEnabled, worstCaseTemp) {
  const el = document.getElementById('minTempWarning');
  const messages = [];
  if (designTemp < result.minOperatingTemp) {
    messages.push(`Outdoor Design Temp (${designTemp}°F) is below the selected unit's minimum operating temp (${result.minOperatingTemp}°F) — the unit cannot run at this condition, so supplemental heat must cover the entire Design Load.`);
  }
  if (worstCaseEnabled && worstCaseTemp < result.minOperatingTemp) {
    messages.push(`Outdoor Worst Case Temp (${worstCaseTemp}°F) is below the selected unit's minimum operating temp (${result.minOperatingTemp}°F) — the unit cannot run at this condition, so supplemental heat must cover the entire Worst Case Load.`);
  }
  if (messages.length) {
    el.textContent = '⚠ ' + messages.join(' ');
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

/* ------------------------- 6. Chart rendering ------------------------- */

const COMPETITOR_COLORS = {
  '3-3.5 Ton': { 'Competitor Unit A': '#8d99ae', 'Competitor Unit B': '#adb5bd' },
  '5-5.5 Ton': { 'Competitor Unit A': '#5c4742', 'Competitor Unit B': '#8a7267' }
};

function renderChart(result, competitorCurves) {
  const ctx = document.getElementById('sizingChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  const datasets = [
    {
      label: 'Design Load',
      data: result.designLoadPoints,
      borderWidth: 0,
      pointRadius: 0,
      backgroundColor: 'rgba(200, 16, 46, 0.15)',
      fill: 'origin',
      tension: 0
    },
    {
      label: 'Supplemental Heat Load',
      data: result.supplementalPoints,
      borderWidth: 0,
      pointRadius: 0,
      backgroundColor: 'rgba(35, 31, 32, 0.18)',
      fill: { target: 0 },
      tension: 0
    },
    {
      label: 'Building Load Line',
      data: result.loadLinePoints,
      borderColor: '#c8102e',
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 3,
      fill: false,
      tension: 0
    },
    {
      label: 'Unit Capacity Curve',
      data: result.capacityCurvePoints,
      borderColor: '#231f20',
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 3,
      fill: false,
      tension: 0
    },
    {
      label: 'Operating Range Limit',
      data: result.minOperatingLine,
      borderColor: '#231f20',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0
    },
    {
      label: 'Operating Range Limit',
      data: result.maxOperatingLine,
      borderColor: '#231f20',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0,
      hideFromLegend: true
    },
    {
      label: 'Design Point',
      data: [result.designPoint],
      borderColor: '#1a7a3c',
      backgroundColor: '#1a7a3c',
      pointRadius: 6,
      pointStyle: 'circle',
      showLine: false
    }
  ];

  if (result.designDayLine) {
    datasets.push({
      label: 'Design Day Reference',
      data: result.designDayLine,
      borderColor: '#c8102e',
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0
    });
  }

  if (competitorCurves) {
    competitorCurves.forEach(c => {
      const color = (COMPETITOR_COLORS[c.className] || {})[c.displayName] || '#9d9d9d';
      datasets.push({
        label: `${c.displayName} (${c.className})`,
        data: c.points,
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [3, 3],
        pointRadius: 2,
        fill: false,
        tension: 0
      });
    });
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          reverse: true,
          title: { display: true, text: 'Outdoor Temperature (°F)' }
        },
        y: {
          title: { display: true, text: 'BTU/h' },
          beginAtZero: true
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            filter: (item, data) => !data.datasets[item.datasetIndex].hideFromLegend
          }
        },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${Math.round(item.parsed.y).toLocaleString()} BTU/h @ ${item.parsed.x.toFixed(1)}°F`
          }
        }
      }
    }
  });
}

/* ------------------------- 7. Results + competitor table ------------------------- */

function renderResults(result, worstCaseEnabled) {
  document.getElementById('resSupplemental').textContent = fmtBTU(result.supplementalAtDesign);
  document.getElementById('resCapacityDesign').textContent = fmtBTU(result.capacityAtDesign);

  document.getElementById('worstCaseResultBlock').style.display = worstCaseEnabled ? 'flex' : 'none';
  document.getElementById('worstCaseCapBlock').style.display = worstCaseEnabled ? 'flex' : 'none';
  document.getElementById('worstCaseSupBlock').style.display = worstCaseEnabled ? 'flex' : 'none';

  if (worstCaseEnabled) {
    document.getElementById('resWorstCaseLoad').textContent = fmtBTU(result.worstCaseLoad);
    document.getElementById('resCapacityWorstCase').textContent = fmtBTU(result.capacityAtWorstCase);
    document.getElementById('resSupplementalWorstCase').textContent = fmtBTU(result.supplementalAtWorstCase);
  }

  const dp = result.designPoint;
  document.getElementById('balancePointNote').textContent =
    `Design Point: ${dp.x.toFixed(1)}°F at ${Math.round(dp.y).toLocaleString()} BTU/h (unit capacity at your selected Design Temp — this drives the Supplemental Heat Required figure above).`;
}

function renderComparisonTable(rows, unitCapacityDesign, unitCapacityWorst, worstCaseEnabled) {
  const tbody = document.getElementById('comparisonTableBody');
  tbody.innerHTML = '';

  const unitSelect = document.getElementById('unitSelect');
  const selectedUnitName = unitSelect.options[unitSelect.selectedIndex].textContent;

  const selectedRow = document.createElement('tr');
  selectedRow.classList.add('centrus-row');
  selectedRow.innerHTML = `
    <td>${selectedUnitName}</td>
    <td>—</td>
    <td>${fmtBTU(unitCapacityDesign)}</td>
    <td class="worstcase-col">${worstCaseEnabled ? fmtBTU(unitCapacityWorst) : '—'}</td>
  `;
  tbody.appendChild(selectedRow);

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.displayName}</td>
      <td>${r.className}</td>
      <td>${fmtBTU(r.capDesign)}</td>
      <td class="worstcase-col">${worstCaseEnabled ? fmtBTU(r.capWorst) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ------------------------- 8. Print / export view ------------------------- */

function openPrintView() {
  const unitSelect = document.getElementById('unitSelect');
  const unitName = unitSelect.options[unitSelect.selectedIndex].textContent;
  const state = document.getElementById('stateSelect').value;
  const county = document.getElementById('countySelect').value;
  const waterTemp = document.getElementById('deliveryWaterTemp').value;
  const shutdownTemp = document.getElementById('shutdownTemp').value;
  const designTemp = document.getElementById('designTempOverride').value;
  const btuLoad = document.getElementById('btuLoad').value;
  const worstCaseEnabled = document.getElementById('worstCaseToggle').checked;
  const worstCaseTemp = document.getElementById('worstCaseTemp').value;

  const supplemental = document.getElementById('resSupplemental').textContent;
  const capacityDesign = document.getElementById('resCapacityDesign').textContent;
  const worstCaseLoad = document.getElementById('resWorstCaseLoad').textContent;
  const capacityWorst = document.getElementById('resCapacityWorstCase').textContent;
  const supplementalWorst = document.getElementById('resSupplementalWorstCase').textContent;

  const chartImage = document.getElementById('sizingChart').toDataURL('image/png');

  const locationLine = designConditionsMode === 'region'
    ? `${county} County, ${state}`
    : 'Manually entered design conditions';

  const w = window.open('', '_blank');
  w.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Heat Pump Sizing Summary</title>
      <style>
        body { font-family: Arial, sans-serif; color: #231f20; padding: 32px; max-width: 800px; margin: 0 auto; }
        h1 { color: #c8102e; border-bottom: 3px solid #c8102e; padding-bottom: 8px; }
        h2 { color: #231f20; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.03em; margin-top: 28px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        td, th { padding: 8px 10px; text-align: left; border-bottom: 1px solid #e0e0e0; }
        th { background: #f5f5f5; }
        .summary-value { font-weight: 700; color: #c8102e; }
        img { max-width: 100%; margin-top: 16px; border: 1px solid #e0e0e0; }
        .print-btn { background: #c8102e; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 700; cursor: pointer; margin-bottom: 20px; }
        @media print { .print-btn { display: none; } }
      </style>
    </head>
    <body>
      <button class="print-btn" onclick="window.print()">Print this summary</button>
      <h1>Heat Pump Sizing Summary</h1>
      <p><strong>Unit:</strong> ${unitName} &nbsp; | &nbsp; <strong>Location:</strong> ${locationLine}</p>

      <h2>Inputs</h2>
      <table>
        <tr><td>Delivery Water Temp</td><td>${waterTemp} °F</td></tr>
        <tr><td>Outdoor Heater Shutdown Temp</td><td>${shutdownTemp} °F</td></tr>
        <tr><td>Outdoor Design Temp</td><td>${designTemp} °F</td></tr>
        <tr><td>BTU Design Load</td><td>${Number(btuLoad).toLocaleString()} BTU/h</td></tr>
        ${worstCaseEnabled ? `<tr><td>Outdoor Worst Case Temp</td><td>${worstCaseTemp} °F</td></tr>` : ''}
      </table>

      <h2>Results</h2>
      <table>
        <tr><td>Supplemental Heat Required</td><td class="summary-value">${supplemental}</td></tr>
        <tr><td>Unit Capacity at Design Temp</td><td>${capacityDesign}</td></tr>
        ${worstCaseEnabled ? `
        <tr><td>Worst Case BTU Load</td><td>${worstCaseLoad}</td></tr>
        <tr><td>Unit Capacity at Worst Case</td><td>${capacityWorst}</td></tr>
        <tr><td>Supplemental Heat (Worst Case)</td><td class="summary-value">${supplementalWorst}</td></tr>
        ` : ''}
      </table>

      <h2>Load vs. Capacity Curve</h2>
      <img src="${chartImage}" alt="Load vs Capacity Curve chart">
    </body>
    </html>
  `);
  w.document.close();
}

/* ------------------------- 9. Reset to defaults ------------------------- */

function resetToDefaults() {
  document.getElementById('unitSelect').value = DEFAULTS.unitKey;
  setDesignConditionsMode(DEFAULTS.mode);
  document.getElementById('stateSelect').value = DEFAULTS.state;
  populateCounties();
  document.getElementById('countySelect').value = DEFAULTS.county;
  updateLookup();
  document.getElementById('deliveryWaterTemp').value = DEFAULTS.waterTemp;
  document.getElementById('shutdownTemp').value = DEFAULTS.shutdownTemp;
  document.getElementById('btuLoad').value = DEFAULTS.btuLoad;
  document.getElementById('worstCaseToggle').checked = DEFAULTS.worstCaseEnabled;
  toggleWorstCaseRow();
  document.getElementById('showCompetitorsToggle').checked = DEFAULTS.showCompetitors;
  calculate();
}

/* ------------------------- 10. Main calculate() ------------------------- */

function calculate() {
  const unitKey = document.getElementById('unitSelect').value;
  const designTemp = parseFloat(document.getElementById('designTempOverride').value);
  const shutdownTemp = parseFloat(document.getElementById('shutdownTemp').value);
  const waterTemp = parseFloat(document.getElementById('deliveryWaterTemp').value);
  const designLoad = parseFloat(document.getElementById('btuLoad').value);
  const worstCaseEnabled = designConditionsMode === 'region' && document.getElementById('worstCaseToggle').checked;
  const worstCaseTemp = parseFloat(document.getElementById('worstCaseTemp').value);
  const showCompetitors = document.getElementById('showCompetitorsToggle').checked;

  const errors = validateInputs({ designLoad, shutdownTemp, designTemp, waterTemp, worstCaseEnabled, worstCaseTemp });
  const hasErrors = showValidationErrors(errors);

  document.getElementById('resultsContent').style.display = hasErrors ? 'none' : '';
  if (hasErrors) {
    document.getElementById('minTempWarning').style.display = 'none';
    return;
  }

  const result = runSizingCalculation({
    unitKey, designLoad, shutdownTemp, designTemp, waterTemp, worstCaseEnabled, worstCaseTemp
  });

  showMinTempWarning(result, designTemp, worstCaseEnabled, worstCaseTemp);
  renderResults(result, worstCaseEnabled);

  const competitorCurves = showCompetitors ? getAllCompetitorCurves() : null;
  renderChart(result, competitorCurves);

  const compRows = buildCompetitorComparison(designTemp, worstCaseTemp, worstCaseEnabled);
  renderComparisonTable(compRows, result.capacityAtDesign, result.capacityAtWorstCase, worstCaseEnabled);
}

/* ------------------------- 11. Init ------------------------- */

async function init() {
  await loadData();
  populateUnits();
  populateStates();
  populateCounties();
  setDesignConditionsMode('region');
  toggleWorstCaseRow();

  document.getElementById('unitSelect').addEventListener('change', calculate);
  document.getElementById('stateSelect').addEventListener('change', () => { populateCounties(); calculate(); });
  document.getElementById('countySelect').addEventListener('change', () => { updateLookup(); calculate(); });
  document.getElementById('worstCaseToggle').addEventListener('change', () => { toggleWorstCaseRow(); calculate(); });
  document.getElementById('showCompetitorsToggle').addEventListener('change', calculate);
  document.getElementById('resetBtn').addEventListener('click', resetToDefaults);
  document.getElementById('printBtn').addEventListener('click', openPrintView);

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => { setDesignConditionsMode(btn.dataset.mode); calculate(); });
  });

  ['deliveryWaterTemp', 'shutdownTemp', 'designTempOverride', 'btuLoad', 'worstCaseTemp']
    .forEach(id => document.getElementById(id).addEventListener('input', calculate));

  calculate();
}

init();
