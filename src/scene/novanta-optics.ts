/**
 * Novanta / ARGES 路线的三维部件建模。
 *
 * 与 SCANLAB 模式的场景代码**完全独立**：那条路线画的是反射镜与三镜四反射模块，
 * 这条路线必须画两块**透射式平行玻璃板**（plane-parallel plate）——
 * 有真实厚度、两个平行表面、内部能看到光线（折射后的光路）。
 *
 * 禁止事项（本仓库约定）：
 *   · 不把平行板画成楔形棱镜（wedge prism），也不称为 Risley prism；
 *   · 不让板绕光轴连续自转来伪造进动 —— 板的姿态严格来自 tracePlate() 的结果；
 *   · 玻璃材质的 transmission / ior 只用于**视觉表现**（让人看出这是玻璃、有厚度），
 *     画面上的光线路径与所有读数一律来自 refraction.ts 的真实向量折射追迹。
 *     两者不共用同一套计算，也不允许用材质的"视觉折射"替代几何追迹。
 */

import {
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
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import { mirrorAxes, mirrorCenter, mirrorNormal, type MirrorSpec } from '../optics/mirror';
import type {
  NovantaActuatorState,
  NovantaOpticalTrain,
  NovantaTrainTrace,
} from '../optics/novanta-optical-train';
import { telescopeLensesAt } from '../optics/galilean-telescope';
import { NOVANTA_AXIS, NOVANTA_BEAM_PATH, NOVANTA_OBJECTIVE, NOVANTA_PLATES } from '../config/novanta-layout';
import { VISUAL_GAIN } from '../config/visual-scale';
import { beamAlignedCylinder } from './geometry-helpers';
import { createGalvoMotor } from './galvo-motor';
import type { SceneMaterials } from './create-scene';
import type { PartEntry } from './create-optics';
import type { ChainView } from './chain-view';

const UP = new Vector3(0, 1, 0);

/**
 * 望远镜镜组轴向行程的绘制放大倍数 —— 与仓库其它视觉放大系数一起放在
 * `config/visual-scale.ts` 里集中管理（并在页面上标注）。
 * 这里再导出一次，方便场景与说明文字引用同一个值。
 */
export const LENS_AXIAL_VISUAL_GAIN = VISUAL_GAIN.novantaLensTravel;

/**
 * 由 (法向, 面内两轴) 构造朝向四元数：局部 X→u、Y→v、Z→n。
 * 与 create-optics.ts 的约定一致，保证两条路线的渲染取向规则相同。
 */
function quaternionFromBasis(u: Vector3, v: Vector3, normal: Vector3): Quaternion {
  const n = normal.clone().normalize();
  const tangent = u.clone().addScaledVector(n, -u.dot(n));
  const x = tangent.lengthSq() > 1e-12 ? tangent.normalize() : new Vector3(1, 0, 0);
  const y = new Vector3().crossVectors(n, x).normalize();
  void v;
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, n));
}

/** 玻璃板材质：transmission 只做视觉表现，不参与光学计算。 */
function makeGlassMaterial(thicknessMm: number): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: 0xdff3ff,
    metalness: 0,
    roughness: 0.06,
    transmission: 0.94,
    thickness: thicknessMm,
    ior: NOVANTA_PLATES.refractiveIndex,
    transparent: true,
    opacity: 1,
    side: 2,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    reflectivity: 0.08,
  });
}

/** 用若干关键点围出一个线框包络（标明"这是一个模块"）。 */
function createWireBox(points: Vector3[], margin: number, color: string): LineSegments {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of points) {
    min.min(p);
    max.max(p);
  }
  min.addScalar(-margin);
  max.addScalar(margin);
  const size = max.clone().sub(min);
  const geometry = new EdgesGeometry(
    new BoxGeometry(Math.max(size.x, 6), Math.max(size.y, 6), Math.max(size.z, 6)),
  );
  const lines = new LineSegments(
    geometry,
    new LineBasicMaterial({ color, transparent: true, opacity: 0.3 }),
  );
  lines.position.copy(min.clone().add(max).multiplyScalar(0.5));
  lines.userData.partId = 'novanta-wobble-unit';
  return lines;
}

