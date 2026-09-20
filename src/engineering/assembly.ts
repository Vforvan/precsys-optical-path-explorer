import { BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Group, Line, LineBasicMaterial, Mesh, MeshStandardMaterial, Raycaster, RingGeometry, Vector3 } from 'three';
import { LIMITS, OPTICAL_DESIGN, opticsAt, type Coordinates, type Evaluation, type Optic } from './model';

const zAxis = new Vector3(0, 0, 1);
const yAxis = new Vector3(0, 1, 0);
const material = (color: number, metalness = 0.65) => new MeshStandardMaterial({ color, metalness, roughness: 0.36 });
const metal = material(0x76879b);
const black = material(0x172333);
const blue = material(0x245ea5);
const copper = material(0xe7a651);
const mirrorMaterial = material(0xc9f6ff, 0.88);
const glass = new MeshStandardMaterial({ color: 0x7ce0ed, transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.08, side: DoubleSide, depthWrite: false });

export interface Part {
  id: string;
  name: string;
  role: string;
  center: number[];
  motor: string | null;
}

export interface Assembly {
  root: Group;
  optics: Group;
  motors: Group;
  structure: Group;
  platform: Group;
  solids: Mesh[];
  labels: { text: string; position: Vector3; motor: boolean }[];
  parts: Part[];
  movingOptics: { mesh: Group; optic: Optic }[];
}

