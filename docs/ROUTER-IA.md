# Router de IA centralizado

Omni habla con cuatro proveedores de IA a través de un solo router, en `src/modules/ai/`:

- OpenAI (ChatGPT)
- Anthropic (Claude)
- Google (Gemini)
- xAI (Grok)

Cualquier pedido entra con la misma forma (`AIRequestPrompt`) y sale con la misma forma (`AIResponse`), responda quien responda. Las fallas también salen normalizadas, por ejemplo red, tiempo agotado, límite de tasa o cuota agotada.

Si un proveedor falla, el router reintenta lo pasajero y, si sigue fallando, responde con el siguiente proveedor.

## Cómo se usa

### Desde la app (web, Android)

`POST /api/v1/ai/chat` tiene sesión obligatoria y admite 20 pedidos por minuto. Cada respuesta cuenta como un mensaje del plan.

```json
{
  "messages": [
    { "role": "user", "content": [{ "type": "text", "text": "¿Qué dice esta factura?" }, { "type": "image", "mediaType": "image/jpeg", "data": "<base64>" }] }
  ],
  "provider": "auto",
  "tier": "fast",
  "responseFormat": { "type": "text" },
  "maxOutputTokens": 800,
  "fallback": true
}
```

Los campos del pedido:

- **`provider`**: `auto` (el router elige), `openai`, `anthropic`, `gemini` o `xai`.
- **`tier`**: `fast` es el modelo rápido de cada proveedor. `smart` es el más capaz y solo está en Pro: en Gratis responde 402 `plan_limit`.
- **`fallback: false`**: usa solo el proveedor pedido.
- **`responseFormat`**: `{ "type": "json", "schema": { … } }` pide JSON ajustado a ese esquema, que llega ya leído en `json`.
- **`instructions`** (opcional): van debajo de las reglas de Omni y no las reemplazan.

La respuesta llega siempre igual, venga de OpenAI, Claude, Gemini o Grok:

```json
{
  "data": {
    "id": "9b1f…",
    "object": "ai.response",
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "tier": "fast",
    "text": "Es una factura de luz por $42,30 que vence el 15 de octubre.",
    "json": null,
    "toolCalls": [],
    "finishReason": "stop",
    "usage": { "inputTokens": 1830, "outputTokens": 41, "totalTokens": 1871, "cachedInputTokens": 0, "reasoningTokens": 0 },
    "latencyMs": 2140,
    "fallback": false,
    "attempts": [{ "provider": "anthropic", "model": "claude-haiku-4-5-20251001", "ok": true, "error": null, "latencyMs": 2131 }],
    "warnings": [],
    "createdAt": "2026-10-09T22:41:07.000Z"
  }
}
```

Los campos de la respuesta:

- **`finishReason`**:
  - `stop`: terminó de responder.
  - `length`: llegó al máximo de tokens.
  - `tool_calls`: pide ejecutar herramientas.
  - `content_filter`: el proveedor no quiso responder.
  - `other`: otro motivo.
- **`fallback: true`**: respondió otro proveedor. `attempts` cuenta qué se intentó.
- **`warnings`**: ajustes que hizo el router porque el modelo no admite algo:
  - `temperature_ignored`: el modelo no acepta temperatura.
  - `stop_emulated`: el modelo no acepta secuencias de corte y el router cortó el texto.
  - `tool_choice_relaxed`: el modelo no permite obligar una herramienta y se pidió en las instrucciones.
  - `reasoning_ignored`: el modelo no permite elegir cuánto razona.

Con los errores pasa lo mismo: siempre `{ error: { code, message, details, requestId } }`, con un mensaje en español listo para mostrar.

```json
{
  "error": {
    "code": "ai_rate_limited",
    "message": "Hay mucha demanda en la IA en este momento. Inténtalo en 9 segundos.",
    "details": { "provider": null, "retryAfterSeconds": 9, "attempts": [{ "provider": "anthropic", "model": "claude-haiku-4-5-20251001", "error": "rate_limited" }] },
    "requestId": "…"
  }
}
```

`GET /api/v1/ai/models` dice qué proveedores hay en este entorno, cuáles están respondiendo y qué niveles permite el plan. La app lo usa para el selector de modelo.

### Desde el servidor

