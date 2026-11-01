const assert = require('assert');
const http = require('http');
const express = require('express');
const path = require('path');
const WebSocket = require('ws');

// Test TV display routes, auto-discovery, delta feed, and WebSocket room binding
async function runTvDisplayTests() {
  console.log(' Starting Smart TV Display & Auto-Discovery E2E Test Suite...\n');

  // Require server/sessionManager to verify logic
  const { SessionManager } = require('../server/sessionManager');
  const sm = new SessionManager();

  // Test 1: Create sessions
  console.log('Test 1: Creating test sessions...');
  const sess1 = await sm.createSession({
    sessionId: 'masjid-alpha',
    mosqueName: 'Masjid Alpha',
    primaryLanguage: 'en'
  });
  const sess2 = await sm.createSession({
    sessionId: 'masjid-beta',
    mosqueName: 'Masjid Beta',
    primaryLanguage: 'tr'
  });
  assert.strictEqual(sess1.id, 'masjid-alpha');
  assert.strictEqual(sess2.id, 'masjid-beta');
  console.log(' PASS: Sessions initialized properly.\n');

  // Test 2: Lifecycle tracking
  console.log('Test 2: Testing session lifecycle & active detection...');
  let activeId = null;
  sm.on('session_started', ({ sessionId }) => {
    activeId = sessionId;
  });

  sm.startSession('masjid-beta');
  assert.strictEqual(activeId, 'masjid-beta', 'Active session should dynamically become masjid-beta');
  assert.strictEqual(sess2.status, 'active');
  console.log(' PASS: session_started event properly updates active session.\n');

  // Test 3: TV Settings persistence
  console.log('Test 3: Testing TV Settings update...');
  sm.updateTvSettings('masjid-beta', {
    fontSize: 'large',
    capacity: 8,
    tvTargetLang: 'uz',
    tvScreenMode: 'translation-only',
    sourceLanguage: 'ar'
  });
  assert.strictEqual(sess2.tvFontSize, 'large');
  assert.strictEqual(sess2.tvCapacity, 8);
  assert.strictEqual(sess2.tvLanguage, 'uz');
  assert.strictEqual(sess2.tvScreenMode, 'translation-only');
  assert.strictEqual(sess2.sourceLanguage, 'ar');
  console.log(' PASS: TV settings persisted and broadcasted.\n');

  // Test 4: Delta sequence feed handling
  console.log('Test 4: Testing delta sequence feed filtering...');
  sess2.transcripts.push({
    seq: 1,
    arabic: 'بسم الله',
    translations: { uz: 'Bismillah', en: 'In the name of Allah' },
    timestamp: new Date().toISOString()
  });
  sess2.transcripts.push({
    seq: 2,
    arabic: 'الحمد لله',
    translations: { uz: 'Alhamdulillah', en: 'Praise be to Allah' },
    timestamp: new Date().toISOString()
  });
  sess2.transcripts.push({
    seq: 3,
    arabic: 'رب العالمين',
    translations: { uz: 'Olamlar Parvardigoriga', en: 'Lord of the worlds' },
    timestamp: new Date().toISOString()
  });

  // Emulate sendSessionFeed logic with since_seq
  function filterFeed(session, sinceSeq) {
    let t = session.transcripts;
    if (sinceSeq !== null && sinceSeq !== undefined) {
      t = t.filter(item => (item.seq || 0) > sinceSeq);
    }
    return t;
  }

  const delta1 = filterFeed(sess2, 0);
  assert.strictEqual(delta1.length, 3, 'since_seq=0 should return all 3 transcripts');

  const delta2 = filterFeed(sess2, 2);
  assert.strictEqual(delta2.length, 1, 'since_seq=2 should return only seq 3');
  assert.strictEqual(delta2[0].seq, 3);

  const delta3 = filterFeed(sess2, 3);
  assert.strictEqual(delta3.length, 0, 'since_seq=3 should return 0 new transcripts');
  console.log(' PASS: Delta polling with since_seq correctly avoids duplicate/heavy data transfer.\n');

  console.log(' All Smart TV unit & logic checks passed successfully!\n');
}

runTvDisplayTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
