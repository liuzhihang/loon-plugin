/*
 * NodeSeek 自动签到 — 独立的 Loon 实现
 * Version: v1.0.0 | Updated: 2026-10-20
 * Author / Maintainer: liuzhihang
 * https://github.com/liuzhihang/loon-plugin
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 liuzhihang
 *
 * 仅观察用户手动签到的响应保存会话；捕获流程不发送请求。
 * 定时任务最多一次 POST；不重试、不跟随重定向、不处理安全挑战。
 * 公开接口及许可研究见 README.md 与仓库 UPSTREAM.md，未复制第三方实现。
 */

var SCRIPT_VERSION = "v1.0.0";
var SESSION_KEY = "NodeSeek_Session";
var ORIGIN = "https://www.nodeseek.com";
var ATTENDANCE_URL = /^https:\/\/www\.nodeseek\.com\/api\/attendance\?random=(?:true|false)$/;
var isCapture = typeof $request !== "undefined";

// 日界是本地去重策略（UTC+8），并非从接口获取的服务端日期。
function dayAt(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function localDay() {
  return dayAt(Date.now());
}

function field(label, value) {
  console.log((label + "              ").slice(0, 14) + ": " + value);
}

function announce(title, detail) {
  field("Status", title);
  if (detail) field("Message", detail);
  try { $notification.post("NodeSeek", title, detail || ""); }
  catch (_) { field("Notification", "通知发送失败，请以执行日志为准"); }
}

function fail(code) {
  var error = new Error(code);
  error.code = code;
  throw error;
}

// 所有外部响应和异常只参与分类，不把原始文本写入日志或通知。
var REASONS = {
  session: "尚无有效本地会话；请在 Safari 登录 www.nodeseek.com 后手动签到一次以保存会话",
  invalidSession: "本地会话格式无效；请重新登录并手动签到以更新会话",
  headers: "缺少有效 Cookie 或浏览器 User-Agent；原有会话保留",
  response: "缺少可验证的签到响应；原有会话保留",
  login: "登录已过期或未登录；请在官网重新登录，再手动签到以更新会话",
  challenge: "需要网页安全验证；请暂停定时任务，在官网手动核实，不反复重试或绕过验证",
  forbidden: "HTTP 403 访问被拒绝；请暂停定时任务并在官网核实账号与访问规则",
  limited: "HTTP 429 请求被限流；请暂停定时任务，稍后在官网核实",
  automated: "服务端拒绝自动化请求；请暂停定时任务并在官网核实规则与账号状态",
  redirect: "收到重定向，已停止且未跟随；请在官网核实登录状态和签到结果",
  http: "签到接口 HTTP 状态异常；本次未确认结果，请在官网核实",
  json: "签到接口返回非 JSON 或结构异常；本次未确认结果，请在官网核实",
  unknown: "服务端未明确确认签到；请在官网核实，本次不自动重试",
  network: "网络请求失败或超时；签到结果不确定，请在官网核实，本次不自动重试",
  storage: "本地存储读取或写入失败；原有会话未主动清除",
  arguments: "插件参数无效；random 和 useCache 必须为布尔值，请检查插件设置",
  runtime: "脚本执行异常；请检查 Loon 脚本环境，本次不自动重试"
};

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

function parseJSON(value) {
  try { return JSON.parse(value); } catch (_) { return null; }
}

function readValue() {
  try { return $persistentStore.read(SESSION_KEY); } catch (_) { fail("storage"); }
}

function writeValue(value) {
  try { return $persistentStore.write(value, SESSION_KEY) === true; } catch (_) { return false; }
}

function sessionFrom(raw) {
  var value = parseJSON(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !validHeader(value.cookie) || !validHeader(value.userAgent)) return null;
  // 不从本地数据读取请求地址，也不把未使用的字段带入新存储。
  var session = { cookie: value.cookie, userAgent: value.userAgent };
  if (value.receipt && /^\d{4}-\d{2}-\d{2}$/.test(value.receipt.day) &&
      (value.receipt.kind === "success" || value.receipt.kind === "duplicate")) {
    session.receipt = { day: value.receipt.day, kind: value.receipt.kind };
  }
  return session;
}

function options() {
  var value = typeof $argument === "undefined" || $argument === null || $argument === "" ? {} : $argument;
  if (typeof value === "string") value = parseJSON(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("arguments");
  var result = { random: false, useCache: true };
  for (var key in result) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      if (typeof value[key] !== "boolean") fail("arguments");
      result[key] = value[key];
    }
  }
  return result;
}

