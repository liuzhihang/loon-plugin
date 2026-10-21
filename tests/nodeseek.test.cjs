// SPDX-License-Identifier: MIT
// Copyright (c) 2026 liuzhihang
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../scripts/nodeseek/nodeseek.js'), 'utf8');
const plugin = readFileSync(join(__dirname, '../plugins/nodeseek.lpx'), 'utf8');
const key = 'NodeSeek_Session';
const day = '2026-10-20';
const captureName = 'NodeSeek会话捕获_自动触发';
const checkinName = 'NodeSeek执行签到_会发请求';
const checkinArgument = { autoCheckin: true, random: false, useCache: true };
const fixture = { cookie: 'session=offline-session; cf_clearance=offline-clearance', userAgent: 'offline-iPhone-Safari' };
const success = { success: true, gain: 5, current: 120, message: '签到完成' };
const duplicate = { success: false, message: '今天已完成签到，明天再来吧' };
const saved = (receipt, session = fixture) => ({ [key]: JSON.stringify({ ...session, ...(receipt ? { receipt } : {}) }) });
const capture = (overrides = {}) => ({
  url: 'https://www.nodeseek.com/api/attendance?random=false', method: 'POST',
  headers: { cOoKiE: fixture.cookie, 'uSeR-aGeNt': fixture.userAgent }, ...overrides,
});
const response = (body = success, extras = {}) => ({ status: 200, headers: { Date: 'Tue, 20 Oct 2026 02:00:00 GMT' }, body: JSON.stringify(body), ...extras });
const boardRequest = (overrides = {}) => capture({ url: 'https://www.nodeseek.com/board', method: 'GET', ...overrides });
const boardHTML = (config = { user: { member_id: 123, username: 'private-page-user' } }) =>
  '<!DOCTYPE html><html><head><title>今日签到鸡腿排行榜</title></head><body>' +
  '<p>今日还未签到</p><script id="temp-script" type="text/plain">' +
  Buffer.from(JSON.stringify(config)).toString('base64') + '</script></body></html>';
const boardResponse = (extras = {}) => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', Date: 'Tue, 20 Oct 2026 02:00:00 GMT' }, body: boardHTML(), ...extras });

// Only these simulated Loon APIs are exposed. No HTTP, browser, filesystem or real credentials enter the VM.
async function runRaw({ initial = {}, request, response: capturedResponse, reply, argument, script, writeOK = true,
  readError = false, writeError = false, notifyError = false, now = '2026-10-20T02:00:00Z', onRequest } = {}) {
  const store = new Map(Object.entries(initial));
  const calls = [], reads = [], writes = [], logs = [], notifications = [], doneValues = [];
  let finish, done = 0;
  const completed = new Promise(resolve => { finish = resolve; });
  const sandbox = {
    $loon: 'offline Loon 3.5.1(983)',
    Date: class extends Date { static now() { return new Date(typeof now === 'function' ? now() : now).getTime(); } },
    console: { log: value => logs.push(String(value)) },
    $persistentStore: {
      read(name) { reads.push(name); if (typeof readError === 'function' ? readError(name, reads.length) : readError) throw new Error('private-read-error'); return store.get(name); },
      write(value, name) {
        writes.push({ value, key: name });
        if (writeError) throw new Error('private-write-error');
        if (writeOK) store.set(name, value);
        return writeOK;
      },
    },
    $notification: { post: (...args) => { notifications.push(args); if (notifyError) throw new Error(`private-notification-error ${fixture.cookie}`); } },
    $httpClient: {
      get() { assert.fail('NodeSeek must never issue a GET'); },
      post(options, callback) {
        calls.push(options);
        if (onRequest) onRequest(store, options);
        const result = reply ? reply(options, calls) : { body: success };
        if (result.throw) throw new Error(result.throw);
        const res = result.noResponse ? undefined : {
          ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : { status: result.status ?? 200 }),
          headers: result.headers || {},
        };
        const body = Object.hasOwn(result, 'rawBody') ? result.rawBody : JSON.stringify(result.body ?? {});
        queueMicrotask(() => callback(result.error || null, res, body));
      },
    },
    $done(value) { done++; doneValues.push(value); finish(); },
  };
  if (request !== undefined) sandbox.$request = request;
  if (capturedResponse !== undefined) sandbox.$response = capturedResponse;
  if (argument !== undefined) sandbox.$argument = argument;
  if (script !== undefined) sandbox.$script = script;
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const timer = setTimeout(() => finish('timeout'), 1000);
  const outcome = await completed;
  clearTimeout(timer);
  assert.notEqual(outcome, 'timeout', 'script must finish');
  assert.equal(done, 1, '$done must be called exactly once');
  assert.equal(JSON.stringify(doneValues), '[{}]', 'capture must leave request and response unchanged');
  return { store, calls, reads, writes, logs: logs.join('\n'), notifications };
}

// Ordinary fixtures model a complete plugin invocation. The regression cases below
// call runRaw directly so missing arguments/metadata remain truly absent.
function run(settings = {}) {
  const capturing = Object.hasOwn(settings, 'request');
  let argument = capturing ? 'capture' : { ...checkinArgument };
  if (Object.hasOwn(settings, 'argument')) {
    const value = settings.argument;
    argument = !capturing && value && typeof value === 'object' && !Array.isArray(value)
      ? { ...checkinArgument, ...value } : value;
  }
  return runRaw({ script: { name: capturing ? captureName : checkinName }, ...settings, argument });
}

const receiptOf = r => JSON.parse(r.store.get(key)).receipt;
const outputOf = r => r.logs + JSON.stringify(r.notifications);

test('manual capture and former confirmation entries never become check-in when request context or arguments are absent', async () => {
  for (const name of [captureName, 'NodeSeek抓包', 'NodeSeek签到确认', 'NodeSeek签到']) {
    for (const argument of [undefined, null, '', 'capture', { random: true, useCache: false }]) {
      const initial = saved();
      const r = await runRaw({ initial, argument, script: { name, type: 'CRON' } });
      assert.equal(r.calls.length + r.reads.length + r.writes.length, 0, `${name}: ${String(argument)}`);
      assert.deepEqual(Object.fromEntries(r.store), initial);
      assert.doesNotMatch(outputOf(r), /签到成功|成功1|单次 POST|offline-session|offline-clearance/);
      assert.match(r.logs, /操作已阻止|捕获入口无需手动运行/);
    }
  }
});

