/**
 * 光学部件的程序化建模（计划书 §4.2：第一版一律用 Three.js 基础几何体）。
 *
 * 这里不追求写实：外壳、镜片口径、物镜内部镜组数量都未公开，
 * 因此所有零件都由基础几何体拼出，并在页面上明确标注"教学等效"。
 * 镜片位姿每帧都由光学层的 MirrorSpec 驱动（位置、法向、局部轴），
 * 因此画面上的镜片姿态与光线计算用的是同一份数据。
 */

import {
  Box3,
  BufferAttribute,
  BoxGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import {
  mirrorAxes,
  mirrorCenter,
  mirrorNormal,
  type MirrorSpec,
} from '../optics/mirror';
import type { ActuatorState, OpticalTrain, TrainTrace } from '../optics/optical-train';
import { OBJECTIVE, AXIS, BEAM_PATH, GALVO, SHIFT_MODULE } from '../config/layout';
import { beamAlignedCylinder } from './geometry-helpers';
import type { SceneMaterials } from './create-scene';
import { createGalvoMotor } from './galvo-motor';

export interface PartEntry {
  id: string;
  label: string;
  object: Object3D;
  spec?: MirrorSpec;
}

export interface OpticsView {
  group: Group;
  parts: PartEntry[];
  /** 每帧更新可动件位姿。 */
  update(actuators: ActuatorState, trace: TrainTrace): void;
  /** 变焦反射镜曲率动画（教学等效，视觉放大）。 */
  setCurvedMirrorRadius(radiusMm: number): void;
}

const UP = new Vector3(0, 1, 0);

/** 用镜片的 (u, v, n) 基构造朝向四元数：局部 X→u、Y→v、Z→n。 */
function orientationOf(normal: Vector3, u: Vector3, v: Vector3): Quaternion {
  const n = normal.clone().normalize();
  const tangent = u.clone().addScaledVector(n, -u.dot(n)).normalize();
  const m = new Matrix4().makeBasis(tangent, new Vector3().crossVectors(n, tangent), n);
  void v;
  return new Quaternion().setFromRotationMatrix(m);
}

/**
 * 由 MirrorSpec 生成一块镜片（薄板 + 亮边框）。
 *
 * 边框不是装饰：镜面本身是低对比度的反射材质，加上一圈高亮轮廓后，
 * 每块镜片的位置、朝向和口径边界都能一眼看清，
 * 读者也才能判断光线是以什么角度打在镜面上。
 */
function createMirrorMesh(
  spec: MirrorSpec,
  materials: SceneMaterials,
  thickness: number = SHIFT_MODULE.plateThickness,
): Mesh {
  const geo = new BoxGeometry(spec.size.u, spec.size.v, thickness);
  geo.translate(0, 0, -thickness / 2);
  const base = spec.kind === 'fixed' ? materials.mirrorFixed : materials.mirrorMovable;
  const mesh = new Mesh(geo, base.clone());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.partId = spec.id;

  const edges = new LineSegments(
    new EdgesGeometry(geo),
    new LineBasicMaterial({
      color: spec.kind === 'fixed' ? 0xdbe7f5 : 0x5fe4ff,
      transparent: true,
      opacity: 0.95,
    }),
  );
  edges.userData.partId = spec.id;
  edges.userData.isOutline = true;
  mesh.add(edges);
  return mesh;
}

/**
 * 可动镜组的支架：把两块平行镜面连成一个刚体。
 * 专利只说明"一个可转镜 26"，未说明其具体形式；模型用同一支架上的两块镜面
 * 实现"第 1 次与第 4 次反射都落在可动镜上"（页面标注为教学等效）。
 */
function createMovableMount(
  inSpec: MirrorSpec,
  outSpec: MirrorSpec,
  materials: SceneMaterials,
): Group {
  const g = new Group();
  const inC = inSpec.center.clone();
  const outC = outSpec.center.clone();
  const dir = outC.clone().sub(inC);
  const len = dir.length();

  const bar = new Mesh(new BoxGeometry(len, 3, 3.5), materials.frame);
  bar.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), dir.clone().normalize()));
  bar.position.copy(inC.clone().add(outC).multiplyScalar(0.5)).addScaledVector(inSpec.v, 25);
  bar.castShadow = true;
  bar.userData.partId = inSpec.id;
  g.add(bar);

  const pivotRing = new Mesh(new TorusGeometry(5.2, 1.0, 8, 26), materials.highlight);
  pivotRing.position.copy(inC);
  pivotRing.quaternion.copy(orientationOf(inSpec.normal, inSpec.u, inSpec.v));
  pivotRing.userData.partId = inSpec.id;
  g.add(pivotRing);

  // 振镜电机刻意画小：避免遮住镜片，镜片面才是要看清的对象
  const motor = new Mesh(new CylinderGeometry(4.4, 4.4, 12, 16), materials.metal);
  motor.position.copy(inC).addScaledVector(inSpec.normal.clone().normalize(), -9);
  motor.quaternion.copy(
    new Quaternion().setFromUnitVectors(UP, inSpec.normal.clone().normalize()),
  );
  motor.userData.partId = inSpec.id;
  g.add(motor);
  for (const center of [inC, outC]) {
    const bridge = new Mesh(new CylinderGeometry(1,1,7,10), materials.frame);
    bridge.position.copy(center).addScaledVector(inSpec.v, 22);
    bridge.quaternion.setFromUnitVectors(UP, inSpec.v);
    g.add(bridge);
  }
  return g;
}

