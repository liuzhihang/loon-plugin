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

async function run({ initial = {}, request, response, reply, writeOK = true, qx = false, surge = false } = {}) {
  const store = new Map(Object.entries(initial));
  const logs = [], calls = [], notifications = [], delays = [];
  let finish, done = 0;
  const finished = new Promise(resolve => { finish = resolve; });
  const send = (options, callback) => {
    calls.push(options);
    const result = reply ? reply(options) : { body: status() };
    const body = result.rawBody !== undefined ? result.rawBody : JSON.stringify(result.body || {});
    queueMicrotask(() => callback(result.error || null, { status: result.status || 200, headers: result.headers || {} }, body));
  };
  const write = (value, key) => { if (!writeOK) return false; store.set(key, value); return true; };
  const sandbox = {
    console: { log: line => logs.push(String(line)) },
    $persistentStore: { read: key => store.get(key), write },
    $notification: { post: (...args) => notifications.push(args) }, $httpClient: { get: send, post: send },
    $done() { done++; finish(); },
    setTimeout: (callback, delay) => { delays.push(delay); queueMicrotask(callback); },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
  };
  if (qx) {
    sandbox.$task = { fetch: options => new Promise((resolve, reject) => send(options, (error, response, body) => error ? reject(error) : resolve({ statusCode: response.status, headers: response.headers, body }))) };
    sandbox.$prefs = { valueForKey: key => store.get(key), setValueForKey: write };
    sandbox.$notify = (...args) => notifications.push(args);
  } else if (!surge) sandbox.$loon = 'iPhone test 3.5.1(998)';
  if (request) sandbox.$request = request;
  if (response) sandbox.$response = { status: 200, body: JSON.stringify(response) };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const timer = setTimeout(() => finish('timeout'), 1000);
  const result = await finished;
  clearTimeout(timer);
  assert.notEqual(result, 'timeout', 'script must finish');
  assert.equal(done, 1);
  return { store, calls, notifications, delays, logs: logs.join('\n') };
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

test('capture reads Cookie and User-Agent without depending on header case', async () => {
  for (const headers of [
    { cOoKiE: 'fixture-cookie', 'User-agent': ua },
    { COOKIE: 'fixture-cookie', 'USER-AGENT': ua },
    { cookie: 'fixture-cookie', 'user-agent': ua },
  ]) {
    const request = { url: `https://${domain}/api/user/status`, headers };
    const result = await run({ request, response: status() });
    assert.deepEqual(JSON.parse(result.store.get(key) || 'null'), ['fixture-cookie']);
    assert.equal(JSON.parse(result.store.get(metaKey))[0].userAgent, ua);
    assert.equal(result.calls.length, 0);
    assert.doesNotMatch(result.logs, /fixture-cookie/);
  }
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
  assert.match(result.logs, /服务端拒绝自动签到/);
  assert.doesNotMatch(result.logs, /需要更新登录凭据/);
  assert.equal(result.calls.filter(call => call.url.endsWith('/checkin')).length, 1);
  assert.equal(result.calls.filter(call => call.url.endsWith('/exchange')).length, 0);
});

test('real duplicate is recognized with captured UA and isolated Loon cookie handling', async () => {
  const result = await run({ initial: { ...saved(['cookie']), [metaKey]: JSON.stringify([{ cookie: 'cookie', email: 'alice@example.test', userAgent: ua }]) },
    reply: options => ({ body: options.url.endsWith('/checkin') ? { code: 1, message: 'Checkin repeats! Please try tomorrow.' }
      : options.url.endsWith('/points') ? { points: 289 } : status() }) });
  assert.match(result.logs, /成功0 重复1 失败0/);
  assert.doesNotMatch(result.logs, /Cookie : Valid|Token/);
  assert.ok(result.calls.every(call => call.headers['User-Agent'] === ua && call['auto-cookie'] === false && call['auto-redirect'] === false && call.insecure === false));
});

test('redirected check-ins never follow the target, report success or exchange points', async () => {
  for (const statusCode of [301, 302, 303, 307, 308]) {
    for (const location of ['/api/user/checkin', 'https://unrelated.example.test/checkin']) {
      const result = await run({ initial: saved(['fixture-cookie']), reply: options => options.url.endsWith('/checkin')
        ? { status: statusCode, headers: { Location: location }, body: { code: 0, points: 4 } }
        : { body: options.url.endsWith('/points') ? { points: 600 } : status() } });
      assert.equal(result.calls.filter(call => call.url.endsWith('/checkin')).length, 1);
      assert.equal(result.calls.filter(call => call.url.endsWith('/exchange')).length, 0);
      assert.ok(result.calls.every(call => new URL(call.url).origin === `https://${domain}` && call['auto-redirect'] === false));
      assert.match(result.logs, /重定向/);
      assert.match(result.logs, /成功0 重复0 失败1/);
    }
  }
});

test('unconfirmed check-ins skip point exchange', async () => {
  for (const failure of [{ error: 'connection closed' }, { body: { code: -2, message: 'not confirmed' } }]) {
    const result = await run({ initial: saved(['fixture-cookie']), reply: options => options.url.endsWith('/checkin')
      ? failure : { body: options.url.endsWith('/points') ? { points: 600 } : status() } });
    assert.equal(result.calls.filter(call => call.url.endsWith('/checkin')).length, 1);
    assert.equal(result.calls.filter(call => call.url.endsWith('/exchange')).length, 0);
    assert.match(result.logs, /成功0 重复0 失败1/);
  }
});

test('successful check-in preserves existing points exchange behavior', async () => {
  const result = await run({ initial: saved(['cookie']), reply: options => ({ body: options.url.endsWith('/checkin') ? { code: 0, points: 4 }
    : options.url.endsWith('/points') ? { points: 504 } : options.url.endsWith('/exchange') ? { code: 0 } : status() }) });
  assert.match(result.logs, /成功1 重复0 失败0/);
  assert.equal(result.calls.filter(call => call.url.endsWith('/exchange')).length, 1);
});

test('explicit authentication failure stops after the account query', async () => {
  const result = await run({ initial: saved(['cookie']), reply: () => ({ status: 401, body: { code: -1, points: 600 } }) });
  assert.match(result.logs, /需要重新登录并抓取 Cookie/);
  assert.match(result.logs, /HTTP 401/);
  assert.equal(result.calls.length, 1);
  assert.ok(result.calls.every(call => call.method === 'GET'));
});

test('temporary precheck errors retry the status GET once before a single check-in', async () => {
  const failures = [
    { error: 'connection closed' },
    ...[408, 500, 502, 503, 504].map(status => ({ status, body: { message: 'temporary service failure' } })),
    { rawBody: '<html>upstream temporarily unavailable</html>' },
  ];
  for (const platform of [{}, { qx: true }, { surge: true }]) {
    for (const failure of failures) {
      let statusCalls = 0;
      const result = await run({ ...platform, initial: saved(['fixture-cookie']), reply: options => {
        if (options.url.endsWith('/status')) return ++statusCalls === 1 ? failure : { body: status() };
        return { body: options.url.endsWith('/checkin') ? { code: 0, points: 4 } : { points: 295 } };
      } });
      assert.deepEqual(result.calls.map(call => `${call.method} ${new URL(call.url).pathname}`), [
        'GET /api/user/status', 'GET /api/user/status', 'POST /api/user/checkin', 'GET /api/user/points', 'GET /api/user/status',
      ]);
      assert.deepEqual(result.delays, [0, 2000]);
      assert.match(result.logs, /账号状态查询重试成功/);
      assert.match(result.logs, /成功1 重复0 失败0/);
      assert.doesNotMatch(result.logs, /需要更新登录凭据|账号验证失败/);
    }
  }
});

test('persistent temporary precheck failure stops after two GETs without requesting new credentials', async () => {
  for (const failure of [{ error: 'request timed out' }, { status: 503, body: { code: 17, message: 'backend unavailable' } }]) {
    const result = await run({ initial: saved(['fixture-cookie']), reply: () => failure });
    assert.equal(result.calls.length, 2);
    assert.ok(result.calls.every(call => call.method === 'GET' && call.url.endsWith('/status')));
    assert.deepEqual(result.delays, [0, 2000]);
    assert.match(result.logs, /账号状态查询失败/);
    assert.match(result.logs, /request timed out|HTTP 503.*code=17.*backend unavailable/);
    assert.doesNotMatch(result.logs, /需要更新登录凭据|请.*抓取 Cookie/);
    assert.equal(result.notifications[1][1], '账号状态查询失败');
    assert.match(result.notifications[1][2], /跳过\(签到未完成\)/);
  }
});

test('terminal account responses never retry or start subsequent account requests', async () => {
  const cases = [
    [{ status: 401, rawBody: 'Unauthorized' }, /需要重新登录并抓取 Cookie/, true],
    [{ body: { code: 1, message: 'Not logged in' } }, /需要重新登录并抓取 Cookie/, true],
    [{ status: 403, rawBody: '<html>Forbidden</html>' }, /访问被拒绝/, false],
    [{ status: 429, body: { message: 'Too many requests' } }, /请求被限流/, false],
    [{ status: 503, rawBody: '<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/test"></script></html>' }, /需要网页验证/, false],
    [{ rawBody: '<html>captcha required</html>' }, /需要网页验证/, false],
    [{ body: { code: 1, message: 'Automated check-in detected. Please sign in again to continue.' } }, /服务端拒绝自动签到/, false],
    [{ status: 302, headers: { Location: '/login' } }, /账号状态查询失败/, false],
    [{ body: { code: 17, message: 'account lookup unavailable' } }, /账号状态查询失败/, false],
    [{ body: { code: 0, data: { leftDays: 506 } } }, /账号状态查询失败/, false],
  ];
  for (const [reply, expectedStatus, needsLogin] of cases) {
    const result = await run({ initial: saved(['fixture-cookie']), reply: () => reply });
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.delays, [0]);
    assert.match(result.notifications[1][1], expectedStatus);
    assert.equal(result.logs.includes('需要更新登录凭据'), needsLogin);
    assert.match(result.logs, /成功0 重复0 失败1/);
  }
});