test('capture intent without a complete web response only gives guidance and cannot inspect stored credentials', async () => {
  for (const context of [{}, { request: null }, { response: boardResponse() },
    { request: boardRequest() }, { request: boardRequest(), response: null }]) {
    const r = await runRaw({ initial: saved(), argument: 'capture', script: { name: captureName, type: 'CRON' }, ...context });
    assert.equal(r.calls.length + r.reads.length + r.writes.length, 0);
    assert.equal(r.notifications.length, 1);
    assert.match(r.logs, /捕获入口无需手动运行|会话未保存/);
    assert.doesNotMatch(r.logs, /签到成功|Reward mode|Action/);
    if (!context.request) {
      assert.equal(r.notifications[0][2], '请在已登录的浏览器进入或刷新 /board');
      assert.match(r.logs, /本次未读取会话、未发签到请求/);
    }
  }
});

test('only the named check-in entry with all explicit typed parameters can issue a POST', async () => {
  for (const script of [undefined, null, {}, { name: captureName }, { name: 'NodeSeek签到确认' }, { name: 'NodeSeek签到' }]) {
    const r = await runRaw({ initial: saved(), script, argument: checkinArgument });
    assert.equal(r.calls.length + r.reads.length + r.writes.length, 0);
    assert.match(r.logs, /操作已阻止/);
  }
  const allowed = await runRaw({ initial: saved(), script: { name: checkinName }, argument: { ...checkinArgument, random: true } });
  assert.equal(allowed.calls.length, 1);
  assert.equal(allowed.calls[0].url, 'https://www.nodeseek.com/api/attendance?random=true');
});

test('missing, partial, malformed and contradictory check-in parameters fail closed before storage access', async () => {
  for (const argument of [undefined, null, '', {}, true, false, [], 'null', '[]', 'random=true',
    { random: true, useCache: true }, { autoCheckin: true },
    { autoCheckin: true, random: true }, { autoCheckin: true, useCache: true },
    { ...checkinArgument, mode: 'capture' }, { ...checkinArgument, autoCheckin: 'true' },
    { ...checkinArgument, random: 'true' }, { ...checkinArgument, useCache: 1 },
    JSON.stringify({ random: true, useCache: false })]) {
    const initial = saved();
    const r = await runRaw({ initial, script: { name: checkinName }, argument });
    assert.equal(r.calls.length + r.reads.length + r.writes.length, 0);
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.match(r.logs, /入口或参数缺失|插件参数无效/);
  }
});

test('a disabled check-in switch blocks manual execution even with the correct entry and saved session', async () => {
  const r = await runRaw({ initial: saved(), script: { name: checkinName }, argument: { ...checkinArgument, autoCheckin: false } });
  assert.equal(r.calls.length + r.reads.length + r.writes.length, 0);
  assert.match(r.logs, /自动签到开关未开启/);
});

test('a check-in argument misbound to a response context cannot read a session or send a second request', async () => {
  for (const context of [{ request: null }, { response: null }, { request: boardRequest(), response: boardResponse() },
    { request: capture(), response: response() }]) {
    const r = await runRaw({ initial: saved(), argument: checkinArgument, script: { name: checkinName }, ...context });
    assert.equal(r.calls.length + r.reads.length + r.writes.length, 0);
    assert.match(r.logs, /操作已阻止/);
  }
});

test('an older plugin without an explicit capture argument cannot capture or execute a check-in', async () => {
  for (const context of [{ request: boardRequest(), response: boardResponse() }, { request: capture(), response: response() }]) {
    const r = await runRaw({ initial: saved(), script: { name: 'NodeSeek抓包' }, ...context });
    assert.equal(r.calls.length + r.reads.length + r.writes.length, 0);
    assert.match(r.logs, /操作已阻止/);
  }
});

test('first, updated and unchanged page credentials each submit one sanitized notification with no network request', async () => {
  const oldSession = { cookie: 'session=previous-private-cookie', userAgent: 'previous-private-agent' };
  for (const [initial, title, detail, writes] of [
    [{}, '登录会话已保存', '已保存到本地', 1],
    [saved(undefined, oldSession), '登录会话已更新', '已保存到本地', 1],
    [saved(), '登录会话已存在', '无需重复保存', 0],
  ]) {
    const r = await runRaw({ initial, argument: 'capture', script: { name: captureName }, request: boardRequest(), response: boardResponse() });
    assert.equal(r.calls.length, 0);
    assert.equal(r.writes.length, writes);
    assert.equal(r.notifications.length, 1);
    assert.deepEqual(r.notifications[0], ['NodeSeek', title, detail]);
    assert.equal(r.notifications[0].length, 3, 'no clipboard, external links or attachments');
    assert.match(r.logs, /本次未发送签到请求/);
    assert.match(r.logs, /已调用 Loon 通知接口.*横幅显示取决于/);
    assert.doesNotMatch(outputOf(r), /offline-session|offline-clearance|offline-iPhone|previous-private|private-page-user/);
    assert.equal(receiptOf(r), undefined);
  }
});

test('page notification errors preserve both first and unchanged credentials without claiming delivery or signing in', async () => {
  for (const initial of [{}, saved()]) {
    const r = await runRaw({ initial, argument: 'capture', script: { name: captureName }, request: boardRequest(), response: boardResponse(), notifyError: true });
    assert.deepEqual(JSON.parse(r.store.get(key)), fixture);
    assert.equal(r.calls.length, 0);
    assert.equal(r.notifications.length, 1);
    assert.match(r.logs, /通知发送失败/);
    assert.doesNotMatch(r.logs, /已调用 Loon 通知接口|签到成功|private-notification-error|offline-session/);
  }
});

