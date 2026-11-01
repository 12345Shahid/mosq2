const { fork } = require('child_process');
const http = require('http');
const assert = require('assert');
const path = require('path');

const TEST_PORT = 3399;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

async function run() {
  console.log(`Starting server on port ${TEST_PORT} for TV route testing...`);
  const serverProc = fork(path.join(__dirname, '../server/index.js'), [], {
    env: { ...process.env, PORT: TEST_PORT, NODE_ENV: 'test' }
  });

  // Give server time to boot
  await new Promise(r => setTimeout(r, 2000));

  try {
    // 1. Test /tv route
    console.log('Testing GET /tv...');
    const tvRes = await fetchText(`http://localhost:${TEST_PORT}/tv`);
    assert.strictEqual(tvRes.status, 200);
    assert(tvRes.body.includes('Live Khutbah TV Display'), 'Expected /tv to serve display.html');
    console.log(' PASS: /tv route returns 200 with display.html');

    // 2. Test /display route
    console.log('Testing GET /display...');
    const displayRes = await fetchText(`http://localhost:${TEST_PORT}/display`);
    assert.strictEqual(displayRes.status, 200);
    assert(displayRes.body.includes('Live Khutbah TV Display'), 'Expected /display to serve display.html');
    console.log(' PASS: /display route returns 200 with display.html');

    // 3. Test /api/session/current
    console.log('Testing GET /api/session/current...');
    const curRes = await fetchJson(`http://localhost:${TEST_PORT}/api/session/current`);
    assert.strictEqual(curRes.status, 200);
    assert(curRes.data.sessionId, 'Expected sessionId in /api/session/current');
    assert(curRes.data.mosqueName, 'Expected mosqueName in /api/session/current');
    assert.strictEqual(typeof curRes.data.isLive, 'boolean', 'Expected isLive boolean flag');
    console.log(` PASS: /api/session/current returned session: "${curRes.data.sessionId}", isLive: ${curRes.data.isLive}`);

    // 4. Test /api/session/current/feed
    console.log('Testing GET /api/session/current/feed...');
    const feedRes = await fetchJson(`http://localhost:${TEST_PORT}/api/session/current/feed`);
    assert.strictEqual(feedRes.status, 200);
    assert(feedRes.data.sessionId, 'Expected sessionId in /api/session/current/feed');
    assert(feedRes.data.tvFontSize, 'Expected tvFontSize in /api/session/current/feed');
    assert(feedRes.data.tvCapacity, 'Expected tvCapacity in /api/session/current/feed');
    assert(Array.isArray(feedRes.data.transcripts), 'Expected transcripts array');
    console.log(` PASS: /api/session/current/feed delivered full TV settings and transcripts`);

    // 5. Test delta query with since_seq
    console.log('Testing GET /api/session/current/feed?since_seq=99999...');
    const deltaRes = await fetchJson(`http://localhost:${TEST_PORT}/api/session/current/feed?since_seq=99999`);
    assert.strictEqual(deltaRes.status, 200);
    assert.strictEqual(deltaRes.data.transcripts.length, 0);
    console.log(' PASS: since_seq query parameter properly filtered delta transcripts');

    console.log('\n ALL SMART TV HTTP TESTS PASSED PERFECTLY!\n');
  } finally {
    serverProc.kill('SIGTERM');
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
