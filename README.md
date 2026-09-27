# loon-plugin

个人维护的 Loon 配置、插件、脚本与规则集合，面向 Loon 3.5.1（983）及以上版本。

本仓库由 [curtinp118/Scripthub](https://github.com/curtinp118/Scripthub) fork，并合入 [liuzhihang/loon](https://github.com/liuzhihang/loon) 的配置与插件。两侧提交历史均保留，来源和许可证范围见 [UPSTREAM.md](UPSTREAM.md)。

## 目录

| 路径 | 内容 |
| --- | --- |
| `profile/` | 原 Loon 仓库的公开主配置模板 |
| `plugins/` | Loon 插件入口，脚本地址指向本仓库 |
| `scripts/` | Scripthub 脚本及各脚本使用说明 |
| `rules/` | 规则集 |
| `tests/` | GLaDOS 和 V2EX 会话更新、签到结果的离线回归测试 |
| `licenses/` | 按来源保留的许可证 |

## 使用

在 Loon 的插件页面从 URL 添加所需插件：

- [GLaDOS 自动签到](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/glados.lpx)
- [V2EX 每日签到](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/v2ex.lpx)
- [蛋蛋不语插件](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/dandanvip.lpx)

完整主配置模板：[profile/Loon.conf](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/profile/Loon.conf)。已有个人配置时，只替换所需插件 URL，避免覆盖自己的节点和策略。

GLaDOS 的详细步骤见 [使用说明](scripts/glados/README.md)。安装新插件后，在受 Loon 接管的浏览器中登录对应域名并刷新控制台，收到“账号 Cookie 已更新”或“新账号已保存”通知后，再手动执行签到。

V2EX 支持 Edge 的浏览器登录会话。安装后登录并刷新 [Edge 每日任务](https://edge.v2ex.com/mission/daily)，保存会话后在同域名签到，详见 [使用说明](scripts/v2ex/README.md)。

## 验证

```sh
node --test tests/*.test.cjs
```

离线测试使用模拟请求，不访问真实账户。Loon 解析、iCloud 同步和真实接口结果需在设备上确认。当前三个 `.lpx` 入口使用新版语法；各历史脚本说明中的旧平台示例保留供参考。

## 维护边界

- Cookie、Token、节点订阅和个人 iCloud 配置仅保存在设备本地，不加入本仓库。
- 定时任务使用服务实际返回的结果；明确要求重新登录时需刷新登录状态，不把错误标成成功。
- 其他脚本由上游合入，合并和 URL 调整不代表它们已完成设备端验证。
