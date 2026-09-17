/**
 * 部件特写截图：直接设置相机位置与注视点（不依赖应用内预设），
 * 用于检查镜片是否看得清、光线与镜面的关系是否正确。
 * 用法：node tools/closeups.mjs [部位...]
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

/** [名称, 相机位置, 注视点] */
const shots = [
  ['cu-alpha', [-30, -150, 560], [-30, -36, 486]],
  ['cu-alpha-side', [-120, -110, 500], [-30, -36, 486]],
  ['cu-beta', [30, -110, 420], [-16, -30, 344]],
  ['cu-z', [-60, -90, 300], [-6, 0, 230]],
  ['cu-galvo', [-70, -70, 200], [-6, 0, 150]],
  // 正视图（沿 +Y 看）：45° 折叠镜在正视图里应呈现为标准 45° 斜线，
  // 竖直入射与水平出射应关于镜面对称 —— 用来检查"光线与镜面的垂直关系"。
  ['cu-front-galvo', [0, -230, 150], [0, 0, 150]],
  ['cu-front-alpha', [-36, -230, 486], [-36, -30, 486]],
  ['cu-front-z', [-6, -220, 232], [-6, 0, 232]],
  ['cu-focus', [60, -120, 130], [0, 0, 40]],
];

const only = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2200);

for (const [name, eye, look] of shots) {
  if (only.length && !only.includes(name)) continue;
  await page.evaluate(
    ([e, l]) => {
      const view = window.__PRECSYS__.sceneView;
      view.camera.position.set(e[0], e[1], e[2]);
      view.controls.target.set(l[0], l[1], l[2]);
      view.controls.update();
    },
    [eye, look],
  );
  await page.waitForTimeout(1300);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('已截图', name);
}

await browser.close();
server.close();
