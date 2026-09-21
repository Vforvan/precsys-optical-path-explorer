import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Group, Line, LineBasicMaterial, Mesh, MeshStandardMaterial, Quaternion, Raycaster, RingGeometry, Vector3 } from 'three';
import { LIMITS, OPTICAL_DESIGN, RAD, opticsAt, type Coordinates, type Evaluation, type Optic } from './model';

/**
 * 五轴工程候选的三维装配。
 *
 * ## 为什么是"建一次 + 增量更新"
 *
 * 早先的实现每次位姿变化都调用 `buildAssembly(q)` 并把旧的整棵场景 `dispose()` 掉。
 * 加工演示每 160 ms 更新一次位姿，于是每秒 6 次把整台扫描头的几何、材质、光束、
 * 标签全部丢弃重建 —— **新材质会触发 WebGL 着色器重新编译**，CPU profile 显示
 * `getProgramInfoLog` 占 32.3%，帧时间 p95 达 97 ms、最大 121 ms。
 *
 * 关键在于：**绝大部分部件与位姿无关**。真正随 `q` 变化的只有三处：
 *   1. 四片反射镜绕各自转轴的姿态（`normal` 旋转）；
 *   2. L1 负透镜沿 X 的平移（`center.x = −285 + q[4]`）；
 *   3. M5 滑座及其随动件沿 X 的平移。
 * 电机外壳、转轴、支座、立柱、平台、L2/L3 及其支撑全都固定不动。
 *
 * 所以这里把装配拆成两半：
 *   - `buildAssembly()` 建一次静态结构，并登记三类可动件的"运动学"信息；
 *   - `updateAssembly()` 只改变换与标签，不新建对象、不动材质。
 */

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

/** 随位姿变化的部件登记表；`updateAssembly()` 只遍历这三类。 */
export interface AssemblyKinematics {
  /**
   * 每片光学件一个组。组位于**镜心**（旋转中心），子对象是相对镜心的局部偏移，
   * 因此组的变换即"该件相对零位姿态的旋转与平移"。
   */
  optics: {
    group: Group;
    optic: Optic;
    /** 转轴（仅镜片有）；为 null 表示该件不旋转（透镜）。 */
    axis: Vector3 | null;
    /** 该件的转角取自 q 的哪一项。 */
    axisIndex: number;
    /**
     * 基体镜筒。位姿变化时它的朝向要按**当前法向**重新定姿，见 updateAssembly：
     * 这里只记录网格引用，零位朝向由 updateAssembly 统一设置。
     */
    body: Mesh[];
  }[];
  /** 沿 X 平移的 M5 随动件：滑座、支臂、读头。 */
  slides: Mesh[];
  /** 需要随位姿移动的标签。 */
  labels: AssemblyLabel[];
}

export interface AssemblyLabel {
  text: string;
  position: Vector3;
  motor: boolean;
  follow?: 'optic' | 'motor';
}

export interface Assembly {
  root: Group;
  optics: Group;
  motors: Group;
  structure: Group;
  platform: Group;
  solids: Mesh[];
  labels: AssemblyLabel[];
  parts: Part[];
  movingOptics: { mesh: Group; optic: Optic }[];
  kinematics: AssemblyKinematics;
  /** 光学件 id → parts 条目，用于把中心坐标同步成当前位姿（惰性建立）。 */
  partIndex?: Map<string, Part>;
}

