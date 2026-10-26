import { BENCHMARKS, BENCHMARK_SOURCE, benchmarkLocalPosition, layoutBenchmarkLabels, MARKER_WIDTH, MARKER_HEIGHT } from './benchmarks.mjs?v=20261026-bm-v2';

const symbol = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M12 7v14M5 17l7-10 7 10"/></svg>';
const signed = value => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(3)}`;
const number = value => value.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const svgNS = 'http://www.w3.org/2000/svg';

export function createBenchmarkLayer({ THREE, model, camera, controls, host, metadata, roadDatum, invalidate, onSelect }) {
  const $ = id => document.getElementById(id);
  const overlay = $('benchmark-overlay');
  const leaders = document.createElementNS(svgNS, 'svg');
  leaders.classList.add('bm-leaders'); leaders.setAttribute('aria-hidden', 'true'); overlay.append(leaders);
  let enabled = true, selected = null, placements = [];
  const entries = BENCHMARKS.map(point => {
    const local = benchmarkLocalPosition(point, metadata);
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'bm-marker'; button.dataset.bmId = point.id;
    button.dataset.easting = point.easting; button.dataset.northing = point.northing; button.dataset.elevation = point.elevation;
    button.setAttribute('aria-label', `${point.id} ${point.name}`); button.setAttribute('aria-pressed', 'false');
    button.title = `${point.id} · ${point.name}\nระดับหมุด ${signed(point.elevation)} ม. รทก.`;
    button.innerHTML = `${symbol}<span>${point.id}</span>`; button.hidden = true; overlay.append(button);
    const line = document.createElementNS(svgNS, 'line');
    const dot = document.createElementNS(svgNS, 'circle'); dot.setAttribute('r', '3.5');
    const group = document.createElementNS(svgNS, 'g'); group.append(line, dot); leaders.append(group);
    const row = document.createElement('button');
    row.type = 'button'; row.className = 'bm-list-item'; row.dataset.bmId = point.id;
    row.setAttribute('aria-label', `ดู ${point.id} ${point.name}`); row.setAttribute('aria-pressed', 'false');
    row.innerHTML = `<span class="bm-list-code">${symbol}<b>${point.id}</b></span><span class="bm-list-place">${point.name}<small>${signed(point.elevation)} ม. รทก.</small></span>`;
    $('benchmark-list').append(row);
    button.onclick = row.onclick = () => select(point.id);
    return { point, local: new THREE.Vector3(local.x, local.y, local.z), button, row, line, dot, group };
  });

  function select(id) {
    selected = entries.find(entry => entry.point.id === id);
    if (!selected) return;
    setEnabled(true);
    const point = selected.point;
    for (const entry of entries) {
      const active = entry === selected;
      entry.button.setAttribute('aria-pressed', String(active)); entry.row.setAttribute('aria-pressed', String(active));
      entry.group.classList.toggle('selected', active);
    }
    $('benchmark-empty').hidden = true; $('benchmark-detail').hidden = false;
    $('benchmark-code').textContent = point.id; $('benchmark-name').textContent = point.name;
    $('benchmark-elevation').textContent = `${signed(point.elevation)} ม. รทก.`;
    $('benchmark-relative').textContent = `${signed(point.elevation - roadDatum)} ม.`;
    $('benchmark-easting').textContent = number(point.easting); $('benchmark-northing').textContent = number(point.northing);
    $('benchmark-detail').dataset.selected = point.id;
    onSelect(); invalidate();
  }
  function setEnabled(value) {
    enabled = value; overlay.hidden = !enabled; $('benchmark-toggle').checked = enabled;
    overlay.dataset.enabled = String(enabled); invalidate();
  }
  $('benchmark-toggle').onchange = event => setEnabled(event.target.checked);
  $('benchmark-focus').onclick = () => {
    if (!selected) return;
    const target = model.localToWorld(selected.local.clone());
    const delta = target.clone().sub(controls.target);
    camera.position.add(delta); controls.target.copy(target); controls.update(); invalidate();
    if (matchMedia('(max-width: 760px)').matches) host.scrollIntoView({ behavior: 'instant', block: 'start' });
  };
  $('benchmark-source').textContent = `${BENCHMARK_SOURCE.drawing} · ตาราง BM1–BM10`;
  $('benchmark-symbol-source').href = BENCHMARK_SOURCE.symbolReference;
  $('benchmark-base').textContent = `ฐานจำลอง 0.00 ใหม่ = ${signed(roadDatum)} ม. รทก.`;
  overlay.dataset.count = String(entries.length); overlay.dataset.ready = 'true'; setEnabled(true);

  function update() {
    if (!enabled) { placements = []; return; }
    model.updateMatrixWorld(true); camera.updateMatrixWorld();
    const width = host.clientWidth, height = host.clientHeight;
    const hostRect = host.getBoundingClientRect();
    leaders.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const obstacles = [...document.querySelectorAll('.map-heading,.view-switch,.compass,.map-tools,.map-bottom,#flood-map-status,#pin-label')]
      .filter(element => !element.hidden)
      .map(element => { const r = element.getBoundingClientRect(); return { x: r.left - hostRect.left, y: r.top - hostRect.top, width: r.width, height: r.height }; });
    const visible = [];
    for (const entry of entries) {
      const projected = model.localToWorld(entry.local.clone()).project(camera);
      const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
      const inFrame = x >= 5 && x <= width - 5 && y >= 5 && y <= height - 5 && projected.z > -1 && projected.z < 1;
      entry.button.hidden = !inFrame; entry.group.style.display = inFrame ? '' : 'none';
      if (inFrame) visible.push({ id: entry.point.id, x, y, entry });
    }
    placements = layoutBenchmarkLabels(visible, width, height, obstacles);
    for (const placement of placements) {
      const { x, y, box, entry } = placement;
      entry.button.style.left = `${box.x}px`; entry.button.style.top = `${box.y}px`;
      entry.button.dataset.anchorX = x.toFixed(3); entry.button.dataset.anchorY = y.toFixed(3);
      const endX = Math.max(box.x, Math.min(box.x + box.width, x));
      const endY = Math.max(box.y, Math.min(box.y + box.height, y));
      entry.line.setAttribute('x1', x); entry.line.setAttribute('y1', y);
      entry.line.setAttribute('x2', endX); entry.line.setAttribute('y2', endY);
      entry.dot.setAttribute('cx', x); entry.dot.setAttribute('cy', y);
    }
    overlay.dataset.visibleCount = String(placements.length);
  }

  function draw(ctx, scale) {
    update(); if (!enabled) return;
    ctx.save(); ctx.scale(scale, scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const { x, y, box, entry } of placements) {
      const active = entry === selected, ink = active ? '#713e08' : '#153f64';
      ctx.strokeStyle = ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(box.x + box.width / 2, box.y + box.height / 2); ctx.stroke();
      ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    for (const { box, entry } of placements) {
      const active = entry === selected, ink = active ? '#713e08' : '#153f64';
      ctx.fillStyle = active ? '#ffe5a6' : '#fffefa'; ctx.strokeStyle = ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(box.x, box.y, MARKER_WIDTH, MARKER_HEIGHT, 8); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(box.x + 7, box.y + 8); ctx.strokeStyle = ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(4, 5); ctx.lineTo(20, 5); ctx.moveTo(12, 7); ctx.lineTo(12, 21); ctx.moveTo(5, 17); ctx.lineTo(12, 7); ctx.lineTo(19, 17); ctx.stroke(); ctx.restore();
      ctx.fillStyle = ink; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'left'; ctx.fillText(entry.point.id, box.x + 35, box.y + 24);
    }
    ctx.restore();
  }
  return { update, draw };
}
