// SPDX-License-Identifier: MIT
// Copyright (c) 2026 liuzhihang
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../scripts/f1sh/f1sh.js'), 'utf8');
const plugin = readFileSync(join(__dirname, '../plugins/f1sh.lpx'), 'utf8');
const key = 'F1sh_Session';
const checkinName = '网鱼执行签到_会发请求';
const fixture = { cookie: 'session=offline-private-cookie; pd_csrf=old-offline-csrf', userAgent: 'offline-private-iPhone-UA' };
const csrf = 'a'.repeat(64);
const otherCsrf = 'b'.repeat(64);
const supportedMoods = ['happy', 'nice', 'love', 'working', 'sleepy', 'popcorn', 'cry', 'angry', 'hello'];
const session = (value = fixture) => ({ [key]: JSON.stringify(value) });

function signedHTML() {
  return '<!doctype html><html><body><header class="pd-ck-head"><div class="pd-ck-head-action"><span class="pd-ck-done">今日已完成</span></div></header>' +
    '<div class="pd-ck-stats">当前连续 1</div></body></html>';
}

function pendingHTML(token = csrf) {
  return '<!doctype html><html><body><header class="pd-ck-head"><div class="pd-ck-head-action"></div>' +
    '<form class="pd-ck-mood-form" method="post" action="/checkin"><input type="hidden" name="csrf_token" value="' + token + '">' +
    supportedMoods.map(mood => '<input type="radio" name="mood" value="' + mood + '">').join('') +
    '</form></header><div class="pd-ck-stats">当前连续 0</div></body></html>';
}

// Synthetic structure mirrors the live check-in DOM: attribute order, selected
// header class, nested mood controls and populated account statistics. All values
// here are fixtures; no browser credentials or response tokens are used.
function liveShapeHTML(token = csrf) {
  const labels = [
    ['nice', '好耶'], ['happy', '哈哈哈'], ['love', '比心'], ['working', '摸鱼'], ['sleepy', '困了'],
    ['popcorn', '吃瓜'], ['cry', '呜呜'], ['angry', '气鼓鼓'], ['hello', '冒个泡'],
  ].map(([value, name]) => `<label class="pd-mood"><input type="radio" value="${value}" name="mood"><img alt=""><span>${name}</span></label>`).join('');
  return '<!doctype html><html><body>' +
    '<header class="pd-ck-head has-mood"><div class="pd-ck-head-text"><h1>每日签到</h1></div>' +
    '<form class="pd-ck-mood-form" method="post" action="/checkin">' +
    `<input type="hidden" name="csrf_token" value="${token}">` +
    '<fieldset class="pd-mood-pick"><legend>选个心情再签到</legend><div class="pd-mood-grid">' + labels + '</div></fieldset>' +
    '<button type="submit">立即签到</button></form></header>' +
    '<div class="pd-ck-stats" aria-label="我的签到数据">' +
    '<div><b>0</b><span>当前连续</span></div><div><b>0</b><span>最长连续</span></div>' +
    '<div><b>0</b><span>累计天数</span></div><div><b>0</b><span>我的经验</span></div></div>' +
    '</body></html>';
}

const page = (html = pendingHTML(), extras = {}) => ({
  status: 200,
  ...extras,
  headers: { 'Content-Type': 'text/html; charset=utf-8', Date: 'Sun, 25 Oct 2026 01:00:00 GMT', ...(extras.headers || {}) },
  body: extras.body ?? html,
});
const pendingPage = page(pendingHTML(), { headers: { 'Set-Cookie': `pd_csrf=${csrf}; Path=/; Secure; HttpOnly; SameSite=Lax` } });
const postSuccess = { status: 303, headers: { Location: '/checkin?notice=ok', Date: 'Sun, 25 Oct 2026 01:00:00 GMT' }, body: '' };
const signedPage = page(signedHTML());
const defaultGetReplies = [pendingPage, signedPage];

