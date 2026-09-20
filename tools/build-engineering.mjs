import { build } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const result = await build({
  configFile: false,
  root,
  build: {
    write: false,
    target: 'es2022',
    lib: { entry: join(root, 'src/engineering/main.ts'), name: 'EngineeringModel', formats: ['iife'] },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const output = Array.isArray(result) ? result[0].output : result.output;
const js = output.find(item => item.type === 'chunk').code.replace(/<\/script/gi, '<\\/script');
const css = await readFile(join(root, 'src/engineering/style.css'), 'utf8');
let html = await readFile(join(root, 'engineering.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./src/engineering/style.css" />', () => `<style>${css}</style>`);
html = html.replace('<script type="module" src="./src/engineering/main.ts"></script>', () => `<script>${js}</script>`);
await mkdir(join(root, 'engineering-dist'), { recursive: true });
await writeFile(join(root, 'engineering-dist/index.html'), html, 'utf8');
console.log('工程结构单文件已生成：engineering-dist/index.html');
