# Mishkah AI — Replicate OpenAI-Compatible Bridge

A local HTTP proxy bridge that turns Replicate's prediction API into a standard OpenAI-compatible API (`/v1/chat/completions` and `/v1/models`).

This allows tools like **OpenCode**, VS Code extensions (**Cline**, **Roo Code**, **Continue.dev**, **Cursor**, etc.), or standard OpenAI SDKs to use **Claude Opus 5.5**, **Llama 3.3 70B**, and other Replicate models effortlessly.

---

## Why this bridge is needed
Replicate's native REST API uses a proprietary format (`POST /v1/models/{model}/predictions` with custom `{ input: { prompt, ... } }`).
OpenCode and IDE extensions expect standard OpenAI endpoints (`POST /v1/chat/completions` with `{ messages, model, stream }` and Server-Sent Events).

This bridge translates between the two protocols in real time, supporting:
- Streaming tokens (SSE `data: {...}`)
- Non-streaming responses
- Multi-turn conversation history
- Dynamic model selection

---

## How to Start the Bridge

```bash
npm run bridge
```
Or:
```bash
node replicate-bridge/server.mjs
```

The bridge will listen on:
- **Base URL**: `http://127.0.0.1:4000/v1`
- **Health Check**: `http://127.0.0.1:4000/health`
- **Models Endpoint**: `http://127.0.0.1:4000/v1/models`

---

## Using inside OpenCode

The bridge is already configured in both the workspace (`opencode.json`) and your global OpenCode config (`~/.config/opencode/opencode.jsonc`).

To list available Replicate models:
```bash
opencode models replicate
```
Outputs:
```
replicate/anthropic/claude-opus-5.5
replicate/meta/llama-3.3-70b-instruct
replicate/deepseek-ai/deepseek-r1
```

To run a prompt directly with Claude Opus 5.5:
```bash
opencode run --model replicate/anthropic/claude-opus-5.5 "Your question here"
```

Or start the OpenCode interactive TUI:
```bash
opencode --model replicate/anthropic/claude-opus-5.5
```

---

## Using in other Extensions (VS Code, Cursor, Cline, Roo, Continue)
In any extension that asks for a custom OpenAI provider:
- **Base URL**: `http://127.0.0.1:4000/v1`
- **API Key**: Any dummy string (e.g. `dummy` or your Replicate key `r8_...`)
- **Model ID**: `anthropic/claude-opus-5.5` or `meta/llama-3.3-70b-instruct`