// The VM exposes only synthetic Loon APIs. It has no real credentials, network,
// browser or filesystem handles.
async function runRaw({ initial = {}, argument, script, request, response: responseContext,
  getReplies = defaultGetReplies, postReply = postSuccess, now = '2026-10-25T01:00:00Z',
  writeOK = true, readError = false, writeError = false, notifyError = false,
  mutateSessionOnGet, throwNetwork = false } = {}) {
  const store = new Map(Object.entries(initial));
  const gets = [], posts = [], traffic = [], reads = [], writes = [], notifications = [], logs = [], doneValues = [];
  const nowMillis = () => new Date(typeof now === 'function' ? now() : now).getTime();
  let finish, done = 0;
  const completed = new Promise(resolve => { finish = resolve; });
  function deliver(result, options, callback) {
    if (throwNetwork || result.throw) throw new Error('private-network-error ' + fixture.cookie + ' ' + csrf);
    const response = result.noResponse ? undefined : {
      ...(Object.hasOwn(result, 'statusCode') ? { statusCode: result.statusCode } : { status: result.status ?? 200 }),
      headers: result.headers || { Date: new Date(nowMillis()).toUTCString() },
    };
    queueMicrotask(() => callback(result.error || null, response, result.body ?? ''));
  }
  const sandbox = {
    $loon: 'offline Loon 3.5.1(983)',
    Date: class extends Date { static now() { return nowMillis(); } },
    console: { log: value => logs.push(String(value)) },
    $persistentStore: {
      read(name) { reads.push(name); if (readError) throw new Error('private-read-error ' + fixture.cookie); return store.get(name); },
      write(value, name) {
        writes.push({ value, key: name });
        if (writeError) throw new Error('private-write-error ' + fixture.cookie);
        if (writeOK) store.set(name, value);
        return writeOK;
      },
    },
    $notification: { post: (...args) => { notifications.push(args); if (notifyError) throw new Error('private-notification-error ' + csrf); } },
    $httpClient: {
      get(options, callback) {
        gets.push(options); traffic.push(options.method || 'GET');
        if (mutateSessionOnGet) mutateSessionOnGet(store, gets.length);
        const result = typeof getReplies === 'function' ? getReplies(options, gets.length, store) : getReplies[gets.length - 1];
        deliver(result || { status: 200, headers: {}, body: '' }, options, callback);
      },
      post(options, callback) {
        posts.push(options); traffic.push(options.method || 'POST');
        const result = typeof postReply === 'function' ? postReply(options, posts.length) : postReply;
        deliver(result, options, callback);
      },
    },
    $done(value) { done++; doneValues.push(value); finish(); },
  };
  if (argument !== undefined) sandbox.$argument = argument;
  if (script !== undefined) sandbox.$script = script;
  if (request !== undefined) sandbox.$request = request;
  if (responseContext !== undefined) sandbox.$response = responseContext;
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const timer = setTimeout(() => finish('timeout'), 1000);
  const result = await completed;
  clearTimeout(timer);
  assert.notEqual(result, 'timeout', 'script must finish');
  assert.equal(done, 1, '$done must be called exactly once');
  assert.deepEqual(JSON.parse(JSON.stringify(doneValues)), [{}], 'background task must finish without rewriting a captured response');
  return { store, gets, posts, traffic, reads, writes, notifications, logs: logs.join('\n') };
}

function runCapture({ initial = {}, cookie = fixture.cookie, userAgent = fixture.userAgent,
  url = 'https://f1sh.com/checkin', method = 'GET', reply = page(), ...rest } = {}) {
  return runRaw({ initial, argument: 'capture', script: { name: '网鱼会话捕获_自动触发' },
    request: { url, method, headers: { Cookie: cookie, 'User-Agent': userAgent } }, response: reply, ...rest });
}

function runCheckin(settings = {}) {
  const { argument = { autoCheckin: true, mood: 'nice' }, ...rest } = settings;
  return runRaw({ initial: session(), argument, script: { name: checkinName }, ...rest });
}

