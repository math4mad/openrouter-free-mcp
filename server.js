#!/usr/bin/env node
// OpenRouter MCP Server (stdio, 零依赖)
// 使用 openrouter/free 自动路由模型：自动分发到当前可用的免费模型，避开单一模型限流
// API key 从环境变量 OPENROUTER_KEY / OPENROUTER_API_KEY 读取（启动命令 source ~/.zshrc 注入）

const https = require('https');

const API_KEY = (process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '').trim();

// ---------- MCP stdio 协议（JSON-RPC 2.0，按行分隔） ----------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function handleInitialize(id) {
  send({
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'openrouter-free', version: '1.0.0' },
    },
  });
}

const TOOLS = [
  {
    name: 'ask_free_model',
    description:
      '通过 openrouter/free 自动路由模型调用免费大模型。请求会自动分发到当前可用的免费模型（含 Gemma、DeepSeek、Llama 等），' +
      '自动避开限流。适合批量文本处理、第二意见、轻量生成任务。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '发送给模型的提示词/问题' },
        system: { type: 'string', description: '可选的系统提示词' },
        max_tokens: { type: 'number', description: '最大生成 token 数，默认 2048' },
      },
      required: ['prompt'],
    },
  },
];

function handleToolsList(id) {
  send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
}

// ---------- 调用 OpenRouter ----------

function callOpenRouter(messages, maxTokens) {
  const body = JSON.stringify({ model: 'openrouter/free', messages, max_tokens: maxTokens });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`OpenRouter ${res.statusCode}: ${data.slice(0, 500)}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0] || {};
            const used = choice.model || 'openrouter/free';
            const msg = choice.message || {};
            // 部分路由到的推理模型会把答案放在 reasoning，content 为 null，需兜底
            const content = msg.content || (msg.reasoning ? `[模型推理过程]\n${msg.reasoning}` : '(空响应)');
            resolve({ used, content });
          } catch (e) {
            reject(new Error('响应解析失败: ' + data.slice(0, 300)));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('请求超时')));
    req.write(body);
    req.end();
  });
}

async function handleToolsCall(id, args) {
  const { prompt, system, max_tokens: maxTokens = 2048 } = args;

  if (!API_KEY) {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: '错误：未找到 API key，请设置 OPENROUTER_KEY 环境变量' }],
        isError: true,
      },
    });
    return;
  }

  if (!prompt) {
    send({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: '错误：缺少 prompt 参数' }], isError: true },
    });
    return;
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  // 自动路由模型本身会避开限流；这里再做 3 次重试兜底（间隔递增）
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { used, content } = await callOpenRouter(messages, maxTokens);
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `[${used}]\n\n${content}` }] },
      });
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  send({
    jsonrpc: '2.0',
    id,
    result: { content: [{ type: 'text', text: '调用失败: ' + lastErr?.message }], isError: true },
  });
}

// ---------- 主循环 ----------

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const { id, method, params = {} } = msg;
      if (method === 'initialize') handleInitialize(id);
      else if (method === 'notifications/initialized') { /* 无需响应 */ }
      else if (method === 'tools/list') handleToolsList(id);
      else if (method === 'tools/call') handleToolsCall(id, params.arguments || {});
      else if (method === 'ping') send({ jsonrpc: '2.0', id, result: {} });
      else if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: '未知方法: ' + method } });
    } catch {
      // 忽略无法解析的行
    }
  }
});

process.stdin.resume();
console.error('[openrouter-free] MCP server 已启动 (stdio)');
