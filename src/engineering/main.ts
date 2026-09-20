import { AmbientLight, AxesHelper, Color, DirectionalLight, GridHelper, Group, Mesh, PerspectiveCamera, Scene, SphereGeometry, MeshBasicMaterial, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildAssembly, beamLines, mechanicalObstructions, type Assembly } from './assembly';
import { aoiFromDirection, aoiTarget, controllability, evaluate, inverse, LIMITS, OPTICAL_DESIGN, opticsAt, type Coordinates } from './model';
import { ProcessPlayer } from './process-view';
import type { ProcessKind } from './process';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = $('viewport');
const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0e1824);
viewport.appendChild(renderer.domElement);
const scene = new Scene(); scene.background = new Color(0x0e1824);
const camera = new PerspectiveCamera(39, 1, 1, 3000); camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08;
scene.add(new AmbientLight(0xc7def6, 2.3));
for (const [x, y, z, intensity] of [[100, -350, 650, 3.2], [-400, 200, 400, 2.1], [200, 300, 150, 1.2]]) {
  const light = new DirectionalLight(0xd8e9ff, intensity); light.position.set(x, y, z); scene.add(light);
}
const grid = new GridHelper(1100, 44, 0x2c465b, 0x1a2b3c); grid.rotation.x = Math.PI / 2; grid.position.z = -72; scene.add(grid);
const axes = new AxesHelper(45); axes.position.set(-375, -165, -28); scene.add(axes);
const labelRenderer = new CSS2DRenderer();
Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
viewport.appendChild(labelRenderer.domElement);
let labelGroup = new Group(); scene.add(labelGroup);
let q: Coordinates = [0, 0, 0, 0, 0];
let assembly: Assembly;
let beam = new Group();
let playing = false;
let conePlaying = false;
let startedAt = 0;
let lastUpdate = 0;
let currentView = 'iso';
let lastReport: Record<string, unknown> = {};
let processPlayer: ProcessPlayer | undefined;
const focusMarker = new Mesh(new SphereGeometry(0.9, 16, 12), new MeshBasicMaterial({ color: 0xffcc8c })); scene.add(focusMarker);
const visibility = { optics: true, motors: true, structure: true, platform: true, beam: true, labels: true };
const axisNames = ['R1 · 前级水平', 'R2 · 前级垂直', 'R3 · 后级水平', 'R4 · 向下折转', 'L1 · 单片调焦'];
const outputs = ['X 焦点', 'Y 焦点', 'Z 焦点', 'α · XZ 投影角', 'β · YZ 投影角'];

function stop(): void { playing = false; conePlaying = false; processPlayer?.pause(); $('demo').textContent = '▶ 五轴联动'; $('aoi-demo').textContent = '▶ 7° 全方位进动'; }

function disposeGroup(group: Group): void {
  const materials = new Set<Mesh['material']>();
  group.traverse(object => {
    const mesh = object as Mesh;
    mesh.geometry?.dispose();
    if (mesh.material) materials.add(mesh.material);
    const label = object as CSS2DObject;
    label.element?.remove();
  });
  for (const entry of materials) for (const material of Array.isArray(entry) ? entry : [entry]) material.dispose();
  group.removeFromParent();
}

function applyVisibility(): void {
  for (const key of ['optics', 'motors', 'structure', 'platform'] as const) assembly[key].visible = visibility[key];
  beam.visible = visibility.beam; focusMarker.visible = visibility.beam && lastReport.output !== null;
  labelGroup.visible = visibility.labels;
  labelRenderer.domElement.style.visibility = visibility.labels ? 'visible' : 'hidden';
}