```ts
import { aiRouter, generateStructured } from "@/modules/ai/ai.service";

// Un pedido cualquiera: texto, imágenes, PDF, herramientas o JSON.
const { response, state } = await aiRouter().complete({ system, messages, tier: "smart", provider: "openai" });

// JSON validado con zod, con corrección y respaldo incluidos.
const { value } = await generateStructured({ schema: alertSchema, name: "redactar_alerta", system, prompt, tier: "fast", maxOutputTokens: 500 });
```

`state` es el estado propio del proveedor y es necesario para seguir una ronda de herramientas. Puede ser:

- el razonamiento cifrado de OpenAI;
- las firmas de pensamiento de Gemini;
- los bloques de pensamiento de Claude.

Va en el mensaje del asistente siguiente: `{ role: "assistant", content, toolCalls, state }`.

## Proveedores y modelos

| Proveedor | API oficial | Rápido (`fast`, Gratis) | Capaz (`smart`, Pro) | Llave |
| --- | --- | --- | --- | --- |
| Anthropic | Messages (`/v1/messages`) | `ANTHROPIC_MODEL_FREE` (claude-haiku-4-5-20251001) | `ANTHROPIC_MODEL_PRO` (claude-sonnet-5-5) | `ANTHROPIC_API_KEY` |
| OpenAI | Responses (`/v1/responses`) | `OPENAI_MODEL_FAST` (gpt-6-luna) | `OPENAI_MODEL_SMART` (gpt-6.1-sol) | `OPENAI_API_KEY` |
| Google | generateContent (`/v1beta/models/…:generateContent`) | `GEMINI_MODEL_FAST` (gemini-3.5-flash-lite) | `GEMINI_MODEL_SMART` (gemini-3.8-flash) | `GEMINI_API_KEY` o `GOOGLE_API_KEY` |
| xAI | Chat Completions, compatible con OpenAI (`/v1/chat/completions`) | `XAI_MODEL_FAST` (grok-4.3) | `XAI_MODEL_SMART` (grok-4.7) | `XAI_API_KEY` |

- **Llaves:** cada proveedor se activa con su llave. Sin llave, el router lo salta.
- **Orden:** `AI_PROVIDER_ORDER` fija en qué orden se prueban (por defecto `anthropic,openai,gemini,xai`). Los que no se nombran van después.
- **Proxies:** `*_BASE_URL` cambia la URL de un proveedor, por ejemplo para usar un proxy o un servicio compatible.
- **Modelos:** son los recomendados por cada proveedor en octubre de 2026. Para cambiar uno basta su variable.

### Qué admite cada uno

El router solo manda a cada proveedor lo que este puede atender. Por ejemplo, un PDF nunca va a Grok y una imagen WEBP no va a xAI.

| | Anthropic | OpenAI | Gemini | xAI |
| --- | --- | --- | --- | --- |
| Imágenes | PNG, JPEG, WEBP, GIF | PNG, JPEG, WEBP, GIF | PNG, JPEG, WEBP | PNG, JPEG |
| PDF | sí | sí | sí | no |
| Herramientas | sí | sí | sí | sí |
| JSON con esquema | sí | sí | sí | sí |
| Temperatura | no (modelos nuevos) | no (GPT-6 razona siempre) | no (obsoleta desde 3.6) | sí |
| Secuencias de corte | sí | no (las corta el router) | sí | no (las corta el router) |
| Obligar una herramienta | Haiku sí; Opus/Sonnet 5.5, Fable y Mythos no | sí | sí | sí |

### Particularidades de cada API

**Anthropic**

- Para pedir JSON con Haiku se usa una herramienta forzada, el camino de siempre.
- Opus y Sonnet 5.5, Fable y Mythos responden 400 si se les fuerza una herramienta. Con ellos el JSON va por salida estructurada (`output_config.format`).
- Si un modelo deja de aceptar la herramienta forzada, el adaptador repite el pedido con salida estructurada.
- Los límites de largo y de cifras del esquema pasan a la descripción, porque la salida estructurada no los acepta.

**OpenAI**

- Usa la Responses API, porque con GPT-6 las herramientas solo funcionan ahí.
- Corre sin estado en OpenAI (`store: false`). Para seguir una ronda de herramientas, se le devuelven sus propios elementos de salida, con el razonamiento cifrado incluido.
- `max_output_tokens` incluye el razonamiento, así que el router suma una reserva al máximo pedido. Solo se cobra lo que se usa.