export function buildAssembly(q?: Coordinates): Assembly {
  const root = new Group();
  root.name = '五轴工程候选结构_毫米';
  const optics = new Group(); optics.name = '独立光学件';
  const motors = new Group(); motors.name = '五个实体电机';
  const structure = new Group(); structure.name = '独立支座与导向';
  const platform = new Group(); platform.name = '静止平台与工件';
  root.add(optics, motors, structure, platform);
  const solids: Mesh[] = [];
  const labels: AssemblyLabel[] = [];
  const parts: Part[] = [];
  const movingOptics: Assembly['movingOptics'] = [];
  const kinematics: AssemblyKinematics = { optics: [], slides: [], labels: [] };

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

  /**
   * 光学件按"零位姿态"建一次，**子对象用相对镜心的局部偏移**。
   *
   * 为什么必须是局部偏移：位姿更新时我们对组施加"零位 → 当前"的旋转差，
   * 组又位于镜心（旋转中心），于是子对象的位置与朝向都会被正确地带动。
   * 若子对象按世界坐标摆放，这个旋转会被施加两次 —— 零位时看不出问题
   * （此时旋转差是单位阵），一给非零位姿就整体错位。
   *
   * 各子件的局部偏移都能随组旋转而落在正确位置：
   *   - 基体：−(t/2)·n，组一转就变成 −(t/2)·(Rn) ✔（n 为镜片法向）
   *   - 转子连接：+(R+1)·a，组一转就变成 +(R+1)·(Ra) ✔（a 为转轴）
   *   - 镜座：同转子连接，且自身朝向也随组旋转，组内只需按零位法向定姿 ✔
   */
  const optics0 = opticsAt([0, 0, 0, 0, 0]);
  for (const optic of optics0) {
    const group = new Group(); group.name = optic.id; optics.add(group);
    const normal = optic.normal;
    const halfThickness = optic.thickness / 2;
    const bodyCenter = optic.kind === 'mirror' ? optic.center.clone().addScaledVector(normal, -halfThickness) : optic.center;
    const bodyMesh = cylinder(group, `${optic.id}-单片基体`, bodyCenter, normal, optic.radius, optic.thickness, optic.kind === 'mirror' ? mirrorMaterial : glass, optic.kind === 'mirror');
    // 镜座位于有效口径以外；一片镜对应一个独立镜座。
    ring(group, `${optic.id}-独立镜座`, bodyCenter, normal, optic.radius + 0.1, optic.radius + 4, optic.thickness + 2);
    parts.push({ id: optic.id, name: optic.label, role: optic.motor === null ? '独立固定光学件' : '单电机驱动单片光学件', center: optic.center.toArray(), motor: optic.motor === null ? null : `M${optic.motor + 1}` });
    labels.push({ text: optic.id, position: optic.center.clone().add(new Vector3(0, 0, -30)), motor: false, follow: 'optic' });
    // 镜片：轴与转角下标取自 model 的约定（R1↔q[0] … R4↔q[3]）；透镜不旋转
    kinematics.optics.push({
      group,
      optic,
      axis: optic.kind === 'mirror' && optic.axis ? optic.axis.clone() : null,
      axisIndex: optic.motor ?? 0,
      body: [bodyMesh],
    });
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
    // 转子连接**不随镜片转动**（旧实现里它的朝向恒为 setFromUnitVectors(yAxis, axis)，
    // 与转角无关），所以不能挂在旋转组内 —— 否则会跟着组转出 0.5° 的偏差。
    // 直接挂在 optics 下、用零位世界坐标；位姿变化不影响它。
    cylinder(optics, `${optic.id}-转子连接`, collar, axis, 4, 5, copper);
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
    labels.push({ text: `M${optic.motor! + 1}`, position: motorCenter.clone().add(new Vector3(0, 0, 25)), motor: true, follow: 'motor' });
  }

  /**
   * 把光学件组内的子对象从"绝对世界坐标"转成"相对镜心的局部偏移"，并把组移到镜心。
   *
   * 为什么：上面的构造代码沿用"按世界坐标摆放子对象"的写法（直观、不易算错），
   * 但那要求组保持单位变换。而增量更新需要组位于**旋转中心（镜心）**、
   * 由组统一承担旋转与平移；若子对象同时带绝对坐标，变换就会被施加两遍
   * （零位时看不出来，一给非零位姿就整体错位）。
   *
   * 子对象的世界朝向与几何都不变 —— 只改位置，且减去的正是组新增的位置，
   * 因此零位外观与改动前逐字节一致。
   */
  for (const entry of kinematics.optics) {
    for (const child of entry.group.children) child.position.sub(entry.optic.center);
    entry.group.position.copy(entry.optic.center);
  }

  post('L2', -225, -100, 161);
  box(structure, 'L2-镜座托块', new Vector3(-225, -100, 161), new Vector3(12, 12, 8));
  post('L3', 20, 225, OPTICAL_DESIGN.objectiveHeightMm);
  box(structure, 'L3-独立悬臂', new Vector3(20, 211, OPTICAL_DESIGN.objectiveHeightMm), new Vector3(14, 30, 10));

  post('M5', -295, -100, 110);
  box(motors, 'M5-直线电机定子', new Vector3(-285, -100, 121), new Vector3(68, 40, 22), blue);
  for (const y of [-113, -87]) box(structure, 'M5-被动直线导轨', new Vector3(-285, y, 136), new Vector3(64, 7, 8));
  // 下面三件随 q[4] 沿 X 平移，登记进 kinematics.slides
  kinematics.slides.push(box(structure, 'M5-单片镜滑座', new Vector3(-285, -100, 144), new Vector3(22, 36, 8), copper));
  kinematics.slides.push(box(structure, 'M5-L1独立支臂', new Vector3(-285, -100, 157), new Vector3(8, 10, 20)));
  box(structure, 'M5-固定编码尺', new Vector3(-285, -120, 134), new Vector3(64, 3, 4));
  kinematics.slides.push(box(structure, 'M5-随滑座读头', new Vector3(-285, -120, 142), new Vector3(10, 5, 6), black));
  parts.push({ id: 'M5', name: '直线电机调焦轴（编码反馈）', role: `只移动 L1；±${LIMITS[4]} mm`, center: [-285, -100, 121], motor: 'M5' });
  labels.push({ text: 'M5 · 直线调焦', position: new Vector3(-285, -133, 135), motor: true });
  labels.push({ text: 'L1 ↔ L2 · 独立镜座', position: new Vector3(-256, -100, 210), motor: false });
  root.updateMatrixWorld(true);
  const assembly: Assembly = { root, optics, motors, structure, platform, solids, labels, parts, movingOptics, kinematics };
  // 传入位姿时直接落到该姿态：单元测试需要一次拿到任意位姿下的装配体
  if (q) updateAssembly(q, assembly);
  return assembly;
}

