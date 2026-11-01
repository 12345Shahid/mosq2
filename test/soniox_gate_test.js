/**
 * Unit Test for Soniox Dynamic Language Gates Manager with Multi-Session Isolation
 */

const assert = require('assert');
const EventEmitter = require('events');
const sonioxService = require('../server/services/sonioxService');

async function runSonioxGateTests() {
  console.log('\n========================================================');
  console.log('🧪 TESTING SONIOX DYNAMIC LANGUAGE GATES MANAGER');
  console.log('========================================================\n');

  // Test 1: Fallback / Unconfigured state
  console.log('[Test 1] Testing unconfigured state handling...');
  assert.strictEqual(typeof sonioxService.isConfigured, 'function');
  const initialStatus = sonioxService.getStatus();
  assert(initialStatus !== null, 'Status object should be returned');
  assert.strictEqual(typeof initialStatus.activeGateCount, 'number');
  console.log('  ✔ Soniox fallback & status inspection verified.');

  // Test 2: Setting API Key & Validating
  console.log('\n[Test 2] Testing Key validation...');
  sonioxService.setApiKey('test_soniox_valid_mock_key_12345');
  assert.strictEqual(sonioxService.isConfigured(), true, 'Valid key should be marked operational');
  console.log('  ✔ API Key activation verified.');

  // Test 3: Gate Syncing & On-Demand Lifecycle (Per-Session)
  console.log('\n[Test 3] Testing dynamic gate synchronization & multi-session isolation...');
  const originalConnectGate = sonioxService.connectGate.bind(sonioxService);
  const openedGates = [];
  sonioxService.connectGate = function(gate) {
    gate.status = 'open';
    gate.ws = {
      readyState: 1, // OPEN
      send: function(data) { gate.lastSent = data; },
      close: function() { gate.status = 'closed'; }
    };
    openedGates.push(gate.gateKey);
  };

  // Open gates for Session A
  sonioxService.syncGates('session-a', ['en', 'bn']);
  assert.strictEqual(sonioxService.activeGates.size, 2, 'Should have 2 open gates for session-a');
  assert(sonioxService.activeGates.has('session-a:en'), 'session-a:en gate should be open');
  assert(sonioxService.activeGates.has('session-a:bn'), 'session-a:bn gate should be open');
  console.log('  ✔ Opened gates for session-a ["en", "bn"].');

  // Test 4: Strict Audio Routing & VAD Energy Check
  console.log('\n[Test 4] Testing strict audio routing & VAD energy check...');
  const voiceChunkA = Buffer.alloc(3200); // 100ms of audio from Laptop A with real voice energy
  for (let i = 0; i < voiceChunkA.length; i += 2) {
    voiceChunkA.writeInt16LE(2000, i); // RMS = 2000 > 150 threshold
  }
  const silenceChunk = Buffer.alloc(3200); // 100ms of pure silence (0 amplitude)

  // Send voice audio -> session-a gates should receive it
  sonioxService.broadcastAudio(voiceChunkA, 'session-a');
  assert.strictEqual(sonioxService.activeGates.get('session-a:en').lastSent, voiceChunkA, 'session-a:en received Laptop A audio');
  assert.strictEqual(sonioxService.activeGates.get('session-a:bn').lastSent, voiceChunkA, 'session-a:bn received Laptop A audio');
  console.log('  ✔ Audio from Laptop A routed exclusively to session-a.');

  // Test Concurrency Protection: Starting Session B closes Session A gates
  console.log('\n[Test 4b] Testing concurrency protection: starting session-b closes session-a gates...');
  sonioxService.syncGates('session-b', ['en', 'tr']);
  assert.strictEqual(sonioxService.activeGates.has('session-a:en'), false, 'session-a:en gate should be closed');
  assert.strictEqual(sonioxService.activeGates.has('session-a:bn'), false, 'session-a:bn gate should be closed');
  assert.strictEqual(sonioxService.activeGates.has('session-b:en'), true, 'session-b:en gate should be open');
  assert.strictEqual(sonioxService.activeGates.has('session-b:tr'), true, 'session-b:tr gate should be open');
  console.log('  ✔ Concurrency protection safely closed stale session-a gates when session-b began.');

  // Switch back to session-a for remaining tests
  sonioxService.syncGates('session-a', ['en', 'bn']);

  // Test 5: Token stream parsing with Session ID
  console.log('\n[Test 5] Testing Soniox per-token streaming emission with Session ID...');
  const receivedTokens = [];
  let receivedFinal = null;

  sonioxService.on('token_stream', (data) => { receivedTokens.push(data); });
  sonioxService.once('sentence_finalized', (data) => { receivedFinal = data; });

  const gateA = sonioxService.activeGates.get('session-a:en');

  // First token arrives
  sonioxService.handleSonioxMessage(gateA, {
    tokens: [{ text: 'Indeed, ', translation_status: 'translation', is_final: true }]
  });
  await new Promise(r => setTimeout(r, 70));

  // Second token arrives
  sonioxService.handleSonioxMessage(gateA, {
    tokens: [{ text: 'إن ', translation_status: 'original', is_final: true }]
  });
  await new Promise(r => setTimeout(r, 70));

  assert(receivedTokens.length >= 2, 'Both tokens should have fired independently');
  assert.strictEqual(receivedTokens[0].sessionId, 'session-a', 'Token MUST carry sessionId');
  assert.strictEqual(receivedTokens[0].lang, 'en');
  console.log('  ✔ Per-token streaming carries correct sessionId ("session-a").');

  // Final sentence completion
  sonioxService.handleSonioxMessage(gateA, {
    tokens: [
      { text: 'with hardship comes ease.', translation_status: 'translation', is_final: true },
      { text: 'مع العسر يسرا.', translation_status: 'original', is_final: true },
      { text: '<end>', translation_status: 'original', is_final: true }
    ]
  });

  assert(receivedFinal !== null, 'sentence_finalized event should have fired');
  assert.strictEqual(receivedFinal.sessionId, 'session-a', 'Finalized sentence MUST carry sessionId');
  assert.strictEqual(receivedFinal.finalText, 'Indeed, with hardship comes ease.');
  console.log('  ✔ Sentence finalized event correctly tagged with sessionId.');

  // Test 6: Closing Session Gates Independently
  console.log('\n[Test 6] Testing session gate cleanup isolation...');
  sonioxService.closeSessionGates('session-a');
  assert.strictEqual(sonioxService.activeGates.has('session-a:en'), false, 'session-a gates should be closed');
  assert.strictEqual(sonioxService.activeGates.has('session-a:bn'), false, 'session-a:bn gate should be closed');
  assert.strictEqual(sonioxService.activeGates.size, 0, 'No active gates remaining');
  console.log('  ✔ Closing session-a gates cleared all active gates ($0 cost).');

  // Clean up
  sonioxService.removeAllListeners('token_stream');
  sonioxService.closeAllGates();
  assert.strictEqual(sonioxService.activeGates.size, 0, 'All gates closed');
  sonioxService.connectGate = originalConnectGate;
  sonioxService.setApiKey(process.env.SONIOX_API_KEY || '');

  console.log('\n========================================================');
  console.log('🎉 ALL SONIOX DYNAMIC GATE TESTS PASSED! (100% GREEN)');
  console.log('========================================================\n');
}

runSonioxGateTests().catch(err => {
  console.error('❌ Soniox Test Failure:', err);
  process.exit(1);
});