test('a login failure on the retry stops immediately without a third status query', async () => {
  let queries = 0;
  const result = await run({ initial: saved(['fixture-cookie']), reply: () => ++queries === 1
    ? { error: 'connection closed' } : { status: 401, body: { message: 'Not logged in' } } });
  assert.equal(result.calls.length, 2);
  assert.ok(result.calls.every(call => call.method === 'GET' && call.url.endsWith('/status')));
  assert.deepEqual(result.delays, [0, 2000]);
  assert.match(result.logs, /需要重新登录并抓取 Cookie/);
  assert.match(result.logs, /HTTP 401.*Not logged in/);
});

test('a failed account does not prevent the next account from completing', async () => {
  const result = await run({ initial: saved(['expired-fixture', 'valid-fixture']), reply: options => {
    if (options.headers.Cookie === 'expired-fixture') return { status: 401, body: { code: -1 } };
    return { body: options.url.endsWith('/checkin') ? { code: 0, points: 4 }
      : options.url.endsWith('/points') ? { points: 295 } : status() };
  } });
  assert.equal(result.calls.filter(call => call.headers.Cookie === 'expired-fixture').length, 1);
  assert.equal(result.calls.filter(call => call.url.endsWith('/checkin')).length, 1);
  assert.match(result.logs, /成功1 重复0 失败1/);
});