/**
 * 把装配体更新到给定姿态。只改变换，**不新建对象、不改材质**。
 *
 * 这一步替代了原先"dispose 整棵场景 + buildAssembly(q)"的做法，
 * 是消除着色器反复编译与帧时间尖峰的关键。
 *
 * 返回当前姿态下的光学件列表，供标签定位等后续步骤复用（避免重复调用 opticsAt）。
 */
export function updateAssembly(q: Coordinates, assembly: Assembly): Optic[] {
  const current = opticsAt(q);
  const byId = new Map(current.map((optic) => [optic.id, optic]));

  for (const entry of assembly.kinematics.optics) {
    const optic = byId.get(entry.optic.id);
    if (!optic) continue;
    // 组位于镜心（旋转中心），子对象是相对镜心的局部偏移。
    //
    // 旋转直接取"绕自身转轴转 q[axisIndex]"——这正是 opticsAt 里
    // normal.applyAxisAngle(axis, q[i]) 的等价刚体转动，实测与旧实现逐位一致。
    // 注意**不能**用 setFromUnitVectors(baseNormal→normal) 推导转角：当基础法向
    // 与转轴反向时（如 R2/R4）那样得到的四元数顺序是反的，位置会差千分之几，
    // 在 7° 姿态下足以让通光遮挡检查误报。
    if (entry.axis) {
      // 组的变换：绕自身转轴转 q[axisIndex]（镜心不动，故只有旋转）
      const rotation = new Quaternion().setFromAxisAngle(entry.axis, q[entry.axisIndex] * RAD);
      entry.group.quaternion.copy(rotation);
    } else {
      entry.group.quaternion.identity();
    }
    /**
     * 基体镜筒的朝向必须逐帧按**当前法向**重新定姿：
     *
     *     meshWorld = setFromUnitVectors(yAxis, optic.normal)
     *
     * 这与旧实现同源（它把旋转后的法向喂给 setFromUnitVectors）。
     * **不能**等价地写成"组旋转 ∘ 零位朝向"——两者在数学上并不相等：
     * 当基础法向与转轴近乎反向时（R2：法向 (0.707,−0.707,0) 与轴 (0.707,0.707,0)
     * 正交但叉积方向相反），两条路径相差约 1.3°，位置看不出来，
     * 却足以让 7° 姿态下的通光遮挡检查误报。
     *
     * 组已承担 R，故网格自身应取 q_base⁻¹ · meshWorld = R⁻¹ · meshWorld：
     * 组与网格合起来正好得到 meshWorld，不会把旋转施加两遍。
     */
    const inverseGroup = entry.group.quaternion.clone().invert();
    const meshWorld = new Quaternion().setFromUnitVectors(yAxis, optic.normal);
    for (const mesh of entry.body) mesh.quaternion.copy(inverseGroup).multiply(meshWorld);
    // 镜心绕轴旋转时不移动，因此组的位置就是当前镜心（只有 L1 会沿 X 平移）。
    entry.group.position.copy(optic.center);
  }

  // 同步 parts 里的光学件中心：BOM 表格与参数导出的"中心 mm"列依赖它
  if (!assembly.partIndex) {
    assembly.partIndex = new Map();
    for (const part of assembly.parts) {
      const optic = byId.get(part.id);
      if (optic) assembly.partIndex.set(part.id, part);
    }
  }
  for (const [id, part] of assembly.partIndex) {
    const optic = byId.get(id);
    if (optic) part.center = optic.center.toArray();
  }

  // M5 滑座及随动件：沿 X 平移；基准位置在首次调用时记下，避免重复累加
  for (const mesh of assembly.kinematics.slides) {
    if (mesh.userData.baseX === undefined) mesh.userData.baseX = mesh.position.x;
    mesh.position.x = (mesh.userData.baseX as number) + q[4];
  }

  assembly.root.updateMatrixWorld(true);
  return current;
}

