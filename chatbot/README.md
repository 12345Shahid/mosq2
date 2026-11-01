# Mishkah AI — Persistent Codebase Chatbot

A dedicated codebase assistant powered by **Claude Opus 5.5** (and other Replicate models) featuring:
- **Zero Line Cutoffs**: Full visibility over every file in the repository (e.g. all 1,242 lines of `display.js`, all 899 lines of `join.js`, all 806 lines of `sessionManager.js`, etc.).
- **Autonomous Tools**: Automatic full-file preloading, regex codebase searching (`searchCodebase`), directory tree inspection, and line slicing.
- **Persistent Sessions**: All conversations are stored on disk in `chatbot/sessions/` as JSON files. Resume conversations anytime without losing context.
- **Dual Interfaces**: Both an interactive terminal CLI and a modern Web UI.

---

## Quick Start

### 1. Interactive Terminal CLI
```bash
npm run chat
```
Or run directly:
```bash
node chatbot/chat.mjs
```

#### CLI Options & Commands
- **Resume most recent session**: Simply press `Enter` on startup.
- **Start a new session**: Press `n` on startup, or use:
  ```bash
  node chatbot/chat.mjs --new
  ```
- **List all saved sessions**:
  ```bash
  npm run chat -- --list
  ```
- **Resume specific session**:
  ```bash
  node chatbot/chat.mjs --session <sessionId>
  ```
- **One-shot question**:
  ```bash
  node chatbot/chat.mjs "Audit display.js lines 500 to 1242"
  ```

#### Terminal Slash Commands
While chatting in the terminal, you can type:
- `/help`: Display available commands
- `/sessions`: List all saved persistent sessions
- `/resume <id>`: Switch to a saved session
- `/new`: Start a new session
- `/read <file> [startLine] [endLine]`: Inspect any file in full
- `/search <query>`: Grep across the entire codebase
- `/tree`: Print the repository file tree
- `/clear`: Clear the screen
- `/exit`: Save session and exit

---

### 2. Modern Web UI
Launch the browser interface with side-by-side code explorer:
```bash
npm run chat:web
```
Or:
```bash
node chatbot/chat.mjs --web
```
Then open your browser at:
👉 **`http://127.0.0.1:4005`**

#### Web UI Highlights:
- **Left Sidebar**: Session history list, create new chat, delete old chats.
- **Center Chat**: Real-time streaming token generation, markdown formatting, syntax highlighting, and quick prompt chips.
- **Right Drawer**: Built-in Code Explorer with full-file viewer and line numbers.