function update(): void {
  if (assembly) disposeGroup(assembly.root);
  disposeGroup(beam); disposeGroup(labelGroup);
  assembly = buildAssembly(q); scene.add(assembly.root);
  const result = evaluate(q);
  const blocked = mechanicalObstructions(assembly, result);
  const capability = controllability(q);
  const aoi = result.output ? aoiFromDirection(result.chief.direction) : null;
  const aoiInRange = aoi !== null && aoi <= OPTICAL_DESIGN.maxAoiDeg + 1e-5;
  beam = beamLines(result); scene.add(beam);
  labelGroup = new Group(); scene.add(labelGroup);
  for (const label of assembly.labels) {
    const element = document.createElement('div'); element.className = `part-label${label.motor ? ' motor' : ''}`; element.textContent = label.text;
    const object = new CSS2DObject(element); object.position.copy(label.position); labelGroup.add(object);
  }
  if (result.focus) focusMarker.position.copy(result.focus);
  focusMarker.visible = !!result.focus;
  for (let i = 0; i < 5; i++) {
    $<HTMLInputElement>(`axis-${i}`).value = String(q[i]);
    $(`value-${i}`).textContent = `${q[i].toFixed(i === 4 ? 3 : 4)} ${i === 4 ? 'mm' : '°'}`;
  }
  $('readouts').innerHTML = outputs.map((name, i) => `<div class="readout"><span>${name}</span><strong>${result.output ? result.output[i].toFixed(3) : '—'}<small>${i < 3 ? 'mm' : '°'}</small></strong></div>`).join('');
  const valid = result.errors.length === 0 && blocked.length === 0 && capability.rank === 5 && aoiInRange;
  $('audit-title').textContent = valid ? '当前姿态：采样通光通过 · 局部秩 5' : '当前姿态存在限制';
  $('audit-title').classList.toggle('warning', !valid);
  $('audit-detail').textContent = valid ? '双环 32 条光线与中心光线检查通过。薄透镜模型；7° 实机像差、动态稳定性尚待验证。' : [...result.errors, ...blocked.map(id => `遮挡：${id}`), ...(capability.rank < 5 ? ['五维局部可控性未通过'] : []), ...(!aoiInRange && aoi !== null ? ['总 AOI 超出本版 7° 目标范围'] : [])].join('；');
  $('aoi-actual').textContent = aoi === null ? '—' : `${aoi.toFixed(4)}°`;
  $('aoi-actual').classList.toggle('warning', !aoiInRange);
  $('alpha-live').textContent = result.output ? `${result.output[3].toFixed(3)}°` : '—';
  $('beta-live').textContent = result.output ? `${result.output[4].toFixed(3)}°` : '—';
  $('audit-metrics').innerHTML = `<div><span>最小口径余量</span><b>${result.apertureMargin.toFixed(2)} mm</b></div><div><span>归一化条件数 κ∞</span><b>${capability.condition.toFixed(1)}</b></div><div><span>几何弥散 RMS</span><b>${Number.isFinite(result.rms) ? (result.rms * 1000).toFixed(2) : '—'} μm</b></div>`;
  lastReport = { q: [...q], output: result.output, aoiDeg: aoi, aoiInRange, apertureMargin: result.apertureMargin, rmsMm: result.rms, ...capability, blocked, errors: result.errors, valid, physicalMotors: 5, independentMovingOptics: 5, modelBoundary: 'V2：AOI 7° 薄透镜近轴模型；机械包络设计；尚未形成加工级设计或动态稳定性验证' };
  $('bom').innerHTML = `<table><thead><tr><th>部件</th><th>功能 / 安装</th><th>电机</th><th>中心 mm</th></tr></thead><tbody>${assembly.parts.map(part => `<tr><td>${part.id}</td><td>${part.role}</td><td>${part.motor ?? '固定'}</td><td>${part.center.map(n => n.toFixed(1)).join(', ')}</td></tr>`).join('')}</tbody></table>`;
  applyVisibility();
}

function setView(view: string): void {
  currentView = view;
  camera.up.set(0, 0, 1);
  if (view === 'top') { camera.position.set(-100, 35, 920); camera.up.set(0, 1, 0); controls.target.set(-100, 35, 80); }
  else if (view === 'front') { camera.position.set(-120, -880, 205); controls.target.set(-120, 40, 85); }
  else if (view === 'focus') { camera.position.set(-420, -400, 300); controls.target.set(-265, -100, 156); }
  else { camera.position.set(490, -620, 545); controls.target.set(-115, 35, 55); }
  controls.update();
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportGlb(): Promise<void> {
  stop();
  const group = new Group(); group.name = 'Engineering_candidate_units_m';
  const model = assembly.root.clone(true); model.traverse(object => { object.visible = true; });
  const opticalPath = beam.clone(true); opticalPath.traverse(object => { object.visible = true; });
  group.add(model, opticalPath); group.scale.setScalar(0.001);
  group.userData = { designStatus: '候选结构，未制造验证', coordinateSystem: 'Z-up; nominal focus (20,170,0) mm', motors: 5, movingOptics: 5, parameters: q };
  const data = await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: false });
  download(new Blob([data as ArrayBuffer], { type: 'model/gltf-binary' }), '五轴扫描头-AOI7度-V2.glb');
}