export function buildAssembly(q: Coordinates): Assembly {
  const root = new Group();
  root.name = '五轴工程候选结构_毫米';
  const optics = new Group(); optics.name = '独立光学件';
  const motors = new Group(); motors.name = '五个实体电机';
  const structure = new Group(); structure.name = '独立支座与导向';
  const platform = new Group(); platform.name = '静止平台与工件';
  root.add(optics, motors, structure, platform);
  const solids: Mesh[] = [];
  const labels: Assembly['labels'] = [];
  const parts: Part[] = [];
  const movingOptics: Assembly['movingOptics'] = [];

  function box(parent: Group, id: string, center: Vector3, size: Vector3, mat = metal, solid = true): Mesh {
    const mesh = new Mesh(new BoxGeometry(size.x, size.y, size.z), mat);
    mesh.position.copy(center); mesh.name = id;
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); if (solid) solids.push(mesh);
    return mesh;
  }

  function cylinder(parent: Group, id: string, center: Vector3, axis: Vector3, radius: number, length: number, mat = black, solid = true): Mesh {
    const mesh = new Mesh(new CylinderGeometry(radius, radius, length, 32), mat);
    mesh.position.copy(center); mesh.quaternion.setFromUnitVectors(yAxis, axis);
    mesh.name = id; mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh); if (solid) solids.push(mesh);
    return mesh;
  }

  function ring(parent: Group, id: string, center: Vector3, normal: Vector3, inner: number, outer: number, depth: number): void {
    const group = new Group(); group.name = id; group.position.copy(center);
    group.quaternion.setFromUnitVectors(zAxis, normal); parent.add(group);
    const shell = new Mesh(new CylinderGeometry(outer, outer, depth, 48, 1, true), black);
    shell.rotation.x = Math.PI / 2; shell.material = black.clone(); shell.material.side = DoubleSide;
    group.add(shell); solids.push(shell);
    const bore = new Mesh(new CylinderGeometry(inner, inner, depth, 48, 1, true), black);
    bore.rotation.x = Math.PI / 2; bore.material = black.clone(); bore.material.side = DoubleSide;
    group.add(bore); solids.push(bore);
    for (const side of [-1, 1]) {
      const face = new Mesh(new RingGeometry(inner, outer, 48), black);
      face.position.z = side * depth / 2; face.material = black.clone(); face.material.side = DoubleSide;
      group.add(face); solids.push(face);
    }
  }

  function post(id: string, x: number, y: number, top: number): void {
    box(structure, `${id}-底座`, new Vector3(x, y, -22), new Vector3(42, 42, 16));
    cylinder(structure, `${id}-立柱`, new Vector3(x, y, (top - 14) / 2), zAxis, 9, top + 14);
    for (const dx of [-14, 14]) for (const dy of [-14, 14]) cylinder(structure, `${id}-安装螺钉`, new Vector3(x + dx, y + dy, -12), zAxis, 3, 4, black);
  }

  box(platform, '静止光学平台 560×450×18', new Vector3(-120, 35, -39), new Vector3(560, 450, 18), material(0x35465b));
  for (const x of [-360, 120]) for (const y of [-150, 220]) cylinder(platform, '隔振脚_被动', new Vector3(x, y, -59), zAxis, 19, 22);
  for (let x = -375; x <= 125; x += 25) for (let y = -165; y <= 235; y += 25) {
    const hole = new Mesh(new RingGeometry(1.8, 2.6, 12), metal);
    hole.position.set(x, y, -29.95); platform.add(hole);
  }
  box(platform, '固定工件台_无电机', new Vector3(20, 170, -22), new Vector3(95, 80, 16), blue);
  box(platform, '工件_上表面Z0', new Vector3(20, 170, -7), new Vector3(64, 54, 14), material(0x969ead), false);
  labels.push({ text: '固定工件台 · 无附加运动轴', position: new Vector3(20, 215, -2), motor: false });

  for (const optic of opticsAt(q)) {
    const group = new Group(); group.name = optic.id; optics.add(group);
    const normal = optic.normal;
    const bodyCenter = optic.kind === 'mirror' ? optic.center.clone().addScaledVector(normal, -optic.thickness / 2) : optic.center;
    cylinder(group, `${optic.id}-单片基体`, bodyCenter, normal, optic.radius, optic.thickness, optic.kind === 'mirror' ? mirrorMaterial : glass, optic.kind === 'mirror');
    // 镜座位于有效口径以外；一片镜对应一个独立镜座。
    ring(group, `${optic.id}-独立镜座`, bodyCenter, normal, optic.radius + 0.1, optic.radius + 4, optic.thickness + 2);
    parts.push({ id: optic.id, name: optic.label, role: optic.motor === null ? '独立固定光学件' : '单电机驱动单片光学件', center: optic.center.toArray(), motor: optic.motor === null ? null : `M${optic.motor + 1}` });
    labels.push({ text: optic.id, position: optic.center.clone().add(new Vector3(0, 0, -30)), motor: false });
    if (optic.motor !== null) movingOptics.push({ mesh: group, optic });
    if (optic.kind !== 'mirror') continue;
    const axis = optic.axis!;
    const motorDistance = optic.motor === 3 ? 72 : 54;
    const motorCenter = optic.center.clone().addScaledVector(axis, motorDistance);
    cylinder(motors, `M${optic.motor! + 1}-旋转振镜电机`, motorCenter, axis, 14, 38, blue);
    cylinder(motors, `M${optic.motor! + 1}-编码器后盖`, motorCenter.clone().addScaledVector(axis, 22), axis, 13, 6);
    const shaftStart = optic.radius + 3;
    cylinder(structure, `${optic.id}-独立转轴`, optic.center.clone().addScaledVector(axis, (shaftStart + motorDistance - 19) / 2), axis, 3, motorDistance - 19 - shaftStart, copper);
    const collar = optic.center.clone().addScaledVector(axis, optic.radius + 1);
    cylinder(group, `${optic.id}-转子连接`, collar, axis, 4, 5, copper);
    if (Math.abs(axis.z) > 0.9) {
      const px = motorCenter.x + 42;
      const py = motorCenter.y - 34;
      post(`M${optic.motor! + 1}`, px, py, motorCenter.z);
      box(structure, `${optic.id}-电机悬臂`, new Vector3((px + motorCenter.x) / 2, py, motorCenter.z), new Vector3(60, 14, 12));
      box(structure, `${optic.id}-电机安装耳`, new Vector3(motorCenter.x, (py + motorCenter.y) / 2, motorCenter.z), new Vector3(14, 38, 12));
    } else {
      post(`M${optic.motor! + 1}`, motorCenter.x, motorCenter.y, motorCenter.z - 14);
      box(structure, `${optic.id}-电机鞍座`, motorCenter.clone().add(new Vector3(0, 0, -15)), new Vector3(30, 28, 12));
    }
    parts.push({ id: `M${optic.motor! + 1}`, name: '闭环旋转振镜电机（封装待选型）', role: `仅驱动 ${optic.id}`, center: motorCenter.toArray(), motor: `M${optic.motor! + 1}` });
    labels.push({ text: `M${optic.motor! + 1}`, position: motorCenter.clone().add(new Vector3(0, 0, 25)), motor: true });
  }

  post('L2', -225, -100, 161);
  box(structure, 'L2-镜座托块', new Vector3(-225, -100, 161), new Vector3(12, 12, 8));
  post('L3', 20, 225, OPTICAL_DESIGN.objectiveHeightMm);
  box(structure, 'L3-独立悬臂', new Vector3(20, 211, OPTICAL_DESIGN.objectiveHeightMm), new Vector3(14, 30, 10));

  post('M5', -295, -100, 110);
  box(motors, 'M5-直线电机定子', new Vector3(-285, -100, 121), new Vector3(68, 40, 22), blue);
  for (const y of [-113, -87]) box(structure, 'M5-被动直线导轨', new Vector3(-285, y, 136), new Vector3(64, 7, 8));
  box(structure, 'M5-单片镜滑座', new Vector3(-285 + q[4], -100, 144), new Vector3(22, 36, 8), copper);
  box(structure, 'M5-L1独立支臂', new Vector3(-285 + q[4], -100, 157), new Vector3(8, 10, 20));
  box(structure, 'M5-固定编码尺', new Vector3(-285, -120, 134), new Vector3(64, 3, 4));
  box(structure, 'M5-随滑座读头', new Vector3(-285 + q[4], -120, 142), new Vector3(10, 5, 6), black);
  parts.push({ id: 'M5', name: '直线电机调焦轴（编码反馈）', role: `只移动 L1；±${LIMITS[4]} mm`, center: [-285, -100, 121], motor: 'M5' });
  labels.push({ text: 'M5 · 直线调焦', position: new Vector3(-285, -133, 135), motor: true });
  labels.push({ text: 'L1 ↔ L2 · 独立镜座', position: new Vector3(-256, -100, 210), motor: false });
  root.updateMatrixWorld(true);
  return { root, optics, motors, structure, platform, solids, labels, parts, movingOptics };
}

