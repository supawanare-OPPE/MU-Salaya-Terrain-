import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

const $ = id => document.getElementById(id);
const host = $('canvas-host');
const format = (n, digits = 2) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (n, digits = 2) => `${n < -0.000001 ? '−' : '+'}${Math.abs(n).toFixed(digits)}`;
let renderer, scene, camera, controls, model, terrain, contours, qa, grid, marker, meta;
let terrainMeshes = [], selectedPoint = null, selectedBand = null, mode = '3d', exag = 20, frustum = 2600;
let pointerDown = null, dragDistance = 0, toastTimer, raf;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500);
}

function setPanel(name) {
  for (const key of ['explore', 'colors']) {
    const active = key === name;
    $(`tab-${key}`).setAttribute('aria-selected', String(active));
    $(`tab-${key}`).tabIndex = active ? 0 : -1;
    $(`${key}-panel`).hidden = !active;
  }
}
for (const name of ['explore', 'colors']) {
  $(`tab-${name}`).onclick = () => setPanel(name);
  $(`tab-${name}`).onkeydown = event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const target = name === 'explore' ? 'colors' : 'explore';
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
  mode = next; controls.target.set(0, 1.5 * exag, 0);
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
  if (!hit) { toast('จุดนี้อยู่นอกผิวโมเดล หรือเป็นบริเวณที่เว้นไว้ตรวจสอบ'); return; }
  const local = model.worldToLocal(hit.point.clone()); const band = meta.palette[hit.object.userData.band];
  const easting = local.x + meta.webCenterLocalMetres[0] + meta.utmOffset[0];
  const northing = -local.z + meta.webCenterLocalMetres[1] + meta.utmOffset[1];
  selectedPoint = { local, elevation: local.y, easting, northing, band: hit.object.userData.band };
  $('point-empty').hidden = true; $('point-values').hidden = false; $('clear-point').hidden = false;
  $('selected-height').innerHTML = `${signed(local.y)}<small>ม.</small>`;
  $('pin-height').textContent = `${signed(local.y)} ม.`;
  $('point-band-text').textContent = `${signed(band.lower)} ถึง ${signed(band.upper)} ม.`;
  $('point-swatch').style.background = band.hex;
  $('point-e').textContent = format(easting); $('point-n').textContent = format(northing);
  setPanel('explore'); updatePin();
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
    ctx.fillStyle = '#183e34'; ctx.font = '19px Arial'; ctx.fillText(`MAHIDOL SALAYA · TERRAIN EXPLORER | ${mode === 'top' ? 'Top view' : '3D view'} | Vertical display x${exag}`, 24, source.height + 31);
    ctx.font = '12px Arial'; ctx.fillStyle = '#6a7e5b'; ctx.fillText('Original elevations (m) · Source: Salaya_Elevation_Terrain.skp · Gaps = data review areas', 24, source.height + 56);
    const width = output.width - 48;
    meta.palette.forEach((item, i) => { ctx.fillStyle = item.hex; ctx.fillRect(24 + i * width / 22, source.height + 73, width / 22 + 1, 17); });
    ctx.fillStyle = '#536b45'; ctx.font = '11px Arial';
    for (const value of [-4, -2, 0, 2, 4, 7]) { const x = 24 + (value + 4) / 11 * width; ctx.textAlign = value === -4 ? 'left' : value === 7 ? 'right' : 'center'; ctx.fillText(`${signed(value, 1)} m`, x, source.height + 108); }
    ctx.textAlign = 'left'; ctx.font = '10px Arial'; ctx.fillText('Colour interval: 0.50 m. Web display preserves the original SKP surface and material colours.', 24, source.height + 131);
    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG export failed');
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Mahidol_Salaya_${mode}_Zx${exag}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 20000);
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
    controls.listenToKeyEvents(host);
    const metadata = fetch('./assets/model.json').then(r => { if (!r.ok) throw new Error('Model metadata unavailable'); return r.json(); });
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('./assets/salaya-terrain.glb', progress => {
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
    scene.add(model); contours.visible = false; contours.position.y = 0.025; qa.visible = false;
    contours.material.transparent = true; contours.material.opacity = 0.58;
    qa.material.depthTest = false; qa.renderOrder = 10;
    grid = new THREE.GridHelper(3000, 30, '#c7d0bf', '#c7d0bf'); grid.material.transparent = true; grid.material.opacity = 0.3; scene.add(grid);
    marker = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.1, 24), new THREE.MeshBasicMaterial({ color: '#183e34', side: THREE.DoubleSide, depthTest: false }));
    marker.renderOrder = 20; marker.visible = false; scene.add(marker);
    setExaggeration(exag); buildLegend(); setView('3d');
    $('loading').hidden = true; $('progress-fill').style.width = '100%';
    $('glb-size').textContent = 'ผิวภูมิประเทศ คอนทัวร์ และบริเวณตรวจสอบ · 6.5 MB';
    host.dataset.ready = 'true'; host.dataset.faceCount = String(faceCount);
    new ResizeObserver(() => { updateSize(); fitView(); }).observe(host);
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
      raf = requestAnimationFrame(animate); controls.update(); updatePin();
      const north = controls.target.clone().add(new THREE.Vector3(0, 0, -200)).project(camera);
      const origin = controls.target.clone().project(camera);
      const angle = Math.atan2((north.x - origin.x) * host.clientWidth, (north.y - origin.y) * host.clientHeight) * 180 / Math.PI;
      $('north-arrow').style.transform = `rotate(${angle}deg)`;
      renderer.render(scene, camera);
    }
    animate();
    // Read-only QA hook: coordinates and original model data, no user content or state mutation.
    window.terrainInspection = () => ({ faces: faceCount, bands: terrainMeshes.length, exag, view: mode, selectedBand, selectedPoint: selectedPoint ? { elevation: selectedPoint.elevation, easting: selectedPoint.easting, northing: selectedPoint.northing, band: selectedPoint.band } : null, layers: { terrain: terrain.visible, contours: contours.visible, qa: qa.visible }, sourceSha256: meta.sourceSha256, renderer: renderer.info.render });
  } catch (error) {
    console.error('Terrain viewer:', error); if (raf) cancelAnimationFrame(raf);
    $('loading').hidden = true; $('load-error').hidden = false;
    $('error-message').textContent = 'เบราว์เซอร์อาจไม่รองรับ WebGL หรือโหลดไฟล์ไม่ครบ ลองโหลดหน้าใหม่ หรือเปิดแผนที่ระดับสีแบบภาพด้านล่าง';
    host.dataset.ready = 'error';
  }
}
initialize();
