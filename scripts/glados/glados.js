/****************************** 
脚本功能：GLaDOS / Railgun 自动签到 + 积分兑换（多账号版）
Version  : v1.4.1
更新时间：2026-09-27
作者：Curtinp118
Platform : Quantumult X / Loon / Surge

使用说明：
Loon 刷新控制台，捕获 /api/user/status 成功响应更新 Cookie；其他平台保留请求抓取方式。
支持 glados.network、railgun.info、glados.vip、glados.one、glados.space，各域名支持多账号。

[rewrite_local]
^https://glados\.network/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
^https://railgun\.info/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
^https://glados\.vip/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
^https://glados\.one/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js
^https://glados\.space/console/account$ url script-request-header https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js

[task_local]
10 7 * * * https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/glados/glados.js, tag=GLaDOS 签到, enabled=true

[MITM]
hostname = %APPEND% glados.network, railgun.info, glados.vip, glados.one, glados.space
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
    console.log("- Accounts: " + tokenStatus);
    console.log("------------------------------------");
  },

  accountHeader: function (index, domain) {
    if (index !== undefined && index !== null) {
      console.log("👤 Account #" + index + " | " + domain);
    } else {
      console.log("👤 Account | " + domain);
    }
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
var SCRIPT_NAME = "GLaDOS";
var SCRIPT_VERSION = "v1.4.1";
var COOKIES_KEY_PREFIX = "GLaDOS_Cookies";
var ACCOUNT_META_PREFIX = "GLaDOS_AccountMeta";
var DOMAINS_LIST_KEY = "GLaDOS_Domains";
var EXCHANGE_PLAN = "plan500";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
var isGetHeader = typeof $request !== "undefined";

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

function readHeader(headers, name) {
  var key = Object.keys(headers || {}).filter(function (key) { return key.toLowerCase() === name.toLowerCase(); })[0];
  return key ? headers[key] : "";
}

function getPlatform() {
  if (isQX) return "Quantumult X";
  if (isLoon) return "Loon";
  if (isSurge) return "Surge";
  return "Unknown";
}

// ========== 存储函数 ==========
function cookiesKeyFor(domain) {
  return COOKIES_KEY_PREFIX + ":" + domain;
}

function getSavedDomains() {
  try {
    var raw = $store.read(DOMAINS_LIST_KEY);
    if (!raw) return [];
    var list = safeJsonParse(raw) || [];
    return Array.isArray(list) ? list.filter(function (domain) { return typeof domain === "string" && /^(glados\.(network|vip|one|space)|railgun\.info)$/.test(domain); }) : [];
  } catch (e) { return []; }
}

function addDomain(domain) {
  try {
    var list = getSavedDomains();
    if (list.indexOf(domain) === -1) {
      list.push(domain);
      return $store.write(JSON.stringify(list), DOMAINS_LIST_KEY);
    }
    return true;
  } catch (e) { return false; }
}

function getCookiesForDomain(domain) {
  try {
    var raw = $store.read(cookiesKeyFor(domain));
    if (!raw) return [];
    var list = safeJsonParse(raw);
    return Array.isArray(list) ? list.filter(function (cookie) { return typeof cookie === "string" && cookie.length > 0; }) : [];
  } catch (e) { return []; }
}

function getAccountMeta(domain) {
  var list = safeJsonParse($store.read(ACCOUNT_META_PREFIX + ":" + domain) || "[]");
  return Array.isArray(list) ? list.filter(function (item) { return item && typeof item.cookie === "string"; }) : [];
}

function findAccountMeta(domain, cookie) {
  return getAccountMeta(domain).filter(function (item) { return item.cookie === cookie; })[0] || {};
}

function saveCookie(domain, cookie, userAgent, verifiedEmail) {
  var identity = verifiedEmail
    ? Promise.resolve({ email: verifiedEmail })
    : getStatus(cookie, domain, userAgent);
  return identity.then(function (current) {
    if (!current.email || current.email === "unknown") throw new Error("无法验证账号，请登录后刷新控制台");
    var email = current.email.toLowerCase();
    var cookies = getCookiesForDomain(domain);
    // 旧版只有 Cookie 数组；先查询旧会话身份，保留无法识别的其他账号。
    return Promise.all(cookies.map(function (saved) {
      var meta = findAccountMeta(domain, saved);
      if (saved === cookie) return { email: email };
      return meta.email && meta.email !== "unknown" ? Promise.resolve(meta) : getStatus(saved, domain);
    })).then(function (identities) {
      var replaced = false;
      var next = [];
      var metadata = [];
      cookies.forEach(function (saved, i) {
        var identityEmail = String(identities[i].email || "").toLowerCase();
        if (saved === cookie || identityEmail === email) {
          replaced = true;
          return;
        }
        if (next.indexOf(saved) !== -1) return;
        next.push(saved);
        var meta = findAccountMeta(domain, saved);
        metadata.push({ cookie: saved, email: identityEmail, userAgent: meta.userAgent || "" });
      });
      next.push(cookie);
      metadata.push({ cookie: cookie, email: email, userAgent: userAgent || findAccountMeta(domain, cookie).userAgent || "" });
      if (!$store.write(JSON.stringify(next), cookiesKeyFor(domain)) ||
          !$store.write(JSON.stringify(metadata), ACCOUNT_META_PREFIX + ":" + domain) || !addDomain(domain)) {
        throw new Error("本地存储写入失败");
      }
      return { isNew: !replaced, index: next.length - 1, email: email };
    });
  });
}

function getHostFromRequest() {
  var url = ($request && $request.url) || "";
  var m = url.match(/^https:\/\/([^/:?#]+)/i);
  return m ? m[1].toLowerCase() : "";
}

// ========== 网络请求 ==========
function request(url, method, cookie, domain, body, userAgent) {
  var headers = {
    "Content-Type": "application/json;charset=UTF-8",
    "Origin": "https://" + domain,
    "Referer": "https://" + domain + "/console/checkin",
    "User-Agent": userAgent || findAccountMeta(domain, cookie).userAgent || UA,
    "Cookie": cookie
  };
  var opts = { url: url, method: method, headers: headers };
  if (isLoon) {
    opts["auto-cookie"] = false;
    opts["auto-redirect"] = false;
    opts.insecure = false;
  }
  if (body !== undefined) opts.body = typeof body === "string" ? body : JSON.stringify(body);

  return $http.fetch(opts).then(
    function (resp) {
      if (resp.statusCode >= 300 && resp.statusCode < 400) {
        return { statusCode: resp.statusCode, data: null, raw: "", error: "接口返回 HTTP " + resp.statusCode + " 重定向，已停止跟随；请在原域名核实登录状态" };
      }
      return { statusCode: resp.statusCode, data: safeJsonParse(resp.body || ""), raw: resp.body || "" };
    },
    function (reason) {
      return { statusCode: 0, data: null, raw: "", error: reason ? String(reason) : "Network error" };
    }
  );
}

// ========== API ==========
function checkin(cookie, domain) {
  return request("https://" + domain + "/api/user/checkin", "POST", cookie, domain, { token: domain }).then(function (resp) {
    if (resp.error) return { status: "签到失败", code: -2, message: resp.error, points: "0" };
    if (!resp.data) return { status: "签到失败", code: -2, message: resp.raw, points: "0" };
    var data = resp.data;
    var code = data.code !== undefined ? data.code : -2;
    var message = data.message || "";
    var points = String(data.points !== undefined ? data.points : 0);
    if (/automated check-in detected|sign in again|not logged in|未登录|重新登录/i.test(message) || resp.statusCode === 401 || resp.statusCode === 403) {
      return { status: "需要重新登录并抓取 Cookie", code: -3, apiCode: code, message: message, points: "0", needsLogin: true };
    }
    if (code === 0) return { status: "签到成功", code: 0, message: message, points: points };
    if (code === 1) return { status: "重复签到", code: 1, message: message, points: "0" };
    return { status: "签到失败", code: code, message: message, points: "0" };
  });
}

function getStatus(cookie, domain, userAgent) {
  return request("https://" + domain + "/api/user/status", "GET", cookie, domain, undefined, userAgent).then(function (resp) {
    if (resp.error || !resp.data || resp.statusCode !== 200 || (resp.data.code !== undefined && resp.data.code !== 0)) return { leftDays: "N/A", email: "unknown" };
    var data = resp.data.data || {};
    var leftDays = data.leftDays;
    var email = typeof data.email === "string" && data.email.indexOf("@") > 0 ? data.email : "unknown";
    var days = (leftDays !== undefined && leftDays !== null) ? parseInt(parseFloat(leftDays), 10) + " 天" : "N/A";
    return { leftDays: days, email: email };
  });
}

function getPoints(cookie, domain) {
  return request("https://" + domain + "/api/user/points", "GET", cookie, domain).then(function (resp) {
    if (resp.error || !resp.data) return { points: "N/A", pointsNum: 0 };
    var points = resp.data.points;
    if (points !== undefined && points !== null) {
      var pointsInt = parseInt(parseFloat(points), 10);
      return { points: "" + pointsInt, pointsNum: pointsInt };
    }
    return { points: "N/A", pointsNum: 0 };
  });
}

function exchange(cookie, domain, plan) {
  return request("https://" + domain + "/api/user/exchange", "POST", cookie, domain, { planType: plan }).then(function (resp) {
    if (resp.error || !resp.data) return "兑换失败";
    var code = resp.data.code !== undefined ? resp.data.code : -2;
    var message = resp.data.message || "";
    if (code === 0) return "兑换成功(" + plan + ")";
    return "兑换失败: " + message;
  });
}

function checkinForAccount(cookie, domain, accountIndex) {
  var statusBefore, checkinResult, pointsResult, exchangeResult, statusAfter, accountEmail;

  return getStatus(cookie, domain).then(function (sb) {
    statusBefore = sb;
    accountEmail = sb.email;
    var displayEmail = accountEmail !== "unknown" ? accountEmail : "Account #" + accountIndex;
    Logger.accountHeader(accountIndex, domain);
    Logger.field("Email", displayEmail);
    if (accountEmail === "unknown") return { status: "账号验证失败", code: -3, message: "请检查网络或登录后重新抓取 Cookie", points: "0", needsLogin: true };
    return checkin(cookie, domain);
  }).then(function (cr) {
    checkinResult = cr;
    return getPoints(cookie, domain);
  }).then(function (pr) {
    pointsResult = pr;
    if (checkinResult.needsLogin) return "跳过(需要更新登录凭据)";
    if (checkinResult.code !== 0 && checkinResult.code !== 1) return "跳过(签到未完成)";
    exchangeResult = "跳过(积分不足)";
    if (pointsResult.pointsNum >= 500) {
      return exchange(cookie, domain, EXCHANGE_PLAN);
    }
    return "跳过(积分不足)";
  }).then(function (er) {
    if (er) exchangeResult = er;
    return getStatus(cookie, domain);
  }).then(function (sa) {
    statusAfter = sa;

    var icon = checkinResult.code === 0 ? "✅" : checkinResult.code === 1 ? "🔁" : "❌";
    Logger.status(icon, checkinResult.status);
    if (checkinResult.apiCode !== undefined) Logger.field("API code", checkinResult.apiCode);
    if (checkinResult.points !== "0") Logger.points("+" + checkinResult.points);
    Logger.daysLeft(statusBefore.leftDays + " → " + statusAfter.leftDays);
    Logger.balance(pointsResult.points);
    Logger.action("兑换: " + exchangeResult);
    if (checkinResult.message) Logger.message(checkinResult.message);
    Logger.separator();

    var displayName = accountEmail !== "unknown" ? accountEmail : "Account #" + accountIndex;

    return {
      accountIndex: accountIndex,
      domain: domain,
      email: displayName,
      status: checkinResult.status,
      code: checkinResult.code,
      message: checkinResult.message,
      earnedPoints: checkinResult.points,
      totalPoints: pointsResult.points,
      daysBefore: statusBefore.leftDays,
      daysAfter: statusAfter.leftDays,
      exchange: exchangeResult
    };
  });
}

// ========== 主流程 ==========
if (isGetHeader) {
  Logger.scriptStart(SCRIPT_NAME, SCRIPT_VERSION, getPlatform(), "Manual");

  var allHeaders = $request.headers || {};
  var cookie = readHeader(allHeaders, "Cookie");
  var userAgent = readHeader(allHeaders, "User-Agent");
  var host = getHostFromRequest();
  var capturedResponse = typeof $response !== "undefined" ? safeJsonParse($response.body || "") : null;
  var verifiedEmail = capturedResponse && (capturedResponse.code === 0 || capturedResponse.code === undefined) && capturedResponse.data && capturedResponse.data.email;
  if (typeof verifiedEmail !== "string" || verifiedEmail.indexOf("@") < 1) verifiedEmail = null;

  if (!cookie || !/^(glados\.(network|vip|one|space)|railgun\.info)$/.test(host) || (typeof $response !== "undefined" && !verifiedEmail)) {
    Logger.status("⚠️", "抓包失败");
    Logger.message("未获取到 Cookie 或 Host");
    notifyFn("GLaDOS 抓包失败", "", "未获取到 Cookie 或 Host");
    $done({});
  } else {
    saveCookie(host, cookie, userAgent, verifiedEmail).then(function (result) {
      var label = "账号 #" + (result.index + 1);
      var message = result.isNew ? "新账号已保存" : "账号 Cookie 已更新";
      Logger.status("✅", message);
      Logger.field("Account", label);
      Logger.field("Domain", host);
      notifyFn("GLaDOS 抓包", message, label + " | " + host);
      $done({});
    }).catch(function () {
      Logger.status("⚠️", "抓包保存失败");
      Logger.message("请确认已登录并刷新控制台；原有其他账号保留");
      notifyFn("GLaDOS 抓包失败", "请登录后刷新控制台", "未验证的 Cookie 不会新增为账号");
      $done({});
    });
  }
} else {
  var delay = Math.floor(Math.random() * 11);

  setTimeout(function () {
    Logger.scriptStart(SCRIPT_NAME, SCRIPT_VERSION, getPlatform(), "Cron");

    var savedDomains = getSavedDomains();
    var allCookies = [];
    for (var d = 0; d < savedDomains.length; d++) {
      var cookies = getCookiesForDomain(savedDomains[d]);
      for (var c = 0; c < cookies.length; c++) {
        allCookies.push({ domain: savedDomains[d], cookie: cookies[c] });
      }
    }

    var totalAccounts = allCookies.length;
    if (totalAccounts === 0) {
      Logger.envCheck(false, "Missing");
      Logger.status("⚠️", "无 Cookie");
      notifyFn("GLaDOS 签到", "无 Cookie", "请先抓包");
      $done();
      return;
    }

    Logger.envCheck(true, "Found (" + totalAccounts + ")");

    var allResults = [];
    var idx = 0;

    function next() {
      if (idx >= allCookies.length) {
        var ok = allResults.filter(function (r) { return r.code === 0; }).length;
        var dup = allResults.filter(function (r) { return r.code === 1; }).length;
        var fail = allResults.filter(function (r) { return r.code !== 0 && r.code !== 1; }).length;

        var resultText = "成功" + ok + " 重复" + dup + " 失败" + fail;
        Logger.summary(totalAccounts, ok, dup, fail, resultText);

        // 汇总弹窗（3行）
        notifyFn("GLaDOS", "签到完成", "账号 " + totalAccounts + " | ✅" + ok + " 🔁" + dup + " ❌" + fail);

        // 逐账号弹窗（每个3行）
        for (var r = 0; r < allResults.length; r++) {
          var res = allResults[r];
          var icon = res.code === 0 ? "✅" : res.code === 1 ? "🔁" : "❌";
          var pts = res.earnedPoints !== "0" ? " | +" + res.earnedPoints + "积分" : "";
          notifyFn(icon + " " + res.email, res.status + pts, "剩余 " + res.daysAfter + " | 积分 " + res.totalPoints + " | " + res.exchange);
        }
        $done();
        return;
      }

      var item = allCookies[idx];
      idx++;
      checkinForAccount(item.cookie, item.domain, idx).then(function (result) {
        allResults.push(result);
        next();
      });
    }

    next();
  }, delay * 1000);
}