test('plugin exposes only capture and explicit check-in entries with complete typed settings', () => {
  assert.equal(plugin.split('\n').filter(line => line.startsWith('response if ')).length, 1);
  assert.doesNotMatch(plugin, /tag="NodeSeek签到确认"|request\.method\} == "POST"/);
  assert.match(plugin, /nodeseek\.js", "capture"\).*tag="NodeSeek会话捕获_自动触发"/);
  assert.match(plugin, /cron .*\{\$\{autoCheckin\}, \$\{random\}, \$\{useCache\}\}.*tag="NodeSeek执行签到_会发请求"/);
  assert.match(plugin, /random = switch,false,type=boolean/);
  assert.match(plugin, /useCache = switch,true,type=boolean/);
  assert.match(plugin, /cronExpression = input,"30 9 \* \* \*",type=string/);
  assert.match(plugin, /cron \$\{cronExpression\}.*\{\$\{autoCheckin\}, \$\{random\}, \$\{useCache\}\}/);
  assert.match(plugin, /hostname = www\.nodeseek\.com\s*$/);
});

test('plugin captures the exact GET board page, including a trailing slash or query, without broadening the hostname', () => {
  const rule = plugin.split('\n').find(line => line.startsWith('response if ') && line.includes('"GET"'));
  assert.match(rule, /\$\{response\.status\} == 200/);
  assert.match(rule, /requires_body=true/);
  const literal = rule.match(/\$\{url\} ~= (\/.+\/) && \$\{request\.method\}/)?.[1];
  assert.ok(literal);
  const matcher = new RegExp(literal.slice(1, -1));
  for (const suffix of ['/board', '/board/', '/board?refresh=1', '/board/?x=1&y=2']) {
    assert.equal(matcher.test('https://www.nodeseek.com' + suffix), true);
  }
  for (const url of ['https://nodeseek.com/board', 'http://www.nodeseek.com/board',
    'https://www.nodeseek.com.evil.test/board', 'https://www.nodeseek.com:443/board',
    'https://www.nodeseek.com/board/extra', 'https://www.nodeseek.com/boardevil',
    'https://www.nodeseek.com/board#fragment', 'https://www.nodeseek.com/login', 'https://www.nodeseek.com/']) {
    assert.equal(matcher.test(url), false, url);
  }
});

test('the remote plugin owns capture and schedule controls, with automatic check-in initially disabled', () => {
  const declarations = new Map();
  let section = '';
  for (const line of plugin.split('\n')) {
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1]; continue; }
    if (section !== 'Argument') continue;
    const declaration = line.match(/^(\w+) = (switch|input),([^,]+),type=(boolean|string),/);
    if (declaration) declarations.set(declaration[1], { control: declaration[2], initial: declaration[3], type: declaration[4] });
  }
  assert.deepEqual([...declarations.keys()], ['capture', 'autoCheckin', 'cronExpression', 'random', 'useCache']);
  assert.deepEqual(declarations.get('capture'), { control: 'switch', initial: 'true', type: 'boolean' });
  assert.deepEqual(declarations.get('autoCheckin'), { control: 'switch', initial: 'false', type: 'boolean' });
  assert.deepEqual(declarations.get('cronExpression'), { control: 'input', initial: '"30 9 * * *"', type: 'string' });
  const rules = plugin.split('\n').filter(line => /^(?:response if|cron )/.test(line));
  assert.equal(rules.length, 2);
  assert.match(rules[0], /enable=\$\{capture\}$/);
  assert.match(rules[1], /^cron \$\{cronExpression\} /);
  assert.match(rules[1], /enable=\$\{autoCheckin\}$/);
  for (const match of plugin.matchAll(/\$\{(capture|autoCheckin|cronExpression|random|useCache)\}/g)) {
    assert.ok(declarations.has(match[1]), `undeclared plugin argument ${match[1]}`);
  }
});

test('plugin references only repository-hosted scripts and keeps its hostname scope inside the plugin', () => {
  const paths = [...plugin.matchAll(/script\("([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(paths, [
    'https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/nodeseek/nodeseek.js',
    'https://raw.githubusercontent.com/liuzhihang/loon-plugin/main/scripts/nodeseek/nodeseek.js',
  ]);
  assert.deepEqual([...plugin.matchAll(/^\[([^\]]+)\]$/gm)].map(match => match[1]), ['Argument', 'Script', 'MITM']);
  assert.equal((plugin.match(/^hostname = .+$/gm) || []).length, 1);
  assert.doesNotMatch(plugin, /file:\/\/|\/Users\/|localhost|127\.0\.0\.1|ca-p12|ca-passphrase/);
});

test('opening a logged-in board page saves only Cookie and User-Agent without signing in or claiming a receipt', async () => {
  const request = boardRequest();
  request.headers.Authorization = 'private-unused-header';
  const r = await run({ request, response: boardResponse() });
  assert.equal(r.calls.length, 0);
  assert.deepEqual(JSON.parse(r.store.get(key)), fixture);
  assert.equal(r.writes.length, 1);
  assert.match(outputOf(r), /登录会话已保存/);
  assert.match(outputOf(r), /未发送签到请求/);
  assert.doesNotMatch(outputOf(r) + r.store.get(key), /private-page-user|private-unused-header|member_id/);
  assert.doesNotMatch(outputOf(r), /offline-session|offline-clearance|offline-iPhone/);
});

test('board capture handles UTF-8 bootstrap data and normal HTML attribute variations without executing scripts', async () => {
  for (const html of [
    boardHTML({ user: { member_id: '123', username: '离线用户🍗' }, note: 'private-config-text' }),
    boardHTML().replace('id="temp-script" type="text/plain"', "type='text/plain'\nID='temp-script'"),
    boardHTML().replace('id="temp-script"', 'id=temp-script'),
    boardHTML().replace('</body>', '<script>throw new Error("private-executed-script")</script></body>'),
    boardHTML().replace('</body>', '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body>'),
  ]) {
    const r = await run({ request: boardRequest(), response: boardResponse({ body: html }) });
    assert.deepEqual(JSON.parse(r.store.get(key)), fixture);
    assert.equal(r.calls.length, 0);
    assert.doesNotMatch(outputOf(r), /private-|离线用户/);
  }
});

test('GET board variants and a missing callback method still require a verified logged-in page', async () => {
  for (const suffix of ['/board', '/board/', '/board?refresh=1']) {
    const request = boardRequest({ url: 'https://www.nodeseek.com' + suffix });
    delete request.method;
    const r = await run({ request, response: boardResponse() });
    assert.deepEqual(JSON.parse(r.store.get(key)), fixture);
  }
});

