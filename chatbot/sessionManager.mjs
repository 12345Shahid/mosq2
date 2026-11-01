import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSIONS_DIR = path.resolve(__dirname, 'sessions');

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

export function listSessions() {
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  const sessions = [];

  for (const file of files) {
    try {
      const filePath = path.join(SESSIONS_DIR, file);
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      sessions.push({
        id: data.id || file.replace('.json', ''),
        title: data.title || 'Untitled Session',
        model: data.model || 'anthropic/claude-opus-5.5',
        createdAt: data.createdAt,
        updatedAt: data.updatedAt || data.createdAt,
        messageCount: (data.messages || []).length,
        filePath
      });
    } catch (_) {}
  }

  // Sort newest first
  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return sessions;
}

export function createSession(title = 'New Codebase Chat', model = 'anthropic/claude-opus-5.5') {
  const id = `session-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const session = {
    id,
    title,
    model,
    createdAt: now,
    updatedAt: now,
    messages: []
  };

  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
  return session;
}

export function loadSession(sessionId) {
  const safeId = path.basename(sessionId).replace('.json', '');
  const filePath = path.join(SESSIONS_DIR, `${safeId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

export function saveSession(session) {
  if (!session || !session.id) return;
  session.updatedAt = new Date().toISOString();

  // Auto-generate title if still default and there's a user message
  if (session.title === 'New Codebase Chat' && session.messages.length > 0) {
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    if (firstUserMsg && firstUserMsg.content) {
      session.title = firstUserMsg.content.slice(0, 48).trim().replace(/[\n\r]+/g, ' ');
    }
  }

  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
}

export function deleteSession(sessionId) {
  const safeId = path.basename(sessionId).replace('.json', '');
  const filePath = path.join(SESSIONS_DIR, `${safeId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}
