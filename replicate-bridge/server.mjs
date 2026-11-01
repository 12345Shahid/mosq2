#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Load environment variables from .env if present
const envPath = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const PORT = parseInt(process.env.BRIDGE_PORT || '4000', 10);
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const DEFAULT_REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || '';

const SUPPORTED_MODELS = [
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', owned_by: 'anthropic' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct', owned_by: 'meta' },
  { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1', owned_by: 'deepseek-ai' },
  { id: 'mistralai/mistral-large-2407', name: 'Mistral Large 2', owned_by: 'mistralai' }
];

function getAuthToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token && token !== 'dummy' && token !== 'none') {
      return token;
    }
  }
  return DEFAULT_REPLICATE_TOKEN;
}

function parseInvokeTag(text) {
  const match = text.match(/<invoke\s+name=["\x27]([^"\x27]+)["\x27]>([\s\S]*?)<\/invoke>/);
  if (!match) return null;
  const toolName = match[1].trim();
  const paramsBlock = match[2];
  const paramRegex = /<parameter\s+name=["\x27]([^"\x27]+)["\x27]>([\s\S]*?)<\/parameter>/g;
  const args = {};
  let p;
  while ((p = paramRegex.exec(paramsBlock)) !== null) {
    let val = p[2].trim();
    // Clean out any accidental nested tags
    val = val.replace(/<\/?(?:invoke|parameter)[^>]*>/g, '').trim();
    try {
      if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
        val = JSON.parse(val);
      }
    } catch (_) {}
    args[p[1]] = val;
  }
  return {
    raw: match[0],
    index: match.index,
    length: match[0].length,
    name: toolName,
    arguments: args
  };
}

function formatMessages(messages, tools = []) {
  let systemPrompt = '';
  const nonSystem = [];

  for (const msg of messages || []) {
    let content = msg.content;
    if (Array.isArray(content)) {
      content = content.map(part => {
        if (typeof part === 'string') return part;
        if (part.type === 'text') return part.text || '';
        if (part.type === 'tool_use' || part.type === 'tool-call') {
          return `<invoke name="${part.name || part.toolName}"><parameter name="input">${JSON.stringify(part.input || part.args || {})}</parameter></invoke>`;
        }
        if (part.type === 'tool_result' || part.type === 'tool-result') {
          return `<system-reminder>\n${part.content || part.output || ''}\n</system-reminder>`;
        }
        return JSON.stringify(part);
      }).join('\n');
    } else if (typeof content !== 'string') {
      content = content ? JSON.stringify(content) : '';
    }

    if (msg.role === 'system') {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${content}` : content;
    } else if (msg.role === 'tool') {
      nonSystem.push({
        role: 'user',
        content: `<system-reminder>\nTool output:\n${content}\n</system-reminder>`
      });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        let tcXml = '';
        for (const tc of msg.tool_calls) {
          const fn = tc.function || {};
          let argsObj = {};
          try { argsObj = JSON.parse(fn.arguments || '{}'); } catch (_) {}
          let paramsXml = '';
          for (const [k, v] of Object.entries(argsObj)) {
            paramsXml += `<parameter name="${k}">${typeof v === 'string' ? v : JSON.stringify(v)}</parameter>\n`;
          }
          tcXml += `<invoke name="${fn.name}">\n${paramsXml}</invoke>\n`;
        }
        nonSystem.push({
          role: 'assistant',
          content: content ? `${content}\n${tcXml}` : tcXml
        });
      } else if (content) {
        nonSystem.push({ role: 'assistant', content });
      }
    } else {
      nonSystem.push({ role: 'user', content });
    }
  }

  if (tools && tools.length > 0 && !systemPrompt.includes('<invoke')) {
    const toolList = tools.map(t => {
      const fn = t.function || t;
      return `- ${fn.name}: ${fn.description || ''}\n  Parameters: ${JSON.stringify(fn.parameters || {})}`;
    }).join('\n');
    const toolInstruction = `\nYou have access to the following tools:\n${toolList}\n\nTo invoke a tool, output in this exact XML format:\n<invoke name="tool_name">\n<parameter name="param_name">value</parameter>\n</invoke>\nDo not output internal thoughts or simulate tool output. Output ONLY the tool invocation.\n`;
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${toolInstruction}` : toolInstruction;
  }

  if (nonSystem.length === 1 && nonSystem[0].role === 'user') {
    return {
      prompt: nonSystem[0].content,
      systemPrompt: systemPrompt || undefined
    };
  }

  let formatted = nonSystem.map(m => {
    const role = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role;
    return `${role}: ${m.content}`;
  }).join('\n\n');

  if (nonSystem.length > 0 && nonSystem[nonSystem.length - 1].role === 'user') {
    formatted += '\n\nAssistant:';
  }

  return {
    prompt: formatted || 'Hello',
    systemPrompt: systemPrompt || undefined
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  });
  res.end(JSON.stringify(data));
}

