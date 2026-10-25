/*
 * 网鱼 f1sh.com 自动签到
 * Version: v1.0.0 | Updated: 2026-10-25
 * Author / Maintainer: liuzhihang
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 liuzhihang
 * https://github.com/liuzhihang/loon-plugin
 *
 * 仅观察 GET /checkin 响应保存会话；捕获不发送额外请求。
 * 每次读取签到页，未签到才提交一次 csrf_token + mood，并重新查询确认。
 * 不执行页面脚本、不补签、不自动重试、不跟随任意重定向。
 * 协议研究与实机验证边界见 README.md 和仓库 UPSTREAM.md。
 */

var SCRIPT_VERSION = "v1.0.0";
var SESSION_KEY = "F1sh_Session";
var ORIGIN = "https://f1sh.com";
var CHECKIN_URL = ORIGIN + "/checkin";
var PAGE_URL = /^https:\/\/f1sh\.com\/checkin(?:\?[^#]*)?$/;
var CHECKIN_NAME = "网鱼执行签到_会发请求";
var MOODS = ["happy", "nice", "love", "working", "sleepy", "popcorn", "cry", "angry", "hello"];
var entryKind = "Blocked";

var REASONS = {
  entry: "入口或参数不匹配；请同时更新插件和脚本，并使用执行签到入口。本次未读取会话、未发请求",
  arguments: "插件参数无效；autoCheckin 必须为布尔值，mood 必须为支持的心情。本次未读取会话、未发请求",
  disabled: "自动签到尚未开启；请先保存会话，再开启插件参数。本次未读取会话、未发请求",
  session: "尚无有效会话；请在 Safari 登录 https://f1sh.com/checkin 后刷新此页",
  headers: "缺少有效 Cookie 或 User-Agent；原有会话保留",
  login: "未登录或会话已过期；请在官网登录并刷新 /checkin 更新会话",
  page: "签到页结构异常或已变化；无法确认个人签到状态，请在官网核实",
  csrf: "签到表单或 CSRF Cookie 不匹配；已停止，请重新登录并刷新签到页",
  challenge: "页面要求安全验证；请在官网手动处理后再使用插件",
  forbidden: "HTTP 403 访问被拒绝；请在官网核实账号与访问规则",
  limited: "HTTP 429 请求被限流；已停止，请稍后在官网核实",
  redirect: "收到非预期重定向；已停止且未跟随，请在官网核实登录状态",
  http: "HTTP 状态异常；未确认签到结果，请在官网核实",
  network: "网络失败或超时；结果未确认，本次不自动重试，请在官网核实",
  date: "响应日期缺失、过期或与北京时间当天不一致；已停止，请核对设备时间与官网",
  dayChanged: "执行期间已跨北京时间日界；已停止，请在官网核实结果",
  sessionChanged: "执行期间本地会话已变化；已停止，请确认当前账号与签到结果",
  unconfirmed: "提交后页面仍未确认今日已签到；本次不自动重试，请在官网核实",
  storage: "本地存储失败；原有会话未主动清除",
  runtime: "脚本执行异常；请检查 Loon 环境与日志，本次不自动重试"
};

function field(name, value) { console.log(name + " : " + value); }
function fail(code) { var error = new Error(code); error.code = code; throw error; }
function announce(title, detail) {
  field("Status", title);
  if (detail) field("Message", detail);
  try { $notification.post("网鱼签到", title, detail || ""); }
  catch (_) { field("Notification", "通知接口失败，请以日志为准"); }
}
function header(headers, name) {
  var keys = Object.keys(headers || {});
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === name.toLowerCase()) return headers[keys[i]];
  }
  return "";
}
function validHeader(value) {
  return typeof value === "string" && value.trim().length > 0 && !/[\r\n\x00]/.test(value);
}
function statusCode(response) {
  var value = response && (response.status !== undefined ? response.status : response.statusCode);
  return (typeof value === "number" || typeof value === "string") && /^\d{3}$/.test(String(value)) ? Number(value) : 0;
}
function dayAt(timestamp) { return new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10); }
function readSession() {
  try { return $persistentStore.read(SESSION_KEY); } catch (_) { fail("storage"); }
}
function parseSession(raw) {
  var value;
  try { value = JSON.parse(raw); } catch (_) { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !validHeader(value.cookie) || !validHeader(value.userAgent)) return null;
  return { cookie: value.cookie, userAgent: value.userAgent };
}
function requireCurrent(raw, day) {
  if (dayAt(Date.now()) !== day) fail("dayChanged");
  if (readSession() !== raw) fail("sessionChanged");
}
function verifyDate(response, day) {
  var value = header(response && response.headers, "Date");
  var timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (!isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 300000 || dayAt(timestamp) !== day) fail("date");
}