test('board visits retain a confirmed receipt only for the unchanged session and never trust page sign-in wording', async () => {
  const initial = saved({ day, kind: 'success' });
  const same = await run({ initial, request: boardRequest(), response: boardResponse() });
  assert.equal(same.writes.length, 0);
  assert.equal(same.notifications.length, 1);
  assert.equal(same.notifications[0][1], '登录会话已存在');
  assert.deepEqual(receiptOf(same), { day, kind: 'success' });
  for (const headers of [{ Cookie: 'session=other-offline-user', 'User-Agent': fixture.userAgent },
    { Cookie: fixture.cookie, 'User-Agent': 'offline-other-browser' }]) {
    const changed = await run({ initial, request: boardRequest({ headers }), response: boardResponse() });
    assert.equal(receiptOf(changed), undefined);
    assert.equal(changed.calls.length, 0);
  }
  const future = await run({ initial: saved({ day: '2099-01-01', kind: 'success' }), request: boardRequest(), response: boardResponse() });
  assert.equal(receiptOf(future), undefined);
  const pageSaysSigned = await run({ request: boardRequest(), response: boardResponse({ body: boardHTML().replace('今日还未签到', '今日已签到') }) });
  assert.equal(receiptOf(pageSaysSigned), undefined);
});

test('an unchanged page session still notifies without writing, and explicit check-in submits exactly one POST', async () => {
  const captured = await run({ request: boardRequest(), response: boardResponse() });
  const initial = Object.fromEntries(captured.store);
  const unchanged = await run({ initial, request: boardRequest(), response: boardResponse() });
  assert.equal(unchanged.writes.length + unchanged.calls.length, 0);
  assert.equal(unchanged.notifications.length, 1);
  assert.match(unchanged.logs, /未变化/);
  const cron = await run({ initial });
  assert.equal(cron.calls.length, 1);
  assert.equal(cron.calls[0].method, 'POST');
  assert.deepEqual(receiptOf(cron), { day, kind: 'success' });
});

test('anonymous, malformed, challenged, redirected or unrelated pages preserve the old session without network access', async () => {
  const bodies = [
    boardHTML({ user: null }), boardHTML({ user: false }), boardHTML({ user: [] }),
    boardHTML({ user: { member_id: 0 } }), boardHTML({ user: { member_id: '001' } }),
    boardHTML({ user: { member_id: '123x' } }), boardHTML({ user: { member_id: 9007199254740992 } }),
    boardHTML({ user: { member_id: true } }), boardHTML({ user: { member_id: { id: 123 } } }),
    boardHTML({ users: [{ member_id: 123 }] }), boardHTML([]), boardHTML('not-a-config'),
    '<html><body>今日还未签到 排行榜 user member_id=123</body></html>',
    boardHTML().replace(/(<script[^>]*>)[^<]+/, '$1!!!invalid!!!'),
    boardHTML().replace(/(<script[^>]*>)[^<]+/, '$1' + Buffer.from('{"user":').toString('base64')),
    boardHTML().replace(/(<script[^>]*>)[^<]+/, '$1' + Buffer.from([0xff, 0xff, 0xff]).toString('base64')),
    boardHTML().replace('<script ', '<!-- <script ').replace('</script>', '</script> -->'),
    boardHTML().replace('id="temp-script"', 'data-id="temp-script"'),
    boardHTML().replace('id="temp-script"', 'data-note=\' id="temp-script" \''),
    boardHTML().replace('id="temp-script"', 'id="other" id="temp-script"'),
    boardHTML().replace('<script ', '<script src="https://evil.test/data" '),
    boardHTML().replace('</body>', '<script id="temp-script">' + Buffer.from('{"user":null}').toString('base64') + '</script></body>'),
    boardHTML().replace('<title>今日签到鸡腿排行榜</title>', '<title>Just a moment...</title>'),
    boardHTML().replace('</body>', '<script>window._cf_chl_opt = {};</script></body>'),
    boardHTML().replace('</body>', '<div class="cf-turnstile">安全验证</div></body>'),
  ];
  const badResponses = bodies.map(body => boardResponse({ body }));
  for (const status of [0, 200.5, 301, 302, 307, 401, 403, 404, 429, 500]) badResponses.push(boardResponse({ status }));
  badResponses.push(boardResponse({ headers: { 'Content-Type': 'application/json' } }));
  badResponses.push(boardResponse({ headers: { 'cf-mitigated': 'challenge' } }));
  for (const capturedResponse of badResponses) {
    const initial = saved({ day, kind: 'duplicate' });
    const r = await run({ initial, request: boardRequest(), response: capturedResponse });
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.equal(r.calls.length + r.writes.length, 0);
    assert.match(r.logs, /会话未保存/);
    assert.doesNotMatch(outputOf(r), /offline-session|private-page-user|evil\.test/);
  }
});

test('board capture never reads headers or storage for another URL or an incorrect method', async () => {
  for (const request of [boardRequest({ method: 'POST' }), boardRequest({ method: 'DELETE' }),
    boardRequest({ url: 'https://nodeseek.com/board' }), boardRequest({ url: 'https://www.nodeseek.com/board/extra' }),
    boardRequest({ url: 'https://www.nodeseek.com.evil.test/board' }), boardRequest({ url: 'https://www.nodeseek.com/login' })]) {
    Object.defineProperty(request, 'headers', { get() { assert.fail('must not read unrelated headers'); } });
    const r = await run({ request, response: boardResponse() });
    assert.equal(r.reads.length + r.writes.length + r.calls.length + r.notifications.length, 0);
  }
});

test('board capture requires valid headers and preserves existing data on storage failures', async () => {
  for (const settings of [
    { request: boardRequest({ headers: { Cookie: fixture.cookie } }) },
    { request: boardRequest({ headers: { Cookie: 'session=unsafe\r\nX: secret', 'User-Agent': fixture.userAgent } }) },
    { readError: true }, { writeError: true }, { writeOK: false },
  ]) {
    const initial = saved(undefined, { ...fixture, cookie: 'session=previous-offline-user' });
    const r = await run({ initial, request: boardRequest(), response: boardResponse(), ...settings });
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.equal(r.calls.length, 0);
    assert.match(r.logs, /会话未保存/);
    assert.doesNotMatch(outputOf(r), /offline-session|secret|private-page-user/);
  }
});

