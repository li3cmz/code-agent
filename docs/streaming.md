# Streaming Mechanism

> Understanding how LLM API streaming works

## Server-Side Chunk Control

When using LLM APIs with streaming enabled, the **chunk size is controlled by the server**, not your client code.

### How It Works

```
Client Code                      LLM API Server
    │                                  │
    │ ──► POST /chat/completions ───► │
    │                                  │
    │ ◄── chunk1 (unpredictable) ─── │
    │ ◄── chunk2 ──────────────────── │
    │ ◄── chunk3 ──────────────────── │
    │ ◄── ... ─────────────────────── │
    │                                  │
```

### Factors Affecting Chunk Size

| Factor | Description |
|--------|-------------|
| Server buffering | Server buffers tokens, flushes when buffer is full |
| Network efficiency | Batch small chunks to reduce round trips |
| Model behavior | Some models emit token-by-token, others in bursts |
| Protocol overhead | SSE (Server-Sent Events) frames add delimiters |

### Example Outputs

```
Request: "Hello"
Chunk 1: "Hello"           (entire response in one chunk)
Chunk 2: (empty)            (end of stream)

Request: "Explain photosynthesis"
Chunk 1: "Photo"
Chunk 2: "synthesis is"
Chunk 3: " the process"
Chunk 4: " by which"
Chunk 5: " plants"
Chunk 6: " convert"
Chunk 7: " sunlight"
...
```

### Client Code Responsibility

Your code must handle **any chunk size**:

```typescript
// You CANNOT control chunk size - just handle whatever comes
for await (const chunk of response) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    accumulated += content;  // concatenate regardless of size
  }
}
```

---

## Protocol: Server-Sent Events (SSE)

Streaming uses **Server-Sent Events (SSE)**, NOT WebSocket.

### SSE vs WebSocket

| Protocol | Type | Use Case | Your Case |
|----------|------|----------|-----------|
| **WebSocket** | Bidirectional, full-duplex | Real-time chat, games | Not used |
| **Server-Sent Events (SSE)** | One-way, server→client | Streaming responses | ✓ Used |
| **HTTP/1.1** | Request/Response | Standard API calls | Non-streaming |

### SSE Flow

```
HTTP Request:
POST /openai/v1/chat/completions
Accept: text/event-stream        ← Key header enables SSE
```

```
Server Response (SSE format):
data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" world"}}]}

data: [DONE]                    ← End marker
```

### SSE Format

```
data: <json payload>
\n\n
data: <next payload>
\n\n
```

- `data:` prefix marks each event
- Double newline `\n\n` is the delimiter
- `[DONE]` signals stream completion

### Why SSE Instead of WebSocket?

| SSE Advantage | Explanation |
|--------------|-------------|
| Simple | Lightweight HTTP upgrade, no complex handshake |
| One-way | Only server sends data (perfect for streaming responses) |
| Native browser support | Works with fetch API natively |
| Automatic reconnection | Browser handles it automatically |

### In Your Code

The OpenAI SDK handles SSE internally — you don't see the raw SSE:

```typescript
const response = await client.chat.completions.create({
  model,
  messages,
  stream: true,  // ← This enables SSE
});

// SDK parses SSE and yields chunks automatically
for await (const chunk of response) {
  // chunk is already parsed JSON
}
```

---

## Tool Calls in Streaming

**Yes, tool calls can also be split across chunks!**

A tool call has three parts:
1. `id` - unique identifier
2. `function.name` - tool name
3. `function.arguments` - JSON arguments (often large)

### How Tool Calls Are Streamed

```
Server Stream:
Chunk 1: { tool_calls: [{ id: "call_abc", function: { name: "readFile" } }] }
Chunk 2: { tool_calls: [{ function: { arguments: "{" } }] }
Chunk 3: { tool_calls: [{ function: { arguments: "\"path\": \"hello" }] }
Chunk 4: { tool_calls: [{ function: { arguments: ".txt\"}" }] }
         (complete: {"path": "hello.txt"})
```

### Client-Side Accumulation

Your code must accumulate tool call data across chunks:

```typescript
let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

for await (const chunk of response) {
  const delta = chunk.choices[0]?.delta;
  
  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      // First chunk: create new entry with id and name
      if (tc.id) {
        toolCalls.push({
          id: tc.id,
          name: tc.function?.name || "",
          arguments: ""
        });
      }
      
      // Subsequent chunks: append arguments
      const existing = toolCalls[toolCalls.length - 1];
      if (existing && tc.function?.arguments) {
        existing.arguments += tc.function.arguments;
      }
    }
  }
}

// After stream: parse complete arguments
const parsed = toolCalls.map(tc => ({
  ...tc,
  arguments: JSON.parse(tc.arguments)  // Now complete JSON
}));
```

### Why Arguments Are Split

| Reason | Explanation |
|--------|-------------|
| JSON is large | Arguments can be hundreds of tokens |
| Progressive parsing | Server sends as JSON is generated |
| Same as text | Same streaming mechanism applied |

---

## Implementation in loop.ts

See `src/core/loop.ts` lines 146-167 for the actual implementation of tool call accumulation:

```typescript
if (delta?.tool_calls) {
  for (const tc of delta.tool_calls) {
    const tcIndex = tc.index ?? 0;
    
    // Find or create tool call entry
    let existing = toolCalls.find((t) => t.id === tc.id);
    if (!existing && tc.id) {
      existing = { id: tc.id, name: tc.function?.name || "", arguments: "" };
      toolCalls.push(existing);
    } else if (!existing && tcIndex < toolCalls.length) {
      existing = toolCalls[tcIndex];  // Azure OpenAI uses index
    }
    
    // Accumulate arguments
    if (existing && tc.function?.arguments) {
      existing.arguments += tc.function.arguments;
    }
  }
}
```

---

## Summary

1. **Protocol is SSE** - Server-Sent Events over HTTP, not WebSocket
2. **Chunk size is server-controlled** - unpredictable, varies by request
3. **Tool calls ARE split** - especially arguments (JSON)
4. **Client must accumulate** - concatenate both text and tool arguments across chunks
5. **Parse after stream ends** - only then is JSON complete and parseable