// 只解析有限的 HTML 元素与属性，绝不 eval 站点的 SSR 或前端代码。
function attributes(text) {
  var result = {};
  var regex = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  var match;
  while ((match = regex.exec(text))) {
    var name = match[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(result, name)) fail("page");
    result[name] = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] || "";
  }
  return result;
}
function hasClass(attrs, name) { return (" " + (attrs["class"] || "").replace(/\s+/g, " ") + " ").indexOf(" " + name + " ") >= 0; }
function elements(html, tag, className) {
  var regex = new RegExp("<" + tag + "\\b([^>]*)>", "gi"), result = [], match;
  while ((match = regex.exec(html))) {
    var attrs = attributes(match[1]);
    if (!className || hasClass(attrs, className)) result.push({ attrs: attrs, start: match.index, end: regex.lastIndex });
  }
  return result;
}
function inspect(reply, allowRedirect) {
  var response = reply.response, body = typeof reply.body === "string" ? reply.body : "";
  var code = statusCode(response);
  field("HTTP status", code || "缺失或异常");
  if (/challenge/i.test(String(header(response && response.headers, "cf-mitigated"))) ||
      /<title[^>]*>\s*(?:Just a moment|Attention Required|安全验证|人机验证)|\b_cf_chl_opt\b|cf-turnstile|g-recaptcha|h-captcha|data-cap-btn|checking your browser|verify you are human/i.test(body)) fail("challenge");
  if (code === 401) fail("login");
  if (code === 403) fail("forbidden");
  if (code === 429) fail("limited");
  if (allowRedirect && (code === 302 || code === 303)) {
    var location = header(response && response.headers, "Location");
    if (typeof location !== "string" || !/^(?:https:\/\/f1sh\.com)?\/checkin(?:\?[^#\r\n]*)?$/.test(location)) fail("redirect");
    return body;
  }
  if (code >= 300 && code < 400) fail("redirect");
  if (code !== 200) fail("http");
  return body;
}
function pageState(reply) {
  var body = inspect(reply, false);
  var contentType = header(reply.response && reply.response.headers, "Content-Type");
  if ((contentType && (typeof contentType !== "string" || !/^text\/html(?:\s*;|\s*$)/i.test(contentType))) ||
      !/<(?:!doctype\s+html|html\b)/i.test(body)) fail("page");
  var html = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  var heads = elements(html, "header", "pd-ck-head");
  if (heads.length !== 1) fail("page");
  var end = html.indexOf("</header>", heads[0].end);
  if (end < 0) fail("page");
  var head = html.slice(heads[0].end, end);
  if (elements(html, "section", "pd-ck-login").length ||
      elements(head, "a").some(function (link) { return /^\/login(?:[?#]|$)/.test(link.attrs.href || ""); })) fail("login");
  if (elements(html, "div", "pd-ck-stats").length !== 1) fail("page");
  var done = elements(head, "span", "pd-ck-done");
  var forms = elements(head, "form", "pd-ck-mood-form");
  if (done.length === 1 && forms.length === 0) return { signed: true };
  if (done.length !== 0 || forms.length !== 1) fail("page");
  var form = forms[0];
  if ((form.attrs.method || "").toLowerCase() !== "post" || form.attrs.action !== "/checkin") fail("page");
  var close = head.indexOf("</form>", form.end);
  if (close < 0) fail("page");
  var inputs = elements(head.slice(form.end, close), "input");
  var csrf = inputs.filter(function (input) { return input.attrs.name === "csrf_token"; });
  if (csrf.length !== 1 || (csrf[0].attrs.type || "").toLowerCase() !== "hidden" || !/^[a-f0-9]{64}$/i.test(csrf[0].attrs.value || "")) fail("csrf");
  var moods = inputs.filter(function (input) { return input.attrs.name === "mood" && input.attrs.type === "radio"; }).map(function (input) { return input.attrs.value; });
  if (!moods.length) fail("page");
  return { signed: false, csrf: csrf[0].attrs.value, moods: moods };
}

// 仅更新当前请求链中的 pd_csrf。登录 Cookie 和 CSRF 均不从响应回写持久存储。
// 不采用服务器提供的请求地址，也不把 Cookie 发送到其他主机。
function csrfCookies(cookie, response, token) {
  var setCookie = header(response && response.headers, "Set-Cookie");
  var values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  var updates = [];
  values.forEach(function (value) {
    if (typeof value !== "string") fail("csrf");
    var regex = /(?:^|,\s*)pd_csrf=([^;,\r\n]*)([^,\r\n]*)/g, match;
    while ((match = regex.exec(value))) {
      if (!/^[a-f0-9]{64}$/i.test(match[1]) || /(?:^|;)\s*max-age\s*=\s*0(?:;|$)/i.test(match[2])) fail("csrf");
      updates.push(match[1]);
    }
  });
  if (updates.length > 1) fail("csrf");
  var parts = cookie.split(/;\s*/).filter(function (part) { return part.length > 0; });
  if (updates.length) {
    parts = parts.filter(function (part) { return !/^pd_csrf=/.test(part); });
    parts.push("pd_csrf=" + updates[0]);
  }
  if (token) {
    var current = parts.filter(function (part) { return /^pd_csrf=/.test(part); });
    if (current.length !== 1 || current[0].slice(8) !== token) fail("csrf");
  }
  return parts.join("; ");
}
function request(method, session, cookie, body) {
  field("Phase", method === "POST" ? "提交签到（POST，仅一次）" : "读取签到页（GET）");
  return new Promise(function (resolve, reject) {
    var headers = { Cookie: cookie, "User-Agent": session.userAgent, Accept: "text/html",
      Referer: CHECKIN_URL, "Cache-Control": "no-cache", Pragma: "no-cache" };
    if (method === "POST") { headers.Origin = ORIGIN; headers["Content-Type"] = "application/x-www-form-urlencoded"; }
    var options = { url: CHECKIN_URL, method: method, headers: headers, timeout: 10000,
      "auto-cookie": false, "auto-redirect": false, insecure: false };
    if (method === "POST") options.body = body;
    try {
      $httpClient[method === "POST" ? "post" : "get"](options, function (error, response, text) {
        if (error) { reject({ code: "network" }); return; }
        resolve({ response: response, body: text });
      });
    } catch (_) { reject({ code: "network" }); }
  });
}
function capture() {
  if (typeof $request === "undefined" || !$request) {
    announce("捕获入口无需手动运行", "请在已登录的 Safari 进入或刷新 https://f1sh.com/checkin；本次未发请求");
    return;
  }
  if (!PAGE_URL.test($request.url || "") || ($request.method !== undefined && $request.method !== "GET")) return;
  if (typeof $response === "undefined" || !$response) fail("page");
  pageState({ response: $response, body: $response.body });
  var cookie = header($request.headers, "Cookie"), userAgent = header($request.headers, "User-Agent");
  if (!validHeader(cookie) || !validHeader(userAgent)) fail("headers");
  var previous = readSession(), old = parseSession(previous);
  if (old && old.cookie === cookie && old.userAgent === userAgent) { field("Status", "会话未变化，静默跳过"); return; }
  var stored = false;
  try { stored = $persistentStore.write(JSON.stringify({ cookie: cookie, userAgent: userAgent }), SESSION_KEY) === true; } catch (_) { fail("storage"); }
  if (!stored) fail("storage");
  announce(old ? "登录会话已更新" : "登录会话已保存", "可在插件参数中开启自动签到；捕获本身不发签到请求");
}
function options(value) {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch (_) { fail("arguments"); } }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(value, "autoCheckin") || !Object.prototype.hasOwnProperty.call(value, "mood") ||
      typeof value.autoCheckin !== "boolean" || typeof value.mood !== "string" || MOODS.indexOf(value.mood) < 0) fail("arguments");
  if (!value.autoCheckin) fail("disabled");
  return value;
}
function checkin(config) {
  var raw = readSession(), session = parseSession(raw);
  if (!session) fail("session");
  var day = dayAt(Date.now()), cookie = session.cookie;
  return request("GET", session, cookie).then(function (reply) {
    requireCurrent(raw, day);
    var state = pageState(reply);
    verifyDate(reply.response, day);
    if (state.signed) { announce("今日已签到", "服务端页面已确认，未重复提交"); return; }
    if (state.moods.indexOf(config.mood) < 0) fail("page");
    cookie = csrfCookies(cookie, reply.response, state.csrf);
    requireCurrent(raw, day);
    return request("POST", session, cookie, "csrf_token=" + encodeURIComponent(state.csrf) + "&mood=" + encodeURIComponent(config.mood)).then(function (posted) {
      requireCurrent(raw, day);
      inspect(posted, true);
      cookie = csrfCookies(cookie, posted.response);
      return request("GET", session, cookie);
    }).then(function (verified) {
      requireCurrent(raw, day);
      var after = pageState(verified);
      verifyDate(verified.response, day);
      if (!after.signed) fail("unconfirmed");
      announce("签到已确认", "提交后已重新查询：今日已签到；奖励以官网实际记录为准");
    });
  });
}
function execute() {
  var argument = typeof $argument === "undefined" ? undefined : $argument;
  if (argument === "capture") { entryKind = "Capture"; return capture(); }
  var name = typeof $script !== "undefined" && $script && $script.name;
  if (name !== CHECKIN_NAME || typeof $request !== "undefined" || typeof $response !== "undefined") fail("entry");
  var config = options(argument);
  entryKind = "Checkin";
  return checkin(config);
}

field("Version", SCRIPT_VERSION + " | Loon");
Promise.resolve().then(execute).catch(function (error) {
  var code = error && error.code;
  announce(entryKind === "Capture" ? "会话未保存" : entryKind === "Checkin" ? "签到未确认" : "操作已阻止",
    Object.prototype.hasOwnProperty.call(REASONS, code) ? REASONS[code] : REASONS.runtime);
}).then(function () { $done({}); }, function () { $done({}); });