async function fetchWith429Retry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < maxRetries) {
      let waitSeconds = 8;
      try {
        const bodyText = await res.text();
        const parsed = JSON.parse(bodyText);
        if (parsed.retry_after) waitSeconds = Math.ceil(parsed.retry_after);
      } catch (_) {}
      console.log(`[Bridge] 429 Throttled by Replicate (6 req/min limit). Auto-waiting ${waitSeconds}s (attempt ${attempt + 1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, (waitSeconds + 1) * 1000));
      continue;
    }
    return res;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

  if (url.pathname === '/health' || url.pathname === '/') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'Mishkah Replicate-OpenAI Bridge',
      port: PORT,
      available_models: SUPPORTED_MODELS.map(m => m.id)
    });
  }

  if (req.method === 'GET' && (url.pathname === '/v1/models' || url.pathname === '/models')) {
    const now = Math.floor(Date.now() / 1000);
    return sendJson(res, 200, {
      object: 'list',
      data: SUPPORTED_MODELS.map(m => ({
        id: m.id,
        object: 'model',
        created: now,
        owned_by: m.owned_by,
        permission: [],
        root: m.id,
        parent: null
      }))
    });
  }

  if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/chat/completions')) {
    let bodyText = '';
    req.on('data', chunk => { bodyText += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(bodyText || '{}');
        let model = payload.model || 'anthropic/claude-opus-5.5';
        if (model.startsWith('replicate/')) {
          model = model.slice('replicate/'.length);
        }

        const isStream = Boolean(payload.stream);
        const { prompt, systemPrompt } = formatMessages(payload.messages, payload.tools);
        const token = getAuthToken(req);

        const inputPayload = {
          prompt,
          max_tokens: Math.max(1024, Number(payload.max_tokens) || 4096)
        };
        if (systemPrompt) {
          inputPayload.system_prompt = systemPrompt;
        }
        if (payload.temperature !== undefined) {
          inputPayload.temperature = Number(payload.temperature);
        }

        const replicateUrl = `https://api.replicate.com/v1/models/${model}/predictions`;
        const headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        };
        if (!isStream) {
          headers['Prefer'] = 'wait';
        }

        console.log(`[Bridge] Request: model=${model}, stream=${isStream}, tokens=${inputPayload.max_tokens}`);

        const initRes = await fetchWith429Retry(replicateUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            stream: isStream,
            input: inputPayload
          })
        });

        if (!initRes.ok) {
          const errBody = await initRes.text();
          console.error(`[Bridge Error] Replicate responded ${initRes.status}:`, errBody);
          return sendJson(res, initRes.status, {
            error: {
              message: `Replicate API error (${initRes.status}): ${errBody}`,
              type: 'invalid_request_error',
              code: initRes.status
            }
          });
        }

        const prediction = await initRes.json();
        const completionId = `chatcmpl-${prediction.id || Date.now()}`;
        const createdTimestamp = Math.floor(Date.now() / 1000);

        let clientClosed = false;
        req.on('close', async () => {
          clientClosed = true;
          if (prediction.urls && prediction.urls.cancel) {
            try {
              await fetch(prediction.urls.cancel, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
              });
              console.log(`[Bridge] Cancelled prediction ${prediction.id} on disconnect.`);
            } catch (_) {}
          }
        });

        // 1. STREAMING MODE
        if (isStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          });

          if (!prediction.urls || !prediction.urls.stream) {
            throw new Error('Replicate did not return a stream URL');
          }

          const streamRes = await fetch(prediction.urls.stream, {
            headers: { 'Accept': 'text/event-stream' }
          });

          if (!streamRes.ok) {
            throw new Error(`Failed to connect to Replicate stream: ${streamRes.statusText}`);
          }

          const reader = streamRes.body.getReader();
          const decoder = new TextDecoder();
          let rawBuffer = '';
          let fullOutputText = '';
          let sentToolCall = false;

          while (!clientClosed) {
            const { done, value } = await reader.read();
            if (done) break;

            rawBuffer += decoder.decode(value, { stream: true });
            const blocks = rawBuffer.split(/\r?\n\r?\n/);
            rawBuffer = blocks.pop() || '';

            for (const block of blocks) {
              if (!block.trim()) continue;

              let eventType = '';
              const dataLines = [];

              for (const line of block.split(/\r?\n/)) {
                if (line.startsWith('event: ')) {
                  eventType = line.slice(7).trim();
                } else if (line.startsWith('event:')) {
                  eventType = line.slice(6).trim();
                } else if (line.startsWith('data: ')) {
                  dataLines.push(line.slice(6));
                } else if (line.startsWith('data:')) {
                  dataLines.push(line.slice(5));
                }
              }

              if (eventType === 'output' || (!eventType && dataLines.length > 0)) {
                const dataContent = dataLines.join('\n');
                if (dataContent.length === 0) continue;

                fullOutputText += dataContent;

                // Check for invoke tag
                const invoke = parseInvokeTag(fullOutputText);
                if (invoke && !sentToolCall) {
                  sentToolCall = true;
                  const toolId = `call_${Date.now()}`;
                  console.log(`[Bridge] Converted model XML invocation -> Tool: ${invoke.name}`, invoke.arguments);

                  const toolChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: createdTimestamp,
                    model,
                    choices: [
                      {
                        index: 0,
                        delta: {
                          tool_calls: [
                            {
                              index: 0,
                              id: toolId,
                              type: 'function',
                              function: {
                                name: invoke.name,
                                arguments: JSON.stringify(invoke.arguments)
                              }
                            }
                          ]
                        },
                        finish_reason: null
                      }
                    ]
                  };
                  res.write(`data: ${JSON.stringify(toolChunk)}\n\n`);

                  const finishChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created: createdTimestamp,
                    model,
                    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
                  };
                  res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
                  res.write('data: [DONE]\n\n');
                  res.end();
                  return;
                }

                // If inside <invoke> or <thinking>, hold back from raw stream
                if (fullOutputText.includes('<invoke') || fullOutputText.includes('<thinking')) {
                  continue;
                }

                const chunk = {
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created: createdTimestamp,
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: dataContent },
                      finish_reason: null
                    }
                  ]
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              } else if (eventType === 'done') {
                if (!sentToolCall) {
                  let cleanText = fullOutputText.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
                  const invoke = parseInvokeTag(cleanText);
                  if (invoke) {
                    const toolId = `call_${Date.now()}`;
                    const toolChunk = {
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created: createdTimestamp,
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              {
                                index: 0,
                                id: toolId,
                                type: 'function',
                                function: {
                                  name: invoke.name,
                                  arguments: JSON.stringify(invoke.arguments)
                                }
                              }
                            ]
                          },
                          finish_reason: null
                        }
                      ]
                    };
                    res.write(`data: ${JSON.stringify(toolChunk)}\n\n`);
                    const finishChunk = {
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created: createdTimestamp,
                      model,
                      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
                    };
                    res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
                  } else {
                    const finalChunk = {
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created: createdTimestamp,
                      model,
                      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
                    };
                    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
                  }
                }
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
            }
          }

          if (!clientClosed) {
            res.write('data: [DONE]\n\n');
            res.end();
          }
          return;
        }

        // 2. NON-STREAMING MODE
        let finalPrediction = prediction;
        while (finalPrediction.status !== 'succeeded' && finalPrediction.status !== 'failed' && finalPrediction.status !== 'canceled') {
          await new Promise(r => setTimeout(r, 1000));
          const checkRes = await fetch(finalPrediction.urls.get, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (checkRes.ok) {
            finalPrediction = await checkRes.json();
          }
        }

        if (finalPrediction.status !== 'succeeded') {
          return sendJson(res, 500, {
            error: {
              message: `Prediction failed with status: ${finalPrediction.status} (${finalPrediction.error || 'Unknown error'})`,
              type: 'replicate_execution_error'
            }
          });
        }

        let outputText = Array.isArray(finalPrediction.output)
          ? finalPrediction.output.join('')
          : String(finalPrediction.output || '');

        const invoke = parseInvokeTag(outputText);
        if (invoke) {
          const toolId = `call_${Date.now()}`;
          return sendJson(res, 200, {
            id: completionId,
            object: 'chat.completion',
            created: createdTimestamp,
            model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: toolId,
                      type: 'function',
                      function: {
                        name: invoke.name,
                        arguments: JSON.stringify(invoke.arguments)
                      }
                    }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ]
          });
        }

        outputText = outputText.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();

        return sendJson(res, 200, {
          id: completionId,
          object: 'chat.completion',
          created: createdTimestamp,
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: outputText
              },
              finish_reason: 'stop'
            }
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
          }
        });
      } catch (err) {
        console.error('[Bridge Error]', err);
        return sendJson(res, 500, {
          error: {
            message: err.message || 'Internal Bridge Error',
            type: 'internal_server_error'
          }
        });
      }
    });
    return;
  }

  sendJson(res, 404, { error: { message: `Not Found: ${req.method} ${url.pathname}` } });
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Mishkah Replicate OpenAI Bridge is LIVE`);
  console.log(`📡 URL:       http://${HOST}:${PORT}/v1`);
  console.log(`🔍 Health:    http://${HOST}:${PORT}/health`);
  console.log(`🤖 Models:    http://${HOST}:${PORT}/v1/models`);
  console.log(`======================================================\n`);
});
