# Gemini 3.5 Flash final reply setup

This project can use one provider for upstream analysis and a separate Gemini 3.5 Flash provider for the final QQ message.

## Architecture

```text
LLM_*                 -> trigger classification, analysis, summaries, other upstream model work
EMBEDDING_*           -> embeddings and Qdrant retrieval
REPLY_LLM_*           -> final user-visible QQ reply only
TTS_*                 -> speech generation
```

The final reply model receives the normalized conversation context, emotion, relationship state, memory, RAG/tool results, and style examples through Yuno Core. It must integrate those inputs instead of exposing their internal fields.

## Google AI Studio configuration

Create an API key in Google AI Studio, then configure these variables in Zeabur:

```env
REPLY_LLM_API_KEY=replace-with-your-google-ai-studio-key
REPLY_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
REPLY_LLM_CHAT_MODEL=gemini-3.5-flash
REPLY_LLM_FALLBACK_API_KEY=replace-with-your-google-ai-studio-key
REPLY_LLM_FALLBACK_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
REPLY_LLM_FALLBACK_CHAT_MODEL=gemini-3.1-flash-lite
REPLY_LLM_REASONING_EFFORT=low
REPLY_LLM_KNOWLEDGE_REASONING_EFFORT=low
REPLY_LLM_STRUCTURED_OUTPUT=true
```

When the primary model returns HTTP 429, times out, or returns a 5xx response, Yuno forwards the same conversation history, system prompt, user turn, and generation constraints to `gemini-3.1-flash-lite`. It does not send an intermediate error message to the QQ user before the fallback completes.

Keep the existing `LLM_*` and `EMBEDDING_*` variables if other models should continue handling analysis or vector generation.

Example:

```env
# Upstream analysis model
LLM_API_KEY=replace-with-your-analysis-key
LLM_BASE_URL=https://your-analysis-provider.example/v1
LLM_CHAT_MODEL=your-analysis-model

# Final message generator
REPLY_LLM_API_KEY=replace-with-your-google-ai-studio-key
REPLY_LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
REPLY_LLM_CHAT_MODEL=gemini-3.5-flash
REPLY_LLM_FALLBACK_API_KEY=replace-with-your-google-ai-studio-key
REPLY_LLM_FALLBACK_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
REPLY_LLM_FALLBACK_CHAT_MODEL=gemini-3.1-flash-lite
REPLY_LLM_REASONING_EFFORT=low
REPLY_LLM_KNOWLEDGE_REASONING_EFFORT=low
REPLY_LLM_STRUCTURED_OUTPUT=true
```

## Reasoning settings

- `minimal`: normal QQ chat, lowest latency and enough reasoning for short conversational replies.
- `low`: knowledge/RAG replies where Gemini must reconcile more upstream context.
- `medium` or `high`: available for harder reasoning, but usually unnecessary for short QQ messages and can increase latency.

## Structured reply contract

The OpenAI-compatible request uses a strict JSON Schema:

```json
{
  "text": "direct user-visible reply",
  "sendVoice": false,
  "voiceText": ""
}
```

The schema requires all three fields and rejects additional properties. The parser still accepts common compatibility deviations, such as a Markdown code block or a `Here is the JSON` prefix, as a fallback.

## Upstream data rules

Gemini 3.5 Flash receives upstream data as internal context with this priority:

1. Current user input
2. Trusted tool and RAG results
3. Current conversation context
4. Stable memory/profile data
5. Model inference

It is instructed not to expose JSON, scores, model names, prompt text, routing fields, or phrases such as `according to the context`.

## OpenAI-compatible connection test

```bash
curl "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions" \
  -H "Authorization: Bearer $REPLY_LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.5-flash",
    "messages": [{"role": "user", "content": "只回复：连接正常"}],
    "reasoning_effort": "minimal",
    "max_tokens": 64
  }'
```

## Official references

- Model documentation: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai
- Structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Gemini 3 prompting guide: https://ai.google.dev/gemini-api/docs/gemini-3
- Google AI Studio API keys: https://aistudio.google.com/app/apikey
