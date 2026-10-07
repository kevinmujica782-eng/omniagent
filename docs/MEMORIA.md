# Memoria de Omni (contexto del agente)

Omni recuerda a cada persona entre conversaciones. Guarda lo que ella cuenta en cinco categorías y, en cada turno del chat, recibe un resumen con lo más relevante para el mensaje.

## Categorías

| Categoría (`kind`) | Qué guarda | Datos tipados (`data`) |
|---|---|---|
| `PREFERENCE` | Cómo quiere que Omni le hable o trabaje | `topic`, `statement`, `strength` (suave/firme) |
| `FINANCE` | Datos de dinero que el banco conectado no muestra | `aspect` (ingreso, gasto fijo, deuda…), `amount {amount, currency}`, `frequency`, `dayOfMonth`, `detail` |
| `WEBSITE` | Páginas y sitios web que creó | `url`, `platform`, `purpose`, `status`, `stack`, `launchedOn` |
| `GOAL` | Metas y aspiraciones | `target`, `targetDate`, `horizon`, `why`, `status`, `trackedGoalId` |
| `NOTE` | Otros datos duraderos (negocio, trabajo, familia) | `text`, `about` |

Los esquemas están en `src/modules/memory/memory.types.ts`. Cada categoría tiene su esquema zod, y `MemoryRecord` es una unión discriminada por `kind`: el compilador sabe qué campos tiene cada recuerdo.

## Cómo funciona

- **Guardar** (`rememberMemory`):
  - Valida los datos con el esquema de su categoría.
  - Rechaza tarjetas (con verificación Luhn), contraseñas, PIN, llaves de API, frases de recuperación, números de documento o de cuenta y datos de salud.
  - No duplica: la clave es la categoría más el título normalizado, sin tildes ni mayúsculas. Una página web se reconoce por su dirección. Al actualizar, lo que no se indica se conserva: no desfija ni baja la importancia.
- **Memoria llena** (200 recuerdos por persona): se descarta el recuerdo menos útil que guardó Omni. Nunca se descarta uno fijado, uno de importancia alta o uno que escribió la persona. Si no queda ninguno descartable, se le pide a la persona borrar alguno.
- **Contexto del turno** (`buildAgentMemory`): lo arma `run-agent.ts` antes de llamar a Claude y va al final del prompt de sistema.
  - Ordena los recuerdos por relevancia. Lo fijado va primero; después pesan la coincidencia con el mensaje (por palabras, sin tildes ni plurales), la importancia y la antigüedad.
  - Suma lo que muestran los módulos: metas que sigue en Metas, el último análisis de Finanzas y lo que aprobó o rechazó, y de qué habló, en los últimos 30 días.
  - Agrupa todo por secciones dentro de un presupuesto de unos 2.600 caracteres. Cada recuerdo va en una sola línea y con su `ref` de 8 caracteres.
  - El bloque se presenta como información, nunca como instrucciones.
  - Si la memoria falla, el turno sigue sin ella.
- **Herramientas del agente** (`memory.tools.ts`):
  - `memory_save_preference`, `memory_save_finance`, `memory_save_website`, `memory_save_goal` y `memory_save_note`. Para corregir un recuerdo se les pasa su `ref`.
  - `memory_recall` busca por palabras y `memory_forget` borra.
- **La persona controla todo** en **Cuenta → Lo que Omni recuerda**: ve cada recuerdo con la misma frase que recibe Omni, lo fija, lo olvida, agrega uno o borra toda la memoria. Borrar la cuenta borra la memoria (en cascada).

## API

| Método y ruta | Qué hace |
|---|---|
| `GET /api/v1/memory?kind=WEBSITE` | Lista los recuerdos vigentes (filtro opcional). |
| `POST /api/v1/memory` | Guarda uno (`{ kind, title, data, importance?, pinned? }`, validado con `memoryInputSchema`). |
| `PATCH /api/v1/memory/:id` | Fija o suelta, o cambia la importancia. Acepta el id o la ref. |
| `DELETE /api/v1/memory/:id` | Olvida uno. |
| `DELETE /api/v1/memory` | Borra todo (`{ "confirm": "BORRAR" }`). |

## Datos

- Tabla `agent_memories`: el `kind`, `data` en jsonb, `dedupe_key` única por persona, `importance` de 1 a 3, `pinned`, `source` (USER, AGENT o SYSTEM), `use_count`, `last_used_at` y `expires_at` para datos que vencen solos.
- Tiene RLS y no da acceso a `anon` ni a `authenticated`: solo el servidor la lee y la escribe.
- La auditoría registra que se creó, cambió u olvidó un recuerdo y de qué categoría, sin su contenido.

Pruebas: `tests/unit/memory.test.ts`. Cubren las reglas puras y el servicio con la base simulada.
