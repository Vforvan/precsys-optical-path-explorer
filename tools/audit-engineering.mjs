import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = await createServer({ configFile: false, root, server: { middlewareMode: true } });
try {
  const { evaluate, controllability, LIMITS, inverse, opticsAt } = await server.ssrLoadModule('/src/engineering/model.ts');
  const { buildAssembly, mechanicalObstructions } = await server.ssrLoadModule('/src/engineering/assembly.ts');
  const report = { model: '五轴工程候选 V1', inputUnits: ['deg', 'deg', 'deg', 'deg', 'mm'], limits: LIMITS, wavelength: '未指定', beam: '入口双环半径 0.75 / 1.5 mm；32 条采样光线 + 主光线；非高斯连续包络证明', opticalApproximation: '3D reflection + paraxial thin lenses; lens thickness excluded from optical refraction', samples: 0, minApertureMarginMm: Infinity, maxNormalizedConditionInfinity: 0, maxGeometricRmsMm: 0, outputSampleExtents: Array.from({ length: 5 }, () => [Infinity, -Infinity]), failures: [], trajectorySamples: 0 };
  const inspect = q => {
    const result = evaluate(q);
    const assembly = buildAssembly(q);
    const blocked = mechanicalObstructions(assembly, result);
    const capability = controllability(q);
    report.samples++;
    report.minApertureMarginMm = Math.min(report.minApertureMarginMm, result.apertureMargin);
    report.maxNormalizedConditionInfinity = Math.max(report.maxNormalizedConditionInfinity, capability.condition);
    report.maxGeometricRmsMm = Math.max(report.maxGeometricRmsMm, result.rms);
    result.output?.forEach((n, i) => { report.outputSampleExtents[i][0] = Math.min(report.outputSampleExtents[i][0], n); report.outputSampleExtents[i][1] = Math.max(report.outputSampleExtents[i][1], n); });
    if (blocked.length || result.errors.length || capability.rank !== 5) report.failures.push({ q, blocked, errors: result.errors, capability });
    assembly.root.traverse(object => object.geometry?.dispose());
  };
  for (let index = 0; index < 243; index++) {
    let code = index;
    const q = [0.3, 0.3, 0.3, 0.3, 0.8].map(limit => { const value = (code % 3 - 1) * limit; code = Math.floor(code / 3); return value; });
    inspect(q);
  }
  for (let i = 0; i <= 80; i++) {
    const t = i * 0.25;
    inspect([0.08 * Math.sin(t), 0.08 * Math.cos(t), -0.06 * Math.sin(t), 0.06 * Math.cos(t), 0.35 * Math.sin(t * 0.6)]);
    report.trajectorySamples++;
  }
  report.nominal = evaluate([0, 0, 0, 0, 0]).output;
  report.model = '五轴工程候选 V2 — 原有小行程回归';
  report.sampledMotorHalfRanges = [0.3, 0.3, 0.3, 0.3, 0.8];
  report.independentTargets = [[0.1, 0, 0, 0, 0], [0, 0.1, 0, 0, 0], [0, 0, 0.1, 0, 0], [0, 0, 0, 0.1, 0], [0, 0, 0, 0, 0.1]].map(target => ({ target, ...inverse(target) }));
  report.optics = opticsAt([0, 0, 0, 0, 0]);
  report.boundaries = ['离散采样不能证明连续工作域', '输出包络不是可任意组合的任务空间', '没有完成全机械碰撞、厚透镜像差、伺服动态和样机验证'];
  await mkdir(join(root, 'engineering-dist'), { recursive: true });
  await writeFile(join(root, 'engineering-dist/validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ samples: report.samples, failures: report.failures, independentTargets: report.independentTargets, minApertureMarginMm: report.minApertureMarginMm, maxNormalizedConditionInfinity: report.maxNormalizedConditionInfinity, maxGeometricRmsMm: report.maxGeometricRmsMm, outputSampleExtents: report.outputSampleExtents }, null, 2));
  if (report.failures.length || report.independentTargets.some(item => !item.ok)) process.exitCode = 1;
} finally {
  await server.close();
}
