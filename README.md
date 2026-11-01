# Mishkah AI (MosqAI) v2.0

> **Real-Time Khutbah Translation, Smart TV Dual-Engine Display, and Zero-Cost Low-Latency Audio Streaming**

---

## 🌟 Overview

Mishkah AI (MosqAI) is an open, high-performance platform engineered for mosques and Islamic centers to broadcast live khutbahs, sermons, and lectures with real-time translation across 10+ languages simultaneously.

### Key Capabilities in v2.0:
1. **Smart TV Zero-Config Auto-Discovery:**
   - Smart TVs simply browse to `/tv` or `/display`.
   - The TV automatically detects the active live session without needing URL parameters or manual TV remote typing.
   - If the sermon has not yet begun, a clean waiting banner displays; the TV automatically switches to live subtitle streaming the moment the sermon starts.
2. **Pure ES5 TV WebView Engine:**
   - 100% compliant with legacy Smart TV JavaScript parsers (Samsung Tizen 2.4–6.5, LG webOS 3.0–6.0, Android TV).
   - Independent dual-engine architecture: WebSocket streaming + low-latency delta HTTP feed sync with an 8-second watchdog.
3. **Soniox Dynamic Language Gates (Zero-Cost Idle Protection):**
   - Active language gates are only opened for requested languages while a session is actively running.
   - Built-in Voice Activity Detection (VAD) via RMS audio energy calculation ensures silence does not reset the 12-second auto-close timer.
   - Instant 0ms closure on microphone-off, session pause, session end, and session delete ($0 idle cost guarantee).
4. **Mobile Attendee Experience:**
   - Attendees scan a QR code or visit `/join.html` on their smartphones.
   - Listen via earbuds with low-latency synthesized speech in their chosen native language.
   - Instant language switching with sticky room activation and retroactive translation history backfill.

---

## 🚀 Quick Start

### 1. Installation
```bash
git clone https://github.com/12345Shahid/mosq2.git
cd mosq2
npm install
```

### 2. Environment Setup
Create a `.env` file in the root directory:
```env
PORT=3000
DEFAULT_MASJID_NAME="Masjid Al-Noor"
DEFAULT_PRIMARY_LANGUAGE="en"

# Provider Keys (configured as needed)
SONIOX_API_KEY=your_soniox_key
OPENROUTER_API_KEY=your_openrouter_key
DEEPL_API_KEY=your_deepl_key
CARTESIA_API_KEY=your_cartesia_key
GLADIA_API_KEYS=your_gladia_keys
```

### 3. Run Server
```bash
npm start
```

Visit:
- **Admin Control Panel:** `http://localhost:3000/admin.html`
- **Smart TV Live Display:** `http://localhost:3000/tv` or `http://localhost:3000/display`
- **Mobile Attendee View:** `http://localhost:3000/join.html`

---

## 🧪 Automated Test Suites

```bash
# Verify strict ES5 compliance for legacy TV browsers
node test/es5_syntax_test.js

# Verify Smart TV HTTP vanity routes & delta polling
node test/tv_server_routes_test.js

# Verify Smart TV E2E logic & session auto-discovery
node test/tv_display_e2e_test.js

# Verify Soniox dynamic language gates & concurrency
node test/soniox_gate_test.js

# Verify Soniox lifecycle audit & silence auto-close ($0 idle cost)
node test/soniox_lifecycle_audit_test.js

# Verify autonomous full pipeline E2E test
node test/autonomous_e2e_test.js
```

---

## 📄 License
MIT License. Created for the global Muslim community by Mishkah AI.