/** 变焦反射镜：平面网格 + 矢高（凸/平/凹）。 */
function createCurvedMirrorMesh(size: number, materials: SceneMaterials): Mesh {
  const geo = new PlaneGeometry(size, size, 30, 30);
  const mesh = new Mesh(geo, materials.mirrorMovable);
  mesh.castShadow = true;
  mesh.userData.partId = 'z-curved';
  mesh.userData.baseSize = size;
  return mesh;
}

/** 按曲率半径更新变焦镜矢高（视觉放大绘制，页面会标注）。 */
export function applyCurvature(mesh: Mesh, radiusMm: number, visualGain = 22): void {
  const geo = mesh.geometry as PlaneGeometry;
  const pos = geo.getAttribute('position') as BufferAttribute;
  if (!geo.userData.flat) {
    geo.userData.flat = Float32Array.from(pos.array as Float32Array);
  }
  const flat = geo.userData.flat as Float32Array;
  const finite = Number.isFinite(radiusMm) && Math.abs(radiusMm) > 1e-6;
  for (let i = 0; i < pos.count; i += 1) {
    const x = flat[i * 3];
    const y = flat[i * 3 + 1];
    const r2 = x * x + y * y;
    const sag = finite ? ((r2 / (2 * radiusMm)) * visualGain) : 0;
    pos.setZ(i, Math.max(-8, Math.min(8, sag)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * 物镜：画成"镜筒 + 内部镜组 + 安装法兰 + 出光口"。
 *
 * 之前是两段等半径的空心大圆筒（紫蓝色），看起来像"悬在光路上的胶囊"，很违和。
 * 现在：镜筒分段收细、用中性玻璃材质、每段加金属加强环，
 * 内部镜组用薄透镜片表示，整体有明确的机械结构感。
 */
function createObjective(materials: SceneMaterials): Group {
  const g = new Group();
  const top = AXIS.objectiveTop;
  const bottom = AXIS.objectiveBottom;
  const height = top - bottom;

  const addRing = (z: number, radius: number, thickness: number) => {
    const ring = new Mesh(new TorusGeometry(radius, thickness / 2, 8, 40), materials.metal);
    ring.position.set(0, 0, z);
    ring.userData.partId = 'objective';
    g.add(ring);
  };

  // 镜筒（三段：入光段细、中段过渡、出光段略收）
  const barrelSpecs: [number, number, number, number][] = [
    // [半径下, 半径上, 长度, 中心 z]
    [OBJECTIVE.barrelTopRadiusMm, OBJECTIVE.barrelTopRadiusMm * 1.15, height * 0.32, top - height * 0.16],
    [OBJECTIVE.barrelTopRadiusMm * 1.15, OBJECTIVE.barrelBottomRadiusMm, height * 0.36, top - height * 0.5],
    [OBJECTIVE.barrelBottomRadiusMm, OBJECTIVE.barrelBottomRadiusMm * 0.72, height * 0.32, bottom + height * 0.16],
  ];
  for (const [rBottom, rTop, len, centerZ] of barrelSpecs) {
    const segment = new Mesh(
      beamAlignedCylinder(rTop, rBottom, len, 40, true),
      materials.optic,
    );
    segment.position.set(0, 0, centerZ);
    segment.userData.partId = 'objective';
    g.add(segment);
  }

  // 机械加强环，标出段与段的分界
  addRing(top - height * 0.32, OBJECTIVE.barrelTopRadiusMm * 1.16, 1.6);
  addRing(top - height * 0.68, OBJECTIVE.barrelBottomRadiusMm * 1.02, 1.6);

  // 入瞳平面标记环
  const pupilRing = new Mesh(
    new RingGeometry(OBJECTIVE.drawnPupilRadiusMm, OBJECTIVE.drawnPupilRadiusMm + 1.2, 48),
    materials.highlight,
  );
  pupilRing.position.set(0, 0, AXIS.entrancePupil);
  pupilRing.userData.partId = 'objective';
  g.add(pupilRing);

  // 内部等效镜组：扩束镜 + 后透镜（数量与曲率未公开，仅示功能）
  const expander = new Mesh(
    beamAlignedCylinder(OBJECTIVE.internalBeamRadiusMm * 0.95, OBJECTIVE.internalBeamRadiusMm * 0.95, 1.8, 28),
    materials.optic,
  );
  expander.position.set(0, 0, AXIS.entrancePupil - 26);
  expander.userData.partId = 'objective';
  g.add(expander);

  const backLens = new Mesh(
    beamAlignedCylinder(OBJECTIVE.internalLensRadiusMm, OBJECTIVE.internalLensRadiusMm, 2.6, 40),
    materials.optic,
  );
  backLens.position.set(0, 0, AXIS.objectiveLastLens);
  backLens.userData.partId = 'objective';
  g.add(backLens);
  addRing(AXIS.objectiveLastLens - 4, OBJECTIVE.internalLensRadiusMm * 1.06, 2);

  // 出光口
  const nose = new Mesh(
    beamAlignedCylinder(
      OBJECTIVE.barrelBottomRadiusMm * 0.55,
      OBJECTIVE.barrelBottomRadiusMm * 0.42,
      7,
      32,
      true,
    ),
    materials.metal,
  );
  nose.position.set(0, 0, bottom - 3);
  nose.userData.partId = 'objective';
  g.add(nose);
  return g;
}

function createGalvo(spec: MirrorSpec, materials: SceneMaterials): Group {
  const g = new Group();
  const plate = createMirrorMesh(spec, materials, GALVO.mirrorThicknessMm);
  g.add(plate);

  const normal = mirrorNormal(spec);
  // 电机退到镜面后方并画小：镜片才是要看清的对象，
  // 之前电机太大，正视图里几乎把 45° 镜面完全挡住。
  const motor = new Mesh(new CylinderGeometry(2.8, 2.8, 9, 14), materials.metal);
  motor.position.copy(mirrorCenter(spec)).addScaledVector(normal, -7);
  motor.quaternion.copy(new Quaternion().setFromUnitVectors(UP, normal));
  motor.userData.partId = spec.id;
  g.add(motor);

  const shaft = new Mesh(new CylinderGeometry(1.1, 1.1, 6, 10), materials.highlight);
  shaft.position.copy(mirrorCenter(spec)).addScaledVector(normal, -3.2);
  shaft.quaternion.copy(new Quaternion().setFromUnitVectors(UP, normal));
  shaft.userData.partId = spec.id;
  g.add(shaft);
  return g;
}

function createSplitterAndSensor(train: OpticalTrain, materials: SceneMaterials): Group {
  const g = new Group();
  const spec = train.splitter;
  const plate = new Mesh(new BoxGeometry(spec.size.u, spec.size.v, 1.4), materials.optic);
  plate.position.copy(mirrorCenter(spec));
  plate.quaternion.copy(orientationOf(mirrorNormal(spec), spec.u, spec.v));
  plate.userData.partId = 'monitor-splitter';
  g.add(plate);

  const sensor = new Mesh(new BoxGeometry(20, 20, 4), materials.sensor);
  sensor.position.copy(train.positionSensor.center);
  sensor.lookAt(BEAM_PATH.afterBeta.x, BEAM_PATH.afterBeta.y, AXIS.monitoringSplitter);
  sensor.userData.partId = 'position-sensor';
  g.add(sensor);

  const aperture = new Mesh(new RingGeometry(3, 4.6, 32), materials.metal);
  aperture.position.copy(sensor.position);
  aperture.quaternion.copy(sensor.quaternion);
  aperture.userData.partId = 'position-sensor';
  g.add(aperture);
  return g;
}

function createBeamConditioning(materials: SceneMaterials): Group {
  const g = new Group();
  const x = BEAM_PATH.inlet.x;
  const y = BEAM_PATH.inlet.y;

  const add = (
    z: number,
    radius: number,
    thickness: number,
    id: string,
    material: MeshPhysicalMaterial | MeshStandardMaterial,
  ) => {
    const disc = new Mesh(beamAlignedCylinder(radius, radius, thickness, 32), material);
    disc.position.set(x, y, z);
    disc.userData.partId = id;
    g.add(disc);
  };

  const inlet = new Mesh(beamAlignedCylinder(6.5, 6.5, 16, 28, true), materials.metal);
  inlet.position.set(x, y, AXIS.inlet);
  inlet.userData.partId = 'inlet';
  g.add(inlet);

  add(AXIS.beamExpander + 8, 8, 5, 'expander', materials.optic);
  add(AXIS.beamExpander - 8, 8, 5, 'expander', materials.optic);
  add(AXIS.divergenceAdjust, 6, 4, 'divergence', materials.optic);
  add(AXIS.halfWavePlate, 5.5, 3, 'half-wave', materials.optic);
  add(AXIS.quarterWavePlate, 5.5, 3, 'quarter-wave', materials.optic);

  const shell = new Mesh(beamAlignedCylinder(14, 14, 130, 30, true), materials.housing);
  shell.position.set(x, y, (AXIS.halfWavePlate + AXIS.beamExpander) / 2 + 6);
  shell.userData.partId = 'beam-conditioning';
  g.add(shell);
  return g;
}

function createProtectiveWindowAndNozzle(materials: SceneMaterials): Group {
  const g = new Group();

  const drawer = new Group();
  for (const [w, h, x, y] of [[48, 5, 0, 15.5], [48, 5, 0, -15.5], [5, 26, 21.5, 0], [5, 26, -21.5, 0]]) {
    const rail = new Mesh(new BoxGeometry(w, h, 6), materials.frame);
    rail.position.set(x, y, 0);
    rail.userData.partId = 'protective-window';
    drawer.add(rail);
  }
  drawer.position.set(0, 0, AXIS.protectiveWindow);
  drawer.userData.partId = 'protective-window';
  g.add(drawer);

  const glass = new Mesh(new BoxGeometry(26, 26, 2.4), materials.optic);
  glass.position.set(0, 0, AXIS.protectiveWindow);
  glass.userData.partId = 'protective-window';
  g.add(glass);

  // 工艺气体喷嘴：金属本体 + 一圈琥珀色标识（原来是整块饱和橙，很抢眼且违和）
  const nozzleBody = new Mesh(
    beamAlignedCylinder(6.2, 4.0, 13, 28, true),
    materials.metal,
  );
  nozzleBody.position.set(0, 0, AXIS.gasNozzle - 2);
  nozzleBody.userData.partId = 'gas-nozzle';
  g.add(nozzleBody);

  const nozzleRing = new Mesh(
    new TorusGeometry(6.0, 0.7, 8, 28),
    materials.gas,
  );
  nozzleRing.position.set(0, 0, AXIS.gasNozzle + 3);
  nozzleRing.userData.partId = 'gas-nozzle';
  g.add(nozzleRing);

  // 供气管：从喷嘴根部斜向接到外壳侧壁，走细管 + 暗色，避免像一根悬空金棒
  const gasLine = new Mesh(new CylinderGeometry(1.05, 1.05, 92, 12), materials.frame);
  gasLine.rotation.set(0, 0, Math.PI / 2.2);
  gasLine.position.set(44, 0, AXIS.gasNozzle + 16);
  gasLine.userData.partId = 'gas-nozzle';
  g.add(gasLine);

  const gasElbow = new Mesh(new TorusGeometry(7, 1.05, 8, 20, Math.PI / 2), materials.frame);
  gasElbow.position.set(9.5, 0, AXIS.gasNozzle + 2);
  gasElbow.rotation.set(0, Math.PI / 2, 0);
  gasElbow.userData.partId = 'gas-nozzle';
  g.add(gasElbow);
  return g;
}

/** 模块包络框：用线框标明"一个模块"的范围，便于区分模块与单块镜片。 */
function createModuleFrame(points: Vector3[], color: string, margin: number): LineSegments {
  const box = new Box3();
  for (const point of points) box.expandByPoint(point);
  box.expandByScalar(margin);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const geometry = new EdgesGeometry(
    new BoxGeometry(Math.max(size.x, 6), Math.max(size.y, 6), Math.max(size.z, 6)),
  );
  const lines = new LineSegments(
    geometry,
    new LineBasicMaterial({ color, transparent: true, opacity: 0.32 }),
  );
  lines.position.copy(center);
  lines.userData.partId = 'module-frame';
  return lines;
}

/** 建立全部光学部件，并返回可动件的逐帧更新函数。 */
export function buildOpticsView(train: OpticalTrain, materials: SceneMaterials): OpticsView {
  const group = new Group();
  const parts: PartEntry[] = [];
  /** 可动镜组支架（含入光镜面、出光镜面与振镜电机），逐帧随动。 */
  const mounts: { group: Group; module: typeof train.alphaModule }[] = [];
  /** 振镜组（镜片 + 电机 + 轴），逐帧随动。 */
  const galvos: { group: Group; spec: MirrorSpec }[] = [];

  const register = (id: string, label: string, object: Object3D, spec?: MirrorSpec) => {
    parts.push({ id, label, object, spec });
  };

  // α / β 平行移束模块
  for (const module of [train.alphaModule, train.betaModule]) {
    const specs: [MirrorSpec, string, string][] = [
      [module.movableIn, `${module.axis}-movable-in`, `${module.axis.toUpperCase()} 可动镜组 · 入光镜面`],
      [module.movableOut, `${module.axis}-movable-out`, `${module.axis.toUpperCase()} 可动镜组 · 出光镜面`],
      [module.fixed1, `${module.axis}-fixed-1`, `${module.axis.toUpperCase()} 固定镜 1`],
      [module.fixed2, `${module.axis}-fixed-2`, `${module.axis.toUpperCase()} 固定镜 2`],
    ];
    for (const [spec, id, label] of specs) {
      const mesh = createMirrorMesh(spec, materials);
      mesh.position.copy(spec.center);
      mesh.quaternion.copy(orientationOf(spec.normal, spec.u, spec.v));
      group.add(mesh);
      register(id, label, mesh, spec);
    }
    const mount = createMovableMount(module.movableIn, module.movableOut, materials);
    group.add(mount);
    mounts.push({ group: mount, module });
    register(`${module.axis}-mount`, `${module.axis.toUpperCase()} 可动镜组支架（同一振镜支架）`, mount, module.movableIn);
    // 模块包络框：帮助读者区分"模块"与"单块镜片"
    group.add(
      createModuleFrame(
        specs.map(([spec]) => spec.center),
        module.axis === 'alpha' ? '#7c8cff' : '#ff9d5c',
        16,
      ),
    );
  }

  // Z 动态调焦等效模块
  const zGalvo = createGalvo(train.focusModule.galvo, materials);
  group.add(zGalvo);
  galvos.push({ group: zGalvo, spec: train.focusModule.galvo });
  register('z-galvo', 'Z 可动折转镜', zGalvo.children[0], train.focusModule.galvo);

  const curved = createCurvedMirrorMesh(train.focusModule.curved.size.u, materials);
  curved.position.copy(mirrorCenter(train.focusModule.curved));
  curved.quaternion.copy(
    orientationOf(
      mirrorNormal(train.focusModule.curved),
      train.focusModule.curved.u,
      train.focusModule.curved.v,
    ),
  );
  group.add(curved);
  register('z-curved', '变焦反射镜', curved, train.focusModule.curved);

  const fold = createGalvo(train.focusModule.fold, materials);
  group.add(fold);
  galvos.push({ group: fold, spec: train.focusModule.fold });
  register('z-fold', 'Z 折返镜', fold.children[0], train.focusModule.fold);

  // 两片振镜
  const yGalvoGroup = createGalvo(train.yGalvo, materials);
  const xGalvoGroup = createGalvo(train.xGalvo, materials);
  group.add(yGalvoGroup, xGalvoGroup);
  galvos.push({ group: yGalvoGroup, spec: train.yGalvo });
  galvos.push({ group: xGalvoGroup, spec: train.xGalvo });
  register('galvo-y', 'Y 振镜（上游）', yGalvoGroup.children[0], train.yGalvo);
  register('galvo-x', 'X 振镜（入瞳平面）', xGalvoGroup.children[0], train.xGalvo);

  // 监测分光元件与光束位置测量单元
  const monitor = createSplitterAndSensor(train, materials);
  group.add(monitor);
  register('monitor-splitter', '监测分光元件', monitor.children[0], train.splitter);
  register('position-sensor', '光束位置测量单元', monitor.children[1]);

  // 物镜、保护玻璃、喷嘴、光束调理
  const objective = createObjective(materials);
  group.add(objective);
  register('objective', '物镜', objective);

  const service = createProtectiveWindowAndNozzle(materials);
  group.add(service);
  register('protective-window', '快换保护玻璃抽屉', service.children[0]);
  register('gas-nozzle', '工艺气体喷嘴', service.children[2]);

  const conditioning = createBeamConditioning(materials);
  group.add(conditioning);
  register('beam-conditioning', '光束调理单元', conditioning);

  const movableParts = parts.filter(
    (p): p is PartEntry & { spec: MirrorSpec } =>
      !!p.spec && p.object instanceof Mesh && (p.spec.kind === 'movable' || p.spec.kind === 'curved'),
  );
  for (const item of mounts) item.group.children[2].visible = false;
  for (const item of galvos) {
    item.group.children[1].visible = false;
    item.group.children[2].visible = false;
  }
  const motors = [
    { view: createGalvoMotor(train.xGalvo, 'X'), angle: (a: ActuatorState) => a.xRad },
    { view: createGalvoMotor(train.yGalvo, 'Y'), angle: (a: ActuatorState) => a.yRad },
    { view: createGalvoMotor(train.focusModule.galvo, 'Z'), angle: (a: ActuatorState) => a.zDeg * Math.PI / 180 },
    { view: createGalvoMotor(train.alphaModule.movableIn, 'α'), angle: (a: ActuatorState) => a.alphaRad },
    { view: createGalvoMotor(train.betaModule.movableIn, 'β'), angle: (a: ActuatorState) => a.betaRad },
  ];
  for (const motor of motors) group.add(motor.view.group);

  /**
   * 教学 Z 折返镜保留随动驱动外形：它不是固定镜，而是每帧按"出射必须沿 −Z"解算法向的
   * 随动镜，角度与执行器不同（因此不能用执行器角驱动，必须用本帧解出的姿态）。
   * 专利未规定此结构；不能把这个示意驱动当作 precSYS 的第六轴。
   */
  const foldMotor = createGalvoMotor(train.focusModule.fold, 'Z 随动示意');
  group.add(foldMotor.group);
  // 高亮只影响当前部件，避免与外壳、光束共用材质时互相覆盖透明度。
  group.traverse((object) => {
    if (object instanceof Mesh && !object.parent?.parent?.userData.motorAxis && !object.parent?.userData.motorAxis) {
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone()) : object.material.clone();
    }
  });

  const angleFor = (spec: MirrorSpec, actuators: ActuatorState): number => {
    const id = spec.id.split('-').slice(-2).join('-');
    switch (id) {
      case 'movable-in':
      case 'movable-out':
        return spec.id.startsWith('alpha') ? actuators.alphaRad : actuators.betaRad;
      case 'galvo-x':
        return actuators.xRad;
      case 'galvo-y':
        return actuators.yRad;
      default:
        return spec.angleRad ?? 0;
    }
  };

  const update = (actuators: ActuatorState, trace: TrainTrace) => {
    for (const motor of motors) motor.view.update(motor.angle(actuators));

    // 随动折返镜的机械角：由本帧解出的法向相对名义法向求出（带符号，绕自身转轴）
    {
      const spec = train.focusModule.fold;
      const axis = (spec.rotationAxis ?? spec.v).clone().normalize();
      const n0 = spec.normal.clone().normalize();
      const hit = trace.hits.find((h) => h.mirrorId === spec.id);
      const n1 = hit ? hit.normal.clone().normalize() : n0;
      const sin = n1.clone().crossVectors(n0, n1).dot(axis);
      foldMotor.update(Math.atan2(sin, n0.dot(n1)));
    }
    // 可动镜面：位置与朝向按刚体转动更新
    for (const part of movableParts) {
      const spec = part.spec;
      if (spec.id === 'z-curved') continue; // 变焦镜只改曲率，姿态固定
      const rotated: MirrorSpec = { ...spec, angleRad: angleFor(spec, actuators) };
      part.object.position.copy(mirrorCenter(rotated));
      const axes = mirrorAxes(rotated);
      part.object.quaternion.copy(orientationOf(mirrorNormal(rotated), axes.u, axes.v));
    }
    // 可动镜组支架：整组随刚体转动
    for (const { group: mount, module } of mounts) {
      const angle = module.axis === 'alpha' ? actuators.alphaRad : actuators.betaRad;
      const inRot: MirrorSpec = { ...module.movableIn, angleRad: angle };
      const outRot: MirrorSpec = { ...module.movableOut, angleRad: angle };
      const inC = mirrorCenter(inRot);
      const outC = mirrorCenter(outRot);
      const bar = mount.children[0] as Mesh;
      const dir = outC.clone().sub(inC);
      bar.quaternion.copy(
        new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), dir.clone().normalize()),
      );
      bar.position.copy(inC.clone().add(outC).multiplyScalar(0.5)).addScaledVector(mirrorAxes(inRot).v, 25);
      const ring = mount.children[1] as Mesh;
      const axes = mirrorAxes(inRot);
      ring.position.copy(inC);
      ring.quaternion.copy(orientationOf(mirrorNormal(inRot), axes.u, axes.v));
      const motor = mount.children[2] as Mesh;
      const n = mirrorNormal(inRot);
      motor.position.copy(inC).addScaledVector(n, -13);
      motor.quaternion.copy(new Quaternion().setFromUnitVectors(UP, n));
      for (const [i, center] of [inC, outC].entries()) {
        mount.children[3 + i].position.copy(center).addScaledVector(axes.v, 22);
        mount.children[3 + i].quaternion.setFromUnitVectors(UP, axes.v);
      }
    }
    // 振镜与折转镜：镜片 + 电机 + 轴一起随动
    for (const { group: galvoGroup, spec } of galvos) {
      const idTail = spec.id.split('-').slice(-2).join('-');
      let angle = spec.angleRad ?? 0;
      if (idTail === 'galvo-x') angle = actuators.xRad;
      else if (idTail === 'galvo-y') angle = actuators.yRad;
      else if (spec.id === 'z-galvo') angle = (actuators.zDeg * Math.PI) / 180;
      else if (spec.id === 'z-fold') angle = (actuators.zDeg * Math.PI) / 180 / 2;
      const rotated: MirrorSpec = { ...spec, angleRad: angle };
      const normal = mirrorNormal(rotated);
      const center = mirrorCenter(rotated);
      const plate = galvoGroup.children[0] as Mesh;
      plate.position.copy(center);
      const axes = mirrorAxes(rotated);
      plate.quaternion.copy(orientationOf(normal, axes.u, axes.v));
      const motor = galvoGroup.children[1] as Mesh;
      motor.position.copy(center).addScaledVector(normal, -12);
      motor.quaternion.copy(new Quaternion().setFromUnitVectors(UP, normal));
      const shaft = galvoGroup.children[2] as Mesh;
      shaft.position.copy(center).addScaledVector(normal, -5);
      shaft.quaternion.copy(new Quaternion().setFromUnitVectors(UP, normal));
    }
    // 渲染直接使用本帧追迹的法向，尤其是随动折返镜，避免两套运动学漂移。
    for (const hit of trace.hits) {
      const part = parts.find((entry) => entry.id === hit.mirrorId);
      if (!part?.spec) continue;
      const index = trace.chiefPoints.findIndex((p) => p.distanceToSquared(hit.point) < 1e-10);
      const incoming = hit.point.clone().sub(trace.chiefPoints[Math.max(0, index - 1)]);
      const front = hit.normal.clone();
      if (incoming.dot(front) > 0) front.negate();
      part.object.quaternion.copy(orientationOf(front, mirrorAxes({ ...part.spec,
        angleRad: angleFor(part.spec, actuators) }).u, part.spec.v));
      const galvo = galvos.find((entry) => entry.spec.id === hit.mirrorId);
      if (galvo) {
        const axis = part.spec.rotationAxis ?? part.spec.v;
        const center = part.object.position;
        galvo.group.children[1].position.copy(center).addScaledVector(axis, part.spec.size.v / 2 + 8);
        galvo.group.children[1].quaternion.setFromUnitVectors(UP, axis);
        galvo.group.children[2].position.copy(center).addScaledVector(axis, part.spec.size.v / 2 + 2);
        galvo.group.children[2].quaternion.setFromUnitVectors(UP, axis);
      }
    }
  };

  return {
    group,
    parts,
    update,
    setCurvedMirrorRadius: (_radiusMm: number) => applyCurvature(curved, Infinity),
  };
}
