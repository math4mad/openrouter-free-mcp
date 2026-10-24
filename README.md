# openrouter-free-mcp

零依赖的 MCP（Model Context Protocol）server，通过 OpenRouter 的 `openrouter/free` 自动路由调用**免费大模型**，请求自动分发到当前可用的免费模型（Gemma、DeepSeek、Llama、Qwen 等），自动避开单一模型的限流。

## 特性

- **零依赖**：仅使用 Node.js 内置模块，无需 `npm install`
- **自动路由**：`openrouter/free` 自动选择当前可用的免费模型，天然缓解限流
- **重试兜底**：429 限流自动重试 3 次（间隔递增）
- **reasoning 兼容**：自动处理推理模型的 `reasoning` 字段兜底
- **响应标注实际模型**：返回结果前缀显示实际路由到的模型，便于追踪

## 前置要求

- Node.js >= 16
- 一个 [OpenRouter](https://openrouter.ai/keys) 的 API key（免费注册）

## 安装与配置

无需安装，直接在你的 MCP 客户端配置中添加。以 **Trae**（`~/Library/Application Support/Trae CN/User/mcp.json`）为例：

```json
{
  "mcpServers": {
    "openrouter-free": {
      "command": "npx",
      "args": ["-y", "openrouter-free-mcp"],
      "env": {
        "OPENROUTER_KEY": "sk-or-v1-你的key"
      }
    }
  }
}
```

Claude Desktop（`claude_desktop_config.json`）、Cursor 等其他客户端同理，把上面这段放进 `mcpServers` 即可。

> ⚠️ API key 通过环境变量注入，本工具**不会**读取或存储你的密钥文件。

## 工具

### `ask_free_model`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | ✅ | 发送给模型的提示词/问题 |
| `system` | string | ❌ | 可选的系统提示词 |
| `max_tokens` | number | ❌ | 最大生成 token 数，默认 2048（建议 ≥2000，推理模型会消耗额外 token） |

响应格式：`[实际模型名]\n\n回答内容`

## 适用场景

- 批量文本处理（翻译、摘要、清洗）
- 第二意见（让另一个模型 review 代码/方案）
- 轻量生成任务（标题、标签、格式转换）

> 注意：免费模型池有速率限制，不适合高频调用或长上下文任务。

## License

MIT
