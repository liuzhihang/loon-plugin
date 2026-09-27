const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = readFileSync(process.env.GLADOS_TEST_SOURCE || join(__dirname, '../scripts/glados/glados.js'), 'utf8');
const domain = 'glados.one';
const key = `GLaDOS_Cookies:${domain}`;
const metaKey = `GLaDOS_AccountMeta:${domain}`;
const ua = 'Mozilla/5.0 (iPhone; test fixture) Safari/604.1';
const status = (email = 'alice@example.test') => ({ code: 0, data: { email, leftDays: 506.5 } });
const capture = (cookie) => ({ url: `https://${domain}/api/user/status`, headers: { Cookie: cookie, 'User-Agent': ua } });
const saved = (cookies) => ({ GLaDOS_Domains: JSON.stringify([domain]), [key]: JSON.stringify(cookies) });

async function run({ initial = {}, request, response, reply, writeOK = true, qx = false } = {}) {
  const store = new Map(Object.entries(initial));
  const logs = [], calls = [];
  let finish, done = 0;
  const finished = new Promise(resolve => { finish = resolve; });
  const send = (options, callback) => {
    calls.push(options);
    const result = reply ? reply(options) : { body: status() };
    queueMicrotask(() => callback(result.error || null, { status: result.status || 200, headers: {} }, JSON.stringify(result.body || {})));
  };
  const write = (value, key) => { if (!writeOK) return false; store.set(key, value); return true; };
  const sandbox = {
    console: { log: line => logs.push(String(line)) },
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
  if (response) sandbox.$response = { status: 200, body: JSON.stringify(response) };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const timer = setTimeout(() => finish('timeout'), 1000);
  const result = await finished;
  clearTimeout(timer);
  assert.notEqual(result, 'timeout', 'script must finish');
  assert.equal(done, 1);
  return { store, calls, logs: logs.join('\n') };
}

test('same-account refresh replaces duplicate old sessions and retains other accounts', async () => {
  const result = await run({ initial: saved(['old-alice', 'bob', 'older-alice']), request: capture('fresh'), response: status('ALICE@example.test'),
    reply: options => ({ body: status(options.headers.Cookie === 'bob' ? 'bob@example.test' : 'alice@example.test') }) });
  assert.deepEqual(JSON.parse(result.store.get(key)), ['bob', 'fresh']);
  assert.equal(JSON.parse(result.store.get(metaKey))[1].userAgent, ua);
  assert.match(result.logs, /账号 Cookie 已更新/);
  assert.doesNotMatch(result.logs, /old-alice|fresh|older-alice/);
});

test('same-cookie capture is idempotent without extra identity requests', async () => {
  const result = await run({ initial: saved(['same']), request: capture('same'), response: status() });
  assert.deepEqual(JSON.parse(result.store.get(key)), ['same']);
  assert.equal(result.calls.length, 0);
});

test('cached account identity permits replacement of an expired session', async () => {
  const result = await run({ initial: { ...saved(['expired']), [metaKey]: JSON.stringify([{ cookie: 'expired', email: 'alice@example.test' }]) }, request: capture('fresh'), response: status() });
  assert.deepEqual(JSON.parse(result.store.get(key)), ['fresh']);
  assert.equal(result.calls.length, 0);
});

test('unidentified legacy accounts are retained on lookup failure', async () => {
  const result = await run({ initial: saved(['unknown']), request: capture('new'), response: status(), reply: () => ({ status: 401, body: { code: -1 } }) });
  assert.deepEqual(JSON.parse(result.store.get(key)), ['unknown', 'new']);
});

test('unsuccessful status capture cannot overwrite saved credentials', async () => {
  const initial = saved(['existing']);
  const result = await run({ initial, request: capture('invalid'), response: { code: -1, message: 'not logged in' } });
  assert.deepEqual(Object.fromEntries(result.store), initial);
  assert.equal(result.calls.length, 0);
});

test('QX request-only capture validates identity before saving', async () => {
  const result = await run({ request: capture('qx-cookie'), qx: true });
  assert.deepEqual(JSON.parse(result.store.get(key)), ['qx-cookie']);
  assert.equal(result.calls[0].headers['User-Agent'], ua);
});

test('sign-in rejection with code 1 is failure and never redeems points', async () => {
  const result = await run({ initial: saved(['cookie']), reply: options => ({ body: options.url.endsWith('/checkin')
    ? { code: 1, message: 'Automated check-in detected. Please sign in again to continue.' }
    : options.url.endsWith('/points') ? { points: 600 } : status() }) });
  assert.match(result.logs, /成功0 重复0 失败1/);
  assert.match(result.logs, /需要重新登录并抓取 Cookie/);
  assert.equal(result.calls.filter(call => call.url.endsWith('/checkin')).length, 1);
  assert.equal(result.calls.filter(call => call.url.endsWith('/exchange')).length, 0);
});

test('real duplicate is recognized with captured UA and isolated Loon cookie handling', async () => {
  const result = await run({ initial: { ...saved(['cookie']), [metaKey]: JSON.stringify([{ cookie: 'cookie', email: 'alice@example.test', userAgent: ua }]) },
    reply: options => ({ body: options.url.endsWith('/checkin') ? { code: 1, message: 'Checkin repeats! Please try tomorrow.' }
      : options.url.endsWith('/points') ? { points: 289 } : status() }) });
  assert.match(result.logs, /成功0 重复1 失败0/);
  assert.doesNotMatch(result.logs, /Cookie : Valid|Token/);
  assert.ok(result.calls.every(call => call.headers['User-Agent'] === ua && call['auto-cookie'] === false && call.insecure === false));
});

test('successful check-in preserves existing points exchange behavior', async () => {
  const result = await run({ initial: saved(['cookie']), reply: options => ({ body: options.url.endsWith('/checkin') ? { code: 0, points: 4 }
    : options.url.endsWith('/points') ? { points: 504 } : options.url.endsWith('/exchange') ? { code: 0 } : status() }) });
  assert.match(result.logs, /成功1 重复0 失败0/);
  assert.equal(result.calls.filter(call => call.url.endsWith('/exchange')).length, 1);
});

test('failed account validation submits neither check-in nor exchange', async () => {
  const result = await run({ initial: saved(['cookie']), reply: () => ({ status: 401, body: { code: -1, points: 600 } }) });
  assert.match(result.logs, /账号验证失败/);
  assert.ok(result.calls.every(call => call.method === 'GET'));
});

test('unsupported domains do not receive credentials', async () => {
  const request = capture('secret-fixture'); request.url = 'https://unrelated.example.test/api/user/status';
  const result = await run({ request, response: status() });
  assert.equal(result.calls.length, 0); assert.equal(result.store.size, 0);
});

test('storage failure is reported without a success notification', async () => {
  const result = await run({ request: capture('cookie'), response: status(), writeOK: false });
  assert.match(result.logs, /抓包保存失败/); assert.doesNotMatch(result.logs, /新账号已保存|Cookie 已更新/);
});

test('missing credentials complete without network access', async () => {
  const result = await run(); assert.equal(result.calls.length, 0); assert.match(result.logs, /无 Cookie/);
});
