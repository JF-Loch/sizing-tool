/* =========================================================================
   Centrus Sizing Tool — UI wiring
   =========================================================================
   1. Small formatting helper
   2. Dropdown population (states / counties) + auto-fill of climate data
   3. Chart rendering (lines, shaded regions, intersection points)
   4. Results panel + competitor table rendering
   5. The main calculate() function that ties it all together
   6. init() — wires up event listeners so every input auto-recalculates,
      and runs the first calculation on page load
   ========================================================================= */

let chartInstance = null;

/* ------------------------- 1. Formatting helper ------------------------- */

function fmtBTU(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Math.round(v).toLocaleString() + ' BTU/h';
}

/* ------------------------- 2. Dropdowns + lookups ------------------------- */

function populateStates() {
  const stateSelect = document.getElementById('stateSelect');
  stateSelect.innerHTML = '';
  getStates().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    stateSelect.appendChild(opt);
  });
  if (getStates().includes('Tennessee')) stateSelect.value = 'Tennessee';
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
  if (getCounties(state).includes('Wilson')) countySelect.value = 'Wilson';
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

/* ------------------------- 3. Chart rendering ------------------------- */

function renderChart(result) {
  const ctx = document.getElementById('sizingChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  // Dataset order matters here: the two shaded-region fills are drawn
  // first (indices 0 and 1) so the visible line strokes and intersection
  // dots (added after) render on top of the shading, not underneath it.
  const datasets = [
    {
      // Blue/green shaded area: the portion of the load the unit supplies
      // on its own (min of load and capacity, filled down to zero).
      label: 'Design Load',
      data: result.designLoadPoints,
      borderWidth: 0,
      pointRadius: 0,
      backgroundColor: 'rgba(11, 95, 165, 0.25)',
      fill: 'origin',
      tension: 0
    },
    {
      // Red shaded area: filled between this dataset (the load line) and
      // the "Design Load" dataset above (index 0). Since load is always
      // >= min(load, capacity), this only shows where capacity falls
      // short of the load — the supplemental heat gap.
      label: 'Supplemental Heat Load',
      data: result.supplementalPoints,
      borderWidth: 0,
      pointRadius: 0,
      backgroundColor: 'rgba(200, 40, 40, 0.25)',
      fill: { target: 0 },
      tension: 0
    },
    {
      label: 'Building Load Line',
      data: result.loadLinePoints,
      borderColor: '#e07b17',
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 3,
      fill: false,
      tension: 0
    },
    {
      label: 'Unit Capacity Curve',
      data: result.capacityCurvePoints,
      borderColor: '#0b5fa5',
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 3,
      fill: false,
      tension: 0
    },
    {
      // Both "Intersection" points (see calc.js comments for what each
      // one means) are kept in a single dataset so they share one
      // legend entry.
      label: 'Intersection',
      data: result.intersectionPoints,
      borderColor: '#1a7a3c',
      backgroundColor: '#1a7a3c',
      pointRadius: 6,
      pointStyle: 'circle',
      showLine: false
    }
  ];

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          reverse: true, // negative temps plot to the right, matching the workbook's convention
          title: { display: true, text: 'Outdoor Temperature (°F)' }
        },
        y: {
          title: { display: true, text: 'BTU/h' },
          beginAtZero: true
        }
      },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${Math.round(item.parsed.y).toLocaleString()} BTU/h @ ${item.parsed.x.toFixed(1)}°F`
          }
        }
      }
    }
  });
}

/* ------------------------- 4. Results + competitor table ------------------------- */

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

  const note = document.getElementById('balancePointNote');
  const pts = result.intersectionPoints;
  if (pts.length === 2) {
    note.textContent = `Intersection points: ${pts[0].x.toFixed(1)}°F at ${Math.round(pts[0].y).toLocaleString()} BTU/h, and ${pts[1].x.toFixed(1)}°F at ${Math.round(pts[1].y).toLocaleString()} BTU/h.`;
  } else {
    note.textContent = `Intersection point: ${pts[0].x.toFixed(1)}°F at ${Math.round(pts[0].y).toLocaleString()} BTU/h.`;
  }
}

function renderComparisonTable(rows, unitCapacityDesign, unitCapacityWorst, worstCaseEnabled) {
  const tbody = document.getElementById('comparisonTableBody');
  tbody.innerHTML = '';

  const centrusRow = document.createElement('tr');
  centrusRow.classList.add('centrus-row');
  centrusRow.innerHTML = `
    <td>Centrus Unit</td>
    <td>—</td>
    <td>${fmtBTU(unitCapacityDesign)}</td>
    <td class="worstcase-col">${worstCaseEnabled ? fmtBTU(unitCapacityWorst) : '—'}</td>
  `;
  tbody.appendChild(centrusRow);

  const smallModels = Object.keys(CAPACITY.competitorsSmall);
  rows.forEach(r => {
    const cls = smallModels.includes(r.model) ? '3-3.5 Ton' : '5-5.5 Ton';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.model}</td>
      <td>${cls}</td>
      <td>${fmtBTU(r.capDesign)}</td>
      <td class="worstcase-col">${worstCaseEnabled ? fmtBTU(r.capWorst) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ------------------------- 5. Main calculate() ------------------------- */

function calculate() {
  const designTemp = parseFloat(document.getElementById('designTempOverride').value);
  const shutdownTemp = parseFloat(document.getElementById('shutdownTemp').value);
  const waterTemp = parseFloat(document.getElementById('deliveryWaterTemp').value);
  const designLoad = parseFloat(document.getElementById('btuLoad').value);
  const worstCaseEnabled = document.getElementById('worstCaseToggle').checked;
  const worstCaseTemp = parseFloat(document.getElementById('worstCaseTemp').value);

  const result = runSizingCalculation({
    designLoad, shutdownTemp, designTemp, waterTemp, worstCaseEnabled, worstCaseTemp
  });

  renderResults(result, worstCaseEnabled);
  renderChart(result);

  const compRows = buildCompetitorComparison(designTemp, worstCaseTemp, worstCaseEnabled);
  renderComparisonTable(compRows, result.capacityAtDesign, result.capacityAtWorstCase, worstCaseEnabled);
}

/* ------------------------- 6. Init ------------------------- */

async function init() {
  await loadData();
  populateStates();
  populateCounties();
  toggleWorstCaseRow();

  // Every input that affects the calculation triggers an automatic
  // recalculation — there's no "Calculate" button, so the chart and
  // results always reflect whatever is currently in the form.
  document.getElementById('stateSelect').addEventListener('change', () => { populateCounties(); calculate(); });
  document.getElementById('countySelect').addEventListener('change', () => { updateLookup(); calculate(); });
  document.getElementById('worstCaseToggle').addEventListener('change', () => { toggleWorstCaseRow(); calculate(); });

  ['deliveryWaterTemp', 'shutdownTemp', 'designTempOverride', 'btuLoad', 'worstCaseTemp']
    .forEach(id => document.getElementById(id).addEventListener('input', calculate));

  calculate(); // initial run with defaults
}

init();
