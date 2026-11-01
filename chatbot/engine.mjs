import fs from 'node:fs';
import path from 'node:path';
import { readFileContent, searchCodebase, listDirectory, getTree, ROOT_DIR } from './tools.mjs';
import { saveSession } from './sessionManager.mjs';

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://127.0.0.1:4000/v1';

export const SYSTEM_PROMPT = `You are the Principal Architect & Senior Full-Stack Engineer for Mishkah AI (a real-time mosque translation & transcription system).
You are running as a persistent codebase chatbot inside the local repository.

YOU HAVE FULL ACCESS TO ALL REPOSITORY FILES WITHOUT TRUNCATION OR LINE LIMITS.
You can inspect files in their entirety (including all lines of display.js, join.js, sessionManager.js, sonioxService.js, etc.).

When answering questions:
- Be thorough, highly technical, and precise.
- Reference exact line numbers and function names.
- If you need to view more files or search the codebase, you can invoke tools by outputting:
  \`TOOL_CALL: read_file <file_path> [startLine] [endLine]\`
  \`TOOL_CALL: search <query>\`
  \`TOOL_CALL: list_dir <dir_path>\`
  \`TOOL_CALL: tree\`
- You can read entire files of any length. Never assume code without verifying.
- Brand name is strictly Mishkah AI.`;

/**
 * Detect file paths in text to proactively load full file contexts
 */
export function detectReferencedFiles(text) {
  const words = text.split(/[\s,;:()[\]"']+/);
  const found = new Set();

  for (const word of words) {
    if (!word || word.length < 3) continue;
    // Check common repo paths
    const candidates = [
      word,
      path.join('public', word),
      path.join('server', word),
      path.join('server', 'services', word)
    ];

    for (const c of candidates) {
      const full = path.resolve(ROOT_DIR, c);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        found.add(path.relative(ROOT_DIR, full));
        break;
      }
    }
  }

  return Array.from(found);
}

/**
 * Execute a tool command
 */
export function executeTool(command) {
  const parts = command.trim().split(/\s+/);
  const tool = parts[0]?.toLowerCase();

  if (tool === 'read_file' || tool === 'read') {
    const filePath = parts[1];
    const start = parts[2] ? parseInt(parts[2], 10) : null;
    const end = parts[3] ? parseInt(parts[3], 10) : null;
    const res = readFileContent(filePath, start, end);
    if (res.error) return `Error: ${res.error}`;
    return `### [Full Content of ${res.filePath} (${res.startLine}-${res.endLine} of ${res.totalLines} lines)]:\n\`\`\`\n${res.content}\n\`\`\``;
  }

  if (tool === 'search' || tool === 'grep') {
    const query = parts.slice(1).join(' ');
    const res = searchCodebase(query);
    if (res.matches.length === 0) return `No matches found for "${query}"`;
    return `### Matches for "${query}" (${res.shown} of ${res.totalFound}):\n` +
      res.matches.map(m => `- ${m.file}:${m.line} -> ${m.snippet}`).join('\n');
  }

  if (tool === 'list_dir' || tool === 'ls') {
    const dir = parts[1] || '.';
    const res = listDirectory(dir);
    if (res.error) return `Error: ${res.error}`;
    return `Directory ${res.directory}:\n` + res.entries.map(e => `${e.isDirectory ? '[DIR] ' : '      '}${e.name}`).join('\n');
  }

  if (tool === 'tree') {
    return getTree();
  }

  return `Unknown tool: ${tool}`;
}

/**
 * Send chat query, execute tools if needed, stream output, and persist to session.
 */
export async function askCodebaseAgent({
  session,
  userMessage,
  model = null,
  onToken = () => {},
  onToolCall = () => {}
}) {
  const activeModel = model || session.model || 'anthropic/claude-opus-5.5';
  session.model = activeModel;

  // Auto-detect any files mentioned by user and supply their complete full content
  const referencedFiles = detectReferencedFiles(userMessage);
  let preloadedContext = '';

  if (referencedFiles.length > 0) {
    onToolCall({ tool: 'preload', files: referencedFiles });
    const docs = [];
    for (const f of referencedFiles) {
      const readRes = readFileContent(f);
      if (!readRes.error) {
        docs.push(`### Complete File: ${readRes.filePath} (Full ${readRes.totalLines} lines):\n\`\`\`\n${readRes.content}\n\`\`\``);
      }
    }
    if (docs.length > 0) {
      preloadedContext = `\n\n[CONTEXT: Automatically loaded full files from codebase]:\n\n${docs.join('\n\n')}`;
    }
  }

  const enhancedUserMessage = userMessage + preloadedContext;

  // Add user message to session
  session.messages.push({
    role: 'user',
    content: userMessage,
    timestamp: new Date().toISOString()
  });

  // Prepare OpenAI message history for bridge
  const conversationMessages = [
    { role: 'system', content: SYSTEM_PROMPT }
  ];

  // Include past messages from session (up to last 20 for context balance)
  const pastMessages = session.messages.slice(-20);
  for (let i = 0; i < pastMessages.length; i++) {
    const msg = pastMessages[i];
    // If it is the last message (current user query), include preloaded context
    if (i === pastMessages.length - 1 && msg.role === 'user') {
      conversationMessages.push({ role: 'user', content: enhancedUserMessage });
    } else {
      conversationMessages.push({ role: msg.role, content: msg.content });
    }
  }

  let finalAssistantResponse = '';
  let maxToolRounds = 3;

  while (maxToolRounds > 0) {
    maxToolRounds--;

    // Stream from local bridge
    const res = await fetch(`${BRIDGE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: activeModel,
        messages: conversationMessages,
        stream: true,
        max_tokens: 4096
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Bridge error (${res.status}): ${err}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let currentRoundText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const raw = decoder.decode(value);
      for (const line of raw.split('\n')) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              currentRoundText += delta;
              onToken(delta);
            }
          } catch (_) {}
        }
      }
    }

    // Check if assistant called a tool
    const toolCallMatch = currentRoundText.match(/TOOL_CALL:\s*([^\n\r]+)/);
    if (toolCallMatch) {
      const toolCmd = toolCallMatch[1].trim();
      onToolCall({ tool: toolCmd });
      const toolResult = executeTool(toolCmd);

      // Append assistant's round and tool result back to conversation
      conversationMessages.push({ role: 'assistant', content: currentRoundText });
      conversationMessages.push({ role: 'user', content: `[TOOL_RESULT for ${toolCmd}]:\n${toolResult}` });
      // Continue loop to let model synthesize answer with tool output
      continue;
    }

    finalAssistantResponse = currentRoundText;
    break;
  }

  // Record assistant response in session
  session.messages.push({
    role: 'assistant',
    content: finalAssistantResponse,
    timestamp: new Date().toISOString()
  });

  saveSession(session);
  return finalAssistantResponse;
}