const cleanOutput = result => result.logs + JSON.stringify(result.notifications);
function assertNotConfirmed(result) {
  assert.notEqual(result.notifications[0]?.[1], '签到成功', 'notification must not claim success');
  assert.doesNotMatch(result.logs, /^Status : (?:签到成功|签到已确认)$/m, 'status must not claim success');
}

test('plugin uses current Loon syntax, exposes a narrow GET capture and disabled-by-default check-in', () => {
  assert.match(plugin, /^\#!name=网鱼/);
  assert.match(plugin, /\#!loon_version=3\.5\.1\(983\)/);
  assert.match(plugin, /capture = switch,true,type=boolean/);
  assert.match(plugin, /autoCheckin = switch,false,type=boolean/);
  assert.match(plugin, /mood = input,"nice",type=string/);
  const rule = plugin.split(/\r?\n/).find(line => line.startsWith('response if ') && line.includes('"GET"'));
  assert.ok(rule, 'capture must use a response rule');
  assert.ok(rule.includes('request.method} == "GET"'));
  assert.ok(rule.includes('response.status} == 200'));
  assert.ok(rule.includes('requires_body=true'));
  assert.match(plugin, /cron .*\{\$\{autoCheckin\}, \$\{mood\}\}.*tag="网鱼执行签到_会发请求".*enable=\$\{autoCheckin\}/);
  assert.match(plugin, /hostname = f1sh\.com\s*$/);
  assert.doesNotMatch(plugin, /legacy|http-request|http-response/i);
  const literal = rule.match(/\$\{url\} ~= (\/.+\/) && \$\{request\.method\}/)?.[1];
  assert.ok(literal, 'capture rule must have an explicit URL matcher');
  const matcher = new RegExp(literal.slice(1, -1));
  assert.equal(matcher.test('https://f1sh.com/checkin'), true);
  assert.equal(matcher.test('https://f1sh.com/checkin?month=2026-10'), true);
  for (const url of ['http://f1sh.com/checkin', 'https://www.f1sh.com/checkin', 'https://f1sh.com/checkin/',
    'https://f1sh.com/checkin/other', 'https://other.example/checkin']) assert.equal(matcher.test(url), false, url);
});

test('capture saves an authenticated pending or already-signed-in session without making a request', async () => {
  for (const html of [pendingHTML(), signedHTML()]) {
    const result = await runCapture({ reply: page(html) });
    assert.equal(result.gets.length + result.posts.length, 0);
    assert.deepEqual(JSON.parse(result.store.get(key)), fixture);
    assert.equal(result.writes.length, 1);
    assert.equal(result.notifications.length, 1);
    assert.doesNotMatch(cleanOutput(result), /offline-private-cookie|offline-private-iPhone-UA|offline-private-csrf/);
  }
});

test('live-shaped nested check-in HTML captures the synthetic session without network traffic', async () => {
  const html = liveShapeHTML();
  assert.match(html, /<header class="pd-ck-head has-mood">/);
  assert.match(html, /<input type="radio" value="nice" name="mood">/);
  assert.match(html, /<fieldset[\s\S]*<label[\s\S]*<input type="radio" value="nice" name="mood">/);
  assert.match(html, /<div class="pd-ck-stats" aria-label="我的签到数据">[\s\S]*<b>0<\/b><span>当前连续<\/span>/);
  const result = await runCapture({ reply: page(html) });
  assert.deepEqual(JSON.parse(result.store.get(key)), fixture);
  assert.equal(result.writes.length, 1);
  assert.equal(result.gets.length + result.posts.length, 0);
  assert.equal(result.notifications.length, 1);
  assert.doesNotMatch(cleanOutput(result), /offline-private-cookie|offline-private-iPhone-UA|offline-private-csrf/);
});

test('live-shaped nested check-in HTML still runs only GET, POST, GET and confirms from the resulting page', async () => {
  const result = await runCheckin({ getReplies: [
    page(liveShapeHTML(), { headers: { 'Set-Cookie': `pd_csrf=${csrf}; Path=/` } }),
    page(signedHTML()),
  ] });
  assert.deepEqual(result.traffic, ['GET', 'POST', 'GET']);
  assert.equal(result.posts.length, 1);
  assert.match(result.posts[0].body, new RegExp(`csrf_token=${csrf}`));
  assert.match(result.posts[0].body, /(?:^|&)mood=nice(?:&|$)/);
  assert.match(result.notifications[0][1], /确认|成功/);
});

test('missing or redacted CSRF values copied from a browser DOM are never treated as real response tokens', async () => {
  const sanitized = [liveShapeHTML().replace(` value="${csrf}"`, ''), liveShapeHTML('redacted-token')];
  for (const html of sanitized) {
    const captured = await runCapture({ reply: page(html) });
    assert.equal(captured.writes.length, 0);
    assert.equal(captured.store.has(key), false);
    assert.equal(captured.gets.length + captured.posts.length, 0);
    assertNotConfirmed(captured);

    const attempted = await runCheckin({ getReplies: [page(html)] });
    assert.equal(attempted.posts.length, 0);
    assert.equal(attempted.gets.length, 1);
    assertNotConfirmed(attempted);
    assert.doesNotMatch(cleanOutput(attempted), /redacted-token/);
  }
});

test('capture silently skips the same Cookie and User-Agent and does not save anonymous or malformed pages', async () => {
  const same = await runCapture({ initial: session() });
  assert.equal(same.writes.length, 0);
  assert.equal(same.notifications.length, 0);
  const changedUA = await runCapture({ initial: session(), userAgent: 'different-offline-UA' });
  assert.equal(changedUA.writes.length, 1);
  assert.equal(JSON.parse(changedUA.store.get(key)).userAgent, 'different-offline-UA');

  const anonymous = '<!doctype html><html><header class="pd-ck-head"><a href="/login">登录后签到</a></header><section class="pd-ck-card pd-ck-login">去登录</section></html>';
  for (const reply of [page(anonymous), page('<html><body>unexpected page</body></html>'),
    { status: 302, headers: { Location: '/login' }, body: '' },
    page(pendingHTML().replace('name="csrf_token" value="' + csrf + '"', 'name="csrf_token" value="bad"'))]) {
    const result = await runCapture({ reply });
    assert.equal(result.writes.length, 0);
    assert.equal(result.store.has(key), false);
    assert.doesNotMatch(cleanOutput(result), /签到成功|offline-private-cookie|private-network-error/);
  }
});

test('capture and check-in entry guards reject unrelated pages, old names, missing arguments and web contexts', async () => {
  for (const context of [
    { argument: 'capture', script: { name: '网鱼会话捕获_自动触发' } },
    { argument: 'capture', script: { name: '旧插件签到' }, request: { url: 'https://f1sh.com/checkin', method: 'GET' }, response: page() },
    { argument: undefined, script: { name: checkinName } },
    { argument: { autoCheckin: true, mood: 'nice' }, script: { name: checkinName }, request: { url: 'https://f1sh.com/checkin', method: 'GET' }, response: page() },
  ]) {
    const result = await runRaw({ initial: session(), ...context });
    assert.equal(result.gets.length + result.posts.length + result.writes.length, 0);
  }
  for (const url of ['https://f1sh.com/checkin/', 'https://www.f1sh.com/checkin', 'http://f1sh.com/checkin', 'https://f1sh.com/checkin/other']) {
    const result = await runCapture({ url });
    assert.equal(result.writes.length, 0, url);
    assert.equal(result.gets.length + result.posts.length, 0, url);
  }
});

test('disabled, malformed or unsupported mood arguments stop before reading credentials or making network calls', async () => {
  for (const argument of [
    { autoCheckin: false, mood: 'nice' }, {}, null, 'true',
    { autoCheckin: 'true', mood: 'nice' }, { autoCheckin: true, mood: 1 },
    { autoCheckin: true, mood: 'invalid' }, { autoCheckin: true, mood: '哈哈哈' },
  ]) {
    const result = await runRaw({ initial: session(), argument, script: { name: checkinName } });
    assert.equal(result.reads.length + result.gets.length + result.posts.length, 0, JSON.stringify(argument));
    assert.equal(result.writes.length, 0);
    assert.deepEqual(Object.fromEntries(result.store), session());
  }
});

test('already signed-in state is recognized by the page and never sends a POST', async () => {
  const result = await runCheckin({ getReplies: [page(signedHTML())] });
  assert.equal(result.gets.length, 1);
  assert.equal(result.posts.length, 0);
  assert.match(cleanOutput(result), /已签到|今日已签到/);
  assert.deepEqual(Object.fromEntries(result.store), session());
});

test('pending state submits one form with fresh CSRF, selected mood and the same first-party session, then confirms by GET', async () => {
  const result = await runCheckin();
  assert.equal(result.gets.length, 2);
  assert.equal(result.posts.length, 1, 'never retry the state-changing request');
  assert.equal(result.posts[0].url, 'https://f1sh.com/checkin');
  assert.equal(result.posts[0].method, 'POST');
  assert.match(result.posts[0].headers.Cookie, /session=offline-private-cookie/);
  assert.match(result.posts[0].headers.Cookie, new RegExp('pd_csrf=' + csrf));
  assert.doesNotMatch(result.posts[0].headers.Cookie, new RegExp(fixture.cookie.split(';')[1].trim().split('=')[1]));
  assert.equal(result.posts[0].headers['User-Agent'], fixture.userAgent);
  assert.equal(result.posts[0].headers.Origin, 'https://f1sh.com');
  assert.equal(result.posts[0].headers.Referer, 'https://f1sh.com/checkin');
  assert.match(result.posts[0].headers['Content-Type'], /application\/x-www-form-urlencoded/i);
  assert.match(result.posts[0].body, new RegExp('csrf_token=' + csrf));
  assert.match(result.posts[0].body, /(?:^|&)mood=nice(?:&|$)/);
  for (const options of [...result.gets, ...result.posts]) {
    assert.equal(options.timeout, 10000);
    assert.equal(options['auto-cookie'], false);
    assert.equal(options['auto-redirect'], false);
    assert.equal(options.insecure, false);
  }
  assert.equal(result.traffic.join(','), 'GET,POST,GET');
  assert.deepEqual(JSON.parse(result.store.get(key)), fixture, 'ephemeral CSRF rotation must not overwrite the saved session');
  assert.match(cleanOutput(result), /签到成功|已完成|签到已确认/);
  assert.doesNotMatch(cleanOutput(result), /offline-private-cookie|offline-private-iPhone-UA|offline-private-csrf|private-network-error/);
});

test('every supported mood maps to one form value and there is no untrusted input in the request URL', async () => {
  for (const mood of supportedMoods) {
    const result = await runCheckin({ argument: { autoCheckin: true, mood } });
    assert.equal(result.posts.length, 1, mood);
    assert.match(result.posts[0].body, new RegExp('(?:^|&)mood=' + mood + '(?:&|$)'), mood);
    assert.equal(result.posts[0].url, 'https://f1sh.com/checkin');
  }
});

test('a matching saved double-submit CSRF cookie works without Set-Cookie', async () => {
  const withCsrf = { cookie: `session=offline-private-cookie; pd_csrf=${csrf}`, userAgent: fixture.userAgent };
  const result = await runCheckin({ initial: session(withCsrf), getReplies: [page(pendingHTML(csrf)), signedPage] });
  assert.equal(result.posts.length, 1);
  assert.match(result.posts[0].headers.Cookie, new RegExp(`(?:^|;\\s*)pd_csrf=${csrf}(?:;|$)`));
  assert.match(result.posts[0].body, new RegExp(`csrf_token=${csrf}`));
  assert.match(result.notifications[0][1], /确认|成功/);
});

test('Set-Cookie arrays and combined cookies with Expires commas preserve the CSRF value', async () => {
  const headers = [
    { 'Set-Cookie': [`hint=rotated; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/`, `pd_csrf=${csrf}; Path=/; Secure; HttpOnly`] },
    { 'Set-Cookie': `hint=rotated; Expires=Wed, 21 Oct 2026 07:28:00 GMT, pd_csrf=${csrf}; Path=/; Secure` },
  ];
  for (const responseHeaders of headers) {
    const result = await runCheckin({ getReplies: [page(pendingHTML(csrf), { headers: responseHeaders }), signedPage] });
    assert.equal(result.posts.length, 1);
    assert.match(result.posts[0].headers.Cookie, new RegExp(`(?:^|;\\s*)pd_csrf=${csrf}(?:;|$)`));
    assert.match(result.posts[0].body, new RegExp(`csrf_token=${csrf}`));
    assert.match(result.notifications[0][1], /确认|成功/);
  }
});

test('HTTP 200 is not success by itself; final signed state is required', async () => {
  const result = await runCheckin({ postReply: { status: 200, headers: { Date: 'Sun, 25 Oct 2026 01:00:00 GMT' }, body: 'internal error' },
    getReplies: [pendingPage, page(pendingHTML())] });
  assert.equal(result.posts.length, 1);
  assertNotConfirmed(result);
});

test('POST redirect is never followed automatically; only same-origin check-in redirect may be verified', async () => {
  for (const location of ['https://evil.example/checkin', 'https://f1sh.com/login', '/login', '//evil.example/checkin', '/checkin/%2e%2e/login']) {
    const result = await runCheckin({ postReply: { status: 303, headers: { Location: location }, body: '' } });
    assert.equal(result.posts.length, 1, location);
    assert.equal(result.gets.length, 1, 'do not fetch an untrusted redirect target');
    assertNotConfirmed(result);
  }
  const valid = await runCheckin({ postReply: { status: 302, headers: { Location: 'https://f1sh.com/checkin?notice=ok', Date: 'Sun, 25 Oct 2026 01:00:00 GMT' }, body: '' } });
  assert.equal(valid.posts.length, 1);
  assert.equal(valid.gets.length, 2);
  assert.match(cleanOutput(valid), /签到成功|已完成|签到已确认/);
});

test('post success-like status without signed confirmation stays unconfirmed and is never retried', async () => {
  for (const status of [200, 302, 303]) {
    const result = await runCheckin({ postReply: { status, headers: { ...(status === 200 ? {} : { Location: '/checkin' }), Date: 'Sun, 25 Oct 2026 01:00:00 GMT' }, body: '' },
      getReplies: [pendingPage, page(pendingHTML())] });
    assert.equal(result.posts.length, 1, String(status));
    assertNotConfirmed(result);
  }
});

test('a POST timeout never retries and never sends the final verification GET', async () => {
  const result = await runCheckin({ postReply: { error: 'timeout' } });
  assert.equal(result.posts.length, 1);
  assert.equal(result.gets.length, 1);
  assert.deepEqual(result.traffic, ['GET', 'POST']);
  assertNotConfirmed(result);
});

test('challenge, authentication, authorization, rate-limit and server errors stop before the POST', async () => {
  const replies = [
    page('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>'),
    { status: 401, headers: {}, body: 'private session' },
    { status: 403, headers: {}, body: 'forbidden' },
    { status: 429, headers: {}, body: 'rate limited' },
    { status: 500, headers: {}, body: 'private server detail' },
    { statusCode: 502, headers: {}, body: 'private upstream detail' },
    { status: 200, headers: { 'Content-Type': 'text/html' }, body: '<html>sign in to continue</html>' },
  ];
  for (const reply of replies) {
    const result = await runCheckin({ getReplies: [reply] });
    assert.equal(result.posts.length, 0, String(reply.status));
    assert.doesNotMatch(cleanOutput(result), /签到成功|private session|private server detail|offline-private-cookie/);
  }
});

test('missing, malformed or contradictory CSRF data is rejected without attempting the form submission', async () => {
  for (const [getReply, postOverride] of [
    [page(pendingHTML().replace(' value="' + csrf + '"', ' value=""')), null],
    [page(pendingHTML().replace(' value="' + csrf + '"', ' value="bad"')), null],
    [page(pendingHTML(otherCsrf), { headers: { 'Set-Cookie': `pd_csrf=${csrf}; Path=/` } }), null],
    [page(pendingHTML(csrf), { headers: { 'Set-Cookie': `pd_csrf=${otherCsrf}; Path=/` } }), null],
  ]) {
    const result = await runCheckin({ getReplies: [getReply] });
    assert.equal(result.posts.length, 0);
    assertNotConfirmed(result);
  }
  const noCsrfCookie = await runCheckin({ getReplies: [page(pendingHTML(csrf))] });
  assert.equal(noCsrfCookie.posts.length, 0, 'without a pd_csrf Cookie or Set-Cookie, the double-submit check cannot be formed safely');
  assert.doesNotMatch(cleanOutput(noCsrfCookie), /签到成功/);
});

test('network errors, storage changes and date boundaries prevent an unverified success', async () => {
  const network = await runCheckin({ getReplies: [{ error: 'network' }] });
  assert.equal(network.posts.length, 0);
  assert.doesNotMatch(cleanOutput(network), /private-network-error|offline-private-cookie|offline-private-csrf/);

  const staleDay = await runCheckin({ getReplies: [page(pendingHTML(), { headers: { Date: 'Sat, 24 Oct 2026 01:00:00 GMT' } })] });
  assert.equal(staleDay.posts.length, 0);
  const missingDate = await runCheckin({ getReplies: [page(pendingHTML(), { headers: { Date: '' } })] });
  assert.equal(missingDate.posts.length, 0);
  const staleResponse = await runCheckin({ getReplies: [page(pendingHTML(), {
    headers: { Date: 'Sun, 25 Oct 2026 00:50:00 GMT', 'Set-Cookie': `pd_csrf=${csrf}; Path=/` },
  })] });
  assert.equal(staleResponse.posts.length, 0, 'a stale but same-day HTTP response must not trigger a write');
  let clockReads = 0;
  const acrossDay = await runCheckin({ now: () => clockReads++ === 0 ? '2026-10-25T15:59:59Z' : '2026-10-25T16:00:01Z', getReplies: [
    page(pendingHTML(), { headers: { Date: 'Sun, 25 Oct 2026 15:59:59 GMT', 'Set-Cookie': `pd_csrf=${csrf}; Path=/` } }),
    signedPage,
  ] });
  assert.equal(acrossDay.posts.length, 0, acrossDay.logs);
  assert.equal(acrossDay.gets.length, 1);
  assert.match(cleanOutput(acrossDay), /跨北京时间日界/);
  assertNotConfirmed(acrossDay);

  const changed = await runCheckin({ mutateSessionOnGet(store, count) {
    if (count === 1) store.set(key, JSON.stringify({ cookie: 'changed-private-session', userAgent: fixture.userAgent }));
  } });
  assert.equal(changed.posts.length, 0);
  assert.doesNotMatch(cleanOutput(changed), /changed-private-session/);
});

test('errors and notification failures do not leak Cookie, CSRF, User-Agent or response detail', async () => {
  for (const result of [
    await runCheckin({ notifyError: true }),
    await runCheckin({ readError: true }),
    await runCheckin({ getReplies: [{ status: 403, headers: {}, body: 'secret-response-body' }] }),
    await runCapture({ reply: page(), notifyError: true }),
  ]) {
    assert.doesNotMatch(cleanOutput(result), /offline-private-cookie|offline-private-iPhone-UA|private-private-csrf|private-notification-error|private-read-error|secret-response-body|private-network-error/);
  }
});
