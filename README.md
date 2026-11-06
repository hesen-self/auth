# auth · Cloudflare Access 身份控制台

一个受 **Cloudflare Zero Trust Access** 保护的 Worker，提供三种登录方式，登录后的页面把 Access 能交付的**全部个人信息**递归展开显示。

- **登录方式**：GitHub OAuth、Google OAuth、邮箱一次性验证码（One-time PIN）
- **访问域名**：`auth.hesen.dpdns.org`
- **Account ID**：`9c2b9da6ca5beb3887a5f6152e3bac7d`
- **Team domain**：`https://seazen.cloudflareaccess.com`（team name `seazen`）
- **OAuth 回调**：`https://seazen.cloudflareaccess.com/cdn-cgi/access/callback`（跑 `npm run urls` 复核）
- **控制台直达**：Google 凭据页 `https://console.cloud.google.com/apis/credentials`｜GitHub OAuth Apps `https://github.com/settings/developers`
- **认证边界**：OAuth 握手与 client secret 全由 Cloudflare 托管，Worker 不接触任何密钥

> Access 是认证**网关**而不是身份提供商。所谓「三种登录方式」= 三个 Access Identity Provider；登录页由 Cloudflare 托管，Worker 只负责读取并展示身份。

## 快速开始

```bash
npm install
npm run preview     # 生成 public/preview.html，用官方 access.dev 机制预览页面
npm run dev         # http://localhost:8787，本地模拟已登录身份
```

上线：

```bash
cp .dev.vars.example .dev.vars   # 已有一份填好账号/域名的 .dev.vars，只需补凭证
npm run doctor                   # 自检凭证与权限（含写权限探测），先跑这个再往下
npm run setup:dry                # 空跑检查请求体
npm run setup -- --write-config  # 创建 IdP + Access 应用并回填 POLICY_AUD（TEAM_DOMAIN 已配置好）
npm run deploy
```

完整步骤见 [docs/SETUP.md](docs/SETUP.md)。

## 页面展示什么

四个互补的数据通道，缺一不可——只解析 JWT 的话你只能看到一个邮箱：

| # | 通道 | 内容 |
| --- | --- | --- |
| ① | `ctx.access.getIdentity()` | 边缘直接注入的完整身份：email / name / idp / groups / devicePosture / ip / geo |
| ② | `CF-Access-Jwt-Assertion` | `jose` + 团队 JWKS 验签后的标准与自定义 claims（RS256 / iss / aud / exp） |
| ③ | `/cdn-cgi/access/get-identity` | 不受 cookie 大小限制的完整 groups、设备会话、WARP / Gateway / mTLS 状态 |
| ④ | headers + `request.cf` | 地理、ASN、colo、TLS 版本、请求元数据 |

页面对返回对象做**全量递归渲染**，不设字段白名单；`cookie` / `authorization` / JWT 原文一律脱敏，验签失败直接 403。

**拿不到的**：GitHub 的 `login / avatar_url`、Google 的 `picture / locale` 等 IdP 原始 profile —— Access 不透传 IdP 的 access token。原因与三种补齐方案见 [docs/SETUP.md §10](docs/SETUP.md)。

## 路由

| 路径 | 说明 |
| --- | --- |
| `/` | 身份信息页 |
| `/api/snapshot` | 完整快照 JSON（含四个数据源状态） |
| `/api/identity` | `get-identity` 的原始响应 |
| `/health` | 探活，不含任何身份数据 |

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | wrangler 本地开发，带模拟 Access 身份 |
| `npm run deploy` | 部署并自动绑定 `auth.hesen.dpdns.org` 自定义域名 |
| `npm run preview` | 离线生成 UI 预览 + 快照 JSON，同时跑渲染冒烟检查 |
| `npm run check` | 各模块语法检查 |
| `npm run urls` | 打印 GitHub / Google OAuth 应用该填的 Homepage URL 与回调地址（填了 API Token 会自动查 team domain） |
| `npm run doctor` | 只读自检凭证有效性、Zero Trust 端点权限矩阵与写权限，打印修复建议 |
| `npm run setup:dry` | 打印将要发送的 Cloudflare API 请求，不联网 |
| `npm run setup` | 创建三个 IdP 与 Access 应用；加 `--write-config` 自动回填配置，`--skip-org` 跳过无权限的组织端点 |

## 目录

```
src/index.js              Worker 入口与路由
src/identity.js           四通道身份采集、JWT 验签、字段释义、脱敏
src/render.js             暗色主题页面渲染
scripts/setup-access.mjs  Cloudflare API 一键配置
scripts/doctor.mjs        凭证与权限自检（含写权限探测）
scripts/show-callbacks.mjs 打印 OAuth 回调地址
scripts/lib/cf.mjs        凭证加载 / 认证头 / API 错误诊断共享模块
scripts/render-preview.mjs 离线预览生成 + 冒烟测试
wrangler.jsonc            Worker / 域名 / access.dev 配置
docs/SETUP.md             完整部署与排查指南
.dev.vars                 本地凭证（已 gitignore）
public/preview.html       生成的页面预览
```

## 依赖

`jose`（Access JWT 验签）、`wrangler`（开发与部署）。运行时无其他依赖，无数据库、无会话存储——登录态完全由 Cloudflare Access 管理。
