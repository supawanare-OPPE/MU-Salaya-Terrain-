import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { createBenchmarkLayer } from './benchmark-layer.js?v=20261026-bm-v1';
import { ROAD_DATUM, MIN_WATER_CM, MAX_WATER_CM, WATER_STEP_CM, surveyWaterLevel, relativeGroundLevel, waterDepth, hasFloodWater, scenarioFloodArea } from './flood-math.mjs?v=rainbomb-078-dry-zero-v1';

const $ = id => document.getElementById(id);
const host = $('canvas-host');
const format = (n, digits = 2) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (n, digits = 2) => `${n < -0.000001 ? '−' : '+'}${Math.abs(n).toFixed(digits)}`;
let renderer, scene, camera, controls, model, terrain, contours, qa, grid, marker, meta;
let terrainMeshes = [], selectedPoint = null, selectedBand = null, mode = '3d', exag = 1, frustum = 2600;
const MODEL_VERSION = '20261021-03-3f4b03e5';
let campus, basemap, buildingOutlines, waterEdges, needsRender = true;
let floodMesh, floodMaterial, floodTriangles, floodPlanArea = 0, floodEnabled = false, floodVisited = false;
let waterCm = MIN_WATER_CM, activePanel = 'explore';
let benchmarkLayer;
const floodAreaCache = new Map();
function invalidate() { needsRender = true; }
for (const event of ['click', 'input', 'change']) document.addEventListener(event, invalidate);
let pointerDown = null, dragDistance = 0, toastTimer, raf;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500);
}

function setPanel(name) {
  activePanel = name;
  $('sidebar').classList.toggle('flood-panel-active', name === 'flood');
  for (const key of ['explore', 'flood', 'benchmarks', 'colors']) {
    const active = key === name;
    $(`tab-${key}`).setAttribute('aria-selected', String(active));
    $(`tab-${key}`).tabIndex = active ? 0 : -1;
    $(`${key}-panel`).hidden = !active;
  }
  if (name === 'flood' && !floodVisited && floodMesh) {
    floodVisited = true; setFloodEnabled(true);
  }
}
const panelNames = ['explore', 'flood', 'benchmarks', 'colors'];
for (const name of panelNames) {
  $(`tab-${name}`).onclick = () => setPanel(name);
  $(`tab-${name}`).onkeydown = event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = panelNames.indexOf(name);
      const target = event.key === 'Home' ? panelNames[0] : event.key === 'End' ? panelNames.at(-1) : panelNames[(index + (event.key === 'ArrowRight' ? 1 : -1) + panelNames.length) % panelNames.length];
      setPanel(target); $(`tab-${target}`).focus();
    }
  };
}
for (const name of ['info', 'download']) {
  $(`${name}-btn`).onclick = () => $(`${name}-dialog`).showModal();
  $(`${name}-dialog`).querySelector('.dialog-close').onclick = () => $(`${name}-dialog`).close();
  $(`${name}-dialog`).addEventListener('click', event => {
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
    }
  });
}
$('retry-load').onclick = () => location.reload();
$('mobile-panel-toggle').onclick = () => {
  const open = $('sidebar').classList.toggle('mobile-open');
  $('mobile-panel-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('sidebar').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
};

function updateSize() {
  if (!renderer) return;
  const width = host.clientWidth, height = host.clientHeight, aspect = width / height;
  camera.left = -frustum * aspect / 2; camera.right = frustum * aspect / 2;
  camera.top = frustum / 2; camera.bottom = -frustum / 2;
  camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
}

function fitView() {
  if (!terrain) return;
  camera.updateMatrixWorld(); model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(terrain);
  const view = new THREE.Box3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    view.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
  }
  const size = view.getSize(new THREE.Vector3());
  const mobile = host.clientWidth < 550;
  frustum = Math.max(size.y * (mobile ? 1.5 : 1.37), size.x / (host.clientWidth / host.clientHeight) * (mobile ? 1.38 : 1.3));
  camera.zoom = 1; updateSize(); controls.update();
}

