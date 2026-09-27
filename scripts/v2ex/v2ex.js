/****************************** 
脚本功能：V2EX 每日签到
Version  : v1.3.0
更新时间：2026-09-27
作者：Curtinp118
Platform : Quantumult X / Loon / Surge

使用说明：
登录后访问 /mission/daily 保存 Cookie、域名和 User-Agent，定时任务在同一域名签到。
支持 edge.v2ex.com 的 Passkey 登录会话；脚本不读取或保存 Passkey。

[rewrite_local]
^https://(?:(?:www|edge)\.)?v2ex\.com/mission/daily(?:\?.*)?$ url script-response-body https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/v2ex/v2ex.js

[task_local]
10 9 * * * https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/v2ex/v2ex.js, tag=V2EX 每日签到, enabled=true

[MITM]
hostname = %APPEND% www.v2ex.com, edge.v2ex.com, v2ex.com
*******************************/

// ========== 三端适配层 ==========
var isQX = typeof $task !== "undefined";
var isLoon = typeof $loon !== "undefined";
var isSurge = typeof $httpClient !== "undefined" && !isLoon;

var $http = {
  fetch: function (opts) {
    if (isQX) return $task.fetch(opts);
    return new Promise(function (resolve, reject) {
      var method = (opts.method || "GET").toUpperCase();
      var handler = function (err, resp, data) {
        if (err) reject(err);
        else resolve({ statusCode: resp.status || resp.statusCode, headers: resp.headers, body: data });
      };
      if (method === "POST") $httpClient.post(opts, handler);
      else $httpClient.get(opts, handler);
    });
  }
};

var $store = {
  read: function (key) { return isQX ? $prefs.valueForKey(key) : $persistentStore.read(key); },
  write: function (val, key) { return isQX ? $prefs.setValueForKey(val, key) : $persistentStore.write(val, key); }
};

var notifyFn = isQX
  ? function (t, s, b) { $notify(t, s, b); }
  : function (t, s, b) { $notification.post(t, s, b); };

// ========== Logger 模块 ==========
var Logger = {
  scriptStart: function (name, version, platform, requestType) {
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var time = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
    console.log("🚀 Script Start");
    console.log("Time     : " + time);
    console.log("Version  : " + version + " | " + platform + " | " + requestType);
    console.log("Platform : " + platform);
    console.log("------------------------------------");
  },

  envCheck: function (cookieValid, tokenStatus) {
    console.log("📂 Environment");
    console.log("- Cookie : " + (cookieValid ? "Stored (not yet verified)" : "Missing"));
    console.log("- Session: " + tokenStatus);
    console.log("------------------------------------");
  },

  accountHeader: function (index, domain) {
    console.log("👤 Account | " + domain);
  },

  field: function (label, value) {
    var padding = "              ";
    var key = (label + padding).substring(0, 14);
    console.log(key + ": " + value);
  },

  status: function (icon, text) { this.field("Status", icon + " " + text); },
  points: function (val) { this.field("Points", val); },
  daysLeft: function (val) { this.field("Days left", val); },
  balance: function (val) { this.field("Balance", val); },
  action: function (val) { this.field("Action", val); },
  message: function (val) { this.field("Message", val); },

  separator: function () { console.log("------------------------------------"); },

  summary: function (total, success, duplicate, failed, result) {
    console.log("📊 Summary");
    console.log("Total      : " + total);
    console.log("Success    : " + success);
    console.log("Duplicate  : " + duplicate);
    console.log("Failed     : " + failed);
    console.log("🎯 Result  : " + result);
    console.log("End");
  }
};

// ========== 工具函数 ==========
var SCRIPT_NAME = "V2EX";
var SCRIPT_VERSION = "v1.3.0";
var COOKIE_KEY = "V2EX_Cookie";
var SESSION_KEY = "V2EX_Session";
var HOST = "www.v2ex.com";
var isGetHeader = typeof $request !== "undefined";

