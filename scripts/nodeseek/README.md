# NodeSeek 自动签到

作者与维护：[liuzhihang](https://github.com/liuzhihang)。这是独立编写的单账号 Loon 插件，仅支持 `https://www.nodeseek.com`，不包含 DeepFlood、多账号、账号密码登录或验证码服务。

## 安装与首次启用

插件和脚本均从本仓库 `main` 下载。本实现已完成离线模拟测试，尚未经过真实 Loon 或账号签到验收。

1. 在 Loon 3.5.1（983）或更高版本中从 URL 添加插件：

   ```text
   https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/nodeseek.lpx
   ```

2. 按自己的设备设置启用插件、脚本和 MitM，安装并信任 Loon 的 MitM 证书，保持 Loon 接管 Safari 流量。插件仅声明 `www.nodeseek.com`，不会替换整份代理配置。
3. 在 Safari 登录 [NodeSeek](https://www.nodeseek.com/board)，由自己在官网手动签到一次。仅在该 POST 响应为 HTTP 200，且明确签到成功或已完成签到时，才保存请求中的 Cookie 和 User-Agent。收到“登录会话已更新”通知后，会话才已保存。普通浏览、刷新 `/board` 或仅有 Cookie 不会保存会话；捕获脚本不会补发签到请求，也不修改网页响应。
4. 可手动运行 Loon 中的 `NodeSeek签到` 检查插件加载情况。同日若有可信日期的确认记录，会显示“本地记录：今日已有确认结果”，并注明“本次未请求服务器”；这不能用来验收自动签到接口。没有当日记录则向服务端提交一次 POST。后续默认每天设备本地时间 **09:30** 执行。只有实际出现“签到成功”或“服务端：今日已签到”，才分别表示服务端确认了新签到或重复签到。

首次启用后的真实运行由使用者自行核实。遇到登录过期，重新登录并手动签到更新会话；遇到访问拒绝、安全验证或限流，先暂停定时任务，在官网核实，不连续运行。

## 参数与结果

插件参数使用 Loon 新版 `[Argument]` 语法，通过 `$argument` 对象传给定时脚本：

手动执行时若 Loon 未传参数（`undefined` 或 `null`），使用下表默认值；非法字符串或非布尔参数会停止执行。

| 设置 | 默认值 | 行为 |
| --- | --- | --- |
| 随机奖励 `random` | 关闭（`false`） | 关闭发送 `random=false`，开启发送 `random=true`。该值是奖励模式，不是随机字符串或防缓存参数 |
| 同日跳过 `useCache` | 开启（`true`） | 同一会话已有当日确认记录时跳过网络请求。关闭后每次运行均提交一次 POST，仍不自动重试 |

公开的 NodeSeek Pro v1.0.8 把 `random=false` 标注为固定 5 个鸡腿，`true` 标注为随机奖励。这是源码研究结果，不保证当前网站或账号的实际奖励；脚本只显示服务端返回且通过类型校验的 `gain`、`current` 数字，不自行补上“5”。

| 执行结果 | 本地记录 | 含义 |
| --- | --- | --- |
| 签到成功 | `kind: success` | HTTP 200、有效 JSON、`success === true`，且没有挑战、登录失效或访问拒绝等信号 |
| 服务端：今日已签到 | `kind: duplicate` | HTTP 200、布尔 `success` 和完整的“已完成签到”肯定句，可带“明天再来”等已支持后缀；含未知补充说明时停止，不计为新签到或新奖励 |
| 本地记录：今日已有确认结果 | 不更新 | 本次未请求服务器，只复用了同一会话的当日确认记录 |
| 签到未完成 | 不更新 | 网络错误、异常 HTTP 状态、非 JSON、未知响应或未明确成功；不把本次运行写成成功 |

本地日界固定使用 **UTC+8**，不依赖设备时区；定时任务时间使用设备本地时区。站点实际日界尚未实测，本地记录只是减少重复请求的策略。如需由服务端确认，先自行核实网站状态，再关闭“同日跳过”手动运行一次。该记录不是跨脚本实例的互斥锁，请只配置一份定时任务。

捕获响应只有在 HTTP `Date` 可解析、不是未来时间且距设备当前时间不超过 5 分钟时，才按该响应时间建立记录；否则只保存已验证会话，不猜测签到日期。请保持设备时间准确。自动 POST 使用请求开始时的日期，跨午夜返回时不会把结果直接记入次日，也不会覆盖同一会话较新的次日确认记录。

## 接口与停止条件

- 单次 `POST https://www.nodeseek.com/api/attendance?random=false` 或 `random=true`，请求体为 JSON `{}`，复用已保存的 Cookie 和浏览器 User-Agent，发送同站 Origin 与 Referer。
- 只接收 HTTP 200 的 JSON 对象；`"true"`、`1`、仅有奖励文案或未知字段都不当作 `success === true`。重复签到采用独立判断，不能凭文案中出现“鸡腿”就当作成功。
- HTTP 401、JSON `status: 404`（公开签到脚本的失效判据）或明确未登录提示要求重新登录；HTTP 404 按接口异常处理。HTTP 403、429、安全挑战和自动化拒绝会提示暂停核实。Cloudflare 挑战（包括 HTTP 200 挑战页）不会尝试解决。
- 请求超时为 15000 毫秒，脚本总超时为 30 秒。不自动重试任何签到请求，不跟随任何重定向，不关闭 TLS 证书校验，不使用自动 Cookie 容器。超时可能发生在服务器处理后，因此只报告结果不确定，需在官网核实。
- 确认成功后如本地记录写入失败，保留服务端成功结果，同时提示记录未保存。请求期间若保存了另一份会话，不用旧请求覆盖新会话。
- 通知发送异常不改变已确认的服务端结果或会话保存结果；可在日志查看预设的通知失败提示，不输出异常原文。

## 本地数据与排查

仅使用 Loon 本地存储键 `NodeSeek_Session`，内容为最近一次验证过的 Cookie、User-Agent 与可选的 `{ day, kind }` 日期记录。单账号运行，下一次成功捕获会替换旧会话；Cookie 不重复写入其他键，不保存密码、完整响应、账号资料或额外请求头。

日志和通知只使用预设的错误分类与校验过的奖励数字，不输出 Cookie、User-Agent、响应正文、服务端原始消息或网络异常文本。存储的会话属于敏感数据，请勿把本地存储或抓包请求头加入仓库或反馈截图。清除会话时只删除 `NodeSeek_Session`；无需清空其他插件数据。

没有捕获通知时，检查是否在 Safari 手动发出了 `POST /api/attendance?random=true|false`，且响应明确成功或已签到。插件规则严格匹配 POST；脚本兼容 Loon 回调省略 `method` 字段的情况，但仍须验证响应。相同会话、相同当日结果会静默跳过保存。登录页、错误页、挑战页、失败响应、缺少 User-Agent 或存储失败都会保留原会话。接口路径、重复签到文案或站点验证方式变化时可能需要更新脚本。

## 公开来源与许可

核对日期：2026-10-20。只研究接口和行为，未移植第三方实现。

| 来源 | 研究内容 | 许可与使用范围 |
| --- | --- | --- |
| [NodeSeek Pro v1.0.8](https://greasyfork.org/zh-CN/scripts/567109-nodeseek-pro/code) | POST 路径、布尔奖励参数、`success` / `gain` / `current` / `message` 字段；浏览器 `credentials: include` | 源码声明 GPL-3.0；未复制其实现。其在判断成功前写入当日日期的逻辑未采用 |
| [dragonff/NodeSeek](https://github.com/dragonff/NodeSeek/tree/39091eb5aab0a83439e8abd8f94456e503fa9ac3) | [Python](https://github.com/dragonff/NodeSeek/blob/39091eb5aab0a83439e8abd8f94456e503fa9ac3/nodeseek_sign.py) 的 JSON `{}` 请求体和“已完成签到”语义；与 Worker 参数进行对比 | 该基线根目录未提供许可证，README 的徽章链接到另一仓库，不视为本仓库授权；未复制代码。未采用 Worker 的随机字符串参数、验证码服务、登录或请求伪装机制 |
| [Loon 插件文档](https://nsloon.app/docs/Plugin/)、[Script API](https://nsloon.app/docs/Script/script_api/) | 新版脚本入口、布尔参数绑定、`$argument` 对象和空参数、毫秒请求超时、Cookie 与重定向开关 | 仅参考配置与 API 说明 |

本目录、新增 `plugins/nodeseek.lpx` 和 `tests/nodeseek.test.cjs` 的独立实现使用 [MIT 许可证](../../licenses/NodeSeek-MIT.txt)。此声明不改变 GLaDOS、V2EX 或其他上游文件的许可；完整来源边界见 [UPSTREAM.md](../../UPSTREAM.md) 与 [LICENSE.md](../../LICENSE.md)。

## 离线验证

```sh
node --test tests/nodeseek.test.cjs
node --test tests/*.test.cjs
node --check scripts/nodeseek/nodeseek.js
node --check tests/nodeseek.test.cjs
git diff --check
```

测试用合成会话和内存模拟 Loon API，不访问真实账号或签到接口。它们验证本地分支行为与插件规则文本，无法证明 Loon 实机解析、MitM 捕获、定时调度、浏览器会话有效期、站点日界或真实奖励已通过验收。
