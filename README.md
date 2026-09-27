# loon-plugin

个人维护的 Loon 签到插件，面向 Loon 3.5.1（983）及以上版本。目前维护 GLaDOS、V2EX 和烧饼论坛三项。

本仓库由 [curtinp118/Scripthub](https://github.com/curtinp118/Scripthub) fork，曾合入 [liuzhihang/loon](https://github.com/liuzhihang/loon) 的配置与插件。现已移除未使用的脚本、规则集和主配置模板；两侧提交历史均保留，来源和许可证范围见 [UPSTREAM.md](UPSTREAM.md)。

当前统一维护地址为 `liuzhihang/loon-plugin`。安装和更新均使用本仓库的 URL；旧 `liuzhihang/loon` 仅作为迁移来源保留，不再是运行依赖。原作者署名、上游仓库名和许可证归属仍按来源保留。

## 目录

| 路径 | 内容 |
| --- | --- |
| `plugins/` | Loon 插件入口，脚本地址指向本仓库 |
| `scripts/` | 三项签到脚本及各自的使用说明 |
| `tests/` | GLaDOS、V2EX 和烧饼论坛的会话与签到离线回归测试 |
| `licenses/` | 按来源保留的许可证 |

## 使用

在 Loon 的插件页面从 URL 添加所需插件：

- [GLaDOS 自动签到](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/glados.lpx)
- [V2EX 每日签到](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/v2ex.lpx)
- [烧饼论坛每日签到](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/sb.lpx)

在现有个人配置中添加所需插件即可。

GLaDOS 的详细步骤见 [使用说明](scripts/glados/README.md)。安装新插件后，在受 Loon 接管的浏览器中登录对应域名并刷新控制台，收到“账号 Cookie 已更新”或“新账号已保存”通知后，再手动执行签到。

V2EX 支持 Edge 的浏览器登录会话。安装后登录并刷新 [Edge 每日任务](https://edge.v2ex.com/mission/daily)，保存会话后在同域名签到，详见 [使用说明](scripts/v2ex/README.md)。

烧饼论坛安装后登录并刷新 [每日签到页](https://sb.sb/signin/)，保存会话后每天 9:20 签到，不填写签到留言，详见 [使用说明](scripts/sb/README.md)。

## 自动化风险

实机签到成功只说明当次请求被接受，不代表站点允许自动化或保证账号不会受限。使用登录 Cookie、浏览器 User-Agent 或 Passkey 登录会话，均不能保证脚本无法被识别。

出现自动化检测、验证码、限流或账号异常提示时，应暂停对应定时任务，在官网核实规则与账号状态，不反复重试或绕过限制。不能接受账号风险时，使用网站的手动签到。

烧饼论坛的 [服务条款](https://sb.sb/pages/terms/) 和 [论坛规则](https://sb.sb/pages/rules/) 禁止绕过限流、验证码等控制，并保留封禁违规账号的处理方式；这不构成对单账号自动签到的明确授权。

## 验证

```sh
node --test tests/*.test.cjs
```

离线测试使用模拟请求，不访问真实账户。Loon 解析、iCloud 同步和真实接口结果需在设备上确认。当前 `.lpx` 入口使用新版语法；各历史脚本说明中的旧平台示例保留供参考。

## 维护边界

- Cookie、Token、节点订阅和个人 iCloud 配置仅保存在设备本地，不加入本仓库。
- 定时任务使用服务实际返回的结果，不把错误标成成功；服务端检测到自动化时应暂停核实，普通会话过期时再更新登录状态。
- 清理掉的上游文件可从 Git 历史找回，后续同步上游时不要重新引入未使用内容。