/** 建立全部 Novanta 光学部件，并返回逐帧更新函数。 */
export function buildNovantaOpticsView(
  train: NovantaOpticalTrain,
  materials: SceneMaterials,
): ChainView {
  const group = new Group();
  const parts: PartEntry[] = [];
  /** 需要保持"玻璃感"的网格（高亮时不能把它们变成不透明）。 */
  const glassMeshes = new Set<Mesh>();

  const register = (id: string, label: string, object: Group | Mesh, spec?: MirrorSpec) => {
    parts.push({ id, label, object, spec });
  };

  // ---------------------------------------------------------------- 两块平行平板
  const plates = [train.wobbleUnit.plateA, train.wobbleUnit.plateB];
  const plateVisuals = plates.map((plate) => {
    const half = plate.apertureMm / 2;
    const geometry = new BoxGeometry(2 * half, 2 * half, plate.thicknessMm);
    const mesh = new Mesh(geometry, makeGlassMaterial(plate.thicknessMm));
    mesh.userData.partId = plate.id;
    group.add(mesh);
    glassMeshes.add(mesh);

    // 两个平行表面的轮廓：一眼看出"有厚度的板"，也便于确认两面平行
    const outline = new LineSegments(
      new EdgesGeometry(geometry),
      new LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9 }),
    );
    outline.userData.partId = plate.id;
    mesh.add(outline);

    // 转轴指示：一根细轴，标明板绕哪根**横向轴**倾斜（不是绕光轴自转）
    const axis = new Mesh(
      new CylinderGeometry(0.5, 0.5, 2 * half + 16, 10),
      materials.highlight.clone(),
    );
    axis.userData.partId = plate.id;
    group.add(axis);

    // 振镜驱动外形（专利明文：两块板由 Galvanometereinheiten 驱动）
    const mount = new Mesh(new CylinderGeometry(4.2, 4.2, 9, 14), materials.metal.clone());
    mount.userData.partId = plate.id;
    group.add(mount);

    register(plate.id, plate.label, mesh, {
      id: plate.id,
      label: plate.label,
      kind: 'movable',
      center: plate.pivot.clone(),
      normal: plate.nominalNormal.clone(),
      u: new Vector3(1, 0, 0),
      v: new Vector3(0, 1, 0),
      size: { u: plate.apertureMm, v: plate.apertureMm },
      rotationAxis: plate.rotationAxis.clone(),
      angleRad: 0,
      trust: '专利原理',
      note: plate.note,
      interactive: true,
    });
    return { plate, mesh, axis, mount };
  });

  // wobble unit 模块包络框
  group.add(
    createWireBox(
      plates.map((p) => p.pivot),
      NOVANTA_PLATES.apertureMm / 2 + 6,
      '#7c8cff',
    ),
  );

  // ---------------------------------------------------------------- 望远镜（凹 + 凸）
  const telescopeLenses = [train.telescope.negative, train.telescope.positive];
  const lensVisuals = telescopeLenses.map((lens) => {
    const mesh = new Mesh(
      beamAlignedCylinder(lens.apertureMm / 2, lens.apertureMm / 2, lens.thicknessMm, 40),
      new MeshPhysicalMaterial({
        color: 0xcfe6ff,
        metalness: 0.02,
        roughness: 0.1,
        transmission: 0.9,
        thickness: lens.thicknessMm,
        ior: 1.52,
        transparent: true,
        opacity: 0.55,
        side: 2,
        depthWrite: false,
      }),
    );
    mesh.userData.partId = lens.id;
    group.add(mesh);
    glassMeshes.add(mesh);

    const rim = new Mesh(
      new TorusGeometry(lens.apertureMm / 2 + 0.7, 0.8, 8, 44),
      materials.metal.clone(),
    );
    rim.userData.partId = lens.id;
    group.add(rim);

    // 轴向可动镜组的滑座外形（专利："可沿光轴移动"）
    const carriage = new Mesh(new BoxGeometry(7, 10, 5), materials.frame.clone());
    carriage.userData.partId = lens.id;
    group.add(carriage);

    register(lens.id, lens.label, mesh);
    return { lens, mesh, rim, carriage };
  });

  // 导轨
  for (const dy of [-5, 5]) {
    const rail = new Mesh(beamAlignedCylinder(0.6, 0.6, 90, 10), materials.frame.clone());
    rail.position.set(
      NOVANTA_BEAM_PATH.upstreamAxis.x - train.telescope.negative.apertureMm / 2 - 7,
      NOVANTA_BEAM_PATH.upstreamAxis.y + dy,
      (NOVANTA_AXIS.telescopeNegativeLens + NOVANTA_AXIS.telescopePositiveLens) / 2,
    );
    group.add(rail);
  }

  // ---------------------------------------------------------------- scanblock 两片振镜
  const galvoVisuals = (
    [
      [train.yGalvo, 'y'],
      [train.xGalvo, 'x'],
    ] as [MirrorSpec, 'x' | 'y'][]
  ).map(([spec, id]) => {
    const g = new Group();
    const plate = new Mesh(new BoxGeometry(spec.size.u, spec.size.v, 2.6), materials.mirrorFixed.clone());
    plate.userData.partId = spec.id;
    g.add(plate);
    const motor = new Mesh(new CylinderGeometry(3.2, 3.2, 10, 16), materials.metal.clone());
    motor.userData.partId = spec.id;
    g.add(motor);
    const shaft = new Mesh(new CylinderGeometry(1.0, 1.0, 7, 10), materials.highlight.clone());
    shaft.userData.partId = spec.id;
    g.add(shaft);
    group.add(g);
    register(spec.id, spec.label, plate, spec);
    return { spec, id, group: g, plate, motor, shaft };
  });

  // ---------------------------------------------------------------- 光束衰减单元（专利 I）
  const attenuator = new Mesh(
    beamAlignedCylinder(9, 9, 8, 26),
    new MeshStandardMaterial({
      color: '#3b4a5e',
      metalness: 0.6,
      roughness: 0.4,
      transparent: true,
      opacity: 0.75,
    }),
  );
  attenuator.position.copy(train.attenuator.center);
  attenuator.userData.partId = 'novanta-attenuator';
  group.add(attenuator);
  register('novanta-attenuator', train.attenuator.label, attenuator);

  // ---------------------------------------------------------------- 入口
  const inletGroup = new Group();
  const inlet = new Mesh(beamAlignedCylinder(6.5, 6.5, 16, 28, true), materials.metal.clone());
  inlet.position.set(NOVANTA_BEAM_PATH.upstreamAxis.x, NOVANTA_BEAM_PATH.upstreamAxis.y, NOVANTA_AXIS.inlet);
  inlet.userData.partId = 'novanta-inlet';
  inletGroup.add(inlet);
  const inletShell = new Mesh(beamAlignedCylinder(11, 11, 40, 26, true), materials.housing.clone());
  inletShell.position.set(
    NOVANTA_BEAM_PATH.upstreamAxis.x,
    NOVANTA_BEAM_PATH.upstreamAxis.y,
    NOVANTA_AXIS.inlet - 12,
  );
  inletShell.userData.partId = 'novanta-inlet';
  inletGroup.add(inletShell);
  group.add(inletGroup);
  register('novanta-inlet', '激光入口 / 光束衰减单元', inletGroup);

  // ---------------------------------------------------------------- 物镜
  const objective = createNovantaObjective(materials);
  group.add(objective);
  register('objective', '物镜（公开焦距 60 mm）', objective);

  // ---------------------------------------------------------------- 保护玻璃与喷嘴
  const service = createNovantaService(materials);
  group.add(service.group);
  register('protective-window', '快换保护玻璃抽屉', service.windowMesh);
  register('gas-nozzle', '工艺气体喷嘴', service.nozzleMesh);

  // ---------------------------------------------------------------- 电机读数
  /**
   * 读数标签必须用这条路线自己的执行轴名字。
   * 直接沿用 SCANLAB 的"α 电机 / β 电机"会误导 —— Novanta 的 α/β 是**两块平板**
   * 各自的机械倾角，不是两个装在镜片上的振镜。
   *
   * createGalvoMotor 只需要 (id, rotationAxis, rotationPivot, size.v)，
   * 因此这里为平板与望远镜各造一个最小 MirrorSpec 适配对象。
   *
   * 【装在哪】平行平板的转轴与板心都在光轴上，所以电机必须沿转轴**外移到板缘之外**
   * （mountOffset = 口径/2 + 余量），否则壳体会压在玻璃板与标签上。
   */
  const motorSpec = (params: {
    id: string;
    label: string;
    rotationAxis: Vector3;
    pivot: Vector3;
    reachMm: number;
    /** 沿转轴外移的距离；0 = 就装在 pivot 上。 */
    mountOffsetMm?: number;
  }): MirrorSpec => ({
    id: params.id,
    label: params.label,
    kind: 'movable',
    center: params.pivot.clone(),
    normal: new Vector3(0, 0, 1),
    u: new Vector3(1, 0, 0),
    v: new Vector3(0, 1, 0),
    size: { u: params.reachMm, v: params.reachMm },
    rotationAxis: params.rotationAxis.clone(),
    rotationPivot: params.pivot
      .clone()
      .addScaledVector(params.rotationAxis.clone().normalize(), params.mountOffsetMm ?? 0),
    angleRad: 0,
    trust: '教学等效',
    note: '',
    interactive: false,
  });

  const plateMountOffset = (plate: (typeof plates)[number]) => plate.apertureMm / 2 + 10;

  /**
   * 振镜电机的挂点。
   *
   * 【两条约束，之前都写错过】
   *  1. **不能移动镜片本体**。45° 折转对的镜心必须在它自己那条竖直光路上
   *     （见 config/novanta-layout.ts 里的推导）；把镜心搬开会让入射光偏心打镜，
   *     还会把 32 mm 宽的镜片拉进物镜筒区间造成穿模。
   *  2. **电机要装在镜面平面内、沿转轴伸出去**。真实振镜就是这样：转轴穿过镜片，
   *     电机接在轴的一端。所以挂点 = 镜心 + rotationAxis × offset。
   *     早前把挂点沿**法向**外移，电机就飘到光路旁的空气里去了。
   */
  const galvoMotorAnchor = (spec: MirrorSpec, reachMm: number): MirrorSpec => ({
    ...spec,
    rotationPivot: spec.center
      .clone()
      .addScaledVector((spec.rotationAxis ?? spec.v).clone().normalize(), reachMm),
  });

  const motors = [
    {
      view: createGalvoMotor(galvoMotorAnchor(train.xGalvo, 24), 'X', 'X 振镜'),
      angle: (a: NovantaActuatorState) => a.xGalvoRad,
    },
    {
      view: createGalvoMotor(galvoMotorAnchor(train.yGalvo, 24), 'Y', 'Y 振镜'),
      angle: (a: NovantaActuatorState) => a.yGalvoRad,
    },
    {
      view: createGalvoMotor(
        motorSpec({
          id: plates[0].id,
          label: plates[0].label,
          rotationAxis: plates[0].rotationAxis,
          pivot: plates[0].pivot,
          reachMm: plates[0].apertureMm,
          mountOffsetMm: plateMountOffset(plates[0]),
        }),
        'plateA',
        '平板 A 倾角',
      ),
      angle: (a: NovantaActuatorState) => a.plateARad,
    },
    {
      view: createGalvoMotor(
        motorSpec({
          id: plates[1].id,
          label: plates[1].label,
          rotationAxis: plates[1].rotationAxis,
          pivot: plates[1].pivot,
          reachMm: plates[1].apertureMm,
          mountOffsetMm: plateMountOffset(plates[1]),
        }),
        'plateB',
        '平板 B 倾角',
      ),
      angle: (a: NovantaActuatorState) => a.plateBRad,
    },
    {
      view: createGalvoMotor(
        motorSpec({
          id: 'novanta-z-actuator',
          label: 'Z 执行器（望远镜镜组轴向移动）',
          rotationAxis: new Vector3(0, 1, 0),
          /**
           * Z 执行器是**直线**轴：电机沿 −Z 挂在凹透镜上游，
           * 不能放在透镜自身位置（会与透镜重叠）。
           */
          pivot: new Vector3(
            NOVANTA_BEAM_PATH.upstreamAxis.x - 26,
            NOVANTA_BEAM_PATH.upstreamAxis.y,
            NOVANTA_AXIS.telescopeNegativeLens + 34,
          ),
          reachMm: 22,
        }),
        'Z',
        'Z 行程',
        0,
        'mm',
      ),
      // 读数显示真实行程（mm）；指针转角按教学比例折算，仅作视觉指示
      angle: (a: NovantaActuatorState) => a.telescopeTravelMm,
      rotorAngle: (a: NovantaActuatorState) => (a.telescopeTravelMm / 1000) * 30,
    },
  ];
  for (const motor of motors) group.add(motor.view.group);
  /** 全部执行器外形（含读数标签），供"显示执行器"开关整体隐藏。 */
  const motorGroups = motors.map((motor) => motor.view.group);

  // 其余网格单独克隆材质，供高亮逐块调整透明度
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (glassMeshes.has(mesh)) return;
    if (mesh.parent?.userData.motorAxis) return;
    const m = mesh.material as MeshStandardMaterial;
    const base = typeof m.opacity === 'number' ? m.opacity : 1;
    const alreadyOwned = m.userData.ownedByNovanta === true || base < 1;
    if (alreadyOwned) return;
    mesh.material = m.clone();
    (mesh.material as MeshStandardMaterial).userData.ownedByNovanta = true;
  });

  const nonGlassMeshes: Mesh[] = [];
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh && mesh.material && !glassMeshes.has(mesh)) nonGlassMeshes.push(mesh);
  });

  const update = (actuators: NovantaActuatorState, trace: NovantaTrainTrace): void => {
    if (!trace.wobble) return;
    const wobble = trace.wobble;

    // ---- 两块板：姿态严格取自追迹结果（法向 + 定位基准点），不另写运动学
    const poses = [wobble.poseA, wobble.poseB];
    plateVisuals.forEach((visual, i) => {
      const plate = visual.plate;
      const pose = poses[i];
      const n = pose.normal.clone().normalize();
      const u = new Vector3().crossVectors(n, plate.rotationAxis);
      const uu = u.lengthSq() > 1e-12 ? u.normalize() : new Vector3(1, 0, 0);
      const vv = new Vector3().crossVectors(n, uu).normalize();
      /**
       * 板心 = 定位基准点（= 转轴与板面的交点，见 plateAnchorAt）沿 −n 后退半个板厚。
       *
       * 这里必须用"不随倾角移动"的基准点：pivot 位于光轴上、离板面有很长的力臂，
       * 一旦把定位点绕转轴旋转，一个小倾角就会把整块玻璃板甩出光路
       * （光学计算仍然正确，只有画面错位 —— 极难排查，故在此注明）。
       */
      visual.mesh.position.copy(pose.entryPlanePoint).addScaledVector(n, -plate.thicknessMm / 2);
      visual.mesh.quaternion.copy(quaternionFromBasis(uu, vv, n));

      visual.axis.position.copy(pose.entryPlanePoint);
      visual.axis.quaternion.copy(new Quaternion().setFromUnitVectors(UP, plate.rotationAxis));

      visual.mount.position
        .copy(pose.entryPlanePoint)
        .addScaledVector(plate.rotationAxis, plate.apertureMm / 2 + 7);
      visual.mount.quaternion.copy(new Quaternion().setFromUnitVectors(UP, plate.rotationAxis));
    });

    // ---- 望远镜两片透镜：只有被指定的那一片随 Z 执行器移动
    const positioned = telescopeLensesAt(train.telescope, actuators.telescopeTravelMm);
    const order = [positioned.negative, positioned.positive];
    const nominalOrder = [train.telescope.negative, train.telescope.positive];
    lensVisuals.forEach((visual, i) => {
      const lens = order[i];
      /**
       * 轴向行程的**视觉放大**。
       *
       * 真实行程只有 ±1.5 mm（焦点 Z 才有 ±0.26 mm），按等比画出来在屏幕上不到 10 px，
       * 读者会以为"Z 轴演示时镜片没动"。因此这里把"相对零位的轴向位移"放大
       * LENS_AXIAL_VISUAL_GAIN 倍绘制，并在页面上明确标注为视觉放大。
       *
       * 注意：**只放大绘制位置**，透镜在光学模型里的位置仍然由 telescopeLensesAt()
       * 按真实行程给出，因此光线、焦点 Z 与读数不受影响 —— 与仓库里 Z 焦点放大 ×6、
       * 电机指示弧放大 ×12 是同一类做法（放大必须标注，且不参与计算）。
       */
      const realDelta = lens.center.z - nominalOrder[i].center.z;
      const drawnCenter = lens.center
        .clone()
        .setZ(nominalOrder[i].center.z + realDelta * LENS_AXIAL_VISUAL_GAIN);
      visual.mesh.position.copy(drawnCenter);
      visual.rim.position.copy(drawnCenter);
      visual.carriage.position.set(
        drawnCenter.x - lens.apertureMm / 2 - 7,
        drawnCenter.y,
        drawnCenter.z,
      );
    });

    // ---- 振镜：镜片 + 电机 + 轴一起随动
    for (const visual of galvoVisuals) {
      const angle = visual.id === 'x' ? actuators.xGalvoRad : actuators.yGalvoRad;
      const rotated: MirrorSpec = { ...visual.spec, angleRad: angle };
      const normal = mirrorNormal(rotated);
      const center = mirrorCenter(rotated);
      visual.plate.position.copy(center);
      const axes = mirrorAxes(rotated);
      visual.plate.quaternion.copy(quaternionFromBasis(axes.u, axes.v, normal));
      visual.motor.position.copy(center).addScaledVector(normal, -9);
      visual.motor.quaternion.copy(new Quaternion().setFromUnitVectors(UP, normal));
      visual.shaft.position.copy(center).addScaledVector(normal, -4);
      visual.shaft.quaternion.copy(new Quaternion().setFromUnitVectors(UP, normal));
    }

    for (const motor of motors) {
      // 直线执行器：指针按等效角转，读数显示真实 mm（两者必须分开传，
      // 否则第二次调用会把真实读数覆盖成折算后的角度）。
      if (motor.rotorAngle) motor.view.update(motor.rotorAngle(actuators), motor.angle(actuators));
      else motor.view.update(motor.angle(actuators));
    }
  };

  const setHighlight = (ids: Set<string> | null): void => {
    for (const mesh of nonGlassMeshes) {
      const material = mesh.material as MeshStandardMaterial;
      const id = (mesh.userData.partId as string | undefined) ?? '';
      // 找到该 mesh 所属部件的 id（mesh 自身或最近的有 partId 的祖先）
      let owner = id;
      let cursor: import('three').Object3D | null = mesh.parent;
      while (!owner && cursor) {
        owner = (cursor.userData.partId as string | undefined) ?? '';
        cursor = cursor.parent;
      }
      const active = !ids || ids.has(owner);
      if (material.userData.baseOpacity === undefined) {
        material.userData.baseOpacity =
          typeof material.opacity === 'number' ? material.opacity : 1;
      }
      const base = material.userData.baseOpacity as number;
      const keepTransparent = base < 1;
      material.transparent = keepTransparent;
      material.opacity = active ? base : Math.max(0.1, base * 0.5);
      material.depthWrite = !keepTransparent;
    }
  };

  return {
    vendor: 'novanta',
    group,
    parts,
    update: (a, t) => {
      if (a.vendor !== 'novanta' || t.vendor !== 'novanta') return;
      update(a.actuators, t.trace);
    },
    setHighlight,
    /**
     * 显示/隐藏执行器外形。
     * 电机壳体与读数标签在特写视角下会挡住镜片/平板，因此给一个总开关；
     * 隐藏的只是**外观**，执行器数值、镜片姿态与光线完全不受影响。
     */
    setMotorsVisible: (visible: boolean) => {
      for (const motorGroup of motorGroups) motorGroup.visible = visible;
    },
    // 光学件保持原位（爆炸只对外壳与外围包络生效），与 SCANLAB 模式一致
    explode: () => {
      group.position.set(0, 0, 0);
    },
  };
}