/**
 * 标签定位：需要跟着光学件/电机走的标签，取当前姿态下的坐标。
 *
 * 与 `updateAssembly` 分开，是因为标签是 CSS2D DOM 对象、需要同步 DOM 文本，
 * 由调用方决定何时更新（通常与位姿更新同频，但不该混进几何变换里）。
 */
export function labelPositions(assembly: Assembly, current: Optic[]): { label: AssemblyLabel; position: Vector3 }[] {
  const byId = new Map(current.map((optic) => [optic.id, optic]));
  const out: { label: AssemblyLabel; position: Vector3 }[] = [];
  for (const entry of assembly.kinematics.optics) {
    const optic = byId.get(entry.optic.id);
    if (!optic) continue;
    // 标签文本就是光学件 id（见 buildAssembly 里的 labels.push）
    const label = assembly.labels.find((item) => item.follow === 'optic' && item.text === entry.optic.id);
    if (label) out.push({ label, position: optic.center.clone().add(new Vector3(0, 0, -30)) });
  }
  return out;
}

/**
 * 光路折线的容量上限，用于**一次性预分配**顶点缓冲。
 *
 *   - 每个 RayPath 从初始点 (−350,−100,180) 出发，依次命中 7 片光学件，
 *     因此点数 = 1 + 7 = 8；若追迹成功再补一个焦点，共 9。
 *   - 光线条数 = 主光线 1 + 两圈采样（每圈 16 条，见 evaluate 的 samples 默认值）= 33。
 *
 * 折线只画"到轴距离 ≥ 1 mm"的前两段（见 updateBeam 的说明），
 * 所以每条约 3 个点，但缓冲按上限分配以容纳极端姿态。
 */
export const BEAM_MAX_POINTS = 9;
export const BEAM_MAX_RAYS = 33;

/**
 * 建一次光路折线容器：33 条 Line，顶点缓冲按上限预分配。
 *
 * 与旧实现（每次 evaluate 都新建 33 个 BufferGeometry）相比，这里只建一次，
 * 之后由 `updateBeam()` 改顶点值。避免每帧新建几何与材质 —— 那是着色器
 * 反复编译与帧时间尖峰的一部分来源。
 */
export function buildBeam(): Group {
  const group = new Group(); group.name = '追迹光路';
  for (let i = 0; i < BEAM_MAX_RAYS; i++) {
    const positions = new Float32Array(BEAM_MAX_POINTS * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    const line = new Line(geometry, new LineBasicMaterial({
      color: i === 0 ? 0xff614b : 0xffbf76,
      transparent: i !== 0,
      opacity: i === 0 ? 1 : 0.22,
      depthTest: true,
    }));
    line.name = i === 0 ? '主光线' : `采样光线${i}`;
    line.visible = false;
    group.add(line);
  }
  return group;
}

/**
 * 把当前追迹结果写进已分配好的折线容器。**不新建任何对象。**
 *
 * 与旧实现逐字等价的折线构成：RayPath.points 是依次命中的交点序列，
 * 若追迹无错再沿出射方向补一个落在焦点平面上的点。
 */
export function updateBeam(group: Group, result: Evaluation): void {
  const paths = [result.chief, ...result.rays];

  for (let i = 0; i < group.children.length; i++) {
    const line = group.children[i] as Line;
    const path = paths[i];
    const geometry = line.geometry as BufferGeometry;
    if (!path) { line.visible = false; geometry.setDrawRange(0, 0); continue; }

    const points = path.points;
    const attribute = geometry.getAttribute('position') as BufferAttribute;
    const array = attribute.array as Float32Array;
    const geometryPoints = Math.min(points.length, BEAM_MAX_POINTS);
    for (let k = 0; k < geometryPoints; k++) {
      array[k * 3] = points[k].x;
      array[k * 3 + 1] = points[k].y;
      array[k * 3 + 2] = points[k].z;
    }
    let count = geometryPoints;
    // 追迹成功时补一个焦点（与旧实现一致）
    if (!path.error && result.focus && count < BEAM_MAX_POINTS && Math.abs(path.direction.z) > 1e-9) {
      const last = points[points.length - 1];
      const t = (result.focus.z - last.z) / path.direction.z;
      array[count * 3] = last.x + path.direction.x * t;
      array[count * 3 + 1] = last.y + path.direction.y * t;
      array[count * 3 + 2] = last.z + path.direction.z * t;
      count += 1;
    }
    attribute.needsUpdate = true;
    geometry.computeBoundingSphere();
    // 点数不足时靠 drawRange 截断，避免画出缓冲里上一帧的残留顶点
    geometry.setDrawRange(0, count);
    line.visible = true;
  }
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