function setView(next) {
  if (!model) return;
  mode = next; controls.target.set(0, (1.5 + (meta?.terrainDisplayOffsetMetres || 0)) * exag, 0);
  camera.up.set(0, 1, 0);
  camera.position.copy(controls.target).add(next === 'top' ? new THREE.Vector3(0, 3200, 0.001) : new THREE.Vector3(1500, 1900, 2100));
  controls.enableRotate = next !== 'top'; controls.minPolarAngle = next === 'top' ? 0 : 0.04;
  controls.maxPolarAngle = next === 'top' ? 0.00001 : Math.PI / 2 - 0.06;
  controls.mouseButtons.LEFT = next === 'top' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  controls.touches.ONE = next === 'top' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  controls.update(); camera.lookAt(controls.target); fitView();
  $('view-3d').classList.toggle('active', next === '3d'); $('view-top').classList.toggle('active', next === 'top');
  $('view-3d').setAttribute('aria-pressed', String(next === '3d')); $('view-top').setAttribute('aria-pressed', String(next === 'top'));
  $('interaction-text').textContent = next === 'top' ? 'ลากเพื่อเลื่อน · เลื่อนเพื่อซูม · คลิกเพื่ออ่านระดับ' : 'ลากเพื่อหมุน · เลื่อนเพื่อซูม · คลิกเพื่ออ่านระดับ';
  host.setAttribute('aria-label', `โมเดล${next === 'top' ? 'มุมบน ลากเพื่อเลื่อน' : ' 3 มิติ ลากเพื่อหมุน'} เลื่อนเพื่อซูม คลิกพื้นที่เพื่ออ่านระดับ`);
  updateScaleNote();
}
function updateScaleNote() {
  $('exag-value').textContent = `×${exag}`;
  $('scale-note').textContent = mode === 'top' ? 'มุมบน · สีตามระดับเดิม' : exag === 1 ? 'ความสูงตามระดับจริง ×1' : `ความสูงแสดงผล ×${exag}`;
}
function setExaggeration(value) {
  if (!model) return;
  exag = value; model.scale.y = value; model.updateMatrixWorld(true);
  grid.position.y = -4 * exag - 12;
  $('exaggeration').value = value; updateScaleNote(); updatePin();
}
$('view-3d').onclick = () => setView('3d'); $('view-top').onclick = () => setView('top');
$('reset-view').onclick = () => setView(mode);
$('exaggeration').oninput = event => setExaggeration(Number(event.target.value));
$('true-scale').onclick = () => setExaggeration(1);
function zoom(factor) { if (camera) { camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 0.4, 35); camera.updateProjectionMatrix(); } }
$('zoom-in').onclick = () => zoom(1.3); $('zoom-out').onclick = () => zoom(1 / 1.3);

