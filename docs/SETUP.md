# 部署与配置指南

> 目标：一个受 Cloudflare Zero Trust Access 保护的 Worker，提供 **GitHub / Google / 邮箱一次性验证码** 三种登录方式，登录后展示 Access 能交付的全部个人信息。

## 0. 已固定的配置

| 项 | 值 |
| --- | --- |
| Cloudflare Account ID | `9c2b9da6ca5beb3887a5f6152e3bac7d` |
| 应用访问域名 | `auth.hesen.dpdns.org` |
| Worker 名称 | `auth-identity-console` |
| **Zero Trust team name** | `seazen` |
| **Team domain** | `https://seazen.cloudflareaccess.com` |
| **OAuth 回调地址** | `https://seazen.cloudflareaccess.com/cdn-cgi/access/callback` |
| Access 应用类型 | Self-hosted，保护整个 hostname |
| 自定义域名 | `wrangler.jsonc` 里 `routes[0].custom_domain = true`，部署时自动建 DNS 记录 |

以上已写入 `.dev.vars`（本地、已 gitignore）与 `wrangler.jsonc`。**唯一还缺的是 `POLICY_AUD`** —— 必须先创建 Access 应用才会生成，`npm run setup -- --write-config` 会自动回填。

### 直接可复制的 OAuth 填写值

| 平台 / 字段 | 值 |
| --- | --- |
| GitHub · Homepage URL | `https://seazen.cloudflareaccess.com` |
| GitHub · Authorization callback URL | `https://seazen.cloudflareaccess.com/cdn-cgi/access/callback` |
| Google · Authorized JavaScript origins | `https://seazen.cloudflareaccess.com` |
| Google · Authorized redirect URIs | `https://seazen.cloudflareaccess.com/cdn-cgi/access/callback` |

随时可用 `npm run urls` 复核（脚本已自带 team name）。

## 1. 前置条件（缺一个都会卡住）

- [ ] `dpdns.org` 这个 zone 已经托管在 **同一个 Cloudflare 账号**下，且 NS 指向 Cloudflare。`custom_domain` 只能给本账号托管的 zone 自动建记录；否则需要手工加一条指向 Worker 的 DNS 记录或改用 route。
- [ ] 该账号已开通 **Zero Trust**（Free 计划即可，50 用户内免费）。
- [ ] 本机 Node.js ≥ 20、npm 可用。
- [ ] 一个**具备写权限**的 API Token，创建入口 <https://dash.cloudflare.com/profile/api-tokens> → **Create Token → Create Custom Token**：
  - `Account · Access: Organizations, Identity Providers, and Groups` → **Edit**（不能是 Read）
  - `Account · Access: Apps and Policies` → **Edit**
  - `Account · Account Settings` → **Read**
  - `Account · Workers Scripts` → **Edit**、`Zone · DNS` → **Edit**（`wrangler deploy` 建自定义域名时用）
  - **Account Resources → Include → 账号 `9c2b9da6ca5beb3887a5f6152e3bac7d`**；若设了 IP 过滤 / TTL，必须覆盖当前网络
  - 先跑 `npm run doctor` 自检。**只有 Read 权限时所有 GET 都是 200、POST 却是 `403 / 1010 auth.forbidden`**，光看读请求会误判成「配置没问题」
  - 兜底方案：在 `.dev.vars` 填 `CF_API_EMAIL` + `CF_GLOBAL_API_KEY` 改用全局密钥（权限很大，仅限本机、勿提交）
- [ ] GitHub 与 Google Cloud 控制台各能创建一个 OAuth 客户端。

## 2. 架构（谁负责什么）

```
浏览器
  │  访问 https://auth.hesen.dpdns.org/
  ▼
Cloudflare 边缘 · Access Application（策略校验）
  │  未登录 → CF 托管登录页：GitHub / Google / One-time PIN 三选一
  │  已登录 → 注入 CF-Access-Jwt-Assertion 头 + CF_Authorization Cookie + ctx.access
  ▼
Worker (auth-identity-console)
  ├─ ctx.access.getIdentity()          → 完整身份（官方推荐，无需解析 JWT）
  ├─ jose 验签 JWT (JWKS + AUD + iss) → 标准 / 自定义 claims
  ├─ 代理 /cdn-cgi/access/get-identity → 设备会话、完整 groups、WARP/mTLS 状态
  └─ headers + request.cf             → 地理 / ASN / TLS / 请求元数据
  ▼
登录后页面：全量递归展开所有字段（敏感头脱敏）
```