export function beamLines(result: Evaluation): Group {
  const group = new Group(); group.name = '追迹光路';
  for (const [i, ray] of [result.chief, ...result.rays].entries()) {
    const points = ray.points.map(point => point.clone());
    if (!ray.error && result.focus) {
      const last = points[points.length - 1];
      const t = (result.focus.z - last.z) / ray.direction.z;
      points.push(last.clone().addScaledVector(ray.direction, t));
    }
    const line = new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: i === 0 ? 0xff614b : 0xffbf76, transparent: i !== 0, opacity: i === 0 ? 1 : 0.22, depthTest: true }));
    line.name = i === 0 ? '主光线' : `采样光线${i}`;
    group.add(line);
  }
  return group;
}

export function mechanicalObstructions(assembly: Assembly, result: Evaluation): string[] {
  const collisions = new Set<string>();
  const caster = new Raycaster();
  assembly.root.updateMatrixWorld(true);
  for (const ray of [result.chief, ...result.rays]) {
    const points = [...ray.points];
    if (!ray.error && result.focus) {
      const last = points[points.length - 1];
      points.push(last.clone().addScaledVector(ray.direction, (result.focus.z - last.z) / ray.direction.z));
    }
    for (let i = 1; i < points.length; i++) {
      const delta = points[i].clone().sub(points[i - 1]);
      const length = delta.length();
      caster.set(points[i - 1].clone().addScaledVector(delta, 0.01 / length), delta.normalize());
      caster.near = 0.01; caster.far = length - 0.03;
      for (const hit of caster.intersectObjects(assembly.solids, false)) collisions.add(hit.object.name || hit.object.parent?.name || '未命名实体');
    }
  }
  return [...collisions];
}