test('both observed duplicate messages are accepted and retain points exchange behavior', async () => {
  for (const message of ['Checkin repeats! Please try tomorrow.', "Today's observation logged. Return tomorrow for more points."]) {
    const result = await run({ initial: saved(['fixture-cookie']), reply: options => ({ body:
      options.url.endsWith('/checkin') ? { code: 1, message } : options.url.endsWith('/points') ? { points: 504 }
        : options.url.endsWith('/exchange') ? { code: 0 } : status() }) });
    assert.match(result.logs, /成功0 重复1 失败0/);
    assert.equal(result.calls.filter(call => call.url.endsWith('/checkin')).length, 1);
    assert.equal(result.calls.filter(call => call.url.endsWith('/exchange')).length, 1);
  }
});

test('unknown code 1 and HTTP errors cannot count as success or duplicate', async () => {
  for (const response of [
    { body: { code: 1, message: 'unknown service error' } },
    { body: { code: 1 } },
    { status: 500, body: { code: 0, points: 4 } },
    { status: 503, body: { code: 1, message: 'Checkin repeats! Please try tomorrow.' } },
  ]) {
    const result = await run({ initial: saved(['fixture-cookie']), reply: options => options.url.endsWith('/checkin') ? response : { body: status() } });
    assert.match(result.logs, /成功0 重复0 失败1/);
    assert.deepEqual(result.calls.map(call => call.method), ['GET', 'POST']);
    assert.deepEqual(result.delays, [0]);
    if (response.body.code === 1) assert.match(result.logs, /API code\s+: 1/);
  }
});

