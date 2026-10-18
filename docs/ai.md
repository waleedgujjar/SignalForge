# AI Architecture

## Provider abstraction

All AI features use the `AIProvider` interface in `@signalforge/ai`.

```
AIProvider
  ├── MockAIProvider   (default — deterministic dev data, no API key needed)
  └── OpenAIProvider   (OpenAI direct / FreeLLMAPI / OpenRouter / any OpenAI-compatible API)
```

The provider is selected by `AI_PROVIDER` and configured by `OPENAI_*` environment variables.
Business logic depends on `AIProvider`, never on a vendor SDK directly.

## Environment

```env
AI_PROVIDER=mock              # mock | openai
OPENAI_API_KEY=               # Required when AI_PROVIDER=openai
OPENAI_BASE_URL=              # Optional — override the OpenAI endpoint (for FreeLLMAPI, OpenRouter, etc.)
OPENAI_MODEL=gpt-4o           # Model name passed to the API (default: gpt-4o)
```

## Mock provider

`MockAIProvider` returns deterministic, realistic development data for all 10 interface methods (lead scoring, company research, email personalization, reply classification, deliverability analysis, analytics, website analysis, lead enrichment). No API key or external service needed.

## FreeLLMAPI integration

FreeLLMAPI is an OpenAI-compatible gateway that routes requests to multiple LLM providers (Gemini, Groq, Mistral, etc.) through a unified API key and endpoint.

### Setup

1. Start FreeLLMAPI (see FreeLLMAPI docs for installation).
2. Configure provider API keys inside FreeLLMAPI.
3. Obtain the FreeLLMAPI unified API key.
4. Set environment variables in `.env`:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=<your FreeLLMAPI unified key>
OPENAI_BASE_URL=http://localhost:3001/v1
OPENAI_MODEL=auto
```

5. Start SignalForge: `pnpm dev`
6. Verify: `GET /health/ai` should return `{"status":"ok","service":"ai:openai"}`

### Model routing

FreeLLMAPI supports routing modes via the model parameter:

- `auto` — automatic routing
- `auto:smart` — prefer higher-quality models
- `auto:fast` — prefer lower-latency models
- `auto:cheap` — prefer lower-cost models

Do not reference underlying provider models (e.g., `gemini-...`, `groq/...`) inside SignalForge.
The gateway controls provider/model routing.

### Docker networking

When both SignalForge and FreeLLMAPI run inside Docker, `localhost` refers to the container itself.
Use the Docker service hostname instead:

```env
OPENAI_BASE_URL=http://freellmapi:3001/v1
```

## Health check

`GET /health/ai` verifies the AI subsystem is configured. It checks that the provider can be constructed and the API key is present (for the `openai` provider). It does not make a real API call.

## Rules

- No direct OpenAI/vendor SDK calls from controllers or UI components
- Business logic depends on `AIProvider`, not a vendor SDK
- OpenAI is optional and not required for local development
- Never expose `OPENAI_API_KEY` to browser code or `NEXT_PUBLIC_*` variables
- FreeLLMAPI is the recommended gateway — do not add Gemini/Groq/Mistral SDKs directly

See [ADR-006](decisions/006-ai-provider-abstraction.md).
