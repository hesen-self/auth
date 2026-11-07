# auth · Cloudflare Access 身份控制台

一个受 **Cloudflare Zero Trust Access** 保护的 Worker，提供三种登录方式，登录后的页面把 Access 能交付的**全部个人信息**递归展开显示；并用 **R2** 保存用户头像、用 **D1** 记录登录日志（列表 + 详情）。

- **登录方式**：GitHub OAuth、Google OAuth、邮箱一次性验证码（One-time PIN）
- **访问域名**：`auth.hesen.dpdns.org`
- **Account ID**：`9c2b9da6ca5beb3887a5f6152e3bac7d`
- **Team domain**：`https://seazen.cloudflareaccess.com`（team name `seazen`）
- **OAuth 回调**：`https://seazen.cloudflareaccess.com/cdn-cgi/access/callback`（跑 `npm run urls` 复核）
- **控制台直达**：Google 凭据页 `https://console.cloud.google.com/apis/credentials`｜GitHub OAuth Apps `https://github.com/settings/developers`
- **存储**：R2 `auth-identity-avatars`（头像）、D1 `auth-identity-db`（登录日志）
- **认证边界**：OAuth 握手与 client secret 全由 Cloudflare 托管，Worker 不接触任何密钥

> Access 是认证**网关**而不是身份提供商。所谓「三种登录方式」= 三个 Access Identity Provider；登录页由 Cloudflare 托管，Worker 只负责读取并展示身份。

## 快速开始

```bash
npm install
npm run preview       # 生成 public/preview.html，用官方 access.dev 机制预览页面
npm run db:init:local # 本地 D1 建表（wrangler dev 用本地模拟资源）
npm run dev           # http://localhost:8787，本地模拟已登录身份
```

上线：

