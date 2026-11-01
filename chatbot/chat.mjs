#!/usr/bin/env node
import readline from 'node:readline';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSessions, createSession, loadSession } from './sessionManager.mjs';
import { askCodebaseAgent, executeTool } from './engine.mjs';
import { ROOT_DIR } from './tools.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI Color Helpers
const cyan = text => `\x1b[36m${text}\x1b[0m`;
const green = text => `\x1b[32m${text}\x1b[0m`;
const yellow = text => `\x1b[33m${text}\x1b[0m`;
const magenta = text => `\x1b[35m${text}\x1b[0m`;
const dim = text => `\x1b[2m${text}\x1b[0m`;
const bold = text => `\x1b[1m${text}\x1b[0m`;

const args = process.argv.slice(2);

// Check if user requested Web UI
if (args.includes('--web')) {
  console.log(cyan('\n🌐 Launching Mishkah Codebase Chatbot Web UI...\n'));
  const webServerPath = path.join(__dirname, 'web', 'server.mjs');
  const child = fork(webServerPath, [], { stdio: 'inherit' });
  child.on('exit', code => process.exit(code || 0));
} else {
  runCli();
}

async function runCli() {
  console.log(bold(cyan(`\n======================================================`)));
  console.log(bold(cyan(`🤖 Mishkah AI Persistent Codebase Chatbot`)));
  console.log(dim(`   Full-file visibility · Zero line cutoffs · Claude Opus 5.5`));
  console.log(bold(cyan(`======================================================\n`)));

  // Check if --list requested
  if (args.includes('--list')) {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log(dim('No saved sessions found.'));
    } else {
      console.log(yellow('Saved Sessions:'));
      sessions.forEach((s, idx) => {
        console.log(` [${idx + 1}] ${bold(s.title)} (${dim(s.id)}) - ${s.messageCount} msgs [${s.updatedAt}]`);
      });
    }
    process.exit(0);
  }

  // Determine active session
  let session = null;
  const sessionArgIdx = args.indexOf('--session');
  if (sessionArgIdx !== -1 && args[sessionArgIdx + 1]) {
    session = loadSession(args[sessionArgIdx + 1]);
    if (!session) {
      console.log(yellow(`Session "${args[sessionArgIdx + 1]}" not found. Creating new session.`));
      session = createSession('New Chat', 'anthropic/claude-opus-5.5');
    }
  } else if (args.includes('--new')) {
    session = createSession('New Chat', 'anthropic/claude-opus-5.5');
  }

  // Check for one-shot query from CLI: node chatbot/chat.mjs "How does X work?"
  const nonFlagArgs = args.filter(a => !a.startsWith('--') && (sessionArgIdx === -1 || a !== args[sessionArgIdx + 1]));
  if (nonFlagArgs.length > 0 && !session) {
    session = createSession('CLI Query', 'anthropic/claude-opus-5.5');
    const query = nonFlagArgs.join(' ');
    console.log(green(`\nUser: `) + query + '\n');
    process.stdout.write(cyan('Claude Opus 5.5: '));
    try {
      await askCodebaseAgent({
        session,
        userMessage: query,
        onToken: t => process.stdout.write(t),
        onToolCall: tc => {
          if (tc.tool === 'preload') {
            console.log(dim(`\n[📖 Auto-loaded full file: ${tc.files.join(', ')}]`));
          } else {
            console.log(dim(`\n[🔧 Tool Executing: ${tc.tool}]`));
          }
        }
      });
      console.log('\n');
    } catch (e) {
      console.error(yellow(`\nError: ${e.message}\n`));
    }
    process.exit(0);
  }

  // Interactive session selector if no session chosen yet
  if (!session) {
    const existingSessions = listSessions();
    if (existingSessions.length > 0) {
      console.log(yellow('Recent Sessions:'));
      existingSessions.slice(0, 5).forEach((s, i) => {
        console.log(`  ${bold(`[${i + 1}]`)} ${s.title} ${dim(`(${s.messageCount} messages · ${new Date(s.updatedAt).toLocaleTimeString()})`)}`);
      });
      console.log(`  ${bold('[n]')} Start a brand new session\n`);

      const rlPrompt = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise(res => rlPrompt.question(cyan(`Choose session [1-${Math.min(5, existingSessions.length)} or Enter for 1, or n]: `), res));
      rlPrompt.close();

      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'n' || trimmed === 'new') {
        session = createSession('New Chat', 'anthropic/claude-opus-5.5');
      } else {
        const choiceIdx = trimmed ? parseInt(trimmed, 10) - 1 : 0;
        if (!isNaN(choiceIdx) && existingSessions[choiceIdx]) {
          session = loadSession(existingSessions[choiceIdx].id);
        } else {
          session = createSession('New Chat', 'anthropic/claude-opus-5.5');
        }
      }
    } else {
      session = createSession('New Chat', 'anthropic/claude-opus-5.5');
    }
  }

  console.log(`\n${green('✓ Active Session:')} ${bold(session.title)} ${dim(`[${session.id}]`)}`);
  console.log(dim(`Commands: /sessions, /new, /resume <id>, /read <file>, /search <query>, /tree, /exit\n`));

  // If session has past messages, show last few
  if (session.messages.length > 0) {
    console.log(dim(`--- Past Conversation (${session.messages.length} messages) ---`));
    session.messages.slice(-4).forEach(m => {
      const prefix = m.role === 'user' ? green('User: ') : cyan('Claude Opus: ');
      const preview = m.content.length > 180 ? m.content.slice(0, 180) + '...' : m.content;
      console.log(prefix + preview);
    });
    console.log(dim(`-----------------------------------------------\n`));
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: bold(green('You > '))
  });

  rl.prompt();

  rl.on('line', async line => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Slash Commands
    if (input.startsWith('/')) {
      const parts = input.slice(1).split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ');

      if (cmd === 'exit' || cmd === 'quit') {
        console.log(dim('Session saved. Goodbye!'));
        process.exit(0);
      }

      if (cmd === 'new') {
        session = createSession('New Chat', session.model || 'anthropic/claude-opus-5.5');
        console.log(green(`\n✓ Started new session: ${session.id}\n`));
        rl.prompt();
        return;
      }

      if (cmd === 'sessions') {
        const list = listSessions();
        console.log(yellow('\nSaved Sessions:'));
        list.forEach(s => console.log(` - ${bold(s.id)}: "${s.title}" (${s.messageCount} msgs, updated: ${s.updatedAt})`));
        console.log('');
        rl.prompt();
        return;
      }

      if (cmd === 'resume') {
        const target = loadSession(arg);
        if (target) {
          session = target;
          console.log(green(`\n✓ Resumed session: ${session.title} [${session.id}]\n`));
        } else {
          console.log(yellow(`\nSession "${arg}" not found.\n`));
        }
        rl.prompt();
        return;
      }

      if (cmd === 'read') {
        const out = executeTool(`read_file ${arg}`);
        console.log(`\n${out}\n`);
        rl.prompt();
        return;
      }

      if (cmd === 'search' || cmd === 'grep') {
        const out = executeTool(`search ${arg}`);
        console.log(`\n${out}\n`);
        rl.prompt();
        return;
      }

      if (cmd === 'tree') {
        console.log(`\n${executeTool('tree')}\n`);
        rl.prompt();
        return;
      }

      if (cmd === 'clear') {
        console.clear();
        rl.prompt();
        return;
      }

      if (cmd === 'help') {
        console.log(cyan('\nAvailable Commands:'));
        console.log('  /new                 Start a new session');
        console.log('  /sessions            List all persistent sessions');
        console.log('  /resume <id>         Resume a past session by ID');
        console.log('  /read <file> [s] [e] Read full file or line slice');
        console.log('  /search <term>       Search codebase for text or regex');
        console.log('  /tree                Show codebase tree');
        console.log('  /clear               Clear terminal');
        console.log('  /exit                Save and exit\n');
        rl.prompt();
        return;
      }

      console.log(yellow(`Unknown command /${cmd}. Type /help for available commands.`));
      rl.prompt();
      return;
    }

    // Normal chat message
    process.stdout.write(bold(cyan('\nClaude Opus 5.5: ')));
    try {
      await askCodebaseAgent({
        session,
        userMessage: input,
        onToken: token => process.stdout.write(token),
        onToolCall: tc => {
          if (tc.tool === 'preload') {
            process.stdout.write(dim(`\n[📖 Inspected full file: ${tc.files.join(', ')}]\n`));
          } else {
            process.stdout.write(dim(`\n[🔧 Running: ${tc.tool}]\n`));
          }
        }
      });
      console.log('\n');
    } catch (err) {
      console.error(yellow(`\n[Error]: ${err.message}\n`));
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(dim('\nChat session saved. Exiting.'));
    process.exit(0);
  });
}