var COMMON_HEADERS = {
  "Accept": "*/*",
  "Accept-Language": "en,zh-CN;q=0.9,zh;q=0.8",
  "cache-control": "max-age=0",
  "pragma": "no-cache",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://www.v2ex.com/mission/daily"
};

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function getPlatform() {
  if (isQX) return "Quantumult X";
  if (isLoon) return "Loon";
  if (isSurge) return "Surge";
  return "Unknown";
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ========== 存储函数 ==========
function getStoredCookie() {
  try {
    var cookie = $store.read(COOKIE_KEY);
    return cookie ? String(cookie).trim() : "";
  } catch (e) { return ""; }
}

function allowedHost(host) {
  return /^(?:(?:www|edge)\.)?v2ex\.com$/.test(host);
}

function readHeader(headers, name) {
  var key = Object.keys(headers || {}).filter(function (key) { return key.toLowerCase() === name.toLowerCase(); })[0];
  return key ? headers[key] : "";
}

function getSession() {
  var raw = $store.read(SESSION_KEY);
  if (raw) {
    var session = safeJsonParse(raw);
    return session && allowedHost(session.host) && typeof session.cookie === "string" && session.cookie.trim() ? session : null;
  }
  // 旧版 Cookie 只用于原来的 www 域名，不猜测它是否能跨域使用。
  var cookie = getStoredCookie();
  return cookie ? { host: "www.v2ex.com", cookie: cookie, userAgent: "" } : null;
}

function saveSession(session) {
  var value = JSON.stringify(session);
  if ($store.read(SESSION_KEY) === value) return false;
  if (!$store.write(value, SESSION_KEY)) throw new Error("本地存储写入失败");
  return true;
}

function buildHeaders(session) {
  var h = {};
  for (var k in COMMON_HEADERS) { h[k] = COMMON_HEADERS[k]; }
  h["Cookie"] = session.cookie;
  h["User-Agent"] = session.userAgent || COMMON_HEADERS["User-Agent"];
  h["Referer"] = "https://" + session.host + "/mission/daily";
  return h;
}

// ========== 网络请求 ==========
function fetchUrl(url, headers, redirects) {
  var opts = { url: url, headers: headers, method: "GET" };
  if (isLoon) {
    opts["auto-cookie"] = false;
    opts["auto-redirect"] = false;
    opts.insecure = false;
  }
  return $http.fetch(opts).then(function (resp) {
    if (resp.statusCode >= 300 && resp.statusCode < 400) {
      var location = readHeader(resp.headers, "Location");
      var base = "https://" + HOST;
      if (/^\/(?!\/)/.test(location)) location = base + location;
      if (location.indexOf(base + "/") !== 0 || (redirects || 0) >= 3) throw new Error("重定向异常，请在已登录域名重新抓取会话");
      return fetchUrl(location, headers, (redirects || 0) + 1);
    }
    if (resp.statusCode !== 200) throw new Error("HTTP " + resp.statusCode);
    return resp.body || "";
  });
}

function formatBalance(html) {
  try {
    if (!html) return "";
    var parts = [];
    var balanceBlock = html.match(/balance_area bigger[\s\S]*?<\/div>/);
    if (!balanceBlock) return "";
    var block = balanceBlock[0];
    var re = /(\d+)\s+<img[^>]+alt="([A-Z])"/g;
    var m;
    while ((m = re.exec(block)) !== null) {
      var num = m[1];
      var type = m[2];
      if (type === "G") parts.push(num + " 金币");
      if (type === "S") parts.push(num + " 银币");
      if (type === "B") parts.push(num + " 铜币");
    }
    return parts.join(", ") || "";
  } catch (e) { return ""; }
}

function parseDaily(html) {
    if (!html) return { once: "", logged_in: false, already: false, days: "?" };
    if (html.includes("你要查看的页面需要先登录") || html.includes("需要先登录")) {
      return { once: "", logged_in: false, already: false, days: "?" };
    }
    var daysMatch = html.match(/已连续登录\s*(\d+)\s*天/);
    var days = daysMatch ? daysMatch[1] : "?";
    if (html.includes("每日登录奖励已领取")) {
      return { once: "", logged_in: true, already: true, days: days };
    }
    var onceMatch = html.match(/\/mission\/daily\/redeem\?once=(\d+)/);
    return { once: onceMatch ? onceMatch[1] : "", logged_in: true, already: false, days: days };
}

function getOnce(headers) {
  return fetchUrl("https://" + HOST + "/mission/daily", headers).then(parseDaily);
}

function queryBalance(headers) {
  return fetchUrl("https://" + HOST + "/balance", headers).then(function (html) {
    return { balance: formatBalance(html) };
  });
}

function checkIn(once, headers) {
  return fetchUrl("https://" + HOST + "/mission/daily/redeem?once=" + once, headers);
}

function doCheckin(attempt, maxRetry, headers) {
  Logger.action("签到尝试 " + (attempt + 1) + "/" + maxRetry);

  return getOnce(headers).then(function (info) {
    if (!info.logged_in) {
      Logger.status("❌", "Cookie 已失效");
      Logger.summary(1, 0, 0, 1, "Cookie 已失效");
      notifyFn("V2EX", "❌ Cookie 已失效", "请在 " + HOST + " 登录并刷新每日任务页面");
      $done({});
      return;
    }

    if (info.already) {
      return queryBalance(headers).then(function (q) {
        Logger.accountHeader(null, HOST);
        Logger.status("🔁", "今日已签到");
        Logger.daysLeft("连续 " + info.days + " 天");
        if (q.balance) Logger.balance(q.balance);
        Logger.separator();
        Logger.summary(1, 0, 1, 0, "今日已签到");
        notifyFn("V2EX", "🔁 今日已签到", "连续 " + info.days + " 天" + (q.balance ? " | " + q.balance : ""));
        $done({});
      });
    }

    if (!info.once) {
      if (attempt + 1 < maxRetry) {
        return sleep(3000).then(function () { return doCheckin(attempt + 1, maxRetry, headers); });
      }
      Logger.summary(1, 0, 0, 1, "未找到 once 码");
      notifyFn("V2EX", "❌ 签到失败", "未找到 once 码");
      $done({});
      return;
    }

    return checkIn(info.once, headers).then(function () {
      return getOnce(headers);
    }).then(function (after) {
      if (!after.already) throw new Error("领取后尚未确认奖励，请在每日任务页面核实");
      info.days = after.days;
      return queryBalance(headers);
    }).then(function (q) {
      Logger.accountHeader(null, HOST);
      Logger.status("✅", "签到成功");
      Logger.daysLeft("连续 " + info.days + " 天");
      if (q.balance) Logger.balance(q.balance);
      Logger.separator();
      Logger.summary(1, 1, 0, 0, "签到成功");
      notifyFn("V2EX", "✅ 签到成功", "连续 " + info.days + " 天" + (q.balance ? " | " + q.balance : ""));
      $done({});
    });
  }).catch(function (e) {
    if (attempt + 1 < maxRetry) {
      return sleep(3000).then(function () { return doCheckin(attempt + 1, maxRetry, headers); });
    }
    Logger.status("❌", "签到未完成");
    Logger.message(e && e.message || "请检查网络或登录状态");
    Logger.summary(1, 0, 0, 1, "签到未完成");
    notifyFn("V2EX", "❌ 签到未完成", "请检查 " + HOST + " 的网络和登录状态");
    $done({});
  });
}

// ========== 主流程 ==========
if (isGetHeader) {
  Logger.scriptStart(SCRIPT_NAME, SCRIPT_VERSION, getPlatform(), "Manual");

  var allHeaders = $request.headers || {};
  var cookie = readHeader(allHeaders, "Cookie");
  var urlMatch = ($request.url || "").match(/^https:\/\/([^/:?#]+)\//i);
  var host = urlMatch ? urlMatch[1].toLowerCase() : "";
  var session = { host: host, cookie: cookie, userAgent: readHeader(allHeaders, "User-Agent") };

  if (!cookie || !allowedHost(host)) {
    Logger.status("⚠️", "未获取到受支持域名的 Cookie");
    $done({});
  } else {
    HOST = host;
    var hasResponse = typeof $response !== "undefined";
    var validation = hasResponse
      ? Promise.resolve(parseDaily(($response.status || $response.statusCode) === 200 ? $response.body || "" : ""))
      : getOnce(buildHeaders(session));
    validation.then(function (info) {
      if (!info.already && !info.once) throw new Error("请登录后刷新每日任务页面");
      var saved = saveSession(session);
      Logger.status("✅", saved ? "登录会话已更新" : "登录会话未变化");
      Logger.field("Domain", host);
      if (saved) notifyFn("V2EX", "登录会话已更新", host + " | 每天 9:10 签到");
      $done({});
    }).catch(function () {
      Logger.status("⚠️", "会话未保存，原有会话保留");
      notifyFn("V2EX", "抓取失败", "请在 " + host + " 登录后刷新每日任务页面");
      $done({});
    });
  }
} else {
  Logger.scriptStart(SCRIPT_NAME, SCRIPT_VERSION, getPlatform(), "Cron");

  var storedSession = getSession();
  if (!storedSession) {
    Logger.envCheck(false, "Missing");
    Logger.status("⚠️", "无 Cookie");
    notifyFn("V2EX", "⚠️ 无 Cookie", "请登录后访问 /mission/daily");
    $done({});
  } else {
    Logger.envCheck(true, "Found");
    HOST = storedSession.host;
    var headers = buildHeaders(storedSession);
    doCheckin(0, 3, headers);
  }
}