test('manual success saves only local Cookie, User-Agent and confirmed receipt without any request', async () => {
  const request = capture();
  request.headers.Authorization = 'private-unused-header';
  const r = await run({ request, response: response({ ...success, token: 'private-response-token', data: { id: 123 } }) });
  assert.equal(r.calls.length, 0);
  assert.deepEqual(JSON.parse(r.store.get(key)), { ...fixture, receipt: { day, kind: 'success' } });
  assert.equal(r.writes.length, 1);
  assert.match(r.logs, /登录会话已保存/);
  assert.doesNotMatch(outputOf(r), /offline-session|offline-clearance|offline-iPhone|private-/);
});

test('the statusCode field and numeric-string status are accepted on manual capture', async () => {
  for (const status of [{ statusCode: 200 }, { status: '200' }]) {
    const r = await run({ request: capture(), response: { ...status, body: JSON.stringify(success) } });
    assert.match(r.logs, /登录会话已保存/);
  }
});

test('legacy explicit capture with an omitted POST method still requires a confirmed response', async () => {
  const request = capture();
  delete request.method;
  const r = await run({ request, response: response() });
  assert.equal(r.calls.length, 0);
  assert.deepEqual(JSON.parse(r.store.get(key)), { ...fixture, receipt: { day, kind: 'success' } });
  const invalid = await run({ request, response: response({ success: false }) });
  assert.equal(invalid.calls.length + invalid.writes.length, 0);
});

test('an unchanged verified session notifies, and the next verified account replaces its receipt', async () => {
  const initial = saved({ day, kind: 'success' });
  const unchanged = await run({ initial, request: capture(), response: response() });
  assert.equal(unchanged.writes.length, 0);
  assert.equal(unchanged.notifications.length, 1);
  assert.match(unchanged.logs, /未变化/);
  const updated = await run({ initial, request: capture({ headers: { Cookie: 'session=new-offline-account', 'User-Agent': fixture.userAgent } }), response: response(duplicate) });
  assert.equal(JSON.parse(updated.store.get(key)).cookie, 'session=new-offline-account');
  assert.deepEqual(receiptOf(updated), { day, kind: 'duplicate' });
});

test('wrong URL and method are ignored before headers or local storage are inspected', async () => {
  for (const request of [
    capture({ url: 'https://www.nodeseek.com/board' }),
    capture({ url: 'https://www.nodeseek.com.example.test/api/attendance?random=false' }),
    capture({ url: 'http://www.nodeseek.com/api/attendance?random=false' }),
    capture({ url: 'https://www.nodeseek.com/api/attendance?random=anything' }),
    capture({ method: 'GET' }), capture({ method: 'DELETE' }),
  ]) {
    const initial = saved();
    const r = await run({ initial, request, response: response() });
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.equal(r.calls.length + r.reads.length + r.writes.length + r.notifications.length, 0);
  }
});

test('capture requires both a verified response and valid captured Cookie and User-Agent', async () => {
  for (const entry of [
    { request: capture() },
    { request: capture(), response: response({ success: false, message: '请先登录' }) },
    { request: capture(), response: response({ success: 'true' }) },
    { request: capture(), response: response({ message: '已完成签到' }) },
    { request: capture(), response: response(success, { status: 401 }) },
    { request: capture(), response: response(success, { status: 403 }) },
    { request: capture(), response: response(success, { status: 429 }) },
    { request: capture(), response: response(success, { body: '<html>login page</html>' }) },
    { request: capture({ headers: { Cookie: fixture.cookie } }), response: response() },
    { request: capture({ headers: { 'User-Agent': fixture.userAgent } }), response: response() },
    { request: capture({ headers: { Cookie: 'session=fixture\r\nInjected: secret', 'User-Agent': fixture.userAgent } }), response: response() },
    { request: capture({ headers: { Cookie: fixture.cookie, 'User-Agent': '\nprivate-header' } }), response: response() },
    { request: capture({ headers: { Cookie: ['invalid'], 'User-Agent': fixture.userAgent } }), response: response() },
  ]) {
    const initial = saved({ day: '2026-10-19', kind: 'success' });
    const r = await run({ initial, ...entry });
    assert.equal(r.calls.length, 0);
    assert.equal(r.writes.length, 0);
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.match(r.logs, /会话未保存/);
    assert.doesNotMatch(outputOf(r), /offline-session|private-header/);
  }
});

test('missing, malformed or unsafe sessions finish without network access', async () => {
  for (const initial of [
    {}, { [key]: '{broken' }, { [key]: 'null' }, { [key]: '[]' },
    { [key]: JSON.stringify({ cookie: fixture.cookie }) },
    { [key]: JSON.stringify({ ...fixture, cookie: 'session=unsafe\r\nX: injected' }) },
    { [key]: JSON.stringify({ ...fixture, userAgent: '' }) },
  ]) {
    const r = await run({ initial });
    assert.equal(r.calls.length, 0);
    assert.equal(r.writes.length, 0);
    assert.match(r.logs, /签到未完成/);
    assert.doesNotMatch(outputOf(r), /offline-session|injected/);
  }
});

test('cron defaults to one fixed-reward POST with the captured credentials and no redirects or cookie jar', async () => {
  const r = await run({ initial: saved() });
  assert.equal(r.calls.length, 1);
  const request = r.calls[0];
  assert.equal(request.url, 'https://www.nodeseek.com/api/attendance?random=false');
  assert.equal(request.method, 'POST');
  assert.equal(request.timeout, 15000);
  assert.equal(request.body, '{}');
  assert.equal(request.headers.Cookie, fixture.cookie);
  assert.equal(request.headers['User-Agent'], fixture.userAgent);
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(request.headers.Origin, 'https://www.nodeseek.com');
  assert.equal(request.headers.Referer, 'https://www.nodeseek.com/board');
  assert.equal(request['auto-cookie'], false);
  assert.equal(request['auto-redirect'], false);
  assert.equal(request.insecure, false);
  assert.deepEqual(receiptOf(r), { day, kind: 'success' });
  assert.match(r.logs, /成功1 服务端重复0 本地跳过0 失败0/);
  assert.match(outputOf(r), /获得 5 个鸡腿.*当前 120 个鸡腿/);
  assert.equal(r.notifications[0][2], '获得 5 个鸡腿；当前 120 个鸡腿');
  assert.doesNotMatch(outputOf(r), /offline-session|offline-clearance|offline-iPhone/);
});