**Worker 不接触任何 client secret**，OAuth 握手完全由 Cloudflare 托管。这正是用 Access 而不是自己写 OAuth 的价值。

## 3. 本地准备

```bash
cd E:/Self-Project/auth
npm install
npm run check       # 语法检查
npm run preview     # 生成 public/preview.html，验证渲染逻辑（不联网、不需凭证）
npm run dev         # http://localhost:8787，使用 wrangler.jsonc 的 access.dev 模拟身份
```

`access.dev` 是 Cloudflare 官方提供的本地模拟机制，不是自造的假数据；部署时该块自动忽略。

## 4. 取得 Team domain 与 AUD

**本项目的 Team domain 已确定为 `https://seazen.cloudflareaccess.com`**（team name `seazen`），已写入 `wrangler.jsonc` 的 `vars.TEAM_DOMAIN` 与 `.dev.vars` 的 `CF_TEAM_NAME`。脚本同时接受纯 team name 与完整域名，两种写法都不会拼错。

`npm run setup` 仍会通过 `/access/organizations` 读取 `auth_domain` 做校验；若需要复核，在 **Zero Trust → Settings → Team name and domain** 查看，或跑 `npm run urls`。

AUD tag 在 **Zero Trust → Access controls → Applications → 你的应用 → Additional settings → Application Audience (AUD) Tag**。`npm run setup` 会在创建应用后直接打印。

## 5. GitHub OAuth App

1. 打开 <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth app**。
2. 填写：

| 字段 | 值 |
| --- | --- |
| Application name | 任意，会显示在登录页 |
| Homepage URL | `https://seazen.cloudflareaccess.com` |
| Authorization callback URL | `https://seazen.cloudflareaccess.com/cdn-cgi/access/callback` |

> **最容易填错的地方**：回调地址是发给 **Cloudflare Access** 的，host 是 `seazen.cloudflareaccess.com`，不是应用域名。
> 千万别填 `auth.hesen.dpdns.org` —— 那个域名由 Access 保护，根本不处理 OAuth 回调，填错了只会静默失败。
> 协议必须 `https`，host 完全一致，callback 路径结尾不要额外加 `/`。
> 上面两个值可直接复制；也可跑 `npm run urls` 复核（会同时打印 GitHub 与 Google 的四个字段）。

3. 复制 **Client ID**，生成并复制 **Client secret**，填入 `.dev.vars` 的 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`。
4. 在 Zero Trust 里保存该 IdP 后点 **Finish setup**，会跳转 GitHub 授权（要求 `Organizations and teams (read-only)` 与 `Email addresses (read-only)`）。启用了 2FA 的账号需先在 GitHub 网页登录再回来。

> 单个 IdP 的 API 形态：`{ "name": "GitHub", "type": "github", "config": { "client_id": "...", "client_secret": "..." } }`

## 6. Google OAuth Client

**控制台直达链接**（先在顶部项目选择器里选好项目，否则会跳回项目列表）：

| 用途 | 网址 |
| --- | --- |
| Google Cloud 控制台首页 | `https://console.cloud.google.com/` |
| **凭据页（主入口）** | `https://console.cloud.google.com/apis/credentials` |
| 凭据页（指定项目） | `https://console.cloud.google.com/apis/credentials?project=<PROJECT_ID>` |
| 新版 Google Auth Platform · Clients | `https://console.cloud.google.com/auth/clients` |
| GitHub OAuth Apps（对照） | `https://github.com/settings/developers` |

> 2026 年 Google 把这块改名成 **Google Auth Platform**：菜单路径为 `菜单 → Google Auth Platform → Clients → Create Client`；
> 老的 `APIs & Services → Credentials → Create credentials → OAuth client ID` 仍然可用，两个入口指向同一批客户端。
> **第一次进会强制先点 Get started** 配置应用信息、Audience、联系方式，不配完不给建客户端。

1. 打开上面的链接，新建（或选择）一个项目。
2. 先配置同意屏幕：Audience 选 **External**，填 App name / 用户支持邮箱 / 开发者联系方式，勾选数据政策后 Create。
3. **Create Client / OAuth client ID** → 类型 **Web application**：

| 字段 | 值 |
| --- | --- |
| Authorized JavaScript origins | `https://seazen.cloudflareaccess.com` |
| Authorized redirect URIs | `https://seazen.cloudflareaccess.com/cdn-cgi/access/callback` |