```bash
cp .dev.vars.example .dev.vars   # 补凭证
npm run doctor                   # 自检凭证与权限（含写权限探测）
npm run setup:dry                # 空跑检查请求体
npm run setup -- --write-config  # 创建 IdP + Access 应用并回填 POLICY_AUD
npm run r2:create                # 仅首次：创建头像 bucket
npm run d1:create                # 仅首次：创建数据库，把返回的 uuid 回填 wrangler.jsonc
npm run db:init                  # 远端建表
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

**拿不到的**：GitHub 的 `login / avatar_url`、Google 的 `picture / locale` 等 IdP 原始 profile —— Access 不透传 IdP 的 access token。因此头像改为**用户自行上传到 R2**，未上传时降级显示姓名首字母。原因与三种补齐方案见 [docs/SETUP.md §10](docs/SETUP.md)。

## 头像与登录记录（R2 + D1）

- **头像**：按 `user_uuid` 存入 R2，经 `/api/avatar` 读写；限 PNG / JPEG / WebP / GIF、≤ 2 MB，写入校验同源。首页提供上传入口，加载失败自动降级为首字母。
- **日志**：每次通过 Access 认证后访问页面时写入 D1 的 `login_logs`，按 `(user_uuid, iat)` 唯一键去重，一次登录只记一条。记录邮箱、姓名、登录方式、IdP、IP / 国家 / 城市、colo、ASN、User-Agent、会话时间、AUD、groups 及**脱敏后的完整身份对象**。
- **可见范围**：groups 含 `identity-console-admin` 的管理员看全部，普通用户只能看自己的。
- **列表 / 详情**：`/logs` 支持分页与关键字搜索，`/logs/:id` 展示概要字段、分组 claims、脱敏身份对象与原始 JSON。

详见 [docs/SETUP.md §13](docs/SETUP.md)。

## 登录 / 退出

顶栏在所有页面显示当前邮箱与 **退出登录** 按钮，未认证时 403 页显示 **前往 Access 登录页**，状态随 Access 会话切换。

退出不是简单的前端跳转：点击后进入 `/logout` 中间页，用同源请求触发 Cloudflare 官方登出端点
（应用域名 + team 域名 `/cdn-cgi/access/logout`，撤销会话并清除授权 / 全局 Cookie），随后跳回 `/`。
整个 hostname 受 Access 保护，Cookie 清除后边缘会 **302 到带动态 `meta` 的登录页**，用户重新选择 GitHub / Google / 邮箱验证码。
登录页 URL 的 `meta` 由边缘实时签发、无法硬编码，所以必须由 `/` 触发重定向；官方登出端点本身不会跳转（无 Cookie 时只返回错误页）。

> 注意：官方登出是全局撤销（旧 token 约 20–30 秒失效），且 IdP 若仍保持登录可能自动 SSO；要彻底换账号需先在 IdP 侧登出。本地 `wrangler dev` 只有模拟身份，退出页会显示降级说明。

详见 [docs/SETUP.md §14](docs/SETUP.md)。

## 路由

| 路径 | 说明 |
| --- | --- |
| `/` | 身份信息页（含 R2 头像上传入口） |
| `/logs` | 登录记录列表（分页 / 搜索） |
| `/logs/:id` | 登录记录详情 |
| `/logout` | 退出中间页：撤销 Access 会话并跳回登录页 |
| `/api/avatar` | GET 读取当前用户头像 / POST 上传 |
| `/api/logs` | 分页日志 JSON |
| `/api/logs/:id` | 单条日志 JSON |
| `/api/snapshot` | 完整快照 JSON（含四个数据源状态） |
| `/api/identity` | `get-identity` 的原始响应 |
| `/health` | 探活，附 R2 / D1 绑定状态，不含身份数据 |

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | wrangler 本地开发，带模拟 Access 身份与本地 R2 / D1 |
| `npm run deploy` | 部署并自动绑定 `auth.hesen.dpdns.org` 自定义域名 |
| `npm run preview` | 离线生成身份页 / 列表页 / 详情页 / 退出页预览 + 快照 JSON，同时跑渲染冒烟检查 |
| `npm run check` | 各模块语法检查 |
| `npm run r2:create` | 创建 `auth-identity-avatars` bucket |
| `npm run d1:create` | 创建 `auth-identity-db` 数据库 |
| `npm run db:init` | 远端执行 `migrations/0001_init.sql` 建表 |
| `npm run db:init:local` | 本地 D1 建表 |
| `npm run urls` | 打印 GitHub / Google OAuth 应用该填的 Homepage URL 与回调地址 |
| `npm run doctor` | 只读自检凭证有效性、Zero Trust 端点权限矩阵与写权限 |
| `npm run setup:dry` | 打印将要发送的 Cloudflare API 请求，不联网 |
| `npm run setup` | 创建三个 IdP 与 Access 应用；`--write-config` 自动回填 POLICY_AUD |

## 目录

```
src/index.js              Worker 入口与路由（头像 / 日志 / 页面）
src/identity.js           四通道身份采集、JWT 验签、字段释义、脱敏
src/render.js             暗色主题页面渲染（身份页 / 列表页 / 详情页 / 退出页）
src/storage.js            R2 头像读写 + D1 日志写入/查询 + 落库脱敏
migrations/0001_init.sql  login_logs 建表与索引
scripts/setup-access.mjs  Cloudflare API 一键配置
scripts/doctor.mjs        凭证与权限自检（含写权限探测）
scripts/show-callbacks.mjs 打印 OAuth 回调地址
scripts/lib/cf.mjs        凭证加载 / 认证头 / API 错误诊断共享模块
scripts/render-preview.mjs 离线预览生成 + 冒烟测试
wrangler.jsonc            Worker / 域名 / vars / R2 / D1 / access.dev 配置
docs/SETUP.md             完整部署与排查指南
.dev.vars                 本地凭证（已 gitignore）
public/preview.html       生成的身份页预览
public/logs-preview.html  生成的列表页预览
public/log-detail-preview.html 生成的详情页预览
public/logout-preview.html 生成的退出页预览（生产态）
```

## 依赖

`jose`（Access JWT 验签）、`wrangler`（开发与部署）。运行时无第三方服务依赖；头像存 R2、日志存 D1，登录态仍完全由 Cloudflare Access 管理。
