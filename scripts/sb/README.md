# 烧饼论坛每日签到

适用于 Loon 3.5.1（983）及以上版本，每天 9:20 为当前保存的一个 sb.sb 账号签到。

## 安装与保存会话

1. 在 Loon 安装 [烧饼论坛插件](https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/plugins/sb.lpx)。
2. 保持 Loon 的脚本、MitM 和已受信任的证书开启。
3. 在 Safari 登录 [sb.sb](https://sb.sb/)，打开并刷新 [每日签到页](https://sb.sb/signin/)。已有 Passkey 登录会话也可使用。
4. 看到“登录会话已更新”后，可在 Loon 手动运行“烧饼论坛签到”验证。

iCloud 同步或新增插件后，如果请求记录没有完整的签到页 URL 和“烧饼论坛抓包”记录，重新连接 Loon，再刷新网页。会话过期后重复第 3 步。

## 行为

- Cookie 和浏览器 User-Agent 保存在设备本地的 `SB_Session`，不记录密码或 Passkey，不输出 Cookie/CSRF 内容。
- 每次运行先读取签到页，获取当前 CSRF token；只向 `https://sb.sb/signin/` 提交签到，不填写签到留言。
- 已签到时不再提交；提交后重新读取页面，确认“今日已签到”才报成功。网络错误不自动重试 POST。
- 登录页、网站验证页或无法识别的页面不会覆盖已保存会话；跨域跳转不会携带 Cookie 跟随。
- 仅适配 Loon。网站修改表单结构、会话过期或要求浏览器验证时，脚本会停止并提示处理。

## 验证

```sh
node --test tests/sb.test.cjs
```

离线测试模拟签到页、Cookie 轮换和 HTTP 返回，不访问真实账号。定时触发与真实账户结果需在设备上验证。
