/*
 * 烧饼论坛每日签到 | v1.0.1 | 2026-09-27
 * Author: liuzhihang
 * Platform: Loon 3.5.1+
 * 登录后刷新 https://sb.sb/signin/ 保存会话；每天 9:20 签到。
 * 仅提交签到所需的 CSRF 字段，不填写留言，不重试 POST。
 */
(function () {
  "use strict";

  var TITLE = "烧饼论坛";
  var KEY = "SB_Session";
  var ORIGIN = "https://sb.sb";
  var DAILY = ORIGIN + "/signin/";
  var capture = typeof $request !== "undefined";

  function header(headers, name) {
    var key = Object.keys(headers || {}).find(function (key) {
      return key.toLowerCase() === name.toLowerCase();
    });
    return key ? headers[key] : "";
  }

  function decode(text) {
    return String(text).replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, function (_, entity) {
      var named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
      if (entity[0] !== "#") return named[entity.toLowerCase()];
      var code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
  }

  function attr(tag, name) {
    var match = tag.match(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i"));
    return match ? decode(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3]) : "";
  }

  function plain(html) {
    return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }

  // 只读签到操作区域，避免把签到榜留言中的“今日已签到”当作账户状态。
  function actionBlock(html) {
    var tags = /<([a-z][\w:-]*)\b[^>]*>/gi;
    var tag;
    while ((tag = tags.exec(html))) {
      if (attr(tag[0], "class").split(/\s+/).indexOf("signin-hero-action") < 0) continue;
      var nested = new RegExp("<(/?)" + tag[1] + "\\b[^>]*>", "gi");
      nested.lastIndex = tags.lastIndex;
      var depth = 1, end;
      while ((end = nested.exec(html))) {
        depth += end[1] ? -1 : 1;
        if (!depth) return html.slice(tag.index, nested.lastIndex);
      }
    }
    return "";
  }

  function parsePage(body) {
    var html = String(body || "").replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    if (/<form\b[^>]*\baction=["']\/login\//i.test(html)) return { state: "login" };
    var action = actionBlock(html);
    if (!action) return { state: "unknown" };
    var buttons = action.match(/<button\b[^>]*>[\s\S]*?<\/button>/gi) || [];
    if (buttons.some(function (button) { return plain(button) === "今日已签到"; })) return { state: "signed" };
    var available = buttons.some(function (button) {
      var opening = button.slice(0, button.indexOf(">") + 1);
      return plain(button) === "立即签到" && !/\sdisabled(?:\s|=|>)/i.test(opening);
    });
    if (!available) return { state: "unknown" };
    var forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i], opening = form.slice(0, form.indexOf(">") + 1);
      if (attr(opening, "method").toLowerCase() !== "post") continue;
      if (["/signin/", DAILY].indexOf(attr(opening, "action")) < 0) continue;
      if (!form.includes("立即签到")) continue;
      if (/cf-turnstile|g-recaptcha|h-captcha|captcha-response/i.test(form)) return { state: "challenge" };
      var inputs = form.match(/<input\b[^>]*>/gi) || [];
      var csrf = inputs.find(function (input) { return attr(input, "name") === "_csrf"; });
      var token = csrf ? attr(csrf, "value") : "";
      if (token && token.length <= 512) return { state: "ready", csrf: token };
    }
    return { state: "unknown" };
  }

  function validPage(page) {
    if (page.state === "login") throw new Error("登录已失效，请在 Safari 登录后刷新签到页");
    if (page.state === "challenge") throw new Error("需要在 Safari 完成网站验证后重新抓取");
    if (page.state !== "ready" && page.state !== "signed") throw new Error("未识别到签到状态，请在 Safari 查看签到页");
    return page;
  }

  function save(session) {
    var value = JSON.stringify(session);
    if ($persistentStore.read(KEY) === value) return false;
    if (!$persistentStore.write(value, KEY)) throw new Error("本地会话保存失败");
    return true;
  }

  // 仅接收 sb.sb 本身响应设置的 Cookie，用于同一次请求中的 CSRF/会话轮换。
  function updateCookies(session, headers) {
    var setCookie = header(headers, "set-cookie");
    if (!setCookie) return;
    var jar = Object.create(null);
    session.cookie.split(/;\s*/).forEach(function (pair) {
      var equal = pair.indexOf("=");
      if (equal > 0) jar[pair.slice(0, equal)] = pair.slice(equal + 1);
    });
    var lines = Array.isArray(setCookie) ? setCookie : String(setCookie).split(/,(?=\s*[^=;,\s]+=)/);
    lines.forEach(function (line) {
      var pair = line.match(/^\s*([^=;,\s]+)=([^;]*)/);
      if (!pair) return;
      var domain = line.match(/;\s*domain=([^;]+)/i);
      if (domain && domain[1].trim().replace(/^\./, "").toLowerCase() !== "sb.sb") return;
      if (/;\s*max-age=0(?:;|$)/i.test(line) || !pair[2]) delete jar[pair[1]];
      else jar[pair[1]] = pair[2];
    });
    session.cookie = Object.keys(jar).map(function (name) { return name + "=" + jar[name]; }).join("; ");
  }

  function redirectPath(location) {
    if (location.indexOf(ORIGIN + "/") === 0) location = location.slice(ORIGIN.length);
    if (/^\/login\/(?:\?|$)/.test(location)) throw new Error("登录已失效，请重新登录并刷新签到页");
    if (!/^\/signin\/(?:\?[^\s\\]*)?$/.test(location)) throw new Error("签到请求发生异常跳转，已停止");
    return ORIGIN + location;
  }

  function request(method, session, csrf, url, hops) {
    url = url || DAILY;
    var headers = {
      Cookie: session.cookie,
      "User-Agent": session.userAgent,
      Accept: "text/html",
      Referer: DAILY,
      "Cache-Control": "no-cache"
    };
    // Loon $httpClient timeout uses milliseconds.
    var options = { url: url, headers: headers, timeout: 15000, "auto-redirect": false, "auto-cookie": false, insecure: false };
    if (method === "POST") {
      headers.Origin = ORIGIN;
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      options.body = "_csrf=" + encodeURIComponent(csrf);
    }
    return new Promise(function (resolve, reject) {
      $httpClient[method === "POST" ? "post" : "get"](options, function (error, response, body) {
        if (error || !response) return reject(new Error(method === "POST" ? "签到提交的网络结果不确定，请在网页核实；未重复提交" : "签到页请求失败，请检查网络"));
        var status = Number(response.status || response.statusCode);
        try {
          updateCookies(session, response.headers || {});
          if (status >= 300 && status < 400) {
            var next = redirectPath(String(header(response.headers, "location")));
            if ((hops || 0) >= 2) throw new Error("签到页面重定向次数过多");
            if (method === "POST" && status !== 302 && status !== 303) throw new Error("签到提交发生异常跳转；未重复提交");
            return resolve(request("GET", session, "", next, (hops || 0) + 1));
          }
          if (status !== 200) throw new Error("签到请求返回 HTTP " + status + "，请在 Safari 查看登录或验证状态");
          resolve(String(body || ""));
        } catch (e) { reject(e); }
      });
    });
  }

  function report(kind, message) {
    console.log("Status   : " + kind);
    console.log("Message  : " + message);
    $notification.post(TITLE, kind, message);
  }

  async function run() {
    console.log("🚀 " + TITLE + " | v1.0.1 | Loon | " + (capture ? "Capture" : "Cron"));
    console.log("Time     : " + new Date().toISOString());
    if (capture) {
      if (!/^https:\/\/sb\.sb\/signin\/(?:\?.*)?$/.test($request.url || "") || String($request.method || "GET").toUpperCase() !== "GET") throw new Error("不是受支持的签到页请求，原有会话保留");
      if (typeof $response === "undefined" || Number($response.status || $response.statusCode) !== 200) throw new Error("签到页响应未成功，原有会话保留");
      var session = { cookie: header($request.headers, "cookie"), userAgent: header($request.headers, "user-agent") };
      if (!session.cookie || !session.userAgent) throw new Error("未获取到完整登录会话，原有会话保留");
      validPage(parsePage($response.body));
      updateCookies(session, $response.headers || {});
      if (save(session)) report("✅ 登录会话已更新", "sb.sb | 每天 9:20 签到");
      else console.log("Status   : ✅ 登录会话未变化");
      return;
    }
    var raw = $persistentStore.read(KEY), stored;
    try { stored = JSON.parse(raw || "null"); } catch (_) { stored = null; }
    if (!stored || typeof stored.cookie !== "string" || !stored.cookie || typeof stored.userAgent !== "string" || !stored.userAgent) throw new Error("未保存登录会话，请登录并刷新 https://sb.sb/signin/");
    var before = validPage(parsePage(await request("GET", stored)));
    save(stored);
    if (before.state === "signed") {
      report("🔁 今日已签到", "服务器已确认，未重复提交");
      return;
    }
    await request("POST", stored, before.csrf);
    var after = validPage(parsePage(await request("GET", stored)));
    if (after.state !== "signed") throw new Error("提交后尚未确认签到成功，请在网页核实；未重复提交");
    save(stored);
    report("✅ 签到成功", "已重新读取签到页，确认今日已签到");
  }

  run().catch(function (error) {
    report("❌ " + (capture ? "会话未保存" : "签到未完成"), error.message || "请检查登录状态和网络");
  }).finally(function () { $done({}); });
})();