function statusCode(response) {
  var status = response && (response.status !== undefined ? response.status : response.statusCode);
  return /^\d{3}$/.test(String(status)) ? Number(status) : 0;
}

function isDuplicate(message) {
  // 只接受完整肯定句和常见的“明天再来”后缀，含未知补充说明时不建立缓存。
  return /^(?:您|你)?(?:今天|今日)?(?:已经|已)完成签到\s*(?:[，,]\s*(?:请)?明天再(?:来|试)吧?)?[。.!！]?\s*$/.test(message);
}

function classify(response, body) {
  var code = statusCode(response);
  var headers = response && response.headers;
  var text = typeof body === "string" ? body : "";
  if (/challenge/i.test(String(header(headers, "cf-mitigated"))) ||
      /(?:<title[^>]*>\s*(?:Just a moment|Attention Required|安全验证|人机验证)|\/cdn-cgi\/challenge-platform|cf-chl-|cf-turnstile|g-recaptcha|h-captcha|checking your browser|verify you are human|captcha required)/i.test(text)) fail("challenge");
  if (code === 401) fail("login");
  if (code === 403) fail("forbidden");
  if (code === 429) fail("limited");
  if (code >= 300 && code < 400) fail("redirect");
  if (code !== 200) fail("http");

  var contentType = header(headers, "Content-Type");
  if (contentType && !/^application\/(?:[\w.-]+\+)?json(?:\s*;|\s*$)/i.test(String(contentType))) fail("json");
  var data = parseJSON(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("json");
  var message = typeof data.message === "string" ? data.message.trim() : "";
  if (/验证码|人机验证|安全验证|captcha|turnstile|challenge/i.test(message)) fail("challenge");
  if (/automated|automation|bot\s+(?:detected|check)|禁止自动|拒绝自动|检测到.*自动/i.test(message)) fail("automated");
  // status: 404 是公开签到脚本使用的登录态失效信号；HTTP 404 仍按接口异常处理。
  var apiStatus = statusCode({ status: data.status });
  if (apiStatus === 401 || apiStatus === 404 || /请先?登录|尚未登录|未登录|登录(?:已)?(?:过期|失效)|会话(?:已)?过期|not\s+(?:logged|signed)\s+in|unauthori[sz]ed|login\s+required|session\s+(?:expired|invalid)/i.test(message)) fail("login");
  if (apiStatus === 429) fail("limited");
  if (apiStatus === 403) fail("forbidden");
  if (apiStatus >= 400) fail("http");
  if (/^(?:您|你)?(?:今天|今日)?(?:已经|已)完成签到/.test(message)) {
    if (typeof data.success === "boolean" && isDuplicate(message)) return { kind: "duplicate" };
    fail("unknown");
  }
  if (data.success !== true) fail("unknown");

  var result = { kind: "success" };
  ["gain", "current"].forEach(function (key) {
    var value = data[key];
    if (typeof value === "number" && isFinite(value) && value >= 0 && Math.floor(value) === value) result[key] = value;
  });
  return result;
}

function capture() {
  // 双重约束：即使手动误调用脚本，也不读取其他页面、域名或方法的请求头。
  // 部分 Loon 回调省略 method；此时由插件的 POST 条件约束，仍须验证响应。
  if (!$request || ($request.method !== undefined && $request.method !== "POST") || !ATTENDANCE_URL.test($request.url || "")) return;
  if (typeof $response === "undefined") fail("response");
  var result = classify($response, $response.body);
  var cookie = header($request.headers, "Cookie");
  var userAgent = header($request.headers, "User-Agent");
  if (!validHeader(cookie) || !validHeader(userAgent)) fail("headers");

  var session = { cookie: cookie, userAgent: userAgent };
  // 响应可能跨午夜才到达。只用近期、非未来的 HTTP Date 建立捕获记录；
  // 缺少可信日期仍保存已验证会话，但不猜测签到发生在哪一天。
  var date = header($response.headers, "Date");
  var timestamp = typeof date === "string" ? Date.parse(date) : NaN;
  var age = Date.now() - timestamp;
  if (isFinite(age) && age >= 0 && age <= 5 * 60 * 1000) session.receipt = { day: dayAt(timestamp), kind: result.kind };
  var previous = readValue();
  var encoded = JSON.stringify(session);
  if (previous === encoded) {
    field("Status", "登录会话未变化，跳过保存");
    return;
  }
  if (!writeValue(encoded)) fail("storage");
  announce("登录会话已更新", session.receipt ? "已验证手动签到响应；只在本地保存会话和当日结果记录" : "已验证并保存本地会话；缺少可信响应日期，本次不建立同日跳过记录");
}

function submit(session, random) {
  return new Promise(function (resolve, reject) {
    var request = {
      url: ORIGIN + "/api/attendance?random=" + (random ? "true" : "false"),
      method: "POST",
      timeout: 15000,
      headers: {
        Cookie: session.cookie,
        "User-Agent": session.userAgent,
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: ORIGIN,
        Referer: ORIGIN + "/board"
      },
      body: "{}",
      "auto-cookie": false,
      "auto-redirect": false,
      insecure: false
    };
    try {
      $httpClient.post(request, function (error, response, body) {
        if (error) { reject({ code: "network" }); return; }
        try { resolve(classify(response, body)); } catch (failure) { reject(failure); }
      });
    } catch (_) { reject({ code: "network" }); }
  });
}

function recordReceipt(session, day, kind) {
  // 等待网络时可能已经捕获了另一个账号；不得用旧请求覆盖新的登录会话。
  try {
    var current = sessionFrom(readValue());
    if (!current || current.cookie !== session.cookie || current.userAgent !== session.userAgent) return false;
    // 旧请求跨午夜返回时，保留同一会话期间新捕获的次日确认记录。
    if (current.receipt && current.receipt.day > day && current.receipt.day <= localDay()) return true;
    current.receipt = { day: day, kind: kind };
    return writeValue(JSON.stringify(current));
  } catch (_) { return false; }
}

function checkin() {
  var settings = options();
  var raw = readValue();
  if (!raw) fail("session");
  var session = sessionFrom(raw);
  if (!session) fail("invalidSession");
  var day = localDay();
  field("Reward mode", settings.random ? "随机奖励（random=true）" : "固定奖励（random=false）");
  if (settings.useCache && session.receipt && session.receipt.day === day) {
    field("Summary", "成功0 服务端重复0 本地跳过1 失败0");
    announce("本地记录：今日已有确认结果", "本次未请求服务器；记录来自" + (session.receipt.kind === "success" ? "签到成功响应" : "服务端已完成签到响应") + "，日界按 UTC+8");
    return;
  }

  field("Action", "单次 POST；失败或结果不明确时不自动重试");
  return submit(session, settings.random).then(function (result) {
    var recorded = recordReceipt(session, day, result.kind);
    var details = [];
    if (result.kind === "success") {
      if (result.gain !== undefined) details.push("获得 " + result.gain + " 个鸡腿");
      if (result.current !== undefined) details.push("当前 " + result.current + " 个鸡腿");
    } else {
      details.push("服务端明确返回已完成签到；本次未计为新奖励");
    }
    if (!recorded) details.push("本地记录未保存或会话已变化；请勿连续运行，先在官网核实");
    field("Summary", result.kind === "success" ? "成功1 服务端重复0 本地跳过0 失败0" : "成功0 服务端重复1 本地跳过0 失败0");
    announce(result.kind === "success" ? "签到成功" : "服务端：今日已签到", details.join("；"));
  });
}

console.log("🚀 NodeSeek Script Start");
field("Version", SCRIPT_VERSION + " | Loon | " + (isCapture ? "Capture" : "Cron"));
Promise.resolve().then(function () {
  return isCapture ? capture() : checkin();
}).catch(function (error) {
  var code = error && error.code;
  var detail = Object.prototype.hasOwnProperty.call(REASONS, code) ? REASONS[code] : REASONS.runtime;
  if (!isCapture) field("Summary", "成功0 服务端重复0 本地跳过0 失败1");
  announce(isCapture ? "会话未保存，原有会话保留" : "签到未完成", detail);
}).then(function () { $done({}); }, function () { $done({}); });
