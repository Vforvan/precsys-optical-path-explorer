/**
 * 一次性修补脚本：把"应与光轴同轴"的圆柱换成 beamAlignedCylinder（轴向 Z）。
 *
 * 背景：three.js 的 CylinderGeometry 默认轴沿 Y，本项目光轴是 Z，
 * 早期这些零件全部横躺 90°，看起来"镜片没和光路垂直"。
 * 这里逐个替换调用点（用唯一上下文匹配，找不到就报错，避免误改）。
 *
 * 用法：node tools/fix-cylinder-orientation.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sceneDir = join(root, 'src', 'scene');

/** [文件, 原字符串, 新字符串] —— 每个必须在文件中恰好出现一次 */
const replacements = [
  // ---------- create-optics.ts ----------
  [
    'create-optics.ts',
    "import { OBJECTIVE, AXIS, BEAM_PATH, GALVO, SHIFT_MODULE } from '../config/layout';",
    "import { OBJECTIVE, AXIS, BEAM_PATH, GALVO, SHIFT_MODULE } from '../config/layout';\nimport { beamAlignedCylinder } from './geometry-helpers';",
  ],
  // 物镜机械加强环
  [
    'create-optics.ts',
    'const ring = new Mesh(new CylinderGeometry(radius, radius, thickness, 40), materials.metal);',
    'const ring = new Mesh(beamAlignedCylinder(radius, radius, thickness, 40), materials.metal);',
  ],
  // 物镜镜筒分段
  [
    'create-optics.ts',
    '      new CylinderGeometry(rTop, rBottom, len, 40, 1, true),',
    '      beamAlignedCylinder(rTop, rBottom, len, 40, 1, true),',
  ],
  // 物镜内部扩束镜
  [
    'create-optics.ts',
    'new CylinderGeometry(OBJECTIVE.internalBeamRadiusMm * 0.95, OBJECTIVE.internalBeamRadiusMm * 0.95, 1.8, 28),',
    'beamAlignedCylinder(OBJECTIVE.internalBeamRadiusMm * 0.95, OBJECTIVE.internalBeamRadiusMm * 0.95, 1.8, 28),',
  ],
  // 物镜后透镜
  [
    'create-optics.ts',
    'new CylinderGeometry(OBJECTIVE.internalLensRadiusMm, OBJECTIVE.internalLensRadiusMm, 2.6, 40),',
    'beamAlignedCylinder(OBJECTIVE.internalLensRadiusMm, OBJECTIVE.internalLensRadiusMm, 2.6, 40),',
  ],
  // 物镜出光口
  [
    'create-optics.ts',
    `    new CylinderGeometry(
      OBJECTIVE.barrelBottomRadiusMm * 0.55,
      OBJECTIVE.barrelBottomRadiusMm * 0.42,
      7,
      32,
      1,
      true,
    ),`,
    `    beamAlignedCylinder(
      OBJECTIVE.barrelBottomRadiusMm * 0.55,
      OBJECTIVE.barrelBottomRadiusMm * 0.42,
      7,
      32,
      true,
    ),`,
  ],
  // 光束调理：波片 / 扩束镜 / 发散度调整 圆片
  [
    'create-optics.ts',
    'const disc = new Mesh(new CylinderGeometry(radius, radius, thickness, 32), material);',
    'const disc = new Mesh(beamAlignedCylinder(radius, radius, thickness, 32), material);',
  ],
  // 激光入口套筒
  [
    'create-optics.ts',
    'new CylinderGeometry(6.5, 6.5, 16, 28, 1, true)',
    'beamAlignedCylinder(6.5, 6.5, 16, 28, true)',
  ],
  // 光束调理外壳
  [
    'create-optics.ts',
    'new CylinderGeometry(14, 14, 130, 30, 1, true)',
    'beamAlignedCylinder(14, 14, 130, 30, true)',
  ],
  // 工艺气体喷嘴本体
  [
    'create-optics.ts',
    'new CylinderGeometry(6.2, 4.0, 13, 28, 1, true),',
    'beamAlignedCylinder(6.2, 4.0, 13, 28, true),',
  ],

  // ---------- create-workpiece.ts ----------
  [
    'create-workpiece.ts',
    "import { AXIS, WORKPIECE } from '../config/layout';",
    "import { AXIS, WORKPIECE } from '../config/layout';\nimport { beamAlignedCylinder } from './geometry-helpers';",
  ],
  [
    'create-workpiece.ts',
    'const hole = new Mesh(new CylinderGeometry(1, 1, 1, 40, 1, true), holeMaterial);',
    'const hole = new Mesh(beamAlignedCylinder(1, 1, 1, 40, true), holeMaterial);',
  ],
  [
    'create-workpiece.ts',
    'hole.geometry = new CylinderGeometry(top, bottom, depth, 40, 1, true);',
    'hole.geometry = beamAlignedCylinder(top, bottom, depth, 40, true);',
  ],
];

let failed = false;
for (const [file, from, to] of replacements) {
  const path = join(sceneDir, file);
  const source = readFileSync(path, 'utf8');
  const occurrences = source.split(from).length - 1;
  if (occurrences !== 1) {
    console.error(`✗ ${file}: 匹配到 ${occurrences} 处（应为 1 处）\n    ${from.slice(0, 80)}`);
    failed = true;
    continue;
  }
  writeFileSync(path, source.replace(from, to), 'utf8');
  console.log(`✓ ${file}: ${from.slice(0, 60).replace(/\s+/g, ' ')}…`);
}

if (failed) {
  console.error('\n有替换未按预期匹配，已中止（未写入的部分保持原样）。');
  process.exit(1);
}
console.log('\n全部替换完成。');
