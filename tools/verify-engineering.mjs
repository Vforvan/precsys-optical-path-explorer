import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'screenshots/engineering');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1536, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
try {
  await page.goto(pathToFileURL(join(root, 'engineering-dist/index.html')).href);
  await page.waitForFunction(() => window.__ENGINEERING__?.getReport().physicalMotors === 5);
  assert.equal(await page.evaluate(() => window.__ENGINEERING__.getReport().valid), true);
  await page.screenshot({ path: join(output, 'overview.png') });
  for (const view of ['top', 'front', 'focus']) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForFunction(view => window.__ENGINEERING__.getView() === view, view);
    await page.waitForTimeout(350);
    await page.screenshot({ path: join(output, `${view}.png`) });
  }
  for (const [signed, azimuth] of [[-7, 0], [7, 0], [-7, 90], [7, 90]]) {
    await page.locator(`[data-aoi="${signed}"]${azimuth ? '[data-azimuth="90"]' : ':not([data-azimuth])'}`).click();
    const state = await page.evaluate(() => window.__ENGINEERING__.getReport());
    assert.equal(state.valid, true); assert.ok(Math.abs(state.aoiDeg - 7) < 1e-5);
    assert.ok(Math.max(...state.output.slice(0, 3).map(Math.abs)) < 1e-5);
  }
  await page.click('[data-aoi="7"]:not([data-azimuth])');
  await page.click('[data-view="iso"]');
  await page.locator('aside').evaluate(element => { element.scrollTop = 0; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(output, 'aoi-plus7-v2.png') });
  const tiltedDownload = page.waitForEvent('download');
  await page.click('#export-glb');
  await (await tiltedDownload).saveAs(join(root, 'engineering-dist/五轴扫描头-AOI正7度姿态-V2.glb'));
  await page.click('#aoi-demo');
  await page.waitForTimeout(800);
  await page.click('#aoi-demo');
  const cone = await page.evaluate(() => window.__ENGINEERING__.getReport());
  assert.equal(cone.valid, true); assert.ok(Math.abs(cone.aoiDeg - 7) < 1e-5);
  assert.ok(Math.abs(cone.output[4]) > 0.1);
  await page.click('#reset');
  await page.evaluate(() => { const input = document.getElementById('axis-4'); input.value = '0.6'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  const moved = await page.evaluate(() => window.__ENGINEERING__.getReport());
  assert.equal(moved.valid, true); assert.ok(Math.abs(moved.output[2]) > 0.1);
  await page.click('#reset');
  await page.locator('summary').filter({ hasText: '任务坐标逆解' }).click();
  await page.fill('#target-0', '0.1');
  await page.click('#solve');
  assert.match(await page.textContent('#solve-status'), /逆解收敛/);
  assert.ok(Math.abs((await page.evaluate(() => window.__ENGINEERING__.getReport())).output[0] - 0.1) < 1e-5);
  await page.fill('#target-0', '100');
  await page.click('#solve');
  assert.match(await page.textContent('#solve-status'), /未找到行程内解/);
  await page.fill('#target-0', '0'); await page.fill('#target-3', '7'); await page.fill('#target-4', '7');
  const beforeRejected = await page.evaluate(() => window.__ENGINEERING__.getReport().q);
  await page.click('#solve');
  assert.match(await page.textContent('#solve-status'), /总 AOI.*超出 7/);
  assert.deepEqual(await page.evaluate(() => window.__ENGINEERING__.getReport().q), beforeRejected);
  await page.click('#reset');
  await page.click('#demo');
  await page.waitForTimeout(850);
  await page.click('#demo');
  const paused = await page.evaluate(() => window.__ENGINEERING__.getReport().q);
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => window.__ENGINEERING__.getReport().q), paused);
  await page.click('#reset');
  for (const layer of ['optics', 'motors', 'structure', 'platform', 'beam', 'labels']) {
    await page.locator(`[data-layer="${layer}"]`).uncheck();
    await page.locator(`[data-layer="${layer}"]`).check();
  }
  const glbEvent = page.waitForEvent('download');
  await page.click('#export-glb');
  await (await glbEvent).saveAs(join(root, 'engineering-dist/五轴扫描头-AOI7度-V2.glb'));
  const jsonEvent = page.waitForEvent('download');
  await page.click('#export-json');
  await (await jsonEvent).saveAs(join(root, 'engineering-dist/五轴扫描头-AOI7度-参数V2.json'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-view="iso"]');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  const report = { browser: 'Edge / WebGL software rendering', offline: true, errors, checks: ['初始姿态', '四种视角', '±7° X/Y', '恒定7°全方位进动', 'AOI分量组合超限拒绝', '7°姿态GLB导出', 'M5 调焦', '任务逆解', '不可达报错', '联动与暂停', '六层显示', 'GLB 导出', 'JSON 导出', '390px 无横向溢出'], nominal: await page.evaluate(() => window.__ENGINEERING__.getReport()) };
  await writeFile(join(output, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
