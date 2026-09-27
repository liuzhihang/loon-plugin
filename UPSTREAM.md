# 来源与许可证

合并日期：2026-09-27。

| 来源 | 合并基线 | 范围 |
| --- | --- | --- |
| https://github.com/curtinp118/Scripthub | `719aac111e434349e40d23719c4d76ad585089de` | `scripts/`、`index.json` 及原始提交历史 |
| https://github.com/liuzhihang/loon（fork 自 curtinp118/Loon） | `acc88bb4fbdb5173b64afbb3291aac267b432945` | `profile/`、`plugins/`、`rules/` 及原始提交历史 |

Loon 来源的原始 MIT 许可证完整保留于 [licenses/Loon-MIT.txt](licenses/Loon-MIT.txt)，适用于该来源的文件。保留各文件中的原作者信息。

Scripthub 在上述基线没有 LICENSE 文件，也没有在 README 中声明开源许可证。本仓库保留 GitHub fork 关系和原有声明，不将这部分代码重新标记为 MIT。公开仓库可见性和 fork 功能不等同于授予任意再许可的权利。

本次维护改动：合并目录与内部 URL；三个 Loon 插件入口迁移至 3.5.1 新语法；GLaDOS 增加经账号身份验证的 Cookie 更新、浏览器 User-Agent 保存、Loon 响应状态字段兼容及重新登录提示处理。

后续同步上游时，应先比较变更并处理本地修改，不直接用上游文件覆盖修复。
