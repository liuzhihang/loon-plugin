const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = readFileSync(join(__dirname, '../scripts/v2ex/v2ex.js'), 'utf8');
const available = '<button onclick="location.href=\'/mission/daily/redeem?once=12345\'">领取 X 铜币</button>已连续登录 12 天';
const claimed = '每日登录奖励已领取 已连续登录 13 天';
const balance = '<div class="balance_area bigger">25 <img alt="S"> 18 <img alt="B"></div>';
const session = { host: 'edge.v2ex.com', cookie: 'fixture-cookie', userAgent: 'fixture-iPhone-Safari' };
const initial = () => ({ V2EX_Session: JSON.stringify(session) });

async function run({ values = {}, request, response, reply, writeOK = true, qx = false } = {}) {
  const store = new Map(Object.entries(values)), calls = [], logs = [];
  let finish, done = 0;
  const completed = new Promise(resolve => { finish = resolve; });
  const send = (options, callback) => {
    calls.push(options);
    const res = reply ? reply(options, calls) : { body: claimed };
    queueMicrotask(() => callback(res.error || null, { status: res.status || 200, headers: res.headers || {} }, res.body || ''));
  };
  const write = (value, key) => { if (!writeOK) return false; store.set(key, value); return true; };
  const sandbox = {
    console: { log: value => logs.push(String(value)) },
    $persistentStore: { read: key => store.get(key), write },
    $notification: { post() {} }, $httpClient: { get: send, post: send },
    $done() { done++; finish(); }, setTimeout: callback => queueMicrotask(callback),
  };
  if (qx) {
    sandbox.$task = { fetch: options => new Promise((resolve, reject) => send(options, (error, response, body) => error ? reject(error) : resolve({ statusCode: response.status, headers: response.headers, body }))) };
    sandbox.$prefs = { valueForKey: key => store.get(key), setValueForKey: write };
    sandbox.$notify = () => {};
  } else sandbox.$loon = 'iPhone test 3.5.1(998)';
  if (request) sandbox.$request = request;
  if (response) sandbox.$response = response;
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const timer = setTimeout(() => finish('timeout'), 1000);
  const result = await completed;
  clearTimeout(timer);
  assert.notEqual(result, 'timeout');
  assert.equal(done, 1);
  return { store, calls, logs: logs.join('\n') };
}

const capture = (host = session.host) => ({ url: `https://${host}/mission/daily`, headers: { cOoKiE: session.cookie, 'User-agent': session.userAgent } });

test('Edge response saves same-origin session and captured UA without logging credentials', async () => {
  const r = await run({ request: capture(), response: { status: 200, body: available } });
  assert.deepEqual(JSON.parse(r.store.get('V2EX_Session')), session);
  assert.equal(r.calls.length, 0);
  assert.match(r.logs, /登录会话已更新/);
  assert.doesNotMatch(r.logs, /fixture-cookie/);
});

test('invalid page, failed HTTP response and unapproved host preserve existing session', async () => {
  for (const entry of [
    { request: capture(), response: { status: 200, body: '需要先登录' } },
    { request: capture(), response: { status: 403, body: available } },
    { request: capture('edge.v2ex.com.example.test'), response: { status: 200, body: available } },
  ]) {
    const values = initial();
    const r = await run({ values, ...entry });
    assert.deepEqual(Object.fromEntries(r.store), values);
    assert.doesNotMatch(r.logs, /✅/);
  }
});

test('storage failure is not reported as a captured session', async () => {
  const r = await run({ request: capture(), response: { status: 200, body: available }, writeOK: false });
  assert.equal(r.store.size, 0);
  assert.match(r.logs, /会话未保存/);
});

test('cron uses Edge and captured UA for reward and verifies server state after claiming', async () => {
  let redeemed = false;
  const r = await run({ values: initial(), reply: options => {
    const path = new URL(options.url).pathname;
    if (path === '/mission/daily/redeem') { redeemed = true; return { status: 302, headers: { location: '/mission/daily' } }; }
    return { body: path === '/balance' ? balance : redeemed ? claimed : available };
  } });
  assert.match(r.logs, /签到成功/);
  assert.match(r.logs, /连续 13 天/);
  assert.match(r.logs, /25 银币, 18 铜币/);
  assert.equal(r.calls.filter(call => call.url.includes('/redeem?once=12345')).length, 1);
  for (const call of r.calls) {
    assert.equal(new URL(call.url).origin, 'https://edge.v2ex.com');
    assert.equal(call.headers['User-Agent'], session.userAgent);
    assert.equal(call.headers.Referer, 'https://edge.v2ex.com/mission/daily');
    assert.equal(call['auto-redirect'], false);
    assert.equal(call['auto-cookie'], false);
    assert.equal(call.insecure, false);
  }
});

test('legacy cookie still uses www and an already-claimed page never redeems', async () => {
  const r = await run({ values: { V2EX_Cookie: 'legacy-fixture' } });
  assert.match(r.logs, /今日已签到/);
  assert.ok(r.calls.every(call => new URL(call.url).hostname === 'www.v2ex.com'));
  assert.equal(r.calls.filter(call => call.url.includes('/redeem')).length, 0);
});

test('an unrelated once token does not trigger a reward request', async () => {
  const r = await run({ values: initial(), reply: () => ({ body: '<a href="/signout?once=999">退出</a>' }) });
  assert.match(r.logs, /未找到 once 码/);
  assert.equal(r.calls.filter(call => call.url.includes('/redeem')).length, 0);
});

test('unsuccessful redeem response cannot be reported as success', async () => {
  const r = await run({ values: initial(), reply: options => ({ body: options.url.includes('/redeem') ? '领取失败' : available }) });
  assert.doesNotMatch(r.logs, /✅|Success    : 1/);
  assert.match(r.logs, /领取后尚未确认奖励/);
});

test('cross-origin redirects never receive stored credentials', async () => {
  const r = await run({ values: initial(), reply: () => ({ status: 302, headers: { Location: 'https://www.v2ex.com/mission/daily' } }) });
  assert.match(r.logs, /重定向异常/);
  assert.ok(r.calls.every(call => new URL(call.url).hostname === 'edge.v2ex.com'));
});

test('QX request-only capture verifies the same domain before storage', async () => {
  const r = await run({ request: capture(), qx: true, reply: () => ({ body: available }) });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, 'https://edge.v2ex.com/mission/daily');
  assert.deepEqual(JSON.parse(r.store.get('V2EX_Session')), session);
});
