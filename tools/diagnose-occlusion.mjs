/**
 * 排查"画面里有一块黑墙/被截断"的问题：
 *   1. 拍默认进入时的视角（用户首屏看到的就是这个）；
 *   2. 逐个隐藏分组（外壳 / 外部系统 / 工件 / 光束 / 标签），各拍一张；
 *   3. 直接从相机向机器中心投射光线，报告"第一命中物"——它就是遮挡物。
 *
 * 用法：node tools/diagnose-occlusion.mjs
 */

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, 'dist');
const outDir = join(root, 'screenshots');
await mkdir(outDir, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    const file = join(distDir, rel === '' ? 'index.html' : rel);
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': extname(file) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const args = ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
async function launch() {
  for (const options of [{ args }, { channel: 'msedge', args }, { channel: 'chrome', args }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* next */
    }
  }
  throw new Error('no browser');
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// 1) 默认首屏
await page.screenshot({ path: join(outDir, 'diag-default.png') });

// 2) 逐个隐藏分组
for (const key of ['housing', 'workpiece', 'beam', 'labels', 'axes', 'optics']) {
  await page.evaluate((k) => {
    const g = window.__PRECSYS__.groups[k];
    g.visible = false;
  }, key);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `diag-hide-${key}.png`) });
}
// 全部恢复
await page.evaluate(() => {
  for (const g of Object.values(window.__PRECSYS__.groups)) g.visible = true;
});

// 3) 相机 → 机器中心 的射线，报告第一命中物
const hits = await page.evaluate(() => {
  const api = window.__PRECSYS__;
  const scene = api.sceneView.scene;
  const camera = api.sceneView.camera;
  // 用场景自带的 Raycaster（通过 three 的模块实例不可得，这里用几何近似：
  // 直接列出相机与目标之间、包围盒跨越视线的对象）
  const targets = [
    ['optics', api.groups.optics],
    ['housing', api.groups.housing],
    ['workpiece', api.groups.workpiece],
  ];
  const report = [];
  const camPos = camera.position.clone();
  for (const [name, group] of targets) {
    let count = 0;
    let near = Number.POSITIVE_INFINITY;
    group.traverse((child) => {
      if (!child.isMesh) return;
      count += 1;
      if (!child.geometry.boundingSphere) child.geometry.computeBoundingSphere();
      const center = child.getWorldPosition(new child.position.constructor());
      const d = center.distanceTo(camPos);
      if (d < near) near = d;
    });
    report.push({ name, meshes: count, nearestMeshDistance: Number(near.toFixed(1)) });
  }
  return {
    cameraPosition: [camPos.x, camPos.y, camPos.z].map((v) => Number(v.toFixed(1))),
    report,
  };
});
console.log(JSON.stringify(hits, null, 2));

await browser.close();
server.close();