test('typed true and complete JSON argument objects select random rewards without nonce parameters', async () => {
  for (const argument of [{ random: true }, JSON.stringify({ ...checkinArgument, random: true })]) {
    const r = await run({ initial: saved(), argument });
    assert.equal(r.calls.length, 1);
    assert.equal(r.calls[0].url, 'https://www.nodeseek.com/api/attendance?random=true');
    assert.match(r.logs, /随机奖励/);
  }
});

test('Loon null arguments never fall back to fixed-reward check-in', async () => {
  const r = await run({ initial: saved(), argument: null });
  assert.equal(r.calls.length + r.reads.length + r.writes.length, 0);
  assert.match(r.logs, /入口或参数缺失/);
});

test('invalid settings never fall back to an unintended reward mode or send a request', async () => {
  for (const argument of [{ random: 'true' }, { random: 1 }, { useCache: 'false' }, 'random=true', 'null', '[]', true]) {
    const r = await run({ initial: saved(), argument });
    assert.equal(r.calls.length, 0);
    assert.equal(r.writes.length, 0);
    assert.match(r.logs, /插件参数无效|入口或参数缺失/);
  }
});

test('same-day cache is distinct from a server duplicate and makes no network request', async () => {
  for (const kind of ['success', 'duplicate']) {
    const initial = saved({ day, kind });
    const r = await run({ initial });
    assert.equal(r.calls.length, 0);
    assert.equal(r.writes.length, 0);
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.match(r.logs, /成功0 服务端重复0 本地跳过1 失败0/);
    assert.match(r.logs, /本次未请求服务器/);
    assert.deepEqual(r.notifications[0], ['NodeSeek', '本地记录：今日已有确认结果', '已跳过重复执行']);
  }
});

test('disabling the cache requests the server and an old or invalid receipt never skips a new day', async () => {
  const cases = [
    { initial: saved({ day, kind: 'success' }), argument: { useCache: false } },
    { initial: saved({ day: '2026-10-19', kind: 'success' }) },
    { initial: saved({ day: '2026-10-21', kind: 'duplicate' }) },
    { initial: saved({ day, kind: 'failed' }) },
    { initial: saved({ day: 'bad-date', kind: 'success' }) },
  ];
  for (const entry of cases) {
    const r = await run(entry);
    assert.equal(r.calls.length, 1);
    assert.deepEqual(receiptOf(r), { day, kind: 'success' });
  }
});

test('UTC+8 cache day is independent of the device timezone and resets at 16:00 UTC', async () => {
  const initial = saved({ day, kind: 'success' });
  const before = await run({ initial, now: '2026-10-20T15:59:59Z' });
  assert.equal(before.calls.length, 0);
  const after = await run({ initial, now: '2026-10-20T16:00:00Z' });
  assert.equal(after.calls.length, 1);
  assert.deepEqual(receiptOf(after), { day: '2026-10-21', kind: 'success' });
});

test('capture arriving after midnight uses the response Date rather than claiming the new day', async () => {
  const r = await run({ request: capture(), now: '2026-10-20T16:00:01Z', response: response(success, {
    headers: { dAtE: 'Tue, 20 Oct 2026 15:59:59 GMT' },
  }) });
  assert.deepEqual(receiptOf(r), { day: '2026-10-20', kind: 'success' });
  const next = await run({ initial: Object.fromEntries(r.store), now: '2026-10-20T16:00:02Z' });
  assert.equal(next.calls.length, 1);
  assert.deepEqual(receiptOf(next), { day: '2026-10-21', kind: 'success' });
});

test('missing, invalid, stale or future response dates save authenticated sessions without a guessed receipt', async () => {
  for (const headers of [{}, { Date: 'private-invalid-date' }, { Date: 'Tue, 20 Oct 2026 01:00:00 GMT' },
    { Date: 'Tue, 20 Oct 2026 02:01:00 GMT' }, { Date: ['Tue, 20 Oct 2026 02:00:00 GMT'] }]) {
    const r = await run({ request: capture(), response: response(success, { headers }) });
    assert.equal(r.calls.length, 0);
    assert.deepEqual(JSON.parse(r.store.get(key)), fixture);
    assert.match(outputOf(r), /缺少可信响应日期/);
    assert.doesNotMatch(outputOf(r), /private-invalid-date/);
  }
});

test('a POST crossing midnight keeps the conservative request-start day so the next day is not skipped', async () => {
  let now = '2026-10-20T15:59:59Z';
  const r = await run({ initial: saved(), now: () => now, onRequest() { now = '2026-10-20T16:00:01Z'; } });
  assert.equal(r.calls.length, 1);
  assert.deepEqual(receiptOf(r), { day: '2026-10-20', kind: 'success' });
  const next = await run({ initial: Object.fromEntries(r.store), now });
  assert.equal(next.calls.length, 1);
});

test('an old POST cannot overwrite a newly captured next-day receipt for the same session', async () => {
  for (const kind of ['success', 'duplicate']) {
    let now = '2026-10-20T15:59:59Z';
    const newer = saved({ day: '2026-10-21', kind });
    const r = await run({ initial: saved(), now: () => now, onRequest(store) {
      now = '2026-10-20T16:00:01Z';
      store.set(key, newer[key]);
    } });
    assert.equal(r.calls.length, 1);
    assert.equal(r.writes.length, 0);
    assert.deepEqual(Object.fromEntries(r.store), newer);
    assert.match(r.logs, /成功1 服务端重复0 本地跳过0 失败0/);
  }
});

test('success requires the exact boolean true, and all other success-like results preserve prior receipts', async () => {
  for (const body of [
    {}, { success: 'true' }, { success: 1 }, { success: 'false' }, { success: null }, { code: 0 },
    { success: false, gain: 5, message: '领取 5 个鸡腿失败' },
    { success: false, message: '签到成功' },
    { success: false, message: '未完成签到' },
    { success: false, message: '签到失败，已完成签到后重试' },
    { message: '今天已完成签到' },
  ]) {
    const initial = saved({ day: '2026-10-19', kind: 'success' });
    const r = await run({ initial, reply: () => ({ body }) });
    assert.equal(r.calls.length, 1);
    assert.equal(r.writes.length, 0);
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.match(r.logs, /成功0 服务端重复0 本地跳过0 失败1/);
    assert.equal(r.notifications[0][1], '签到未完成');
  }
});

