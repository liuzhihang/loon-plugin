/*
 * NodeSeek 自动签到
 * Version: v1.3.0 | Updated: 2026-10-21
 * Author / Maintainer: liuzhihang
 * https://github.com/liuzhihang/loon-plugin
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 liuzhihang
 *
 * 进入已登录的签到页即可保存会话；兼容手动签到响应，捕获流程不发送请求。
 * 定时任务先只读验证登录和签到状态，明确未签到才发一次 POST。
 * 不重试、不跟随重定向、不处理安全挑战。
 * 公开接口及许可研究见 README.md 与仓库 UPSTREAM.md，未复制第三方实现。
 */

var SCRIPT_VERSION = "v1.3.0";
var SESSION_KEY = "NodeSeek_Session";
var ORIGIN = "https://www.nodeseek.com";
var BOARD_URL = /^https:\/\/www\.nodeseek\.com\/board\/?(?:\?[^#]*)?$/;
var ATTENDANCE_URL = /^https:\/\/www\.nodeseek\.com\/api\/attendance\?random=(?:true|false)$/;
var CHECKIN_NAME = "NodeSeek执行签到_会发请求";
var entryKind = "Blocked";

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

function announce(title, detail, notificationDetail) {
  field("Status", title);
  if (detail) field("Message", detail);
  try {
    $notification.post("NodeSeek", title, notificationDetail === undefined ? detail || "" : notificationDetail);
    field("Notification", "已调用 Loon 通知接口；横幅显示取决于系统权限与 Loon 通知设置");
  }
  catch (_) { field("Notification", "通知发送失败，请以执行日志为准"); }
}

function fail(code) {
  var error = new Error(code);
  error.code = code;
  throw error;
}

// 所有外部响应和异常只参与分类，不把原始文本写入日志或通知。
var REASONS = {
  entry: "入口或参数缺失、不匹配，已停止；请同时更新插件与脚本，勿单独手动运行旧捕获条目；本次未读取本地会话、未发签到请求",
  disabled: "自动签到开关未开启，已阻止执行；本次未读取本地会话、未发签到请求",
  session: "尚无有效本地会话；请在浏览器登录 www.nodeseek.com 后进入或刷新签到页 /board",
  invalidSession: "本地会话格式无效；请重新登录并刷新签到页 /board 以更新会话",
  headers: "缺少有效 Cookie 或浏览器 User-Agent；原有会话保留",
  response: "缺少可验证的签到响应；原有会话保留",
  page: "签到页缺少可验证的登录信息或格式已变化；请登录后刷新 /board，原有会话保留",
  login: "登录已过期或未登录；请在官网重新登录，再刷新签到页 /board 以更新会话",
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
  arguments: "插件参数无效；autoCheckin、random 和 useCache 必须为布尔值，本次未读取会话、未发签到请求",
  runtime: "脚本执行异常；请检查 Loon 脚本环境，本次不自动重试",
  query: "签到状态查询失败或不明确；已停止，请在官网核实",
  queryNetwork: "签到前查询网络失败或超时；已停止，请稍后在官网核实",
  queryDate: "签到状态响应日期缺失、过期或跨日；已停止，请稍后核实",
  sessionChanged: "查询期间登录会话已变化；已停止，请确认当前账号后再使用",
  dayChanged: "查询期间已跨日；已停止，请等待下次计划执行"
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

function options(value) {
  if (typeof value === "string") value = parseJSON(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("entry");
  var keys = Object.keys(value);
  if (keys.length !== 3 || keys.some(function (key) {
    return key !== "autoCheckin" && key !== "random" && key !== "useCache";
  })) fail("entry");
  if (typeof value.autoCheckin !== "boolean" || typeof value.random !== "boolean" || typeof value.useCache !== "boolean") fail("arguments");
  if (value.autoCheckin !== true) fail("disabled");
  return { random: value.random, useCache: value.useCache };
}

function statusCode(response) {
  var status = response && (response.status !== undefined ? response.status : response.statusCode);
  if (typeof status !== "number" && typeof status !== "string") return 0;
  return /^\d{3}$/.test(String(status)) ? Number(status) : 0;
}

function isDuplicate(message) {
  // 只接受完整肯定句和常见的“明天再来”后缀，含未知补充说明时不建立缓存。
  return /^(?:您|你)?(?:今天|今日)?(?:已经|已)完成签到\s*(?:[，,]\s*(?:(?:请)?明天再(?:来|试)吧?|请勿重复(?:操作|签到)))?[。.!！]?\s*$/.test(message);
}

function inspectResponse(response, body, page, allowDuplicate500) {
  var code = statusCode(response);
  // 仅输出校验后的数字或固定标签；绝不输出原始状态值、Header 或响应正文。
  field("HTTP status", code || "缺失或格式异常");
  field("Status types", "status=" + typeof (response && response.status) + ", statusCode=" + typeof (response && response.statusCode));
  var headers = response && response.headers;
  var text = typeof body === "string" ? body : "";
  if (/challenge/i.test(String(header(headers, "cf-mitigated"))) ||
      /(?:<title[^>]*>\s*(?:Just a moment|Attention Required|安全验证|人机验证)|\b_cf_chl_opt\b|cf-turnstile|g-recaptcha|h-captcha|checking your browser|verify you are human|captcha required)/i.test(text) ||
      (!page && /\/cdn-cgi\/challenge-platform|cf-chl-/i.test(text))) fail("challenge");
  if (code === 401) fail("login");
  if (code === 403) fail("forbidden");
  if (code === 429) fail("limited");
  if (code >= 300 && code < 400) fail("redirect");
  if (code !== 200 && !(allowDuplicate500 && code === 500)) fail("http");
  return text;
}

// 只解码站点的 Base64 JSON 数据，不执行页面脚本，也不保存账号资料。
function boardConfig(encoded) {
  var value = encoded.replace(/\s/g, "");
  if (!value || value.length > 512 * 1024 || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail("page");
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var buffer = 0, bits = 0, escaped = "";
  for (var i = 0; i < value.length && value[i] !== "="; i++) {
    buffer = (buffer << 6) | alphabet.indexOf(value[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      escaped += "%" + ("0" + ((buffer >>> bits) & 255).toString(16)).slice(-2);
    }
  }
  var config;
  try { config = parseJSON(decodeURIComponent(escaped)); } catch (_) { fail("page"); }
  if (!config || typeof config !== "object" || Array.isArray(config)) fail("page");
  return config;
}

function verifyBoard(response, body) {
  // 正常 HTML 也会携带 Cloudflare 检测资源路径，路径本身不等于挑战页。
  // 仍拒绝挑战标头、验证页标题及交互验证信号，并要求已登录的初始数据。
  var text = inspectResponse(response, body, true);
  var contentType = header(response.headers, "Content-Type");
  if ((contentType && !/^text\/html(?:\s*;|\s*$)/i.test(String(contentType))) ||
      !/<(?:!doctype\s+html|html\b)/i.test(text)) fail("page");
  // temp-script 是页面的服务端初始数据；忽略注释，不以排行榜里的用户名判定登录。
  var scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  var html = text.replace(/<!--[\s\S]*?-->/g, "");
  var match, config = null;
  while ((match = scripts.exec(html))) {
    var attributes = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    var attribute, id = "", idCount = 0, external = false;
    while ((attribute = attributes.exec(match[1]))) {
      var name = attribute[1].toLowerCase();
      if (name === "id") {
        idCount++;
        id = attribute[2] !== undefined ? attribute[2] : attribute[3] !== undefined ? attribute[3] : attribute[4];
      }
      if (name === "src") external = true;
    }
    if (id !== "temp-script") continue;
    if (external || idCount !== 1 || config !== null) fail("page");
    config = boardConfig(match[2]);
  }
  if (!config) fail("page");
  var user = config.user;
  if (!user || typeof user !== "object" || Array.isArray(user)) fail("login");
  var member = user.member_id;
  if ((typeof member !== "number" && typeof member !== "string") ||
      !/^[1-9]\d*$/.test(String(member)) || Number(member) > 9007199254740991) fail("login");
  return String(member);
}

function apiPayload(response, body, allowDuplicate500) {
  var text = inspectResponse(response, body, false, allowDuplicate500);
  var headers = response && response.headers;

  var contentType = header(headers, "Content-Type");
  if (contentType && !/^application\/(?:[\w.-]+\+)?json(?:\s*;|\s*$)/i.test(String(contentType))) fail("json");
  var data = parseJSON(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("json");
  var apiStatus = statusCode({ status: data.status });
  field("API status", apiStatus || "缺失或格式异常");
  field("API type", typeof data.status);
  var message = typeof data.message === "string" ? data.message.trim() : "";
  if (/验证码|人机验证|安全验证|captcha|turnstile|challenge/i.test(message)) fail("challenge");
  if (/automated|automation|bot\s+(?:detected|check)|禁止自动|拒绝自动|检测到.*自动/i.test(message)) fail("automated");
  // status: 404 是公开签到脚本使用的登录态失效信号；HTTP 404 仍按接口异常处理。
  if (apiStatus === 401 || apiStatus === 404 || /请先?登录|尚未登录|未登录|登录(?:已)?(?:过期|失效)|会话(?:已)?过期|not\s+(?:logged|signed)\s+in|unauthori[sz]ed|login\s+required|session\s+(?:expired|invalid)/i.test(message)) fail("login");
  if (apiStatus === 429) fail("limited");
  if (apiStatus === 403) fail("forbidden");
  if (apiStatus >= 400) fail("http");
  return { data: data, message: message };
}

function classify(response, body) {
  var payload = apiPayload(response, body, true);
  var data = payload.data, message = payload.message;
  // 站点可能以 HTTP 500 返回明确的重复签到；只放行这一种失败结构。
  // 其他 500（包括 success:true、模糊提示、业务错误和挑战）仍不当作成功。
  if (statusCode(response) === 500) {
    if (data.success === false && isDuplicate(message)) return { kind: "duplicate" };
    fail("http");
  }
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

function attendanceState(response, body, member, day) {
  var payload = apiPayload(response, body);
  var data = payload.data;
  if (payload.message || (data.status !== undefined && statusCode({ status: data.status }) !== 200) ||
      (data.error !== undefined && data.error !== null) || (data.errors !== undefined && data.errors !== null) ||
      (data.success !== undefined && data.success !== true) || !Array.isArray(data.list) ||
      !Object.prototype.hasOwnProperty.call(data, "record")) fail("query");
  // 只使用当前会话的 record，不扫描排行榜 list，也不把缺字段当未签到。
  var date = header(response.headers, "Date");
  var timestamp = typeof date === "string" ? Date.parse(date) : NaN;
  var age = Date.now() - timestamp;
  if (!isFinite(age) || age < -30000 || age > 5 * 60 * 1000 || dayAt(timestamp) !== day) fail("queryDate");
  if (data.record === null) {
    if (data.order !== undefined && data.order !== null) fail("query");
    return { kind: "pending" };
  }
  var record = data.record;
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      typeof record.gain !== "number" || !isFinite(record.gain) || record.gain < 0 || Math.floor(record.gain) !== record.gain) fail("query");
  if (record.member_id !== undefined &&
      ((typeof record.member_id !== "number" && typeof record.member_id !== "string") || String(record.member_id) !== member)) fail("query");
  if (record.created_at !== undefined) {
    var created = typeof record.created_at === "string" ? Date.parse(record.created_at) : NaN;
    if (!isFinite(created) || created > timestamp + 30000 || dayAt(created) !== day) fail("query");
  }
  return { kind: "duplicate" };
}

function requireSameSession(session, day) {
  if (localDay() !== day) fail("dayChanged");
  var current = sessionFrom(readValue());
  if (!current || current.cookie !== session.cookie || current.userAgent !== session.userAgent) fail("sessionChanged");
}

function readRemote(session, path, accept, stage) {
  field("Stage", stage);
  return new Promise(function (resolve, reject) {
    try {
      $httpClient.get({
        url: ORIGIN + path, method: "GET", timeout: 6000,
        headers: { Cookie: session.cookie, "User-Agent": session.userAgent, Accept: accept,
          Referer: ORIGIN + "/board", "Cache-Control": "no-cache", Pragma: "no-cache" },
        "auto-cookie": false, "auto-redirect": false, insecure: false
      }, function (error, response, body) {
        if (error) { reject({ code: "queryNetwork" }); return; }
        resolve({ response: response, body: body });
      });
    } catch (_) { reject({ code: "queryNetwork" }); }
  });
}

function queryAttendance(session, day) {
  var member;
  // board 的 record:null 也可能出现在匿名访问中，先以同一 Cookie 验证登录身份。
  return readRemote(session, "/board", "text/html", "验证登录状态（GET）").then(function (reply) {
    requireSameSession(session, day);
    member = verifyBoard(reply.response, reply.body);
    return readRemote(session, "/api/attendance/board?page=1", "application/json", "查询签到状态（GET）");
  }).then(function (reply) {
    requireSameSession(session, day);
    return attendanceState(reply.response, reply.body, member, day);
  });
}

function capture() {
  // 双重约束：即使手动误调用脚本，也不读取其他页面、域名或方法的请求头。
  // 部分 Loon 回调省略 method；此时由插件的 GET / POST 条件约束，仍须验证响应。
  if (!$request) return;
  var page = BOARD_URL.test($request.url || "");
  var attendance = ATTENDANCE_URL.test($request.url || "");
  if ((!page && !attendance) || ($request.method !== undefined && $request.method !== (page ? "GET" : "POST"))) return;
  if (typeof $response === "undefined") fail("response");
  var result;
  if (page) verifyBoard($response, $response.body);
  else result = classify($response, $response.body);
  var cookie = header($request.headers, "Cookie");
  var userAgent = header($request.headers, "User-Agent");
  if (!validHeader(cookie) || !validHeader(userAgent)) fail("headers");

  var session = { cookie: cookie, userAgent: userAgent };
  var previous = readValue();
  var oldSession = sessionFrom(previous);
  // 打开页面不代表完成签到；仅保留同一会话已有的、非未来的服务端确认记录。
  if (page && oldSession && oldSession.cookie === cookie && oldSession.userAgent === userAgent &&
      oldSession.receipt && oldSession.receipt.day <= localDay()) session.receipt = oldSession.receipt;
  // 响应可能跨午夜才到达。只用近期、非未来的 HTTP Date 建立捕获记录；
  // 缺少可信日期仍保存已验证会话，但不猜测签到发生在哪一天。
  var date = header($response.headers, "Date");
  var timestamp = typeof date === "string" ? Date.parse(date) : NaN;
  var age = Date.now() - timestamp;
  if (!page && isFinite(age) && age >= 0 && age <= 5 * 60 * 1000) session.receipt = { day: dayAt(timestamp), kind: result.kind };
  var encoded = JSON.stringify(session);
  if (previous === encoded) {
    announce("登录会话已存在", "Cookie 与 User-Agent 未变化，跳过重复写入；本次未发送签到请求", "无需重复保存");
    return;
  }
  if (!writeValue(encoded)) fail("storage");
  var detail = page ? "已从已登录签到页保存本地会话；本次未发送签到请求，也不新增今日签到记录" :
    session.receipt ? "已验证手动签到响应；只在本地保存会话和当日结果记录" : "已验证并保存本地会话；缺少可信响应日期，本次不建立同日跳过记录";
  announce(oldSession ? "登录会话已更新" : "登录会话已保存", detail, "已保存到本地");
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

function checkin(settings) {
  var raw = readValue();
  if (!raw) fail("session");
  var session = sessionFrom(raw);
  if (!session) fail("invalidSession");
  var day = localDay();
  field("Reward mode", settings.random ? "随机奖励（random=true）" : "固定奖励（random=false）");
  if (settings.useCache && session.receipt && session.receipt.day === day) {
    field("Summary", "成功0 服务端重复0 本地跳过1 失败0");
    announce("本地记录：今日已有确认结果", "本次未请求服务器；记录来自" + (session.receipt.kind === "success" ? "签到成功响应" : "服务端已完成签到响应") + "，日界按 UTC+8", "已跳过重复执行");
    return;
  }

  field("Action", "先查询服务端状态；明确未签到才发送单次 POST，不自动重试");
  return queryAttendance(session, day).then(function (state) {
    requireSameSession(session, day);
    if (state.kind === "duplicate") {
      field("Preflight", "服务端确认今日已签到，跳过 POST");
      return state;
    }
    field("Preflight", "服务端明确今日未签到");
    field("Stage", "执行签到（POST）");
    return submit(session, settings.random);
  }).then(function (result) {
    var recorded = recordReceipt(session, day, result.kind);
    var details = [];
    if (result.kind === "success") {
      if (result.gain !== undefined) details.push("获得 " + result.gain + " 个鸡腿");
      if (result.current !== undefined) details.push("当前 " + result.current + " 个鸡腿");
    } else {
      details.push("服务端明确返回已完成签到；本次未计为新奖励");
    }
    var notificationDetail = result.kind === "success" ? details.join("；") : "无需重复签到";
    if (!recorded) {
      var warning = "本地记录未保存或会话已变化；请勿连续运行，先在官网核实";
      details.push(warning);
      notificationDetail += (notificationDetail ? "；" : "") + warning;
    }
    field("Summary", result.kind === "success" ? "成功1 服务端重复0 本地跳过0 失败0" : "成功0 服务端重复1 本地跳过0 失败0");
    announce(result.kind === "success" ? "签到成功" : "服务端：今日已签到", details.join("；"), notificationDetail);
  });
}

function execute() {
  var argument = typeof $argument === "undefined" ? undefined : $argument;
  // 捕获用途由规则里的固定参数指定，不能用缺少 $request 来推断需要签到。
  if (argument === "capture") {
    entryKind = "Capture";
    field("Entry", "会话捕获；不发送签到请求");
    if (typeof $request === "undefined" || !$request) {
      announce("捕获入口无需手动运行", "请在已登录的浏览器进入或刷新 /board；此处需要网页响应，本次未读取会话、未发签到请求", "请在已登录的浏览器进入或刷新 /board");
      return;
    }
    if (typeof $response === "undefined" || !$response) fail("response");
    return capture();
  }
  // 名称和完整的显式参数都符合签到入口时才允许读会话、发 POST。
  // 旧插件、缺参的手动运行及错误绑定一律停止，不默认采用固定奖励。
  var name = typeof $script !== "undefined" && $script && $script.name;
  if (name !== CHECKIN_NAME || typeof $request !== "undefined" || typeof $response !== "undefined") fail("entry");
  entryKind = "Checkin";
  field("Entry", "执行签到；参数验证后才允许发送请求");
  return checkin(options(argument));
}

console.log("🚀 NodeSeek Script Start");
field("Version", SCRIPT_VERSION + " | Loon");
Promise.resolve().then(function () {
  return execute();
}).catch(function (error) {
  var code = error && error.code;
  var detail = Object.prototype.hasOwnProperty.call(REASONS, code) ? REASONS[code] : REASONS.runtime;
  if (entryKind === "Checkin") field("Summary", "成功0 服务端重复0 本地跳过0 失败1");
  announce(entryKind === "Capture" ? "会话未保存，原有会话保留" : entryKind === "Checkin" ? "签到未完成" : "操作已阻止", detail);
}).then(function () { $done({}); }, function () { $done({}); });
