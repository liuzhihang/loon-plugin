# GLaDOS 自动签到

## 功能说明

- 支持 glados.network、railgun.info、glados.vip、glados.one、glados.space 五个域名
- 每个域名支持多账号
- 自动签到 + 积分查询 + 积分兑换（≥500 积分自动兑换 plan500）

## 支持平台

- Quantumult X
- Loon
- Surge

## 使用说明

1. Loon 安装本仓库的 `plugins/glados.lpx`，登录对应域名后刷新控制台；捕获 `/api/user/status` 的成功响应保存 Cookie 和 User-Agent
2. 每天 7:10 自动执行签到
3. 同域名按账号邮箱去重：同账号新 Cookie 替换旧会话，不同账号继续分别保存

## 配置

### Quantumult X

```ini
[rewrite_local]
^https://glados\.network/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
^https://railgun\.info/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
^https://glados\.vip/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
^https://glados\.one/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
^https://glados\.space/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js

[task_local]
10 7 * * * https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js, tag=GLaDOS 签到, enabled=true

[MITM]
hostname = %APPEND% glados.network, railgun.info, glados.vip, glados.one, glados.space
```

### Loon

需要 Loon 3.5.1（983）或以上。从下面的地址添加插件：

```text
https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/glados.lpx
```

启用插件及已有的 MitM 证书，登录后刷新控制台，确认收到抓取通知。抓取规则读取账号状态响应，不修改服务器返回内容。旧 Cookie 数组自动兼容；只有确认属于同一邮箱的旧会话才会被替换，无法识别的旧账号会保留。

### Surge

```ini
[Script]
GLaDOS 抓包 = type=http-request, pattern=^https://glados\.network/console/account$, requires-body=0, script-path=https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
GLaDOS 抓包2 = type=http-request, pattern=^https://railgun\.info/console/account$, requires-body=0, script-path=https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
GLaDOS 抓包3 = type=http-request, pattern=^https://glados\.vip/console/account$, requires-body=0, script-path=https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
GLaDOS 签到 = type=cron, cronexp="10 7 * * *", script-path=https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js, timeout=60

[MITM]
hostname = %APPEND% glados.network, railgun.info, glados.vip, glados.one, glados.space
```

## 多账号

同一域名按经接口验证的邮箱区分账号。重新登录同一个账号后刷新页面，会更新该账号 Cookie；其他账号保留。旧版无身份记录且已完全失效的 Cookie 无法安全判断归属，需要用户确认后单独处理。

## 注意事项

- 积分 ≥500 时自动兑换 plan500
- 出现 `Automated check-in detected` 或重新登录提示时，先在网站验证登录状态，再刷新控制台更新 Cookie；脚本不会绕过服务端限制。
- 日志中的 Stored 仅代表本地存在凭据，账户接口和签到接口的验证结果分别处理。
- 积分兑换在需要重新登录时跳过；其他情况下维持原 ≥500 自动兑换行为。

## 更新记录

- v1.4.0 - 同账号 Cookie 替换、浏览器 User-Agent 保存、Loon 3.5.1 插件入口与响应字段兼容、重新登录错误分类

- v1.1.0 - 统一日志规范、六阶段结构、Logger 模块
- v1.0.0 - 初始版本