test('explicit already-completed responses are classified separately and cached as duplicates', async () => {
  for (const message of ['已完成签到', '今天已完成签到，明天再来吧', '今日已经完成签到。', '您今天已完成签到！']) {
    const r = await run({ initial: saved(), reply: () => ({ body: { success: false, message, gain: 5 } }) });
    assert.equal(r.calls.length, 1);
    assert.deepEqual(receiptOf(r), { day, kind: 'duplicate' });
    assert.match(r.logs, /成功0 服务端重复1 本地跳过0 失败0/);
    assert.equal(r.notifications[0][1], '服务端：今日已签到');
    assert.equal(r.notifications[0][2], '无需重复签到');
    assert.match(r.logs, /服务端明确返回已完成签到；本次未计为新奖励/);
    assert.doesNotMatch(outputOf(r), /获得 5 个鸡腿/);
  }
});

test('ambiguous duplicate suffixes never become success or duplicate receipts even with success true', async () => {
  for (const message of ['今天已完成签到，但结果异常', '已完成签到，服务器返回失败', '已完成签到，请稍后核实', '已完成签到。未知说明']) {
    for (const successFlag of [true, false]) {
      const initial = saved();
      const body = { success: successFlag, message };
      const r = await run({ initial, reply: () => ({ body }) });
      assert.equal(r.calls.length, 1);
      assert.equal(r.writes.length, 0);
      assert.deepEqual(Object.fromEntries(r.store), initial);
      assert.equal(r.notifications[0][1], '签到未完成');
      const captured = await run({ initial, request: capture(), response: response(body) });
      assert.equal(captured.calls.length + captured.writes.length, 0);
      assert.deepEqual(Object.fromEntries(captured.store), initial);
    }
  }
});

test('success output includes only validated numeric rewards, never raw messages or payloads', async () => {
  for (const stats of [
    { gain: 0, current: 0 }, {}, { gain: -1, current: -2 }, { gain: '5', current: '<secret>' },
    { gain: 1.5, current: { token: 'private-stat' } }, { gain: 'private-gain', current: 'private-current' },
  ]) {
    const r = await run({ initial: saved(), reply: () => ({ body: {
      success: true, ...stats, message: `raw ${fixture.cookie}`, cookie: 'private-cookie', data: { token: 'private-token' },
    } }) });
    assert.match(r.logs, /成功1 服务端重复0/);
    assert.doesNotMatch(outputOf(r), /offline-session|offline-clearance|private-|<secret>/);
    if (stats.gain === 0) assert.match(outputOf(r), /获得 0 个鸡腿.*当前 0 个鸡腿/);
  }
});

const terminalCases = [
  ['HTTP 401', { status: 401, body: success }, /登录已过期或未登录/],
  ['login JSON', { body: { success: false, message: '请先登录' } }, /登录已过期或未登录/],
  ['session expired JSON', { body: { success: false, message: 'Session expired' } }, /登录已过期或未登录/],
  ['invalid-session status JSON', { body: { success: false, status: 404 } }, /登录已过期或未登录/],
  ['HTTP 403', { status: 403, body: success }, /HTTP 403 访问被拒绝/],
  ['HTTP 429', { status: 429, body: success }, /HTTP 429 请求被限流/],
  ['JSON 403', { body: { success: true, status: 403 } }, /HTTP 403 访问被拒绝/],
  ['JSON 429', { body: { success: true, status: 429 } }, /HTTP 429 请求被限流/],
  ['JSON string 401', { body: { success: true, status: '401' } }, /登录已过期或未登录/],
  ['JSON string 403', { body: { success: true, status: '403' } }, /HTTP 403 访问被拒绝/],
  ['JSON string 429', { body: { success: true, status: '429' } }, /HTTP 429 请求被限流/],
  ['contradictory JSON server error', { body: { success: true, status: 500 } }, /HTTP 状态异常/],
  ['HTTP 500', { status: 500, body: success }, /HTTP 状态异常/],
  ['HTTP 503 duplicate', { status: 503, body: duplicate }, /HTTP 状态异常/],
  ['HTTP 404 is an endpoint error', { status: 404, body: success }, /HTTP 状态异常/],
  ['no response metadata', { noResponse: true, body: success }, /HTTP 状态异常/],
  ['malformed JSON', { rawBody: '{"success":' }, /非 JSON 或结构异常/],
  ['empty body', { rawBody: '' }, /非 JSON 或结构异常/],
  ['null JSON', { rawBody: 'null' }, /非 JSON 或结构异常/],
  ['array JSON', { rawBody: '[{"success":true}]' }, /非 JSON 或结构异常/],
  ['text JSON', { rawBody: '"private-response"' }, /非 JSON 或结构异常/],
  ['HTML', { rawBody: '<html>private-response</html>' }, /非 JSON 或结构异常/],
  ['wrong content type', { headers: { 'CONTENT-TYPE': 'text/html' }, body: success }, /非 JSON 或结构异常/],
  ['Cloudflare HTML', { status: 503, rawBody: '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/test"></script></html>' }, /需要网页安全验证/],
  ['Cloudflare header', { headers: { 'CF-Mitigated': 'challenge' }, body: success }, /需要网页安全验证/],
  ['Turnstile HTML', { rawBody: '<div class="cf-turnstile">private-response</div>' }, /需要网页安全验证/],
  ['browser check HTML', { rawBody: '<html>Checking your browser before accessing the site</html>' }, /需要网页安全验证/],
  ['captcha HTML', { rawBody: '<html>captcha required</html>' }, /需要网页安全验证/],
  ['captcha JSON', { body: { success: true, message: 'captcha required' } }, /需要网页安全验证/],
  ['automation rejection', { body: { success: true, message: 'Automated check-in detected' } }, /服务端拒绝自动化请求/],
  ['negative duplicate', { body: { success: false, message: '今天已完成签到，但登录已过期' } }, /登录已过期或未登录/],
  ['network timeout', { error: `request timed out; Cookie: ${fixture.cookie}; token=private-token` }, /网络请求失败或超时/],
  ['HTTP client throws', { throw: `private-error ${fixture.cookie}` }, /网络请求失败或超时/],
];

