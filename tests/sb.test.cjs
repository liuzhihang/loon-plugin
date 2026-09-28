const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = readFileSync(join(__dirname, '../scripts/sb/sb.js'), 'utf8');
const daily = 'https://sb.sb/checkin/';
const legacyDaily = 'https://sb.sb/signin/';
const session = { cookie: 'session=fixture-secret; csrf=old-cookie', userAgent: 'fixture-iPhone-Safari' };
const ready = `<h1>每日签到</h1><div class="signin-hero-action"><form action="/checkin/" method="post">
  <input value="fresh&amp;token" name="_csrf" type="hidden">
  <input name="message" placeholder="留言（可选）"><button type="submit">立即签到</button>
</form></div>`;
const signed = '<h1>每日签到</h1><div class="signin-hero-action"><div><button disabled>今日已签到</button></div></div>';
const login = '<form action="/login/" method="post"><input name="_csrf" value="login-token"></form>';
const values = () => ({ SB_Session: JSON.stringify(session) });
const capture = () => ({ url: daily, method: 'GET', headers: { cOoKiE: session.cookie, 'user-Agent': session.userAgent } });

async function run({ initial = {}, request, response, reply, writeOK = true } = {}) {
  const store = new Map(Object.entries(initial)), calls = [], logs = [];
  let finish, count = 0;
  const completed = new Promise(resolve => { finish = resolve; });
  const send = method => (options, callback) => {
    calls.push({ ...options, method });
    const r = reply ? reply(calls.at(-1), calls) : { body: signed };
    queueMicrotask(() => callback(r.error || null, { status: r.status ?? 200, headers: r.headers || {} }, r.body || ''));
  };
  const sandbox = {
    console: { log: value => logs.push(String(value)) }, $loon: '3.5.1(998)',
    $persistentStore: { read: key => store.get(key), write: (value, key) => { if (!writeOK) return false; store.set(key, value); return true; } },
    $notification: { post: (...args) => logs.push(args.join(' ')) },
    $httpClient: { get: send('GET'), post: send('POST') },
    $done() { count++; finish(); },
  };
  if (request) sandbox.$request = request;
  if (response) sandbox.$response = response;
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  const timer = setTimeout(() => finish('timeout'), 1000);
  const result = await completed;
  clearTimeout(timer);
  assert.notEqual(result, 'timeout');
  assert.equal(count, 1);
  const output = logs.join('\n');
  assert.doesNotMatch(output, /fixture-secret|fresh&token|old-cookie/);
  return { store, calls, logs: output };
}

test('validated capture atomically saves Cookie and UA, incorporating same-site rotation', async () => {
  const r = await run({ request: capture(), response: { status: 200, body: ready, headers: { 'Set-Cookie': ['csrf=new-cookie; Path=/', 'wrong=bad; Domain=example.test'] } } });
  assert.deepEqual(JSON.parse(r.store.get('SB_Session')), { ...session, cookie: 'session=fixture-secret; csrf=new-cookie' });
  assert.match(r.logs, /登录会话已更新/);
  assert.equal(r.calls.length, 0);
});

test('signed-in capture accepts the completed daily page', async () => {
  const r = await run({ request: capture(), response: { status: 200, body: signed } });
  assert.deepEqual(JSON.parse(r.store.get('SB_Session')), session);
});

test('both current and legacy daily URLs can capture a validated session', async () => {
  for (const url of [daily, legacyDaily, daily + '?from=nav', legacyDaily + '?from=nav']) {
    const r = await run({ request: { ...capture(), url }, response: { status: 200, body: ready } });
    assert.deepEqual(JSON.parse(r.store.get('SB_Session')), session);
    assert.match(r.logs, /登录会话已更新/);
  }
});

