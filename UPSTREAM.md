# 来源与许可证

合并日期：2026-09-27。

| 来源 | 合并基线 | 范围 |
| --- | --- | --- |
| https://github.com/curtinp118/Scripthub | `719aac111e434349e40d23719c4d76ad585089de` | `scripts/`、`index.json` 及原始提交历史 |
| https://github.com/liuzhihang/loon（fork 自 curtinp118/Loon） | `acc88bb4fbdb5173b64afbb3291aac267b432945` | `profile/`、`plugins/`、`rules/` 及原始提交历史 |

Loon 来源的原始 MIT 许可证完整保留于 [licenses/Loon-MIT.txt](licenses/Loon-MIT.txt)，适用于该来源的文件。保留各文件中的原作者信息。

## 原作者与更新维护

- 原作者：[Curtinp118](https://github.com/curtinp118)。GLaDOS、V2EX 脚本来自 `curtinp118/Scripthub`，插件入口来自 `curtinp118/Loon`，均保留原始署名。
- 更新维护：[liuzhihang](https://github.com/liuzhihang)。负责本仓库的 Loon 适配、会话与签到逻辑修复、离线测试、安装说明及后续更新；维护地址为 [liuzhihang/loon-plugin](https://github.com/liuzhihang/loon-plugin)。
- `index.json` 中的 `author` 保留原作者，`maintainer` 记录当前更新维护人；插件的 `#!author` 与脚本头分别标明两者角色。

## 维护范围

上述表格记录合并时的范围。2026-09-27 按实际使用范围精简后，已移除蛋蛋不语及其他未接入的上游脚本、`rules/` 和 `profile/`。当时只保留 GLaDOS 和 V2EX 两个插件、对应脚本、说明和测试；2026-10-20 新增独立编写的 NodeSeek 插件。删除未重写 Git 历史，原文件仍可从合并基线和后续提交中追溯。

Scripthub 在上述基线没有 LICENSE 文件，也没有在 README 中声明开源许可证。本仓库保留 GitHub fork 关系和原有声明，不将这部分代码重新标记为 MIT。公开仓库可见性和 fork 功能不等同于授予任意再许可的权利。

维护改动：合并目录与内部 URL；原有三个 Loon 插件入口迁移至 3.5.1 新语法；GLaDOS 增加经账号身份验证的 Cookie 更新、浏览器 User-Agent 保存、Loon 响应状态字段兼容及重新登录提示处理；V2EX 增加 Edge 会话支持和签到结果复核。

旧 `liuzhihang/loon` 的 `main`（上述合并基线）已是本仓库历史的一部分。来源记录中的旧仓库名用于追溯，不应随当前仓库改名而替换。停用旧仓库前还应检查其他设备或使用者保存的旧 URL；保留并归档旧仓库可继续提供这些链接。

后续同步上游时，应先比较变更并处理本地修改，不直接用上游文件覆盖修复。

## NodeSeek 独立实现与接口研究

核对日期：2026-10-20。`scripts/nodeseek/`、`plugins/nodeseek.lpx` 和 `tests/nodeseek.test.cjs` 由 liuzhihang 独立实现，使用 [licenses/NodeSeek-MIT.txt](licenses/NodeSeek-MIT.txt)，不继承其他脚本的作者声明，也不改变上述旧文件的许可范围。

| 只读研究来源 | 核对版本 / 基线 | 核对结果与许可边界 |
| --- | --- | --- |
| [NodeSeek Pro 源码](https://greasyfork.org/zh-CN/scripts/567109-nodeseek-pro/code) | v1.0.8 | 声明 GPL-3.0。确认 `POST /api/attendance?random=true\|false` 与 `success`、`gain`、`current`、`message` 字段。源码将 false 标注为固定 5 个鸡腿；这是公开源码信息，不保证实际奖励。仅参考接口，不复制实现；不采用在验证成功前写入当日记录的行为 |
| [dragonff/NodeSeek](https://github.com/dragonff/NodeSeek/tree/39091eb5aab0a83439e8abd8f94456e503fa9ac3) | `39091eb5aab0a83439e8abd8f94456e503fa9ac3` | Python 入口使用同一 POST、JSON `{}` 与“已完成签到”判定。基线根目录未提供许可证，README 徽章指向其他仓库，不据此推定授权；未复制实现。Worker 的 random 为随机字符串，与浏览器布尔参数语义不一致，未采用；验证码服务、登录和请求伪装机制均未接入 |
| [Loon 插件文档](https://nsloon.app/docs/Plugin/)、[Script API](https://nsloon.app/docs/Script/script_api/) | 读取时的 3.5.1（983）新版语法与 API 说明 | 参考响应脚本、布尔 `[Argument]` 声明、`$argument` 对象与空参数、毫秒请求超时和请求安全开关 |

会话捕获只观察用户手动签到的已确认响应，不主动登录或补发签到。自动任务每次最多一个 POST，服务端成功、服务端重复与本地跳过分别记录；异常结果不写成功日期，不跟随重定向，不自动重试或绕过挑战。实现、参数、离线测试与未验证项见 [NodeSeek 说明](scripts/nodeseek/README.md)。未使用用户账号验证当前接口或实际奖励。

提交前审查收紧了重复签到的完整文案判定与矛盾错误状态处理，补充通知异常隔离、Loon 空参数兼容及显式请求超时。捕获缓存依据近期可信响应日期，自动请求保守使用开始日期，跨午夜不覆盖较新的确认记录；会话切换、存储异常和这些日期边界均有合成数据离线回归测试。

2026-10-21 的 `v1.0.1` 完善纯远程插件接入：主配置只需 `.lpx` 入口，由插件管理远程脚本、捕获开关、自动签到开关与 Cron 时间。自动签到默认关闭，首次保存会话后由使用者开启；不依赖设备上的本地 JS 副本，也不要求在主配置重复维护捕获、定时或 MitM 条目。
