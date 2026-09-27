const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = readFileSync(join(__dirname, '../scripts/sb/sb.js'), 'utf8');
const daily = 'https://sb.sb/signin/';
const session = { cookie: 'session=fixture-secret; csrf=old-cookie', userAgent: 'fixture-iPhone-Safari' };
const ready = `<h1>每日签到</h1><div class="signin-hero-action"><form action="/signin/" method="post">
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
      return { status: 303, headers: { Location: '/signin/' } };
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

test('already signed never submits another POST', async () => {
  const r = await run({ initial: values() });
  assert.match(r.logs, /今日已签到/);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, 'GET');
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
  for (const location of ['https://example.test/signin/', '//example.test/signin/', 'https://sb.sb.example.test/signin/', '/signin/\\example.test']) {
    const r = await run({ initial: values(), reply: () => ({ status: 302, headers: { Location: location } }) });
    assert.equal(r.calls.length, 1);
    assert.match(r.logs, /异常跳转/);
  }
  const r = await run({ initial: values(), reply: call => call.method === 'POST' ? { status: 307, headers: { Location: daily } } : { body: ready } });
  assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
  assert.doesNotMatch(r.logs, /✅ 签到成功/);
});

test('HTTP errors and uncertain submission never produce success or a retry', async () => {
  for (const failure of [{ status: 403 }, { error: 'private network detail' }]) {
    const r = await run({ initial: values(), reply: call => call.method === 'POST' ? failure : { body: ready } });
    assert.equal(r.calls.filter(c => c.method === 'POST').length, 1);
    assert.doesNotMatch(r.logs, /✅ 签到成功|private network detail/);
  }
});