for (const [name, reply, expected] of terminalCases) {
  test(`${name} stops after one POST without updating success or exposing external text`, async () => {
    const initial = saved({ day: '2026-10-19', kind: 'duplicate' });
    const r = await run({ initial, reply: () => reply });
    assert.equal(r.calls.length, 1);
    assert.equal(r.writes.length, 0);
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.match(outputOf(r), expected);
    assert.match(r.logs, /成功0 服务端重复0 本地跳过0 失败1/);
    assert.doesNotMatch(outputOf(r), /offline-session|offline-clearance|private-/);
  });
}

test('all redirects stop without a second request or credentials being forwarded', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const location of ['/board', '/api/attendance?random=true', 'https://unrelated.example.test/collect', '//evil.example.test/']) {
      const r = await run({ initial: saved(), reply: () => ({ status, headers: { Location: location }, body: success }) });
      assert.equal(r.calls.length, 1);
      assert.equal(r.calls[0].url, 'https://www.nodeseek.com/api/attendance?random=false');
      assert.equal(r.writes.length, 0);
      assert.match(r.logs, /重定向，已停止且未跟随/);
      assert.doesNotMatch(outputOf(r), /evil|unrelated/);
    }
  }
});

test('capture rejects challenges and unconfirmed results with no request and preserves the old account', async () => {
  for (const [, reply] of terminalCases) {
    if (reply.error || reply.throw || reply.noResponse) continue;
    const initial = saved();
    const captured = { status: reply.status ?? 200, headers: reply.headers, body: reply.rawBody ?? JSON.stringify(reply.body) };
    const r = await run({ initial, request: capture(), response: captured });
    assert.equal(r.calls.length, 0);
    assert.equal(r.writes.length, 0);
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.match(r.logs, /会话未保存/);
  }
});

test('successful manual duplicate captures an authenticated session without calling the endpoint', async () => {
  const r = await run({ request: capture(), response: response(duplicate) });
  assert.equal(r.calls.length, 0);
  assert.deepEqual(JSON.parse(r.store.get(key)), { ...fixture, receipt: { day, kind: 'duplicate' } });
});

test('local storage failures on capture do not announce success or erase existing credentials', async () => {
  for (const failure of [{ writeOK: false }, { writeError: true }, { readError: true }]) {
    const initial = saved();
    const r = await run({ ...failure, initial, request: capture(), response: response() });
    assert.equal(r.calls.length, 0);
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.match(r.logs, /会话未保存/);
    assert.doesNotMatch(outputOf(r), /登录会话已更新|private-/);
  }
});

test('a storage read failure before cron submits no request', async () => {
  const r = await run({ initial: saved(), readError: true });
  assert.equal(r.calls.length, 0);
  assert.match(outputOf(r), /本地存储读取或写入失败/);
});

test('failed persistence after a confirmed result preserves the server outcome and warns about the cache', async () => {
  for (const body of [success, duplicate]) {
    for (const failure of [{ writeOK: false }, { writeError: true }]) {
      const initial = saved();
      const r = await run({ ...failure, initial, reply: () => ({ body }) });
      assert.equal(r.calls.length, 1);
      assert.deepEqual(Object.fromEntries(r.store), initial);
      assert.equal(r.notifications[0][1], body.success ? '签到成功' : '服务端：今日已签到');
      assert.match(r.notifications[0][2], /本地记录未保存或会话已变化；请勿连续运行，先在官网核实/);
      assert.doesNotMatch(r.notifications[0][2], /本次未计为新奖励/);
      assert.doesNotMatch(outputOf(r), /private-/);
    }
  }
});

test('a storage read failure after confirmation does not change the known server outcome', async () => {
  const initial = saved();
  const r = await run({ initial, readError: (_name, count) => count > 1 });
  assert.equal(r.calls.length, 1);
  assert.equal(r.writes.length, 0);
  assert.deepEqual(Object.fromEntries(r.store), initial);
  assert.equal(r.notifications[0][1], '签到成功');
  assert.match(outputOf(r), /本地记录未保存/);
  assert.doesNotMatch(outputOf(r), /private-/);
});

test('notification exceptions cannot turn confirmed capture or server results into failures', async () => {
  for (const entry of [
    { request: capture(), response: response(), expected: '登录会话已保存' },
    { initial: saved(), expected: '签到成功' },
    { initial: saved(), reply: () => ({ body: duplicate }), expected: '服务端：今日已签到' },
    { expected: '签到未完成' },
  ]) {
    const r = await run({ ...entry, notifyError: true });
    assert.equal(r.notifications.length, 1);
    assert.equal(r.notifications[0][1], entry.expected);
    assert.match(r.logs, /通知发送失败，请以执行日志为准/);
    assert.doesNotMatch(outputOf(r), /private-notification-error|offline-session|offline-clearance/);
    if (entry.request || entry.initial) assert.doesNotMatch(r.logs, /会话未保存|失败1/);
  }
});

test('a pending old-account request cannot overwrite a newly captured account', async () => {
  for (const session of [{ cookie: 'session=other-offline-user', userAgent: fixture.userAgent },
    { cookie: fixture.cookie, userAgent: 'offline-other-browser' }]) {
    const newer = saved({ day, kind: 'duplicate' }, session);
    const r = await run({ initial: saved(), onRequest: store => store.set(key, newer[key]) });
    assert.equal(r.calls.length, 1);
    assert.equal(r.writes.length, 0);
    assert.deepEqual(Object.fromEntries(r.store), newer);
    assert.equal(r.notifications[0][1], '签到成功');
    assert.match(outputOf(r), /本地记录未保存或会话已变化/);
  }
});

test('stored host and unused fields cannot redirect credentials and are removed from the next receipt', async () => {
  const initial = { [key]: JSON.stringify({ ...fixture, host: 'evil.example.test', url: 'http://evil.example.test/', password: 'private-unused' }) };
  const r = await run({ initial });
  assert.equal(r.calls[0].url, 'https://www.nodeseek.com/api/attendance?random=false');
  assert.deepEqual(JSON.parse(r.store.get(key)), { ...fixture, receipt: { day, kind: 'success' } });
  assert.doesNotMatch(outputOf(r), /evil|private-/);
});