test('the Loon plugin captures only the current and legacy same-origin daily pages', () => {
  const plugin = readFileSync(join(__dirname, '../plugins/sb.lpx'), 'utf8');
  const rule = plugin.split('\n').find(line => line.startsWith('response if '));
  const pattern = new RegExp(rule.match(/ ~= \/(.*)\/ && /)[1]);
  for (const url of [daily, legacyDaily, daily + '?from=nav']) assert.ok(pattern.test(url));
  for (const url of ['https://example.test/checkin/', 'https://sb.sb.example.test/checkin/', 'https://sb.sb/settings/']) assert.equal(pattern.test(url), false);
  assert.match(rule, /\$\{response\.status\} == 200/);
});

test('the migrated checkin route is requested directly instead of the old 301 endpoint', async () => {
  const r = await run({ initial: values(), reply: call => call.url === legacyDaily
    ? { status: 301, headers: { Location: '/checkin/' } } : { body: signed } });
  assert.match(r.logs, /今日已签到/);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, daily);
});

test('login, error, unsupported domain and POST captures preserve the old session', async () => {
  for (const entry of [
    { request: capture(), response: { status: 200, body: login } },
    { request: capture(), response: { status: 403, body: ready } },
    { request: { ...capture(), url: 'https://sb.sb.example.test/signin/' }, response: { status: 200, body: ready } },
    { request: { ...capture(), method: 'POST' }, response: { status: 200, body: ready } },
    { request: { ...capture(), headers: { Cookie: 'different' } }, response: { status: 200, body: ready } },
  ]) {
    const initial = values();
    const r = await run({ initial, ...entry });
    assert.deepEqual(Object.fromEntries(r.store), initial);
    assert.doesNotMatch(r.logs, /✅/);
  }
});

test('a failed storage write is not reported as successful capture', async () => {
  const r = await run({ request: capture(), response: { status: 200, body: ready }, writeOK: false });
  assert.equal(r.store.size, 0);
  assert.match(r.logs, /会话未保存/);
});

test('no session makes no network request', async () => {
  const r = await run();
  assert.equal(r.calls.length, 0);
  assert.match(r.logs, /未保存登录会话/);
});

test('fresh CSRF and rotated cookies are used once, with no message and a final verification GET', async () => {
  let posted = false;
  const r = await run({ initial: values(), reply: call => {
    if (call.method === 'POST') {
      assert.equal(call.body, '_csrf=fresh%26token');
      assert.match(call.headers.Cookie, /csrf=new-cookie/);
      posted = true;
      return { status: 303, headers: { Location: '/checkin/' } };
    }
    return { body: posted ? signed : ready, headers: { 'set-cookie': 'csrf=new-cookie; Expires=Wed, 30 Sep 2026 10:00:00 GMT; Path=/' } };
  } });
  assert.match(r.logs, /✅ 签到成功/);
  assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(r.calls.at(-1).method, 'GET');
  for (const c of r.calls) {
    assert.equal(c.url, daily);
    assert.equal(c.headers['User-Agent'], session.userAgent);
    assert.equal(c['auto-cookie'], false);
    assert.equal(c['auto-redirect'], false);
    assert.equal(c.insecure, false);
  }
});

test('POST goes only to a recognized same-origin form action', async () => {
  for (const action of ['/checkin/', daily, '/signin/', legacyDaily]) {
    let posted = false;
    const body = ready.replace('action="/checkin/"', `action="${action}"`);
    const r = await run({ initial: values(), reply: call => {
      if (call.method === 'POST') posted = true;
      return { body: posted ? signed : body };
    } });
    const posts = r.calls.filter(call => call.method === 'POST');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, new URL(action, daily).href);
    assert.equal(posts[0].body, '_csrf=fresh%26token');
    assert.match(r.logs, /✅ 签到成功/);
  }
  for (const action of ['https://example.test/checkin/', '//example.test/checkin/', '/settings/', '/checkin/../settings/']) {
    const r = await run({ initial: values(), reply: () => ({ body: ready.replace('action="/checkin/"', `action="${action}"`) }) });
    assert.equal(r.calls.filter(call => call.method === 'POST').length, 0);
    assert.match(r.logs, /未识别到签到状态/);
  }
});

