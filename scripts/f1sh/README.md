# 网鱼每日签到

作者与维护：[liuzhihang](https://github.com/liuzhihang)。这是单账号 Loon 插件，仅支持 `https://f1sh.com`。要求 Loon 3.5.1（983）或更高版本。

## 安装与首次启用

当前版本为 `v1.0.0`（2026-10-25）。在 iPhone 或 iPad 的 Safari 打开本仓库 README，点击快捷安装链接并在 Loon 中确认添加；也可以从插件页面通过 URL 添加以下地址：

1. 在 Loon 3.5.1（983）或更高版本中，通过 [快捷安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fliuzhihang%2Floon-plugin%2Fmain%2Fplugins%2Ff1sh.lpx) 导入，或使用插件直链：

   ```text
   https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/f1sh.lpx
   ```

2. 按设备设置启用插件、脚本和 MitM，安装并信任 Loon 的 MitM 证书，保持 Loon 接管 Safari 的流量。插件参数中的“捕获登录会话”默认开启，“自动签到”默认关闭。
3. 在受 Loon 接管的 Safari 登录 [网鱼](https://f1sh.com/checkin)，然后进入或刷新每日签到页。页面响应必须是成功的登录状态 HTML；脚本保存该请求 Cookie 与 User-Agent 到设备本地的 `F1sh_Session`。无需先签到，也无需手动运行捕获入口。相同 Cookie 和 User-Agent 会静默跳过；首次保存后可关闭捕获开关。
4. 在插件参数中开启“自动签到”后，才会按计划签到。默认计划是设备本地时间每天 **09:35**；可按需要调整 Cron 和心情选项。若要手动签到，也先开启“自动签到”，再运行 `网鱼执行签到_会发请求`；关闭开关时手动入口也会停止。

捕获只匹配 HTTPS `f1sh.com/checkin` 的 GET 页面请求，可带查询参数，不匹配尾部斜杠或其他路径。页面捕获只检查响应和保存本地会话，不额外请求网站。

## 两个入口的分工

| 入口 | 用途 | 手动运行时 |
| --- | --- | --- |
| `网鱼会话捕获_自动触发`（RESPONSE） | 浏览器进入或刷新登录后的签到页时验证 HTML 并保存 Cookie、User-Agent | 没有网页响应时只提示去刷新 `/checkin`，不读取本地会话，也不发签到请求 |
| `网鱼执行签到_会发请求`（CRON） | 自动签到开启后按计划查询状态，明确未签到时提交一次，并回查页面状态 | 仍须自动签到开启；缺少或不匹配的入口参数会停止 |

首次保存提示、重复会话提示和执行结果以 Loon 日志与通知为准。未登录、页面结构异常或存储失败时保留原有会话。

## 主配置接入

如果通过主配置管理插件，在现有 `[Plugin]` 中仅添加这一项：

```ini
[Plugin]
https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/f1sh.lpx,tag=F1sh,enabled=true
```

捕获规则、定时任务、`f1sh.com` 的 MitM 主机声明和远程 JS 都由 `.lpx` 插件管理。不要在主配置重复添加 `[Script]` 或 `[MITM]` 条目；执行时间与开关在插件参数中调整。

## 参数与心情

自动签到开启后才会按设备本地时间运行。网站把日期边界定义为北京时间，因此脚本检查服务端 `Date` 并以 UTC+8 日期判断。每次运行都读取服务端页面，不使用本地“今日已签到”缓存。

| 设置 | 默认值 | 行为 |
| --- | --- | --- |
| 捕获登录会话 `capture` | 开启（`true`） | 登录后进入或刷新 `/checkin` 即可捕获有效会话；保存后可关闭 |
| 自动签到 `autoCheckin` | 关闭（`false`） | 开启后按 Cron 执行；关闭时也阻止手动签到入口 |
| 执行时间 `cronExpression` | `35 9 * * *` | 设备本地时间每天 09:35 |
| 签到心情 `mood` | `nice`（好耶） | 可选 `happy`、`nice`、`love`、`working`、`sleepy`、`popcorn`、`cry`、`angry`、`hello` |

心情对应页面选项分别是：`happy` 哈哈哈、`nice` 好耶、`love` 比心、`working` 摸鱼、`sleepy` 困了、`popcorn` 吃瓜、`cry` 呜呜、`angry` 气鼓鼓、`hello` 冒个泡。站点允许不选心情时使用“好耶”；此插件将默认值设为 `nice`。

| 结果 | 含义 |
| --- | --- |
| 今日已签到 | 签到前页面明确显示当天已完成，跳过 POST |
| 签到已确认 | 签到前确认未签到，只提交一次；随后回查签到页并看到今日完成标记 |
| 签到未确认 / 已停止 | 登录失效、挑战、限流、网络或页面结构异常、日期无法确认等情况；不报告成功，不自动重试 |

## 请求与停止条件

- 每次签到先 GET `https://f1sh.com/checkin`，验证 HTTP 响应、当天 `Date` 和已登录 HTML。签到表单的 `csrf_token` 用于本次 POST；若响应更新 `pd_csrf` Cookie，新值只合并到当前运行的内存请求。如果响应没有更新 Cookie，则现有 Cookie 中的 `pd_csrf` 必须与表单 token 匹配，否则停止。
- 页面明确显示今日已签到时不发送 POST。只有签到表单结构、CSRF 和未签到状态都明确时才 POST 同一 `/checkin`，请求体使用 `application/x-www-form-urlencoded`，包含 `csrf_token` 与所选 `mood`。
- 一次运行最多发送一个签到 POST，不自动重试，也不跟随任意重定向。POST 返回正常 HTTP 200，或指向同源 `/checkin` 的 HTTP 302/303 后，脚本固定重新 GET `/checkin`；只有新页面的今日完成标记得到验证，才报告“签到已确认”。重定向不会被当作成功本身。
- HTTP 401/403/429、挑战页、非预期重定向、异常 HTTP 状态、无效 HTML、缺少页面标记或网络错误都会停止。POST 超时的结果可能不确定；先在官网核实，不连续手动运行。
- 插件只执行每日签到，不补签、不购买补签卡，也不额外调用彩票功能。签到奖励及附送彩票由网站按账号规则处理。

## 本地会话与隐私

脚本只在 Loon 本地存储 `F1sh_Session` 中保存捕获请求的原始 Cookie 与 User-Agent。Cookie 原文可能含有 `pd_csrf`；脚本不单独保存表单 CSRF token 或响应正文，新响应中的 `pd_csrf` 值仅在本次运行中使用。不要把本地存储、Cookie 或抓包请求头发给他人或放进仓库。清理会话时仅清除 `F1sh_Session`。

## 公开来源与许可

核对日期：2026-10-25。只研究公开页面和协议事实，没有复制网站脚本实现。

| 来源 | 核对内容 |
| --- | --- |
| [网鱼签到页](https://f1sh.com/checkin) 及页面加载的公开前端脚本 | 页面结构、`POST /checkin`、`mood` 字段、签到前后标记及北京时间日期规则 |
| [Loon 插件手册](https://nsloon.app/docs/Plugin/)、[Script v2](https://nsloon.app/docs/Script/script_v2/)、[Script API](https://nsloon.app/docs/Script/script_api/) | Loon 新版插件、脚本入口、请求与本地存储 API |

本目录、`plugins/f1sh.lpx`、`tests/f1sh.test.cjs` 的文件使用 [MIT 许可证](../../licenses/F1sh-MIT.txt)。公开页面仅用于核对协议行为，没有复制站点代码。此许可不改变 GLaDOS、V2EX、NodeSeek 或其他文件的许可范围。

## 验证范围

离线测试使用合成 HTML、模拟响应与内存版 Loon API，不访问网站或提交真实签到。已在登录态页面只读核对 DOM 结构，但这不等于验收原始 HTTP 响应；Loon 实机解析、设备捕获与真实签到均未完成。

已登录页面的原始响应、实际 POST 返回形式和 Loon 对多条 `Set-Cookie` 的表示仍需实机核实。脚本只在内存中合并 `pd_csrf`，若网站在请求期间轮换其他登录 Cookie，后续请求可能失效，需要重新捕获会话。

```sh
node --check scripts/f1sh/f1sh.js
node --test tests/f1sh.test.cjs
node --test tests/*.test.cjs
git diff --check
```