/** 物镜：镜筒 + 内部镜组 + 出光口（结构与曲率未公开，仅示功能）。 */
function createNovantaObjective(materials: SceneMaterials): Group {
  const g = new Group();
  const top = NOVANTA_OBJECTIVE.barrelTopZ;
  const bottom = NOVANTA_OBJECTIVE.barrelBottomZ;
  const height = top - bottom;
  const r = NOVANTA_OBJECTIVE.barrelRadiusMm;

  const barrel = new Mesh(beamAlignedCylinder(r * 0.82, r, height, 40, true), materials.optic.clone());
  barrel.position.set(0, 0, (top + bottom) / 2);
  barrel.userData.partId = 'objective';
  g.add(barrel);

  for (const z of [top - height * 0.25, bottom + height * 0.2]) {
    const ring = new Mesh(new TorusGeometry(r + 0.8, 0.9, 8, 44), materials.metal.clone());
    ring.position.set(0, 0, z);
    ring.userData.partId = 'objective';
    g.add(ring);
  }

  // 入瞳参考环（"等效入瞳参考"，不等于实机入瞳平面）
  const pupilRing = new Mesh(
    new TorusGeometry(NOVANTA_OBJECTIVE.drawnPupilDiameterMm / 2, 0.9, 8, 48),
    materials.highlight.clone(),
  );
  pupilRing.position.set(0, 0, NOVANTA_AXIS.entrancePupil);
  pupilRing.userData.partId = 'objective';
  g.add(pupilRing);

  const lastLens = new Mesh(
    beamAlignedCylinder(NOVANTA_OBJECTIVE.drawnPupilDiameterMm / 2 - 1, NOVANTA_OBJECTIVE.drawnPupilDiameterMm / 2 - 1, 2.6, 40),
    materials.optic.clone(),
  );
  lastLens.position.set(0, 0, NOVANTA_OBJECTIVE.lastLensZ);
  lastLens.userData.partId = 'objective';
  g.add(lastLens);

  const nose = new Mesh(beamAlignedCylinder(r * 0.5, r * 0.4, 7, 32, true), materials.metal.clone());
  nose.position.set(0, 0, bottom - 3);
  nose.userData.partId = 'objective';
  g.add(nose);
  return g;
}