4. 复制 Client ID / Secret 填入 `.dev.vars` 的 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`。

> **最常见的坑**：consent screen 处于 **Testing** 状态时，只有列在 *Test users* 里的账号能登录，报错发生在 Google 侧、看起来完全不像 Access 的问题。要么把自己的 Gmail 加进测试用户，要么发布应用（发布不等于放开权限，Access 策略仍会拦人）。
>
> `type: "google"` 允许任意 Google 账号；`type: "google-apps"` + `apps_domain` 则锁定某个 Workspace 域名。

## 7. 一键开通 Access

```bash
npm run doctor          # 只读自检：凭证有效性 + Zero Trust 端点权限 + 写权限探测
npm run setup:dry       # 空跑，检查将要发送的请求体
npm run setup -- --write-config
```

脚本依次完成：

0. `GET /accounts/{id}` → 验证凭证有效性（**不用** `/user/tokens/verify`，它对非用户级 Token 会误报 `Invalid API Token`）；
1. `GET /access/organizations` → **可选**：补一个 team domain 交叉校验。该端点缺权限会返回 `403 / 10000`，此时若 `.dev.vars` 已填 `CF_TEAM_NAME` 就自动降级继续（也可用 `--skip-org` 直接跳过）；
2. `GET /access/identity_providers` → **按 type 复用已有 IdP**，不重复创建；
3. 缺失的 IdP 补齐：
   - `onetimepin` → `config: {}`（零配置，第三种登录方式）
   - `github` / `google` → 需对应凭证，缺凭证会跳过并提示，不会中断其余步骤；
4. `GET /access/apps` 按 domain 幂等复用（失败重跑不会创建第二个应用）；不存在才 `POST /access/apps` 创建 self-hosted 应用：
   - `domain: auth.hesen.dpdns.org`
   - `auto_redirect_to_identity: false`（**必须关掉 Instant Auth**，否则会直接跳转到单一 IdP，看不到三种方式的选择页）
   - `allowed_idps` 绑定三个 IdP
   - 一条 Allow 策略，由 `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAIN` 生成；两者都为空时退化成 `everyone`，脚本会显著警告；
5. 打印 `TEAM_DOMAIN` / `POLICY_AUD`，`--write-config` 时自动写回 `wrangler.jsonc`。

### 手动控制台路径（不想用 API 时）

**Zero Trust → Integrations → Identity providers → Add new**：分别添加 *One-time PIN*、*GitHub*、*Google*，填入上面的 Client ID / Secret 并 Test。
**Zero Trust → Access controls → Applications → Add an application → Self-hosted**：名称 `Identity Console`，Application domain 填 `auth.hesen.dpdns.org`，Session duration 按需，Identity providers 勾选三个，关闭 Instant Auth，添加 Allow 策略（Emails 填你的邮箱）。保存后从 Additional settings 复制 AUD tag，手动填进 `wrangler.jsonc`。

## 8. 回填与部署

`wrangler.jsonc` 的 `vars` 中 `TEAM_DOMAIN` 已填好；`POLICY_AUD` 是唯一待填项，创建 Access 应用后由 `--write-config` 自动回填：

```jsonc
"vars": {
  "TEAM_DOMAIN": "https://seazen.cloudflareaccess.com",  // 无尾斜杠
  "POLICY_AUD": "<创建应用后返回的 AUD tag>",
  "APP_NAME": "Identity Console"
}
```

TEAM_DOMAIN 与 AUD 都不是机密，放 `vars` 即可；若要更严格可用 `wrangler secret put`。

```bash
npm run deploy       # 自动为 auth.hesen.dpdns.org 创建 Custom Domain + DNS 记录
```

`workers_dev` 已设为 `false`。**原因**：Access 应用是按 `auth.hesen.dpdns.org` 这个 hostname 建的，`*.workers.dev` 若还开着就能绕过登录页直接访问 Worker。如果确实需要 workers.dev 预览，请改用 **Workers & Pages → 该 Worker → Access → Protect this Worker**（Worker 级保护覆盖它所有域名），或者为该 hostname 再建一条 Access 应用。

## 9. 验收清单

| # | 检查 | 预期 |
| --- | --- | --- |
| 1 | `curl -sI https://auth.hesen.dpdns.org/` | `302` 跳转到 `*.cloudflareaccess.com` |
| 2 | 浏览器打开登录页 | 同时出现 GitHub、Google、邮箱验证码三个入口 |
| 3 | 分别用三种方式登录 | 均进入页面，顶部「登录方式」徽章与本次选择一致 |
| 4 | `/api/snapshot` | 四个数据源状态、`jwt.verified: true` |
| 5 | 未列在 Allow 策略里的账号登录 | `That account does not have access.` |
| 6 | `curl -sI https://auth-identity-console.<subdomain>.workers.dev/` | 无法访问（workers_dev 已关闭） |

