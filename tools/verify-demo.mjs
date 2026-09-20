import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const args = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'];
const browser = await chromium.launch({ channel: 'msedge', args });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
await mkdir('screenshots/revised', { recursive: true });
const url = pathToFileURL(resolve('dist/index.html')).href;
await page.goto(url);
await page.waitForFunction(() => window.__PRECSYS__);
await page.waitForFunction(() => document.querySelector('#geometry-card')?.textContent.includes('避让通过'));
await page.locator('#geometry-card summary').click();
await page.waitForTimeout(300);
if (!await page.locator('#geometry-card details').evaluate(el => el.open)) throw Error('Geometry details closed during refresh');
await page.evaluate(() => window.__PRECSYS__.state.setConditioning({ expanderMagnification: 40 }));
await page.waitForFunction(() => document.querySelector('#geometry-card')?.textContent.includes('几何告警'));
await page.screenshot({ path: 'screenshots/revised/geometry-warning.png' });
await page.evaluate(() => window.__PRECSYS__.state.setConditioning({ expanderMagnification: 1 }));
await page.waitForFunction(() => document.querySelector('#geometry-card')?.textContent.includes('避让通过'));
await page.locator('#geometry-card summary').click();
await page.screenshot({ path: 'screenshots/revised/overview.png' });
const report = [];
for (const id of ['percussion', 'trepann', 'spiral', 'precession-in', 'precession-out']) {
  await page.locator(`[data-preset="${id}"]`).click();
  const before = await page.evaluate(() => window.__PRECSYS__.state.snapshot().theta);
  await page.waitForTimeout(750);
  const result = await page.evaluate(() => {
    const s = window.__PRECSYS__.state.snapshot();
    // 快照里的 trace / actuators 现在按技术路线加了标签，故多一层 .trace / .actuators
    return { mode: s.mode, playing: s.playing, theta: s.theta, ok: s.trace.trace.ok,
      residual: s.residual, focus: s.trace.trace.focusPoint.toArray(), actuators: s.actuators.actuators };
  });
  if (result.mode !== 'process' || !result.playing || !result.ok || result.theta <= before) throw Error(`Preset failed: ${id}`);
  report.push({ id, ...result });
}
await page.screenshot({ path: 'screenshots/revised/process.png' });
const motorCount = await page.evaluate(() => {
  let count = 0;
  window.__PRECSYS__.chain().group.traverse(o => { if (o.userData.motorAxis) count++; });
  return count;
});
// 5 个驱动外形：4 台振镜电机（X/Y/α/β）+ 1 个 Z 三透镜直线调焦台（group.userData.motorAxis = 'Z'）。
// 注意 z-linear-stage 是**直线驱动**，不是第六台振镜电机 —— README 里"5 个模型执行轴"的说法与此一致。
if (motorCount !== 5) throw Error(`Expected 5 actuator motors, got ${motorCount}`);
await page.getByRole('button', { name: '⏸ 暂停', exact: true }).click();
const stopped = await page.evaluate(() => window.__PRECSYS__.state.theta);
const retained = await page.evaluate(() => window.__PRECSYS__.workpiece.material.stats());
if (retained.removedVoxels <= 0) throw Error('Material was not removed during playback');
await page.waitForTimeout(300);
if (Math.abs(await page.evaluate(() => window.__PRECSYS__.state.theta) - stopped) > 1e-8) throw Error('Pause failed');
const paused = await page.evaluate(() => window.__PRECSYS__.workpiece.material.stats());
if (paused.removedVoxels !== retained.removedVoxels) throw Error('Paused stock changed');
await page.getByRole('button', { name: '物镜与振镜', exact: true }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/revised/mirrors.png' });
await page.getByRole('button', { name: 'α/β 模块', exact: true }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/revised/shift.png' });
const cameraStock = await page.evaluate(() => window.__PRECSYS__.workpiece.material.stats());
if (cameraStock.removedVoxels !== retained.removedVoxels) throw Error('Camera reset stock');
await page.getByRole('button', { name: '⟲ 重置', exact: true }).click();
await page.waitForTimeout(200);
const resetStock = await page.evaluate(() => window.__PRECSYS__.workpiece.material.stats());
if (resetStock.removedVoxels !== retained.removedVoxels || resetStock.resets !== retained.resets) throw Error('Controls reset stock');
await page.locator('[data-preset="precession-out"]').click();
await page.waitForTimeout(200);
const same = await page.evaluate(() => window.__PRECSYS__.workpiece.material.stats());
if (same.resets !== retained.resets) throw Error('Same preset reset stock');
await page.locator('[data-preset="trepann"]').click();
await page.getByRole('button', { name: '⏸ 暂停', exact: true }).click();
const switched = await page.evaluate(() => window.__PRECSYS__.workpiece.material.stats());
if (switched.resets !== retained.resets + 1) throw Error('New preset did not reset stock');
// 放大累积后的真实边界，检查实际网格生成与显示。
await page.evaluate(() => {
  const api = window.__PRECSYS__;
  api.workpiece.sweep(api.state.process, 0, Math.PI*2*8);
  api.workpiece.refreshMesh();
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/revised/material-removal.png' });
const beforeSection = await page.evaluate(() => window.__PRECSYS__.workpiece.material.stats());
await page.getByRole('button', { name: '剖切观察', exact: true }).click();
await page.waitForTimeout(300);
const afterSection = await page.evaluate(() => window.__PRECSYS__.workpiece.material.stats());
if (beforeSection.removedVoxels !== afterSection.removedVoxels || beforeSection.resets !== afterSection.resets) throw Error('Section view reset stock');
await page.screenshot({ path: 'screenshots/revised/material-section.png' });
await page.locator('#controlbar summary').click();
await page.getByText('爆炸视图', { exact: true }).click();
await page.waitForTimeout(400);
const aligned = await page.evaluate(() => {
  const g = window.__PRECSYS__.groups;
  return g.optics.position.distanceTo(g.beam.position) < 1e-8;
});
if (!aligned) throw Error('Exploded optical train out of alignment');
const layouts = [];
for (const [width, height] of [[1366, 768], [390, 844]]) {
  await page.setViewportSize({ width, height });
  await page.goto(url);
  await page.waitForFunction(() => window.__PRECSYS__);
  await page.locator('[data-preset="precession-out"]').click();
  await page.waitForTimeout(400);
  const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - innerWidth,
    viewport: document.querySelector('#viewport').getBoundingClientRect().height,
    preset: document.querySelectorAll('[data-preset]').length }));
  if (layout.overflow > 1 || layout.viewport < 200) throw Error(`Layout: ${JSON.stringify(layout)}`);
  layouts.push({ width, height, ...layout });
  await page.screenshot({ path: `screenshots/revised/layout-${width}.png`, fullPage: true });
}
await writeFile('screenshots/revised/report.json', JSON.stringify({ report, layouts, motorCount, retained, paused, resetStock, switched, errors }, null, 2));
await browser.close();
console.log(JSON.stringify({ presets: report.length, layouts, errors }, null, 2));
if (errors.length) process.exitCode = 1;
