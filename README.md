# 铁证 IRONPROOF

> 你练过的，都有铁证。

面向健身爱好者的本地优先打卡 PWA：训练记录、日历、体重、图表、拍照留证。数据存在手机本地（IndexedDB），断网照样用，支持一键导出 CSV/JSON。

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm test           # 全量单测（Vitest）
npm run typecheck  # TS 检查
npm run build      # 类型检查 + 生产构建 → dist/
npm run preview    # 本地预览生产构建（验 PWA）
npm run icons      # 从 public/logo.svg 重新生成全套图标
```

## 部署（Cloudflare Pages，手动）

```bash
npm run build
npx wrangler pages deploy dist --project-name tiezheng
```

首次执行会引导登录 Cloudflare 账号。验证期手动部署，Phase 2 再接自动化。

## 路线图

- Phase 1（当前）：单机完整版 —— 记录/日历/体重/图表/拍照/PWA
- Phase 2：邮箱账号 + 云同步（Supabase）
- Phase 3：铁证海报（季/半年/年）+ 微信引导 + 隐私政策