**Gemini**

- Gemini 3 exige recibir de vuelta la firma de pensamiento de sus llamadas a funciones. Para llamadas que hizo otro proveedor se usa el valor que documenta Google para saltar esa validación.
- Cada respuesta de función lleva el `id` de su llamada, y todas van juntas en un solo turno.
- El JSON se pide con `responseMimeType` + `responseSchema`, en el subconjunto de OpenAPI. Si la API ya no los acepta, se repite con `responseFormat`.

**xAI**

- Usa `max_completion_tokens`, porque `max_tokens` está obsoleto.
- Sus modelos de razonamiento rechazan `stop`, así que el router corta el texto.
- No documenta `tool_calls` como `finish_reason`: las llamadas se detectan en el mensaje.

## Errores, reintentos y respaldo

| Código | Ejemplo | Mismo proveedor | Otro proveedor | Respuesta de la API |
| --- | --- | --- | --- | --- |
| `network_error` | conexión cortada, DNS | reintenta | sí | 503 `ai_network_error` |
| `timeout` | sin respuesta a tiempo | reintenta | sí | 504 `ai_timeout` |
| `rate_limited` | 429 por minuto | espera el Retry-After si es corto (hasta 4 s) | sí | 429 `ai_rate_limited` + `Retry-After` |
| `quota_exceeded` | sin saldo, tope de gasto, cuota diaria | no | sí | 503 `ai_quota_exceeded` |
| `auth_failed` | llave inválida | no | sí | 503 `ai_unavailable` |
| `model_not_found` | modelo mal configurado | no | sí | 503 `ai_unavailable` |
| `provider_unavailable` | 5xx, 529 de Anthropic | reintenta | sí | 503 `ai_unavailable` |
| `bad_response` | JSON inválido | reintenta (no si se cortó por el máximo de tokens) | sí | 502 `ai_bad_response` |
| `invalid_request` | pedido mal armado | no | no | 400 `ai_invalid_request` |
| `context_too_long` | conversación demasiado larga | no | no | 413 `ai_context_too_long` |
| `content_blocked` | bloqueado por políticas | no | no | 422 `ai_content_blocked` |
| `aborted` | la persona cerró la app | no | no | 408 `ai_canceled` |

- **Reintentos:**
  - Hasta 2 intentos por proveedor ante fallas pasajeras.
  - Entre uno y otro se espera 250–500 ms (más en los siguientes), o lo que pida el proveedor si es corto.
  - El tiempo de espera se lee de `Retry-After`, de `x-ratelimit-reset-*` en OpenAI y de `RetryInfo` en Google.
- **Cuota contra límite de tasa:** cada adaptador distingue un 429 por minuto (`rate_limited`) de una cuota que no vuelve en segundos (`quota_exceeded`). Por ejemplo:
  - OpenAI: `insufficient_quota` y los topes de gasto.
  - Anthropic: `enforced_spend_limit_reached`, 402 `billing_error` y saldo bajo.
  - Google: cuota por día y 402 de créditos prepagados.
  - xAI: créditos agotados.
- **Cortacircuitos:**
  - Tras 3 fallas pasajeras seguidas, un proveedor pasa al final de la fila por 30 s.
  - Un 429 con espera larga lo deja al final mientras dure esa espera.
  - Sin cuota, con la llave inválida o con un modelo inexistente, queda fuera 5 minutos, salvo que no haya otro.
  - Es por instancia del servidor.
- **Plazos:**
  - Cada intento tiene su tope: 30 s en el nivel rápido y 45–50 s en el capaz.
  - Todo el pedido tiene un plazo total: 50 s en la API, dentro de los 60 s de una función de Netlify.
  - Si la persona cierra la app, se corta la llamada al proveedor.

## Funciones de la app que usan el router

Seis salidas estructuradas usan `generateStructured`:

- el informe de finanzas;
- los textos de las páginas web, con decisión de no hacerla si el pedido es engañoso;
- la lectura de formularios PDF (el PDF completo va al proveedor);
- la clasificación de correos;
- la lectura de precios de páginas sin datos de producto;
- la redacción de alertas de ofertas.

