#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSessions, createSession, loadSession, deleteSession, saveSession } from '../sessionManager.mjs';
import { askCodebaseAgent } from '../engine.mjs';
import { readFileContent, listDirectory, getTree, ROOT_DIR } from '../tools.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = parseInt(process.env.CHAT_WEB_PORT || '4005', 10);
const HOST = process.env.CHAT_WEB_HOST || '127.0.0.1';

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }

  // 1. GET /api/sessions
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    return sendJson(res, 200, listSessions());
  }

  // 2. POST /api/sessions (Create new session)
  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const session = createSession(parsed.title || 'New Codebase Chat', parsed.model || 'anthropic/claude-opus-5.5');
        return sendJson(res, 201, session);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    });
    return;
  }

  // 3. GET /api/sessions/:id
  if (req.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
    const id = url.pathname.replace('/api/sessions/', '');
    const session = loadSession(id);
    if (!session) return sendJson(res, 404, { error: 'Session not found' });
    return sendJson(res, 200, session);
  }

  // 4. DELETE /api/sessions/:id
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
    const id = url.pathname.replace('/api/sessions/', '');
    const ok = deleteSession(id);
    return sendJson(res, ok ? 200 : 404, { success: ok });
  }

  // 5. POST /api/chat (Streaming SSE response)
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { sessionId, message, model } = JSON.parse(body || '{}');
        let session = sessionId ? loadSession(sessionId) : null;
        if (!session) {
          session = createSession('New Chat', model || 'anthropic/claude-opus-5.5');
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });

        // Send initial metadata
        res.write(`event: session\ndata: ${JSON.stringify({ sessionId: session.id, title: session.title })}\n\n`);

        await askCodebaseAgent({
          session,
          userMessage: message,
          model,
          onToken: token => {
            res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
          },
          onToolCall: tc => {
            res.write(`event: tool\ndata: ${JSON.stringify(tc)}\n\n`);
          }
        });

        res.write(`event: done\ndata: ${JSON.stringify({ sessionId: session.id, title: session.title })}\n\n`);
        res.end();
      } catch (err) {
        console.error('[Web Chat Error]', err);
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      }
    });
    return;
  }

  // 6. GET /api/files (Explore repository files)
  if (req.method === 'GET' && url.pathname === '/api/files') {
    const dir = url.searchParams.get('dir') || '.';
    return sendJson(res, 200, listDirectory(dir));
  }

  // 7. GET /api/file-content (View complete file)
  if (req.method === 'GET' && url.pathname === '/api/file-content') {
    const filePath = url.searchParams.get('path');
    if (!filePath) return sendJson(res, 400, { error: 'Path is required' });
    const content = readFileContent(filePath);
    return sendJson(res, 200, content);
  }

  // 8. Serve static Web UI
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  try {
    const fileData = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(fileData);
  } catch (_) {
    sendJson(res, 404, { error: 'Not found' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`🌐 Mishkah Persistent Codebase Chatbot Web UI is LIVE`);
  console.log(`📡 URL: http://${HOST}:${PORT}`);
  console.log(`📂 Codebase Root: ${ROOT_DIR}`);
  console.log(`======================================================\n`);
});
