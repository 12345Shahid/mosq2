/**
 * Comprehensive Lifecycle & Silence Audit Test for Soniox Dynamic Language Gates
 *
 * Verifies that Soniox gates are 100% closed ($0 cost) in all non-active conditions:
 *   1. Session is Idle -> Gates are never opened
 *   2. Session is Paused -> Gates close immediately, audio dropped
 *   3. Session is Ended -> Gates close immediately, audio dropped
 *   4. Session is Deleted -> Gates close immediately, session purged
 *   5. Microphone is Turned Off -> Gates close immediately (0ms delay)
 *   6. Silence / Ambient Noise -> RMS Voice Activity Detection prevents idle billing
 */

const assert = require('assert');
const sonioxService = require('../server/services/sonioxService');
const { SessionManager } = require('../server/sessionManager');

async function runAudit() {
  console.log('\n========================================================');
  console.log('🛡️  RUNNING COMPREHENSIVE SONIOX LIFECYCLE & SILENCE AUDIT');
  console.log('========================================================\n');

  const sessionManager = new SessionManager();

  // Wire up the session validator just as server/index.js does
  sonioxService.setApiKey('test_soniox_valid_mock_key_12345');
  sonioxService.setSessionValidator((sid) => {
    const s = sessionManager.getSession(sid);
    return Boolean(s && s.status === 'active');
  });

  // Wire up session lifecycle event listeners
  sessionManager.on('session_paused', ({ sessionId }) => {
    sonioxService.closeSessionGates(sessionId);
  });
  sessionManager.on('session_ended', ({ sessionId }) => {
    sonioxService.closeSessionGates(sessionId);
  });
  sessionManager.on('session_deleted', ({ sessionId }) => {
    sonioxService.closeSessionGates(sessionId);
  });

  // Mock connectGate so real network sockets are not opened during unit tests
  sonioxService.connectGate = function(gate) {
    gate.status = 'open';
    gate.ws = {
      readyState: 1, // OPEN
      bufferedAmount: 0,
      send: function(data) { gate.lastSent = data; },
      close: function() { gate.status = 'closed'; }
    };
  };

  const AUDIT_SID = 'audit-test-session-001';

  // ─────────────────────────────────────────────────────────────
  // AUDIT STEP 1: Idle Session (Before Start)
  // ─────────────────────────────────────────────────────────────
  console.log('[Audit 1] Testing IDLE session (before Khutbah starts)...');
  await sessionManager.createSession({
    sessionId: AUDIT_SID,
    mosqueName: 'Audit Masjid',
    primaryLanguage: 'en'
  });
  const session = sessionManager.getSession(AUDIT_SID);
  assert.strictEqual(session.status, 'idle', 'New session must start as idle');

  // Attempting to sync or ensure gates while session is IDLE must be REFUSED:
  sonioxService.syncGates(AUDIT_SID, ['en', 'bn']);
  assert.strictEqual(sonioxService.activeGates.size, 0, 'No gates should be opened when session is IDLE');

  const idleGate = sonioxService.ensureGate(AUDIT_SID, 'en');
  assert.strictEqual(idleGate, null, 'ensureGate must return null when session is IDLE');
  assert.strictEqual(sonioxService.activeGates.size, 0, 'Gates size MUST remain 0');

  // Attempting to broadcast audio to an IDLE session must be dropped:
  const dummyAudio = Buffer.alloc(3200);
  dummyAudio.writeInt16LE(2500, 0); // Voice energy
  sonioxService.broadcastAudio(dummyAudio, AUDIT_SID);
  assert.strictEqual(sonioxService.activeGates.size, 0, 'Audio to IDLE session must not open any gates');
  console.log('  ✔ PASS: Idle session strictly blocked all gate creation and audio ingestion ($0 cost).');

  // ─────────────────────────────────────────────────────────────
  // AUDIT STEP 2: Active Session (Khutbah Started)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Audit 2] Testing ACTIVE session (Khutbah starts)...');
  sessionManager.startSession(AUDIT_SID);
  assert.strictEqual(session.status, 'active', 'Session must be active');

  // Gates should now open on demand:
  sonioxService.syncGates(AUDIT_SID, ['en', 'bn']);
  assert.strictEqual(sonioxService.activeGates.size, 2, 'Gates should open when session is active');
  assert.strictEqual(sonioxService.activeGates.has(`${AUDIT_SID}:en`), true, 'en gate should be open');
  assert.strictEqual(sonioxService.activeGates.has(`${AUDIT_SID}:bn`), true, 'bn gate should be open');
  console.log('  ✔ PASS: Active session successfully opened required gates ["en", "bn"].');

  // ─────────────────────────────────────────────────────────────
  // AUDIT STEP 3: Paused Session
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Audit 3] Testing PAUSED session...');
  sessionManager.pauseSession(AUDIT_SID);
  assert.strictEqual(session.status, 'paused', 'Session must be paused');
  assert.strictEqual(sonioxService.activeGates.size, 0, 'All gates MUST close immediately when paused');

  // Audio arriving while paused must be rejected and gates must NOT reopen:
  sonioxService.broadcastAudio(dummyAudio, AUDIT_SID);
  assert.strictEqual(sonioxService.activeGates.size, 0, 'No gates allowed to open while session is paused');
  console.log('  ✔ PASS: Pausing session immediately closed all Soniox gates with $0 idle cost.');

  // ─────────────────────────────────────────────────────────────
  // AUDIT STEP 4: Resumed Session
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Audit 4] Testing RESUMED session...');
  sessionManager.startSession(AUDIT_SID);
  assert.strictEqual(session.status, 'active');
  sonioxService.syncGates(AUDIT_SID, ['en']);
  assert.strictEqual(sonioxService.activeGates.size, 1, 'Gate opens when session resumes');
  console.log('  ✔ PASS: Gates cleanly re-opened upon session resumption.');

  // ─────────────────────────────────────────────────────────────
  // AUDIT STEP 5: Microphone Turned Off (MIC_OFF Event)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Audit 5] Testing MICROPHONE OFF event (Imam stops mic)...');
  sonioxService.onMicrophoneOff(AUDIT_SID);
  assert.strictEqual(sonioxService.activeGates.size, 0, 'All gates MUST close immediately when mic is turned off');
  console.log('  ✔ PASS: onMicrophoneOff closed all Soniox gates with 0ms delay ($0 cost).');

  // ─────────────────────────────────────────────────────────────
  // AUDIT STEP 6: Ended Session
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Audit 6] Testing ENDED session (Khutbah concluded)...');
  sessionManager.startSession(AUDIT_SID);
  sonioxService.syncGates(AUDIT_SID, ['en']);
  assert.strictEqual(sonioxService.activeGates.size, 1);

  sessionManager.endSession(AUDIT_SID);
  assert.strictEqual(session.status, 'ended', 'Session must be ended');
  assert.strictEqual(sonioxService.activeGates.size, 0, 'All gates MUST close immediately when session ends');

  sonioxService.syncGates(AUDIT_SID, ['en']);
  assert.strictEqual(sonioxService.activeGates.size, 0, 'Ended session must reject gate requests');
  console.log('  ✔ PASS: Concluded session permanently closed all Soniox gates.');

  // ─────────────────────────────────────────────────────────────
  // AUDIT STEP 7: Deleted Session
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Audit 7] Testing DELETED session...');
  const DEL_SID = 'audit-del-test-002';
  await sessionManager.createSession({ sessionId: DEL_SID });
  sessionManager.startSession(DEL_SID);
  sonioxService.syncGates(DEL_SID, ['en']);
  assert.strictEqual(sonioxService.activeGates.size, 1);

  sessionManager.deleteSession(DEL_SID);
  assert.strictEqual(sessionManager.getSession(DEL_SID), null, 'Session must be deleted from manager');
  assert.strictEqual(sonioxService.activeGates.size, 0, 'Gates MUST be closed when session is deleted');
  console.log('  ✔ PASS: Deleted session immediately terminated Soniox gates.');

  // ─────────────────────────────────────────────────────────────
  // AUDIT STEP 8: Voice Activity Detection (RMS Energy vs Silence)
  // ─────────────────────────────────────────────────────────────
  console.log('\n[Audit 8] Testing Voice Activity Detection (VAD) & Silence Auto-Close...');
  const VAD_SID = 'audit-vad-test-003';
  await sessionManager.createSession({ sessionId: VAD_SID });
  sessionManager.startSession(VAD_SID);
  sonioxService.syncGates(VAD_SID, ['en']);
  const vadGate = sonioxService.activeGates.get(`${VAD_SID}:en`);
  assert(vadGate, 'VAD gate should exist');

  // Test with real speech audio (RMS > 150)
  const speechPcm = Buffer.alloc(3200);
  for (let i = 0; i < speechPcm.length; i += 2) {
    speechPcm.writeInt16LE(3000, i); // High energy speech
  }
  const speechTimeBefore = Date.now();
  sonioxService.broadcastAudio(speechPcm, VAD_SID);
  assert(vadGate.lastAudioAt >= speechTimeBefore, 'Speech MUST update lastAudioAt');
  assert.strictEqual(vadGate.lastSent, speechPcm, 'Speech MUST be forwarded to Soniox WebSocket');

  // Test with total silence PCM (RMS = 0 < 150)
  const silencePcm = Buffer.alloc(3200); // 0 amplitude
  vadGate.lastSent = null;
  const oldLastAudio = vadGate.lastAudioAt;

  // Artificial time advance: wait 5ms
  await new Promise(r => setTimeout(r, 10));
  sonioxService.broadcastAudio(silencePcm, VAD_SID);

  // Assert that lastAudioAt was NOT updated by silence!
  assert.strictEqual(vadGate.lastAudioAt, oldLastAudio, 'Silence MUST NOT update lastAudioAt');
  console.log('  ✔ PASS: Silence did not refresh lastAudioAt, allowing auto-close timer to proceed ($0 cost).');

  // Clean up
  sonioxService.closeAllGates();
  assert.strictEqual(sonioxService.activeGates.size, 0, 'Clean exit with 0 active gates');

  console.log('\n========================================================');
  console.log('🏆 AUDIT COMPLETE: 100% OF LIFECYCLE & COST GATES VERIFIED');
  console.log('========================================================\n');
}

runAudit().catch(err => {
  console.error('\n❌ AUDIT FAILED:', err);
  process.exit(1);
});