/** 保护玻璃抽屉与工艺气体喷嘴。 */
function createNovantaService(materials: SceneMaterials): {
  group: Group;
  windowMesh: Mesh;
  nozzleMesh: Mesh;
} {
  const g = new Group();

  const drawer = new Group();
  for (const [w, h, x, y] of [
    [46, 5, 0, 15],
    [46, 5, 0, -15],
    [5, 25, 20.5, 0],
    [5, 25, -20.5, 0],
  ]) {
    const rail = new Mesh(new BoxGeometry(w, h, 6), materials.frame.clone());
    rail.position.set(x, y, 0);
    rail.userData.partId = 'protective-window';
    drawer.add(rail);
  }
  drawer.position.set(0, 0, NOVANTA_AXIS.protectiveWindow);
  g.add(drawer);

  const glass = new Mesh(new BoxGeometry(25, 25, 2.4), materials.optic.clone());
  glass.position.set(0, 0, NOVANTA_AXIS.protectiveWindow);
  glass.userData.partId = 'protective-window';
  g.add(glass);

  const nozzle = new Mesh(beamAlignedCylinder(6.0, 3.8, 12, 28, true), materials.metal.clone());
  nozzle.position.set(0, 0, NOVANTA_AXIS.gasNozzle - 2);
  nozzle.userData.partId = 'gas-nozzle';
  g.add(nozzle);

  const nozzleRing = new Mesh(new TorusGeometry(5.8, 0.7, 8, 28), materials.gas.clone());
  nozzleRing.position.set(0, 0, NOVANTA_AXIS.gasNozzle + 3.5);
  nozzleRing.userData.partId = 'gas-nozzle';
  g.add(nozzleRing);

  const body = new Mesh(
    beamAlignedCylinder(
      NOVANTA_OBJECTIVE.barrelRadiusMm * 0.6,
      NOVANTA_OBJECTIVE.barrelRadiusMm * 0.6,
      26,
      30,
      true,
    ),
    materials.housing.clone(),
  );
  body.position.set(0, 0, NOVANTA_AXIS.gasNozzle + 20);
  body.userData.partId = 'gas-nozzle';
  return { group: g, windowMesh: glass, nozzleMesh: nozzle };
}
