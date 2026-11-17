# 铁证 IRONPROOF

[![CI](https://github.com/nuts-and-bytes/tiezheng/actions/workflows/ci.yml/badge.svg)](https://github.com/nuts-and-bytes/tiezheng/actions/workflows/ci.yml)

> 你练过的，都有铁证。

面向健身爱好者的本地优先打卡 PWA：训练记录、日历、体重、图表、拍照留证。数据存在手机本地（IndexedDB），断网照样用，支持一键导出 CSV/JSON。

**在线体验**：<https://tiezheng.pages.dev>（手机 Safari 打开 → 分享 → 添加到主屏幕，体验最佳）

## 可以做什么

| 功能 | 使用结果 |
| --- | --- |
| 训练与日历 | 记录训练，按日期回看 |
| 体重与图表 | 观察自己的记录变化 |
| 拍照留证 | 为训练和身体变化留下图像记录 |
| 数据导出 | 导出 CSV/JSON，自行保管备份 |

## 数据与 AI 边界

核心记录以浏览器 IndexedDB 为主，不自动跨设备同步；清理站点数据前应先备份。仓库包含文字及照片 AI 的独立网关和 Preview 配置，启用这些能力会涉及外部服务。它们的账号、权限、预算与发布边界分别管理，不能把“本地优先”理解为所有 AI 功能完全离线。

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

## 路线图

- Phase 1（当前）：单机完整版 —— 记录/日历/体重/图表/拍照/PWA
- Phase 2：邮箱账号 + 云同步（Supabase）
- Phase 3：铁证海报（季/半年/年）+ 微信引导 + 隐私政策

## 反馈与许可

使用问题可通过 [Issue](https://github.com/nuts-and-bytes/tiezheng/issues) 说明复现步骤，请勿附上访问码、健康记录或 API 凭据。当前仓库没有独立 `LICENSE` 文件，许可证待维护者明确。

## English

IRONPROOF is a local-first fitness PWA for training logs, calendar, weight tracking, charts, photo records and CSV/JSON export. [Try it](https://tiezheng.pages.dev/).

Run `npm install` and `npm run dev` for local development. Browser records have no automatic cross-device sync; keep backups. Optional text/photo AI features have separate remote-service, access and budget boundaries. The CI workflow checks PRs and deploys successful `main` pushes to Cloudflare Pages. No standalone LICENSE file is currently present.
