/**
 * 单文件构建：先按 IIFE 方式构建，再把 JS / CSS 内联进 dist/index.html。
 *
 * 为什么要这么做：浏览器对 file:// 页面里的**外链**脚本与带 crossorigin 的样式表
 * 一律按 CORS 拒绝（origin 为 null），所以普通 Vite 产物双击打开时三维部分根本不会启动。
 * 内联成经典脚本后，双击 dist/index.html 即可离线运行，不需要任何服务器。
 *
 * 用法：node tools/build-standalone.mjs   （npm run build 默认走这条路）
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink, stat, mkdir, cp, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(root, 'dist');
const indexFile = join(distDir, 'index.html');
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

/** GitHub Pages 的发布源目录（仓库 Settings → Pages → main / docs）。 */
const pagesDir = join(root, 'docs');

function runVite() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [viteBin, 'build'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PRECSYS_BUILD: 'standalone' },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`vite build 退出码 ${code}`))));
  });
}

/**
 * 把 HTML 里引用的本地 js/css 内联进来，并删掉不再需要的外链文件。
 *
 * 两个坑必须避开：
 *   1. String.replace 的**字符串替换**会解释 `$&`、`$'` 之类的模式，
 *      而打包后的 JS 里这类字符很常见 → 必须用函数式替换；
 *   2. 内联脚本里若含 "</script>" 会提前结束标签 → 需要转义。
 */
async function inline() {
  let html = await readFile(indexFile, 'utf8');
  const consumed = [];
  let inlinedJs = 0;
  let inlinedCss = 0;

  // 1) 内联样式表
  for (const tag of html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/g) ?? []) {
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (!href || /^(https?:|data:)/.test(href)) continue;
    const file = join(distDir, href.replace(/^\.\//, ''));
    try {
      const css = (await readFile(file, 'utf8')).replace(/<\/style>/gi, '<\\/style>');
      html = html.replace(tag, () => `<style>\n${css}\n</style>`);
      consumed.push(file);
      inlinedCss += 1;
    } catch {
      console.warn(`跳过无法读取的样式：${href}`);
    }
  }

  // 2) 取出入口脚本内容（先把它从原位置删掉，最后统一放到 </body> 前）
  //    注意：内联脚本是"经典脚本"，没有 type="module" 的延迟执行语义，
  //    若留在 <head> 会在 <body> 解析之前执行，导致找不到 #viewport。
  for (const tag of html.match(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g) ?? []) {
    const src = /src="([^"]+)"/.exec(tag)?.[1];
    if (!src || /^https?:/.test(src)) continue;
    const file = join(distDir, src.replace(/^\.\//, ''));
    try {
      const js = (await readFile(file, 'utf8')).replace(/<\/script>/gi, '<\\/script>');
      html = html.replace(tag, () => '');
      consumed.push(file);
      inlinedJs += 1;
      // 追加到 </body> 之前
      const inlineTag = `<script>\n${js}\n</script>\n`;
      html = html.includes('</body>')
        ? html.replace('</body>', () => `${inlineTag}</body>`)
        : `${html}\n${inlineTag}`;
    } catch {
      console.warn(`跳过无法读取的脚本：${src}`);
    }
  }

  // 3) 移除 modulepreload 之类的悬空引用
  html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, '');

  await writeFile(indexFile, html, 'utf8');
  for (const file of consumed) {
    await unlink(file).catch(() => undefined);
  }
  await unlink(join(distDir, 'assets')).catch(() => undefined);

  const { size } = await stat(indexFile);
  console.log(
    `\n单文件构建完成：dist/index.html（${(size / 1024).toFixed(0)} KB，内联 ${inlinedJs} 个脚本 / ${inlinedCss} 个样式表）`,
  );
  console.log('双击 dist/index.html 即可离线运行，无需本地服务器。');
  void relative;
}

/**
 * 把 dist/ 的产物同步到 docs/ —— 后者是纳入版本管理的发布目录，
 * GitHub Pages 直接从 main 分支的 /docs 提供线上页面。
 *
 * 三个要点：
 *   1. 先清空再复制，避免删掉的文件残留在发布目录里；
 *      **正因为清空**，工程候选页必须在这里一并复制（见下），
 *      否则每次 npm run build 都会把它从 docs/ 里删掉，线上变 404；
 *   2. 写入 .nojekyll：GitHub Pages 默认用 Jekyll 处理，而 Jekyll 会忽略
 *      下划线开头的文件；放这个空文件等于告诉它"原样发布，别预处理"；
 *   3. 工程候选页放在 docs/engineering/ —— Pages 的发布源是分支目录，
 *      不在 docs/ 下的文件即使 push 了也没有在线地址。
 */
const engineeringDir = join(root, 'engineering-dist');
const engineeringPage = join(pagesDir, 'engineering', 'index.html');

async function publish() {
  await rm(pagesDir, { recursive: true, force: true });
  await mkdir(pagesDir, { recursive: true });
  await cp(distDir, pagesDir, { recursive: true });
  await writeFile(join(pagesDir, '.nojekyll'), '', 'utf8');

  const { size } = await stat(join(pagesDir, 'index.html'));
  console.log(`发布目录已同步：docs/index.html（${(size / 1024).toFixed(0)} KB）`);

  // 工程候选页同样发布到线上。**只复制 index.html**：
  // 它是自包含的单文件（JS/CSS 已内联，也不加载 .glb —— 模型是页面导出的），
  // 所以网页演示不需要那 4 MB 的 GLB/参数文件，不必让线上多背一份。
  try {
    await mkdir(dirname(engineeringPage), { recursive: true });
    await cp(join(engineeringDir, 'index.html'), engineeringPage);
    const eng = await stat(engineeringPage);
    console.log(`发布目录已同步：docs/engineering/index.html（${(eng.size / 1024).toFixed(0)} KB）`);
  } catch {
    // 工程候选还没构建过（engineering-dist/index.html 不存在）不是错误：
    // 只跑 npm run build 时允许它缺席，线上保留上一次发布的版本。
    console.warn('跳过工程候选页：engineering-dist/index.html 不存在，'
      + '如需发布请先运行 npm run build:engineering');
  }

  console.log('提交并推送 docs/ 后，GitHub Pages 会自动更新线上页面。');
}

await runVite();
await inline();
await publish();
