/**
 * 页面自检与截图（可选工具，不参与构建产物）。
 *
 * 用途：
 *   1. 启动一个临时静态服务器指向 dist/；
 *   2. 用 Playwright Chromium 打开页面，收集 console 错误与未捕获异常；
 *   3. 逐个切换一级模式并截图，同时读取 window.__PRECSYS__ 的关键数值，
 *      确认"命令 → 执行轴 → 追迹"这条链路在浏览器里真的跑起来了。
 *
 * 用法：node tools/screenshot.mjs [输出目录]
 * 前置：npm run build && npx playwright install chromium
 */

import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, 'dist');
const outDir = process.argv[2] ? process.argv[2] : join(root, 'screenshots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};

if (!existsSync(distDir)) {
  console.error('未找到 dist/，请先运行 npm run build');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    const file = join(distDir, rel === '' ? 'index.html' : rel);
    if (!file.startsWith(distDir)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

await mkdir(outDir, { recursive: true });

const browserArgs = [
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--ignore-gpu-blocklist',
];

/**
 * 优先用 Playwright 自带的 Chromium；未下载时回退到系统已安装的 Edge / Chrome，
 * 避免为了截图必须下载上百 MB 的浏览器二进制。
 */
async function launchBrowser() {
  const attempts = [
    { name: 'chromium', options: { args: browserArgs } },
    { name: 'msedge', options: { channel: 'msedge', args: browserArgs } },
    { name: 'chrome', options: { channel: 'chrome', args: browserArgs } },
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const instance = await chromium.launch(attempt.options);
      console.log(`使用浏览器：${attempt.name}`);
      return instance;
    } catch (error) {
      errors.push(`${attempt.name}: ${error.message.split('\n')[0]}`);
    }
  }
  throw new Error(`无法启动任何浏览器：\n${errors.join('\n')}`);
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });

const problems = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    problems.push(`[console.${msg.type()}] ${msg.text()}`);
  }
});
page.on('pageerror', (error) => problems.push(`[pageerror] ${error.message}`));

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2500);

const alive = await page.evaluate(() => {
  const api = window.__PRECSYS__;
  if (!api) return { ok: false };
  const snapshot = api.state.snapshot();
  return {
    ok: true,
    focus: [snapshot.trace.focus.xMm, snapshot.trace.focus.yMm, snapshot.trace.focus.zMm],
    aoi: [snapshot.trace.focus.aoiXDeg, snapshot.trace.focus.aoiYDeg],
    actuators: {
      x: (snapshot.actuators.xRad * 180) / Math.PI,
      y: (snapshot.actuators.yRad * 180) / Math.PI,
      z: snapshot.actuators.zTravelMm,
      a: (snapshot.actuators.alphaRad * 180) / Math.PI,
      b: (snapshot.actuators.betaRad * 180) / Math.PI,
    },
    coneFullAngleRad: snapshot.trace.focus.coneHalfAngleRad * 2,
    segments: snapshot.trace.segments.length,
    fps: api.state.fps,
  };
});

console.log('页面状态：', JSON.stringify(alive, null, 2));

const modes = [
  ['overview', '整机总览'],
  ['axes', '五轴拆解'],
  ['linked', '硬件联动'],
  ['process', '加工演示'],
  ['calibration', '校准与监控'],
  ['evidence', '结构依据'],
];

for (const [mode, label] of modes) {
  await page.click(`#mode-tabs button:has-text("${label}")`);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(outDir, `${mode}.png`) });
}

// 命中测试：设定一个非零工况，确认读数与追迹同步变化
const crosstalk = await page.evaluate(() => {
  const api = window.__PRECSYS__;
  api.state.setToggles({ compensation: false });
  api.state.setCommand({ xMm: 1.25, yMm: -1.25, zMm: 0.6, alphaDeg: 5, betaDeg: -5 });
  const naive = api.state.snapshot();
  api.state.setToggles({ compensation: true });
  const compensated = api.state.snapshot();
  return {
    naive: [naive.trace.focus.aoiXDeg, naive.trace.focus.aoiYDeg],
    compensated: [compensated.trace.focus.aoiXDeg, compensated.trace.focus.aoiYDeg],
    residual: [
      compensated.residual.xMm,
      compensated.residual.alphaDeg,
      compensated.residual.betaDeg,
    ],
    iterations: compensated.inverse.iterations,
  };
});
console.log('补偿对比：', JSON.stringify(crosstalk, null, 2));

await page.screenshot({ path: join(outDir, 'linked-compensated.png') });

await page.evaluate(() => window.__PRECSYS__?.state.setToggles({ compensation: false }));
await page.waitForTimeout(600);
await page.screenshot({ path: join(outDir, 'linked-uncompensated.png') });

// 引导流程一步
await page.evaluate(() => window.__PRECSYS__?.state.setToggles({ compensation: true }));
await page.keyboard.press('n');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(outDir, 'tour-step1.png') });

// 易用性验收（计划书 §18.3）：1366×768 与 390×844 两种分辨率下检查关键控件可见、无横向溢出
const layoutChecks = [];
for (const [w, h] of [
  [1366, 768],
  [390, 844],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const check = await page.evaluate(() => {
    const visible = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight;
    };
    return {
      playButton: visible('#controlbar button'),
      modeTabs: document.querySelectorAll('#mode-tabs button').length,
      xSlider: visible('#controlbar input[type="range"]'),
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      viewportHeight: document.querySelector('#viewport')?.getBoundingClientRect().height ?? 0,
    };
  });
  layoutChecks.push({ size: `${w}x${h}`, ...check });
  await page.screenshot({ path: join(outDir, `layout-${w}x${h}.png`) });
}
console.log('布局检查：', JSON.stringify(layoutChecks, null, 2));
await page.setViewportSize({ width: 1600, height: 950 });

const report = {
  alive,
  crosstalk,
  problems,
  layoutChecks,
  screenshots: [
    ...modes.map(([m]) => `${m}.png`),
    'linked-compensated.png',
    'linked-uncompensated.png',
    'tour-step1.png',
  ],
};
await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

console.log(`\n截图已写入：${outDir}`);
if (problems.length) {
  console.log(`\n发现 ${problems.length} 条 console 错误/警告：`);
  for (const p of problems.slice(0, 20)) console.log('  ' + p);
} else {
  console.log('没有 console 错误或未捕获异常。');
}

await browser.close();
server.close();
process.exit(problems.some((p) => p.startsWith('[pageerror]')) ? 2 : 0);
