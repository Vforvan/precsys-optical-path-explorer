import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = await createServer({ configFile: false, root, server: { middlewareMode: true } });
try {
  const m = await server.ssrLoadModule('/src/engineering/model.ts');
  const a = await server.ssrLoadModule('/src/engineering/assembly.ts');
  const fields = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [1.25 * Math.cos(i * Math.PI / 4), 1.25 * Math.sin(i * Math.PI / 4)])];
  const report = {
    version: 'V2 AOI ±7°', design: m.OPTICAL_DESIGN, motorHalfRanges: m.LIMITS,
    domain: { xyDiameterMm: 2.5, zMm: [-0.4, 0, 0.4], aoiDeg: [0, 3.5, 7], azimuthStepAt7Deg: 5, azimuthStepAt3p5Deg: 15, fieldPoints: fields, raySamples: '32 ring rays + 1 chief' },
    samples: 0, failures: [], minApertureMarginMm: Infinity, worstMarginTarget: null, maxNormalizedConditionInfinity: 0,
    maxMotorAbs: [0, 0, 0, 0, 0], maxPositionResidualMm: 0, maxAngleResidualDeg: 0, maxAoiErrorDeg: 0,
    boundaries: ['离散任务空间采样，不构成连续工作域证明', '薄透镜近轴模型，没有真实光学处方或实测AOI认证', '扩大电机行程不代表其笛卡尔积全部可用', '没有认证650Hz动态性能、实际焦斑或厂商光谱指标'],
  };
  for (const z of report.domain.zMm) for (const [x, y] of fields) for (const aoi of report.domain.aoiDeg) {
    const step = aoi === 7 ? 5 : aoi === 3.5 ? 15 : 360;
    for (let azimuth = 0; azimuth < 360; azimuth += step) {
      const target = m.aoiTarget(aoi, azimuth, [x, y, z]);
      const solution = m.inverse(target);
      const result = m.evaluate(solution.q);
      const assembly = a.buildAssembly(solution.q);
      const blocked = a.mechanicalObstructions(assembly, result);
      const capability = m.controllability(solution.q);
      const actualAoi = m.aoiFromDirection(result.chief.direction);
      report.samples++;
      const positionError = result.output ? Math.max(...result.output.slice(0, 3).map((n, i) => Math.abs(n - target[i]))) : Infinity;
      const angleError = result.output ? Math.max(...result.output.slice(3).map((n, i) => Math.abs(n - target[i + 3]))) : Infinity;
      report.maxPositionResidualMm = Math.max(report.maxPositionResidualMm, positionError);
      report.maxAngleResidualDeg = Math.max(report.maxAngleResidualDeg, angleError);
      report.maxAoiErrorDeg = Math.max(report.maxAoiErrorDeg, Math.abs(actualAoi - aoi));
      if (result.apertureMargin < report.minApertureMarginMm) { report.minApertureMarginMm = result.apertureMargin; report.worstMarginTarget = target; }
      report.maxNormalizedConditionInfinity = Math.max(report.maxNormalizedConditionInfinity, capability.condition);
      solution.q.forEach((n, i) => { report.maxMotorAbs[i] = Math.max(report.maxMotorAbs[i], Math.abs(n)); });
      if (!solution.ok || blocked.length || result.errors.length || capability.rank !== 5 || positionError > 1e-5 || angleError > 1e-5 || Math.abs(actualAoi - aoi) > 1e-5) report.failures.push({ target, solution, blocked, errors: result.errors, capability });
      assembly.root.traverse(object => { object.geometry?.dispose(); if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); });
      if (report.samples % 300 === 0) console.log(`AOI 验证 ${report.samples} 个姿态；失败 ${report.failures.length}`);
    }
  }
  report.axisHeadroom = report.maxMotorAbs.map((n, i) => m.LIMITS[i] - n);
  await mkdir(join(root, 'engineering-dist'), { recursive: true });
  await writeFile(join(root, 'engineering-dist/aoi-validation-v2.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
} finally { await server.close(); }
