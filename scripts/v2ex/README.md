# V2EX 每日签到

## 功能说明

- 自动完成 V2EX 每日签到领取铜币
- 显示连续签到天数和余额信息
- 支持 `edge.v2ex.com`、`www.v2ex.com` 和 `v2ex.com`，签到请求始终使用所保存的域名
- 每次运行只尝试一次签到，失败、限流或网站验证时停止并通知

## 支持平台

- Quantumult X
- Loon
- Surge

## 使用说明

1. 安装插件后，在 Safari 登录常用的 V2EX 域名；Edge 可以沿用已有的 Passkey 登录会话
2. 打开并刷新该域名的 `/mission/daily`，例如 `https://edge.v2ex.com/mission/daily`，确认“登录会话已更新”通知
3. 每天 9:10 自动执行签到，也可在 Loon 插件的签到脚本文件中手动运行
4. 签到结果通过通知推送；只有再次读取每日任务页面确认已领取，才报告签到成功

Passkey 只用于浏览器登录。插件保存登录后的 Cookie、域名和 User-Agent，不读取 Passkey，也不要求改用密码。当前为单账号脚本，最后一次成功抓取的会话用于定时任务。

## 配置

### Quantumult X

```ini
[rewrite_local]
^https://(?:(?:www|edge)\.)?v2ex\.com/mission/daily(?:\?.*)?$ url script-response-body https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/v2ex/v2ex.js

[task_local]
10 9 * * * https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/v2ex/v2ex.js, tag=V2EX 每日签到, enabled=true

[MITM]
hostname = %APPEND% www.v2ex.com, edge.v2ex.com, v2ex.com
```

### Loon

Loon 3.5.1（983）及以上，从以下地址添加插件：

```text
https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/v2ex.lpx
```

保持脚本与 MitM 开启，使用已安装并受信任的证书。iCloud 同步或插件更新后，如果请求记录只有 `edge.v2ex.com:443` TCP 连接、未出现完整 URL 和抓取任务，重新连接 Loon 后再刷新每日任务页面。抓取不会修改网页响应。

### Surge

```ini
[Script]
V2EX 抓包 = type=http-response, pattern=^https://(?:(?:www|edge)\.)?v2ex\.com/mission/daily(?:\?.*)?$, requires-body=1, script-path=https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/v2ex/v2ex.js
V2EX 签到 = type=cron, cronexp="10 9 * * *", script-path=https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/v2ex/v2ex.js, timeout=60

[MITM]
hostname = %APPEND% www.v2ex.com, edge.v2ex.com, v2ex.com
```

## 注意事项

- Cookie 失效后，在原域名重新登录并刷新每日任务页面；无需在另一个域名重新输入密码
- 新会话保存为设备本地的 `V2EX_Session`；只有旧 `V2EX_Cookie` 时继续使用原来的 `www.v2ex.com`，不会自动把旧 Cookie 发到 Edge
- 只有确认每日任务页面有效才更新会话，登录页、错误页和存储失败不会显示抓取成功
- 领取结果未确认时不会重新提交；请在每日任务页面核实结果。Loon 中仅跟随同域名每日任务或余额查询页的重定向
- 签到结果依赖 V2EX 页面解析，页面变动可能导致失败

## 更新记录

- v1.3.1 - 移除失败重试，网站验证时停止，限制重定向到查询页面，避免重复领取
- v1.3.0 - 支持 Edge 登录会话、同域名请求与浏览器 User-Agent、Loon 状态码兼容、领奖结果确认
- v1.1.0 - 统一日志规范、六阶段结构、Logger 模块
- v1.0.0 - 初始版本