test('failed check-in POSTs are never retried and stop further account requests', async () => {
  for (const response of [
    { error: 'request timed out' },
    { status: 401, rawBody: 'Unauthorized' },
    { status: 403, rawBody: 'Forbidden' },
    { status: 429, body: { message: 'Too many requests' } },
    { status: 503, rawBody: '<html>Service unavailable</html>' },
    { rawBody: '<html>captcha required</html>' },
  ]) {
    const result = await run({ initial: saved(['fixture-cookie']), reply: options => options.url.endsWith('/checkin') ? response : { body: status() } });
    assert.deepEqual(result.calls.map(call => call.method), ['GET', 'POST']);
    assert.deepEqual(result.delays, [0]);
    assert.match(result.logs, /成功0 重复0 失败1/);
  }
});

test('diagnostics retain reasons without exposing cookie values or raw response payloads', async () => {
  const cookie = 'session=secret-session-value; auth=secret-auth-value';
  const result = await run({ initial: saved([cookie]), reply: () => ({
    error: `connection closed; Cookie: ${cookie}; token=secret-token-value`,
  }) });
  assert.match(result.logs, /connection closed/);
  assert.doesNotMatch(result.logs + JSON.stringify(result.notifications), /secret-session-value|secret-auth-value|secret-token-value/);
  const payload = await run({ initial: saved(['fixture-cookie']), reply: () => ({ body: {
    code: 7, message: 'account unavailable', data: { cookie: 'private-response-cookie', token: 'private-response-token' },
  } }) });
  assert.match(payload.logs, /HTTP 200.*code=7.*account unavailable/);
  assert.doesNotMatch(payload.logs, /private-response/);
});

test('a final status query failure preserves the confirmed check-in and is not retried', async () => {
  let queries = 0;
  const result = await run({ initial: saved(['fixture-cookie']), reply: options => {
    if (options.url.endsWith('/status')) return ++queries === 1 ? { body: status() } : { status: 503, body: { message: 'service unavailable' } };
    return { body: options.url.endsWith('/checkin') ? { code: 0, points: 4 } : { points: 295 } };
  } });
  assert.match(result.logs, /成功1 重复0 失败0/);
  assert.match(result.logs, /HTTP 503.*service unavailable/);
  assert.equal(queries, 2);
  assert.deepEqual(result.delays, [0]);
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