function moveToTarget(target: Coordinates): boolean {
  const targetAoi = Math.atan(Math.hypot(Math.tan(target[3] * Math.PI / 180), Math.tan(target[4] * Math.PI / 180))) * 180 / Math.PI;
  if (target.some(n => !Number.isFinite(n)) || Math.abs(target[3]) >= 90 || Math.abs(target[4]) >= 90) { $('solve-status').textContent = '请输入有限数值，方向分量必须在 ±90° 内'; return false; }
  if (targetAoi > OPTICAL_DESIGN.maxAoiDeg + 1e-5) { $('solve-status').textContent = `目标总 AOI ${targetAoi.toFixed(3)}° 超出 7°，保留原姿态。`; return false; }
  let solution = inverse(target, q);
  if (!solution.ok) solution = inverse(target);
  if (!solution.ok) { $('solve-status').textContent = `未找到行程内解，残差 ${solution.residual.toPrecision(3)}；保留原姿态。`; return false; }
  const result = evaluate(solution.q);
  const candidate = buildAssembly(solution.q);
  const blocked = mechanicalObstructions(candidate, result);
  disposeGroup(candidate.root);
  if (result.errors.length || blocked.length) { $('solve-status').textContent = `目标存在光路限制：${[...result.errors, ...blocked].join('、')}；保留原姿态。`; return false; }
  q = solution.q; update();
  target.forEach((n, i) => { $<HTMLInputElement>(`target-${i}`).value = n.toFixed(6); });
  $('solve-status').textContent = `逆解收敛，最大坐标残差 ${solution.residual.toExponential(2)}；当前姿态通光通过。`;
  return true;
}

function setAoi(signedAoi: number, azimuth: number): boolean {
  return moveToTarget(aoiTarget(signedAoi, azimuth));
}

