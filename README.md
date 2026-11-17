# 铁证 IRONPROOF

[![CI](https://github.com/nuts-and-bytes/tiezheng/actions/workflows/ci.yml/badge.svg)](https://github.com/nuts-and-bytes/tiezheng/actions/workflows/ci.yml)

> 你练过的，都有铁证。

面向健身爱好者的本地优先 PWA，覆盖训练记录、日历、体重与训练趋势、营养记录、照片和训练海报。核心记录保存于浏览器 IndexedDB，支持导出与恢复；可选 AI 功能有独立的联网与权限边界。

**在线体验**：<https://tiezheng.pages.dev>（手机 Safari 打开 → 分享 → 添加到主屏幕，体验最佳）

## 从页面进入

| 页面 | 当前代码中的能力 |
| --- | --- |
| 今日 | 训练概览、连续记录与营养摘要，进入记录流程 |
| 日历 | 按月份与日期回看训练、照片与当天详情 |
| 数据 | 训练节奏、动作与重量趋势 |
| 我的 | 个人资料、个人纪录、数据导出与恢复 |
| 健康 | 饮食记录、食品选择与摄入汇总；自动营养目标及 AI 估算受独立开关控制 |
| 海报 | 根据月度或年度训练记录生成、预览并保存训练海报 |

底部导航实际名称是“今日 / 日历 / 数据 / 我的”；健康、海报和记录流程由应用中的相关入口进入，不是新增的底部页签。

## 数据与 AI 边界

核心记录以浏览器 IndexedDB 为主，不自动跨设备同步；清理站点数据前应先备份。

`src/lib/nutritionFeatureFlags.ts` 分别读取自动营养目标、照片 AI 和文字 AI 的构建开关，只有值为 `true` 才启用。代码存在不等于线上已对所有人开放。文字和照片 AI 还依赖各自的网关、认证、账号与预算；估算结果需要用户核对后确认保存。手动记录、模型估算和正式入账应分别理解。

训练海报在本地绘制和导出。可选模型估算涉及外部服务，不能将整个应用概括为“所有数据永远不离开设备”。

## 技术栈

Vite 6 · React 19 · TypeScript (strict) · Tailwind CSS 4 · Zustand 5 · Dexie 4 (IndexedDB) · Chart.js 4 · vite-plugin-pwa · Vitest · Node.js test runner

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # 全量门禁（Vitest + 文字 AI Node 控制套件）
npm run test:watch -- --run <test-file>  # 聚焦运行单个 Vitest 文件
npm run typecheck  # TS 检查
npm run build      # 类型检查 + 生产构建 → dist/
npm run preview    # 本地预览生产构建（验 PWA）
npm run icons      # 从 public/logo.svg 重新生成全套图标
```

## 部署与验证

[CI 工作流](.github/workflows/ci.yml) 在 PR 中运行类型检查、测试、Edge 检查和构建；推送到 `main` 并通过检查后，生产部署任务才会发布到 Cloudflare Pages。不要按旧说明将手动 `wrangler pages deploy` 当作默认发布路径。

[文字 AI Preview](.github/workflows/text-ai-preview.yml) 使用受保护的手动工作流，需按具体分支、SHA 和账号操作授权；普通文档整理不触发这个管理入口。

## 当前范围

当前代码包含训练、统计、营养记录、海报与数据恢复；云账号和跨设备同步不能由早期 Phase 2 计划推定已经实现。AI Preview 的实际开放状态以对应账号与受保护流程核验为准。

## 反馈与许可

使用问题可通过 [Issue](https://github.com/nuts-and-bytes/tiezheng/issues) 说明复现步骤，请勿附上访问码、健康记录或 API 凭据。当前仓库没有独立 `LICENSE` 文件，许可证待维护者明确。

## English

IRONPROOF is a local-first fitness PWA for training logs, nutrition records, weight and exercise trends, photo records, training posters, and data backup/restore. [Try it](https://tiezheng.pages.dev/).

Run `npm install` and `npm run dev` for local development. Browser records have no automatic cross-device sync; keep backups. Optional text/photo AI features have separate remote-service, access and budget boundaries. The CI workflow checks PRs and deploys successful `main` pushes to Cloudflare Pages. No standalone LICENSE file is currently present.