## 10. 页面展示哪些信息

页面对返回对象做**全量递归展开**，不设字段白名单，因此 IdP 返回什么就显示什么。主要分四区：

1. **完整身份**：`email / name / idp / geo / custom.groups / amr / devicePosture / ip / user_uuid / account_id / device_sessions …`
2. **JWT 声明**：`aud / email / exp / iat / nbf / iss / type / identity_nonce / sub / country / custom …`，用 `jose` + 团队 JWKS 校验 RS256 签名、issuer、audience、exp。
3. **get-identity 扩展**：不受 cookie 大小限制的完整 groups、mTLS 状态、WARP / Gateway 标记、设备会话列表。
4. **请求上下文**：全部 HTTP headers + `request.cf`（colo / city / timezone / asn / asOrganization / TLS 版本等）。

`cookie`、`authorization`、`cf-access-jwt-assertion` 等敏感头一律脱敏后再渲染；JWT 验签失败直接返回 403，不渲染未验证的声明。

### 拿不到的信息（重要）

Access 交付的是**归一化身份**，不透传 IdP 的 access token，所以 GitHub 的 `login / avatar_url / bio / company`、Google 的 `picture / locale` 等原始 profile **在这个架构里拿不到**。想补齐需要：改用通用 OIDC/SAML IdP 并配置自定义 claims 与 SCIM；或在应用内另行实现 OAuth（自己保管 client secret，等于放弃 Access 的部分优势）。`custom` claims 序列化超过约 1 KB 会被从尾部裁剪，groups 最容易丢——完整分组请走通道 ③。

## 11. 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 页面 403「请求没有携带可验证的 Access 身份」 | 访问的是未受 Access 保护的域名（例如 workers.dev），或 Worker 级/域名级 Access 没开启 |
| 403 且提示验签失败 | `TEAM_DOMAIN` 有尾斜杠、`POLICY_AUD` 复制错、或应用被删后重建导致 AUD 变化 |
| Google 报 `403 access_denied` / 测试用户限制 | consent screen 仍是 Testing，把账号加进 Test users 或发布应用 |
| GitHub 登录后组织策略不生效 | 用户是在加入组织**之前**尝试过登录，需要在 GitHub 设置里撤销该 OAuth App 授权后重新登录 |
| 登录页只有一个入口 | 开了 Instant Auth（`auto_redirect_to_identity: true`），关掉它 |
| 邮箱验证码收不到 | 只有命中 Allow 策略的邮箱才会发信；把 `noreply@notify.cloudflare.com` 加进邮件网关白名单；验证码 10 分钟有效且单次使用 |
| `groups` 时有时无 | JWT 的 `custom` 被裁剪；以 `/cdn-cgi/access/get-identity` 为准 |
| 部署报 zone 不存在 | `dpdns.org` 未托管在该账号，或 NS 未指向 Cloudflare；手工在 DNS 加记录后再部署 |
| setup 报 `10000: Authentication error` | **不是 Token 填错**，而是该端点权限不足。`/access/organizations` 需要 `Access: Organizations, Identity Providers, and Groups` 权限；已填 `CF_TEAM_NAME` 时脚本会自动降级继续，不阻塞 |
| setup 报 `1010: auth.forbidden` | Token 有效但**只有读权限**，POST 被拒。到 API Tokens 把两项 Access 权限从 Read 改成 Edit，或改用 `CF_API_EMAIL` + `CF_GLOBAL_API_KEY` |
| setup 报 `9106 / 9109 / 1000: Invalid API Token` | 凭证本身无效：复制不全、已删除/过期、误填 Global API Key 或 Token ID、IP 过滤未放行当前出口 IP。重建 Token 后重跑 |
| `/user/tokens/verify` 返回 401 但其他端点 200 | 该端点对非用户级 Token 会误报。**判断凭证是否有效请用 `/accounts/{id}`**，不要只看 verify |
| 不确定卡在哪一步 | `npm run doctor` 打印完整权限矩阵（含一次非破坏性写权限探测）与修复建议 |

## 12. 上线前建议加固

- 把 `everyone` 策略换成明确的邮箱 / 邮箱域 / IdP 分组。
- 缩短 `session_duration`，敏感场景在策略里要求 MFA（`Login methods` + `Authentication Method Reference` 选择器）。
- 若 Worker 还挂了其他域名，为每个 hostname 建 Access 应用或启用 Worker 级保护。
- 定期轮换 Access 签名密钥时无需改代码：JWKS 每次从 `/cdn-cgi/access/certs` 动态获取并按 `kid` 匹配。