$('sliders').innerHTML = axisNames.map((name, i) => `<div class="axis-control"><div class="axis-head"><b>M${i + 1}<small>${name}</small></b><output id="value-${i}"></output></div><input aria-label="M${i + 1} 电机坐标" id="axis-${i}" type="range" min="${-LIMITS[i]}" max="${LIMITS[i]}" step="${i === 4 ? 0.005 : 0.001}" value="0"><div class="axis-range"><span>−${LIMITS[i]} ${i === 4 ? 'mm' : '°'}</span><span>+${LIMITS[i]} ${i === 4 ? 'mm' : '°'}</span></div></div>`).join('');
for (let i = 0; i < 5; i++) $<HTMLInputElement>(`axis-${i}`).addEventListener('input', event => { stop(); q[i] = Number((event.target as HTMLInputElement).value); update(); });
$('targets').innerHTML = outputs.map((name, i) => `<label>${name}<input id="target-${i}" type="number" step="0.01" value="0"></label>`).join('');
$('solve').onclick = () => {
  stop();
  const target = outputs.map((_, i) => Number($<HTMLInputElement>(`target-${i}`).value)) as Coordinates;
  moveToTarget(target);
};
for (const id of ['aoi-angle', 'aoi-azimuth']) $<HTMLInputElement>(id).oninput = () => {
  stop();
  const signed = Number($<HTMLInputElement>('aoi-angle').value);
  const azimuth = Number($<HTMLInputElement>('aoi-azimuth').value);
  $('aoi-command').textContent = `${signed.toFixed(1)}° / ${azimuth.toFixed(0)}°`;
  setAoi(signed, azimuth);
};
document.querySelectorAll<HTMLButtonElement>('[data-aoi]').forEach(button => { button.onclick = () => {
  stop();
  const signed = Number(button.dataset.aoi); const azimuth = Number(button.dataset.azimuth ?? 0);
  $<HTMLInputElement>('aoi-angle').value = String(signed); $<HTMLInputElement>('aoi-azimuth').value = String(azimuth);
  $('aoi-command').textContent = `${signed.toFixed(1)}° / ${azimuth.toFixed(0)}°`; setAoi(signed, azimuth);
}; });
$('aoi-demo').onclick = () => {
  const start = !conePlaying; stop();
  if (start && setAoi(7, 0)) { conePlaying = true; startedAt = performance.now(); $('aoi-demo').textContent = 'Ⅱ 暂停 7° 进动'; }
};
for (const [key, label] of Object.entries({ optics: '独立镜片', motors: '5 个电机', structure: '镜座与支撑', platform: '承载平台', beam: '光路与光束', labels: '部件标签' })) {
  const row = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.dataset.layer = key;
  input.onchange = () => { visibility[key as keyof typeof visibility] = input.checked; applyVisibility(); };
  row.append(input, label); $('visibility').append(row);
}
$('reset').onclick = () => { stop(); q = [0, 0, 0, 0, 0]; $('solve-status').textContent = ''; $<HTMLInputElement>('aoi-angle').value = '0'; $<HTMLInputElement>('aoi-azimuth').value = '0'; $('aoi-command').textContent = '0.0° / 0°'; update(); };
$('demo').onclick = () => { const start = !playing; stop(); playing = start; startedAt = performance.now(); $('demo').textContent = playing ? 'Ⅱ 暂停联动' : '▶ 五轴联动'; };
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => { button.onclick = () => setView(button.dataset.view!); });
$('export-json').onclick = () => download(new Blob([JSON.stringify({ units: 'mm / deg', inputRadiusMm: 1.5, opticalModel: '3D reflection + paraxial thin lenses', design: OPTICAL_DESIGN, coordinates: q, optics: opticsAt(q), parts: assembly.parts, validation: lastReport }, null, 2)], { type: 'application/json' }), '五轴扫描头-AOI7度-参数V2.json');
$('export-glb').onclick = () => { exportGlb().catch(error => { $('audit-title').textContent = `导出失败：${String(error)}`; }); };
new ResizeObserver(() => { const width = viewport.clientWidth, height = viewport.clientHeight; renderer.setSize(width, height); labelRenderer.setSize(width, height); camera.aspect = width / height; camera.fov = width < 720 ? 49 : 39; camera.updateProjectionMatrix(); }).observe(viewport);
update(); setView('iso'); $('boot').remove();
processPlayer = new ProcessPlayer(stop, values => { q = [...values]; update(); return lastReport.valid === true; });
function frame(time: number): void {
  requestAnimationFrame(frame);
  if (playing && time - lastUpdate > 160) {
    const t = (time - startedAt) / 1000;
    q = [0.08 * Math.sin(t), 0.08 * Math.cos(t), -0.06 * Math.sin(t), 0.06 * Math.cos(t), 0.35 * Math.sin(t * 0.6)];
    update(); lastUpdate = time;
  }
  if (conePlaying && time - lastUpdate > 160) {
    const azimuth = ((time - startedAt) / 1000 * 18) % 360;
    if (!setAoi(7, azimuth)) stop();
    $<HTMLInputElement>('aoi-angle').value = '7'; $<HTMLInputElement>('aoi-azimuth').value = String(azimuth);
    $('aoi-command').textContent = `7.0° / ${azimuth.toFixed(0)}°`; lastUpdate = time;
  }
  processPlayer?.tick(time);
  controls.update(); renderer.render(scene, camera); labelRenderer.render(scene, camera);
}
requestAnimationFrame(frame);
Object.assign(window, { __ENGINEERING__: { getReport: () => lastReport, getView: () => currentView, setQ: (values: Coordinates) => { stop(); q = [...values]; update(); }, setAoi: (aoi: number, azimuth: number) => { stop(); return setAoi(aoi, azimuth); }, getProcess: () => processPlayer?.state(), startProcess: (kind: ProcessKind) => processPlayer?.start(kind), seekProcess: (progress: number) => processPlayer?.seek(progress), pauseProcess: () => processPlayer?.pause(), setView, exportGlb } });