function setBand(index) {
  selectedBand = selectedBand === index ? null : index;
  for (const mesh of terrainMeshes) {
    mesh.material.color.copy(mesh.userData.originalColor);
    if (selectedBand !== null && selectedBand !== mesh.userData.band) mesh.material.color.lerp(new THREE.Color('#e6ebe0'), 0.87);
  }
  document.querySelectorAll('.legend-row').forEach(button => {
    const active = Number(button.dataset.band) === selectedBand;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
}
$('clear-band').onclick = () => { selectedBand = null; setBand(null); };
function buildLegend() {
  const maximum = Math.max(...meta.palette.map(p => p.planAreaM2));
  for (let i = meta.palette.length - 1; i >= 0; i--) {
    const item = meta.palette[i]; const percent = item.planAreaM2 / meta.planAreaM2 * 100;
    const button = document.createElement('button');
    button.className = 'legend-row'; button.dataset.band = i; button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `เน้นระดับ ${item.lower.toFixed(2)} ถึง ${item.upper.toFixed(2)} เมตร พื้นที่ ${percent.toFixed(2)} เปอร์เซ็นต์`);
    button.innerHTML = `<i class="swatch" style="background:${item.hex}"></i><span>${signed(item.lower, 1)} ถึง ${signed(item.upper, 1)}</span><span class="area-bar"><i style="background:${item.hex};width:${item.planAreaM2 / maximum * 100}%"></i></span><span class="area-pct">${percent < 0.1 ? '<0.1' : percent.toFixed(1)}%</span>`;
    button.onclick = () => setBand(i); $('legend-list').appendChild(button);
  }
}

function clearPoint() {
  selectedPoint = null; if (marker) marker.visible = false;
  $('pin-label').hidden = true; $('point-values').hidden = true; $('point-empty').hidden = false; $('clear-point').hidden = true;
  updateFloodPoint();
}
$('clear-point').onclick = clearPoint;
function updatePin() {
  if (!selectedPoint || !terrain.visible) { if (marker) marker.visible = false; $('pin-label').hidden = true; return; }
  const world = model.localToWorld(selectedPoint.local.clone()); marker.position.copy(world); marker.visible = true;
  const projected = world.clone().project(camera);
  const inFrame = Math.abs(projected.x) < 0.95 && Math.abs(projected.y) < 0.92 && projected.z > -1 && projected.z < 1;
  $('pin-label').hidden = !inFrame;
  if (inFrame) { $('pin-label').style.left = `${(projected.x * 0.5 + 0.5) * host.clientWidth}px`; $('pin-label').style.top = `${(-projected.y * 0.5 + 0.5) * host.clientHeight}px`; }
  marker.quaternion.copy(camera.quaternion);
  const scale = frustum / host.clientHeight / camera.zoom * 5;
  marker.scale.setScalar(scale);
}
function pickPoint(event) {
  if (!terrain?.visible) return;
  const rect = host.getBoundingClientRect();
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  model.updateMatrixWorld(true); raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(terrainMeshes, false)[0];
  if (!hit) { toast('จุดนี้อยู่นอกผิวภูมิประเทศ หรือเป็นบริเวณที่เว้นไว้ตรวจสอบ'); return; }
  const local = model.worldToLocal(hit.point.clone()); const band = meta.palette[hit.object.userData.band];
  const easting = local.x + meta.webCenterLocalMetres[0] + meta.utmOffset[0];
  const northing = -local.z + meta.webCenterLocalMetres[1] + meta.utmOffset[1];
  const elevation = local.y - (meta.terrainDisplayOffsetMetres || 0);
  selectedPoint = { local, elevation, easting, northing, band: hit.object.userData.band };
  $('point-empty').hidden = true; $('point-values').hidden = false; $('clear-point').hidden = false;
  $('selected-height').innerHTML = `${signed(elevation)}<small>ม.</small>`;
  $('pin-height').textContent = `${signed(elevation)} ม.`;
  $('point-band-text').textContent = `${signed(band.lower)} ถึง ${signed(band.upper)} ม.`;
  $('point-swatch').style.background = band.hex;
  $('point-e').textContent = format(easting); $('point-n').textContent = format(northing);
  if (activePanel !== 'flood') setPanel('explore');
  updateFloodPoint(); updatePin();
}
function buildFloodLayer() {
  model.updateMatrixWorld(true);
  const inverse = model.matrixWorld.clone().invert();
  const chunks = [], parts = [], shared = new Map();
  let vertexCount = 0, indexCount = 0;
  for (const mesh of terrainMeshes) {
    const attribute = mesh.geometry.attributes.position;
    const transform = inverse.clone().multiply(mesh.matrixWorld);
    const key = transform.elements.join(',');
    if (!shared.has(attribute.array)) shared.set(attribute.array, new Map());
    const variants = shared.get(attribute.array);
    let chunk = variants.get(key);
    if (!chunk) {
      chunk = { attribute, transform, offset: vertexCount };
      variants.set(key, chunk); chunks.push(chunk); vertexCount += attribute.count;
    }
    parts.push({ mesh, chunk }); indexCount += mesh.geometry.index.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const heights = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);
  const point = new THREE.Vector3();
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.attribute.count; i++) {
      point.fromBufferAttribute(chunk.attribute, i).applyMatrix4(chunk.transform);
      const n = chunk.offset + i;
      positions.set([point.x, point.y, point.z], n * 3);
      // Remove source placement; round only sub-micrometre cancellation noise.
      heights[n] = Math.round((point.y - (meta.terrainDisplayOffsetMetres || 0)) * 1e6) / 1e6;
    }
  }
  let cursor = 0;
  for (const { mesh, chunk } of parts) {
    for (const index of mesh.geometry.index.array) indices[cursor++] = index + chunk.offset;
  }
  floodTriangles = new Float64Array(indexCount / 3 * 4);
  for (let i = 0, j = 0; i < indices.length; i += 3, j += 4) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const area = Math.abs((positions[b * 3] - positions[a * 3]) * (positions[c * 3 + 2] - positions[a * 3 + 2]) - (positions[c * 3] - positions[a * 3]) * (positions[b * 3 + 2] - positions[a * 3 + 2])) / 2;
    const sorted = [heights[a], heights[b], heights[c]].sort((x, y) => x - y);
    floodTriangles.set([...sorted, area], j); floodPlanArea += area;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('surveyHeight', new THREE.BufferAttribute(heights, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  floodMaterial = new THREE.ShaderMaterial({
    uniforms: {
      surveyWater: { value: surveyWaterLevel(waterCm) },
      displayWater: { value: surveyWaterLevel(waterCm) + (meta.terrainDisplayOffsetMetres || 0) },
      waterColour: { value: new THREE.Color('#8ddaf2') }
    },
    vertexShader: `
      attribute float surveyHeight;
      varying float groundHeight;
      uniform float displayWater;
      void main() {
        groundHeight = surveyHeight;
        vec3 waterPosition = vec3(position.x, displayWater, position.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(waterPosition, 1.0);
      }`,
    fragmentShader: `
      varying float groundHeight;
      uniform float surveyWater;
      uniform vec3 waterColour;
      void main() {
        if (surveyWater - groundHeight <= 0.00001) discard;
        gl_FragColor = vec4(waterColour, 0.48);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide
  });
  floodMesh = new THREE.Mesh(geometry, floodMaterial);
  floodMesh.name = 'rain_bomb_water'; floodMesh.visible = false; model.add(floodMesh);
  $('flood-controls').disabled = false;
  $('flood-datum').textContent = `${signed(ROAD_DATUM)} ม. เดิม = 0.00 ม. ในสถานการณ์`;
  updateFlood();
  if (activePanel === 'flood') { floodVisited = true; setFloodEnabled(true); }
}

function setFloodEnabled(enabled) {
  floodEnabled = enabled && Boolean(floodMesh);
  $('flood-toggle').checked = floodEnabled;
  $('flood-map-status').hidden = !floodEnabled;
  $('flood-off-note').hidden = floodEnabled;
  $('flood-panel').dataset.enabled = String(floodEnabled);
  updateFlood();
}

function setWaterLevel(value) {
  waterCm = Math.max(MIN_WATER_CM, Math.min(MAX_WATER_CM, Math.round(value / WATER_STEP_CM) * WATER_STEP_CM));
  if (floodMesh) setFloodEnabled(true);
  else updateFlood();
}

function updateFlood() {
  const level = surveyWaterLevel(waterCm);
  const hasWater = hasFloodWater(waterCm);
  $('flood-level').value = waterCm;
  $('flood-level').setAttribute('aria-valuetext', `${waterCm} เซนติเมตรเหนือระดับอ้างอิงถนนเทิดจักรี`);
  $('flood-level-value').textContent = `${waterCm} ซม.`;
  $('flood-survey-level').textContent = hasWater ? `${signed(level)} ม.` : '— ยังไม่เพิ่มน้ำ';
  $('flood-map-level').textContent = hasWater ? `Rain Bomb · น้ำ +${waterCm} ซม.` : 'Rain Bomb · 0 ซม. ยังไม่ท่วม';
  $('flood-minus').disabled = waterCm <= MIN_WATER_CM;
  $('flood-plus').disabled = waterCm >= MAX_WATER_CM;
  document.querySelectorAll('[data-water-cm]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.waterCm) === waterCm)));
  if (!floodMesh) return;
  floodMesh.visible = floodEnabled && hasWater;
  floodMaterial.uniforms.surveyWater.value = level;
  floodMaterial.uniforms.displayWater.value = level + (meta.terrainDisplayOffsetMetres || 0);
  if (!floodAreaCache.has(waterCm)) floodAreaCache.set(waterCm, scenarioFloodArea(floodTriangles, waterCm));
  const area = floodAreaCache.get(waterCm);
  $('flood-area').textContent = format(area / 1600, 1);
  $('flood-percent').textContent = `${format(area / floodPlanArea * 100, 1)}% ของผิวโมเดลที่มีข้อมูล`;
  $('flood-area').dataset.squareMetres = area.toFixed(3);
  $('flood-panel').dataset.surveyWater = hasWater ? level.toFixed(2) : '';
  $('flood-panel').dataset.waterVisible = String(floodMesh.visible);
  updateFloodPoint(); invalidate();
}

function updateFloodPoint() {
  $('flood-point-empty').hidden = Boolean(selectedPoint);
  $('flood-point-values').hidden = !selectedPoint;
  $('flood-clear-point').hidden = !selectedPoint;
  $('pin-flood-depth').hidden = !floodEnabled || !selectedPoint;
  if (!selectedPoint) return;
  const depth = waterDepth(selectedPoint.elevation, waterCm);
  $('flood-point-ground').textContent = `${signed(relativeGroundLevel(selectedPoint.elevation))} ม.`;
  $('flood-point-survey').textContent = `ระดับเดิม ${signed(selectedPoint.elevation)} ม.`;
  $('flood-point-depth').textContent = `${format(depth * 100, 1)} ซม.`;
  $('flood-point-state').textContent = !hasFloodWater(waterCm) ? 'สถานะเริ่มต้น · ไม่มีน้ำท่วมขังจำลอง' : depth > 0.00001 ? 'พื้นดินต่ำกว่าผิวน้ำที่เลือก' : 'พื้นดินเท่ากับหรือสูงกว่าผิวน้ำที่เลือก';
  $('pin-title').textContent = floodEnabled ? 'พื้นดินเทียบถนนเทิดจักรี' : 'ระดับสำรวจบนผิวภูมิประเทศ';
  $('pin-height').textContent = `${signed(floodEnabled ? relativeGroundLevel(selectedPoint.elevation) : selectedPoint.elevation)} ม.`;
  $('pin-flood-depth').textContent = `ความลึกน้ำ ${format(depth * 100, 1)} ซม.`;
}

$('flood-toggle').onchange = event => setFloodEnabled(event.target.checked);
$('flood-level').oninput = event => setWaterLevel(Number(event.target.value));
$('flood-minus').onclick = () => setWaterLevel(waterCm - WATER_STEP_CM);
$('flood-plus').onclick = () => setWaterLevel(waterCm + WATER_STEP_CM);
$('flood-clear-point').onclick = clearPoint;
for (const button of document.querySelectorAll('[data-water-cm]')) button.onclick = () => setWaterLevel(Number(button.dataset.waterCm));

for (const [id, getLayer] of [['campus-toggle', () => campus], ['basemap-toggle', () => basemap], ['buildings-toggle', () => buildingOutlines], ['water-toggle', () => waterEdges]]) {
  $(id).onchange = event => { const layer = getLayer(); if (layer) layer.visible = event.target.checked; };
}
$('terrain-toggle').onchange = event => { if (terrain) { terrain.visible = event.target.checked; updatePin(); } };
$('contour-toggle').onchange = event => { if (contours) contours.visible = event.target.checked; };
$('qa-toggle').onchange = event => { if (qa) qa.visible = event.target.checked; $('qa-note').hidden = !event.target.checked; };

async function snapshot() {
  if (!renderer || !meta) return;
  try {
    renderer.render(scene, camera);
    const source = renderer.domElement; const output = document.createElement('canvas');
    output.width = source.width; output.height = source.height + 145;
    const ctx = output.getContext('2d'); ctx.fillStyle = '#fafbf6'; ctx.fillRect(0, 0, output.width, output.height); ctx.drawImage(source, 0, 0);
    benchmarkLayer?.draw(ctx, source.width / host.clientWidth);
    ctx.fillStyle = '#183e34'; ctx.font = '19px Arial'; ctx.fillText(`MAHIDOL SALAYA · TERRAIN EXPLORER | ${mode === 'top' ? 'Top view' : '3D view'} | Vertical display x${exag}`, 24, source.height + 31);
    ctx.font = '12px Arial'; ctx.fillStyle = '#6a7e5b';
    const width = output.width - 48;
    if (floodEnabled) {
      ctx.fillText(`RAIN BOMB | Water +${waterCm} cm above road datum | New 0.00 m = survey ${signed(ROAD_DATUM)} m`, 24, source.height + 56);
      ctx.fillStyle = '#8ddaf2'; ctx.fillRect(24, source.height + 73, 20, 17);
      ctx.fillStyle = '#326875'; ctx.font = '11px Arial';
      ctx.fillText(hasFloodWater(waterCm) ? `Area below water: ${format(floodAreaCache.get(waterCm) / 1600, 1)} rai | Water survey elevation ${signed(surveyWaterLevel(waterCm))} m` : 'Starting state: no simulated floodwater | Flooded area 0 rai | Depth 0 cm', 54, source.height + 86);
      ctx.fillText('Static water-level comparison. Includes existing low ponds/canals; data gaps excluded.', 24, source.height + 108);
      ctx.font = '10px Arial'; ctx.fillText(`Source: ${meta.source} | No rainfall, drainage or flow modelling.`, 24, source.height + 131);
    } else {
      ctx.fillText(`Original elevations (m) · Source: ${meta.source} · Gaps = data review areas`, 24, source.height + 56);
      meta.palette.forEach((item, i) => { ctx.fillStyle = item.hex; ctx.fillRect(24 + i * width / 22, source.height + 73, width / 22 + 1, 17); });
      ctx.fillStyle = '#536b45'; ctx.font = '11px Arial';
      for (const value of [-4, -2, 0, 2, 4, 7]) { const x = 24 + (value + 4) / 11 * width; ctx.textAlign = value === -4 ? 'left' : value === 7 ? 'right' : 'center'; ctx.fillText(`${signed(value, 1)} m`, x, source.height + 108); }
      ctx.textAlign = 'left'; ctx.font = '10px Arial'; ctx.fillText('Colour interval: 0.50 m. Web display preserves the original SKP surface and material colours.', 24, source.height + 131);
    }
    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG export failed');
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Mahidol_Salaya_${floodEnabled ? `RainBomb_${waterCm}cm_` : ''}${mode}_Zx${exag}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 20000);
    toast('บันทึกภาพมุมมองพร้อมแถบสีแล้ว');
  } catch { toast('บันทึกภาพไม่สำเร็จ กรุณาลองอีกครั้ง'); }
}
$('snapshot').onclick = snapshot;

async function initialize() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor('#e8ede4'); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-label', 'โมเดลภูมิประเทศศาลายา'); host.appendChild(renderer.domElement);
    scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-1500, 1500, 1500, -1500, 1, 20000);
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
    controls.minZoom = 0.4; controls.maxZoom = 35; controls.zoomSpeed = 0.85; controls.rotateSpeed = 0.55; controls.screenSpacePanning = true;
    controls.listenToKeyEvents(host); controls.addEventListener('change', invalidate);
    const metadata = fetch(`./model.json?v=${MODEL_VERSION}`).then(r => { if (!r.ok) throw new Error('Model metadata unavailable'); return r.json(); });
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(`./salaya-terrain.glb?v=${MODEL_VERSION}`, progress => {
      const percent = progress.total ? Math.min(95, progress.loaded / progress.total * 95) : 35;
      $('progress-fill').style.width = `${percent}%`;
      if (progress.total) $('loading-text').textContent = `โหลดโมเดล ${Math.round(percent)}% · ${format(progress.total / 1e6, 1)} MB`;
    });
    meta = await metadata; model = gltf.scene; terrain = model.getObjectByName('terrain'); contours = model.getObjectByName('contours'); qa = model.getObjectByName('qa');
    if (!terrain || !contours || !qa) throw new Error('Incomplete model layers');
    terrain.traverse(object => {
      if (!object.isMesh) return;
      const band = meta.palette.findIndex(item => item.name === object.material.name);
      if (band < 0) throw new Error('Unknown elevation colour');
      object.userData.band = band; object.userData.originalColor = object.material.color.clone();
      object.material.polygonOffset = true; object.material.polygonOffsetFactor = 1; object.material.polygonOffsetUnits = 1;
      object.geometry.computeBoundingSphere(); terrainMeshes.push(object);
    });
    const faceCount = terrainMeshes.reduce((sum, object) => sum + object.geometry.index.count / 3, 0);
    if (faceCount !== meta.faces) throw new Error('Model face count differs from source');
    buildingOutlines = model.getObjectByName('building_outlines'); waterEdges = model.getObjectByName('water_edges');
    if (buildingOutlines) buildingOutlines.visible = false; if (waterEdges) waterEdges.visible = false;
    campus = new THREE.Group(); campus.name = 'campus'; basemap = new THREE.Group(); basemap.name = 'basemap'; model.add(campus, basemap);
    scene.add(model); contours.visible = false; contours.position.y = 0.025; qa.visible = false;
    contours.material.transparent = true; contours.material.opacity = 0.58;
    qa.material.depthTest = false; qa.renderOrder = 10;
    grid = new THREE.GridHelper(3000, 30, '#c7d0bf', '#c7d0bf'); grid.material.transparent = true; grid.material.opacity = 0.3; scene.add(grid);
    marker = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.1, 24), new THREE.MeshBasicMaterial({ color: '#183e34', side: THREE.DoubleSide, depthTest: false }));
    marker.renderOrder = 20; marker.visible = false; scene.add(marker);
    buildFloodLayer(); setExaggeration(exag); buildLegend(); setView('3d');
    benchmarkLayer = createBenchmarkLayer({ THREE, model, camera, controls, host, metadata: meta, roadDatum: ROAD_DATUM, invalidate, onSelect: () => {
      setPanel('benchmarks'); $('sidebar').scrollTop = 0;
      if (matchMedia('(max-width: 760px)').matches) {
        $('sidebar').classList.add('mobile-open'); $('mobile-panel-toggle').setAttribute('aria-expanded', 'true');
        $('benchmark-detail').scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    } });
    $('loading').hidden = true; $('progress-fill').style.width = '100%';
    $('glb-size').textContent = `ผิวภูมิประเทศ เส้นอ้างอิง และบริเวณตรวจสอบ · ${format(meta.terrainGlbBytes / 1e6, 1)} MB`;
    $('context-status').textContent = 'กำลังโหลดอาคารและภาพแผนที่…';
    host.dataset.ready = 'true'; host.dataset.faceCount = String(faceCount);
    new ResizeObserver(() => { updateSize(); fitView(); invalidate(); }).observe(host);
    renderer.domElement.addEventListener('pointerdown', event => { pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId, button: event.button }; dragDistance = 0; });
    renderer.domElement.addEventListener('pointermove', event => { if (pointerDown) dragDistance = Math.max(dragDistance, Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)); });
    renderer.domElement.addEventListener('pointerup', event => {
      if (pointerDown?.id === event.pointerId && pointerDown.button === 0 && dragDistance < 5) pickPoint(event);
      pointerDown = null;
    });
    renderer.domElement.addEventListener('pointercancel', () => { pointerDown = null; });
    renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); toast('การแสดงผล 3 มิติหยุดชั่วคราว กำลังรอการเชื่อมต่อภาพกลับมา'); });
    renderer.domElement.addEventListener('webglcontextrestored', () => toast('การแสดงผล 3 มิติกลับมาพร้อมใช้งานแล้ว'));
    function animate() {
      raf = requestAnimationFrame(animate); controls.update();
      if (!needsRender) return;
      needsRender = false; updatePin(); benchmarkLayer?.update();
      const north = controls.target.clone().add(new THREE.Vector3(0, 0, -200)).project(camera);
      const origin = controls.target.clone().project(camera);
      const angle = Math.atan2((north.x - origin.x) * host.clientWidth, (north.y - origin.y) * host.clientHeight) * 180 / Math.PI;
      $('north-arrow').style.transform = `rotate(${angle}deg)`;
      renderer.render(scene, camera);
    }
    animate();
    loadContext(loader);
    // Read-only QA hook: coordinates and original model data, no user content or state mutation.
    window.terrainInspection = () => ({ faces: faceCount, bands: terrainMeshes.length, exag, view: mode, selectedBand, selectedPoint: selectedPoint ? { elevation: selectedPoint.elevation, easting: selectedPoint.easting, northing: selectedPoint.northing, band: selectedPoint.band } : null, layers: { terrain: terrain.visible, contours: contours.visible, qa: qa.visible, campus: campus.visible, basemap: basemap.visible }, sourceSha256: meta.sourceSha256, contextReady: host.dataset.contextReady, contextFiles: meta.contextFiles?.length, displayOffset: meta.terrainDisplayOffsetMetres, renderer: renderer.info.render });
  } catch (error) {
    console.error('Terrain viewer:', error); if (raf) cancelAnimationFrame(raf);
    $('loading').hidden = true; $('load-error').hidden = false;
    $('error-message').textContent = `เปิดโมเดลไม่สำเร็จ: ${error.message || 'โปรดตรวจการเชื่อมต่อและลองอีกครั้ง'}`;
    host.dataset.ready = 'error';
  }
}
async function loadContext(loader) {
  host.dataset.contextReady = 'loading';
  let complete = 0;
  try {
    for (const file of meta.contextFiles || []) {
      $('context-status').textContent = `กำลังโหลดอาคารและภาพแผนที่ ${complete}/${meta.contextFiles.length}`;
      const part = await loader.loadAsync(`./${file.url}?v=${MODEL_VERSION}`);
      part.scene.traverse(object => {
        if (object.isMesh) {
          object.material.polygonOffset = true;
          object.material.polygonOffsetFactor = 1;
          object.material.polygonOffsetUnits = 1;
        }
      });
      (file.role === 'basemap' ? basemap : campus).add(part.scene);
      complete++; invalidate();
    }
    host.dataset.contextReady = 'true';
    $('context-status').textContent = 'อาคารและภาพแผนที่พร้อมแล้ว';
  } catch (error) {
    console.error('Campus layers:', error);
    host.dataset.contextReady = 'error';
    $('context-status').textContent = 'โหลดอาคารหรือภาพแผนที่ไม่ครบ กรุณาโหลดหน้าใหม่';
  }
}
initialize();
