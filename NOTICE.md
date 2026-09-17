# 第三方组件与商标声明

本文件补充说明本项目的第三方依赖与商标归属。**软件本身的许可条款见 [LICENSE](LICENSE)（MIT）。**
之所以单独放一个文件：GitHub 的许可证识别要求 `LICENSE` 里只有标准的 MIT 正文，
附加声明混在里面会让识别结果变成 "Other" 而不是 "MIT"。

## 第三方组件

| 组件 | 许可证 | 说明 |
|---|---|---|
| [three.js](https://threejs.org/) | MIT | 三维渲染引擎，Copyright © 2010-2024 three.js authors |
| [Vite](https://vitejs.dev/) | MIT | 构建工具 |
| [Vitest](https://vitest.dev/) | MIT | 单元测试框架 |
| [TypeScript](https://www.typescriptlang.org/) | Apache-2.0 | 类型系统与编译器 |
| [Playwright](https://playwright.dev/) | Apache-2.0 | 仅用于本地自检与截图工具 |

`three` 会被打包进构建产物 `dist/index.html`，其许可证文本见 `node_modules/three/LICENSE`。
其余均为开发期依赖，不进入发布产物。

## 商标声明

**precSYS**、**SCANLAB** 为其各自权利人的商标。本项目与上述公司**无隶属关系，也未获其背书**。
项目名称中出现 `precsys` 仅用于说明所解读的技术对象。

## 资料来源与免责

本项目的几何与数值建立在**公开资料**之上：官方产品手册的公开规格、公开专利
（EP3932609B1）的功能结构描述，以及公开应用文章。仓库内**不包含任何原始 PDF 全文**，
仅标注来源与页码，详见 [`public/references/README.md`](public/references/README.md)。

模型为面向教学的**等效近似**，不等同于整束光截光、衍射、热效应或材料烧蚀仿真，
不得作为真实加工参数、安全边界或设备验收依据。详见 [README](README.md) 中的口径说明。