test('already signed never submits another POST', async () => {
  const r = await run({ initial: values() });
  assert.match(r.logs, /今日已签到/);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, 'GET');
});

test('Loon millisecond timeouts allow a normal network round trip', async () => {
  let posted = false;
  const r = await run({ initial: values(), reply: call => {
    // Loon measures timeout in milliseconds; model a 200 ms response.
    if (call.timeout < 200) return { error: 'request timed out' };
    if (call.method === 'POST') posted = true;
    return { body: posted ? signed : ready };
  } });
  assert.match(r.logs, /✅ 签到成功/);
  assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
});

test('board text and script literals cannot be mistaken for a signed account', async () => {
  const fake = ready + '<article>今日已签到</article><script>"<div class=\"signin-hero-action\"><button>今日已签到</button></div>"</script>';
  const r = await run({ initial: values(), reply: () => ({ body: fake }) });
  assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
  assert.match(r.logs, /提交后尚未确认签到成功/);
  assert.doesNotMatch(r.logs, /✅ 签到成功|🔁/);
});

test('missing CSRF, browser challenge and login pages cause no POST', async () => {
  for (const body of [ready.replace('name="_csrf"', 'name="unrelated"'), ready.replace('</form>', '<div class="cf-turnstile"></div></form>'), login]) {
    const r = await run({ initial: values(), reply: () => ({ body }) });
    assert.equal(r.calls.length, 1);
    assert.doesNotMatch(r.logs, /✅ 签到成功/);
  }
});

test('redirects never forward credentials off-site or resend a POST', async () => {
  for (const location of ['https://example.test/checkin/', '//example.test/checkin/', 'https://sb.sb.example.test/checkin/', '/checkin/\\example.test', '/checkin/../settings/', 'https://sb.sb@evil.test/checkin/']) {
    const r = await run({ initial: values(), reply: () => ({ status: 302, headers: { Location: location } }) });
    assert.equal(r.calls.length, 1);
    assert.match(r.logs, /异常跳转/);
  }
  for (const status of [301, 307, 308]) {
    const r = await run({ initial: values(), reply: call => call.method === 'POST' ? { status, headers: { Location: daily } } : { body: ready } });
    assert.equal(r.calls.length, 2);
    assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
    assert.doesNotMatch(r.logs, /✅ 签到成功/);
  }
});

test('GET redirects between recognized daily routes remain bounded', async () => {
  const r = await run({ initial: values(), reply: (_, calls) => calls.length === 1
    ? { status: 302, headers: { Location: '/signin/' } } : calls.length === 2
      ? { status: 301, headers: { Location: '/checkin/' } } : { body: signed } });
  assert.deepEqual(r.calls.map(call => call.url), [daily, legacyDaily, daily]);
  assert.ok(r.calls.every(call => call.method === 'GET'));
  assert.match(r.logs, /今日已签到/);
  const loop = await run({ initial: values(), reply: () => ({ status: 302, headers: { Location: '/checkin/' } }) });
  assert.equal(loop.calls.length, 3);
  assert.match(loop.logs, /重定向次数过多/);
});

test('redirect diagnostics show method, status and path without query credentials', async () => {
  const r = await run({ initial: values(), reply: (_, calls) => calls.length === 1
    ? { status: 302, headers: { Location: '/login/?token=private-token#private-fragment' } } : { body: signed } });
  assert.equal(r.calls.length, 1);
  assert.match(r.logs, /GET \/checkin\/.*302/);
  assert.match(r.logs, /Location\s+: \/login\//);
  assert.match(r.logs, /登录已失效/);
  assert.doesNotMatch(r.logs, /private-token|private-fragment/);
});

test('HTTP errors and uncertain submission never produce success or a retry', async () => {
  for (const failure of [{ status: 403 }, { error: 'private network detail' }]) {
    const r = await run({ initial: values(), reply: call => call.method === 'POST' ? failure : { body: ready } });
    assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
    assert.doesNotMatch(r.logs, /✅ 签到成功|private network detail/);
  }
});
