# loon-plugin

个人维护的 Loon 签到插件，支持 GLaDOS 和 V2EX，要求 **Loon 3.5.1（983）或更高版本**。

原作者：[Curtinp118](https://github.com/curtinp118) · 更新维护：[liuzhihang](https://github.com/liuzhihang)

## 快捷安装

在已安装 Loon 的 iPhone / iPad 上，用 **Safari 打开本仓库 README**，点击对应的“安装”链接，在 Loon 中确认添加并启用插件。

| 插件 | 默认执行时间 | 快捷安装 | 插件地址 |
| --- | --- | --- | --- |
| [GLaDOS 自动签到](scripts/glados/README.md) | 每天 07:10 | [安装 GLaDOS](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fliuzhihang%2Floon-plugin%2Fmain%2Fplugins%2Fglados.lpx) | [插件直链](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/glados.lpx) |
| [V2EX 每日签到](scripts/v2ex/README.md) | 每天 09:10 | [安装 V2EX](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fliuzhihang%2Floon-plugin%2Fmain%2Fplugins%2Fv2ex.lpx) | [插件直链](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/v2ex.lpx) |

GLaDOS 支持多域名、多账号签到及积分查询，积分达到 500 时会自动兑换 `plan500`。V2EX 为单账号签到，支持 `edge.v2ex.com`、`www.v2ex.com` 和 `v2ex.com` 的登录会话。

快捷安装使用 [Loon 官方 Scheme 文档](https://nsloon.app/docs/Scheme/)提供的 HTTPS 导入入口。若 GitHub App、微信等内置浏览器未唤起 Loon，请改用 Safari；也可以复制下面的地址手动添加。

### 手动添加

在 Loon 的插件页面选择从 URL 添加，粘贴所需的 **`.lpx` 插件地址**：

GLaDOS：

```text
https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/glados.lpx
```

V2EX：

```text
https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/v2ex.lpx
```

插件会引用本仓库的 JS 脚本，无需手动复制脚本或替换整份 Loon 配置。

## 首次使用

1. 启用插件、脚本和 MitM，完成 Loon 的 MitM 证书安装与系统信任，并保持 Loon 连接。
2. 在受 Loon 接管的 Safari 中登录对应网站，按下表刷新页面，保存自己的登录会话。
3. 收到保存通知后，手动运行插件中的 `GLaDOS签到` 或 `V2EX签到` 任务，核对日志与通知；之后按默认时间自动运行。

| 插件 | 登录后需要刷新的页面 | 首次保存成功提示 |
| --- | --- | --- |
| GLaDOS | 对应域名的控制台，例如 [glados.network 控制台](https://glados.network/console/account) | “新账号已保存”或“账号 Cookie 已更新” |
| V2EX | 登录域名的 `/mission/daily`，例如 [Edge 每日任务](https://edge.v2ex.com/mission/daily) | “登录会话已更新” |

GLaDOS 在同一域名下按邮箱区分账号，同账号重新登录并抓取会更新旧 Cookie。V2EX 使用最后一次成功保存的会话，始终向该会话的原域名发送签到请求；Passkey 仅用于浏览器登录，脚本不读取或保存 Passkey。

详细说明：[GLaDOS](scripts/glados/README.md) · [V2EX](scripts/v2ex/README.md) · [Loon 插件手册](https://nsloon.app/docs/Plugin/)

## 更新与排查

- **更新版本**：在 Loon 中更新远程插件及其引用的远程 JS 脚本。当前功能版本为 GLaDOS `v1.4.3`、V2EX `v1.3.1`，以执行日志中的 `Version` 为准；账号数据无需为升级而清空。
- **没有抓取通知**：检查插件、脚本、MitM 和证书信任状态。插件更新或 iCloud 同步后，若请求记录只有 `域名:443` 的 TCP 连接、没有完整页面 URL，可重新连接 Loon 后再刷新页面。
- **登录会话过期**：在原域名重新登录，再刷新上表对应页面。
- **链接无法下载**：确认设备能够访问 `raw.githubusercontent.com`；无法快捷唤起时，使用上面的 `.lpx` 地址手动添加。

安装与更新统一使用 `liuzhihang/loon-plugin` 的地址；旧 `liuzhihang/loon` 仅作迁移来源保留。

## 原作者与更新维护

| 项目 | 原作者 / 来源 | 更新维护 |
| --- | --- | --- |
| GLaDOS、V2EX 脚本 | [Curtinp118](https://github.com/curtinp118) / [curtinp118/Scripthub](https://github.com/curtinp118/Scripthub) | [liuzhihang](https://github.com/liuzhihang) |
| Loon 插件入口 | [Curtinp118](https://github.com/curtinp118) / [curtinp118/Loon](https://github.com/curtinp118/Loon)，经 `liuzhihang/loon` 合入 | [liuzhihang](https://github.com/liuzhihang) |

原作者负责原始脚本与插件；liuzhihang 负责本仓库的 Loon 适配、会话与签到逻辑修复、测试、安装说明和后续更新。脚本头、插件信息及索引均保留原作者，并单独标明更新维护人。

本仓库由 `curtinp118/Scripthub` fork，保留两侧原始提交历史。来源基线与许可证范围见 [UPSTREAM.md](UPSTREAM.md) 和 [LICENSE.md](LICENSE.md)，不对全部文件统一声明 MIT。

使用问题与反馈请提交到[本仓库 Issues](https://github.com/liuzhihang/loon-plugin/issues)。分享给他人时，可直接发送[仓库首页](https://github.com/liuzhihang/loon-plugin#快捷安装)。

## 自动化风险

实机签到成功只说明当次请求被接受，不代表站点允许自动化或保证账号不会受限。使用登录 Cookie、浏览器 User-Agent 或 Passkey 登录会话，均不能保证脚本无法被识别。

出现自动化检测、验证码、限流或账号异常提示时，应暂停对应定时任务，在官网核实规则与账号状态，不反复重试或绕过限制。不能接受账号风险时，使用网站的手动签到。

## 验证

```sh
node --test tests/*.test.cjs
```

离线测试使用模拟请求，不访问真实账户。快捷唤起、Loon 解析、iCloud 同步和真实接口结果需在设备上确认。当前 `.lpx` 入口使用新版语法；各脚本说明保留 Quantumult X、Surge 配置示例，其设备兼容性需分别确认。

## 目录

| 路径 | 内容 |
| --- | --- |
| `plugins/` | Loon 插件入口，脚本地址指向本仓库 |
| `scripts/` | 两项签到脚本及各自的使用说明 |
| `tests/` | GLaDOS 和 V2EX 的会话与签到离线回归测试 |
| `licenses/` | 按来源保留的许可证 |

## 维护边界

- Cookie、Token、节点订阅和个人 iCloud 配置仅保存在设备本地，不加入本仓库。
- 定时任务使用服务实际返回的结果，不把错误标成成功；服务端检测到自动化时应暂停核实，普通会话过期时再更新登录状态。
- 清理掉的上游文件可从 Git 历史找回，后续同步上游时不要重新引入未使用内容。