Las tres primeras usan el nivel del plan de la persona: con Claude primero, Haiku en Gratis y Sonnet en Pro. Las otras tres usan siempre el nivel rápido. Si el informe o la página citan cifras que no salen de los datos, se pide una corrección al mismo proveedor.

**Antes del router fallaban en Pro.** Estas funciones forzaban una herramienta, y Sonnet 5.5 (el modelo de Pro) lo rechaza con 400: según la función, la app pasaba a las reglas o la tarea fallaba. Ahora usan salida estructurada y, si Claude falla, responde otro proveedor configurado.

**El chat del agente sigue en Claude** (`modules/agent/run-agent.ts`). Usa sus herramientas, el prompt caching y el historial con el SDK de Anthropic. El router ya admite herramientas y rondas de varias vueltas, así que pasarlo es el paso siguiente si se quiere respaldo también ahí.

## Seguridad

- **Llaves:** solo en el servidor. La app nunca habla directo con un proveedor.
- **Elección de modelo:** la app elige proveedor y nivel, no un modelo arbitrario. El nivel `smart` es de Pro.
- **Límites por plan:**
  - Máximo de tokens de salida: 1.024 en Gratis, 4.096 en Pro.
  - Imágenes por conversación: 2 en Gratis, 4 en Pro.
  - Cuerpo de hasta 4,5 MB, 40 mensajes y 100.000 caracteres.
- **Instrucciones de Omni:** van siempre primero. Lo que mande la app (`instructions`) va debajo y no las reemplaza. Imágenes, archivos y textos citados son datos, nunca instrucciones.
- **Logs:** cada intento queda registrado (`ai.attempt` y `ai.attempt_failed`) con proveedor, modelo, código, estado HTTP y latencia, sin el contenido de la conversación.
- **Consumo:** queda en `ai_usage_logs`, con la columna `provider`.

## Agregar un proveedor

1. Si su API es compatible con Chat Completions, basta `chatCompletionsProvider({ id, apiKey, baseUrl, models })`, en `providers/openai-compatible.ts`.
2. Si no, implementa `ModelProvider` (`ai.types.ts`). Sus partes:
   - `models()` con las capacidades de cada nivel.
   - `generate()`, que arma el pedido, llama con `postJson` y traduce la respuesta a `ProviderResult` y sus errores a `AIProviderError`.
3. Agrega su id en `AI_PROVIDER_IDS` (`src/types/ai.ts`), sus modelos en `ai.catalog.ts` y su llave en `src/lib/env.ts`. Regístralo en `aiRouter()` (`ai.service.ts`).
4. Prueba el pedido, la respuesta y cada error con `fakeFetch` (`tests/support/ai-fakes.ts`).

## Código

| Archivo | Qué hace |
| --- | --- |
| `src/types/ai.ts` | Contrato con la app: `AIResponse`, códigos de error, proveedores, niveles y la vista de modelos. |
| `ai.types.ts` | `AIRequestPrompt`, mensajes (texto, imagen, PDF, herramientas), `ModelProvider` y `ProviderResult`. |
| `ai.errors.ts` | `AIProviderError`, la política de cada código y la respuesta de la API. |
| `ai.http.ts` | POST con tope de tiempo, lectura de `Retry-After` y duraciones. |
| `ai.schema.ts` | JSON Schema para cada proveedor y lectura de JSON. |
| `ai.catalog.ts` | Modelos y capacidades por proveedor, y orden. |
| `ai.router.ts` | El router: candidatos, reintentos, respaldo, cortacircuitos y normalización. |
| `providers/` | Un adaptador por API: `openai.ts`, `anthropic.ts`, `gemini.ts`, `openai-compatible.ts` (xAI). |
| `ai.service.ts` | El router con las llaves del entorno, `generateStructured`, el registro de consumo y la API de la app. |
| `ai.validation.ts` | Lo que acepta `POST /api/v1/ai/chat`. |

Pruebas:

- `tests/unit/ai-providers.test.ts`: pedido, respuesta y errores de cada API, con respuestas como las de su documentación.
- `tests/unit/ai-router.test.ts`: reintentos, respaldo, plazos, cancelación y cortacircuitos.
- `tests/unit/ai-schema.test.ts`: esquemas.
- `tests/unit/ai-service.test.ts`: salida estructurada de punta a punta.
