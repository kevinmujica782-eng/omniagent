# Asistente interactivo de Omni

Se le da una orden a Omni desde cualquier pantalla, con la voz o escribiendo. Es siempre oscuro (clase `theme-dark`). En el teléfono ocupa la pantalla completa; en la compu es un panel centrado.

## Cómo se abre

- La pestaña **Omni** del centro, en el menú de abajo del teléfono.
- La identidad de Omni en el encabezado (marca, nombre y lo que vigila).
- **Ctrl+K** (⌘K en Mac) en la compu. Lo cierran Escape, la X o el cambio de pantalla.

## Estados

| Estado | Qué muestra el ojo | Qué dice |
|---|---|---|
| En espera | La luna ámbar da una vuelta cada 24 s y la pupila la mira. Al abrir, la luna da una vuelta rápida y se posa. | Lo que Omni vigila ahora (la misma línea del encabezado) |
| Escuchando | La luna se detiene arriba, salen ondas del anillo, y la pupila y el anillo laten con el volumen real del micrófono. | Tus palabras en grande mientras las dices (lo que aún no es seguro va en gris) |
| Procesando | La luna corre con su estela, un tramo del anillo gira al revés y la pupila busca. | Qué está haciendo según la orden: «Revisando tu correo y tus trámites…», «Mirando tus cuentas…» |
| Activo | El anillo se aviva, sale una onda y la pupila baja a la respuesta. Si responde en voz alta, el anillo late al hablar. | La respuesta, cuántas cosas esperan aprobación y sugerencias para seguir |
| Error | Anillo y luna en coral. | Qué pasó y qué hacer («Permite el micrófono…») |

Pasados 6 s, Activo vuelve a En espera (si Omni no está hablando), y la respuesta sigue a la vista. Mientras escucha o procesa, se ocultan las órdenes rápidas: en pantalla quedan solo el ojo y tus palabras. Si llega algo nuevo por aprobar (Supabase Realtime sobre `agent_actions`), la luna destella y aparece el aviso.

## Órdenes rápidas

Hay seis: «¿Qué tengo pendiente?», «Revisa mi correo», «Analiza mis gastos», «Vigila un precio», «Rastrea mis pedidos» y «Recuerda algo». Cada una muestra lo que hay en vivo en su área («3 por aprobar», «4 por confirmar», «1 oferta nueva»). Las que necesitan un dato («Vigila el precio de…», «Recuerda que…») quedan escritas en el campo para completarlas; las demás se envían al tocarlas.

## Voz

- **Dictado:** Web Speech API, en el español del teléfono o en `es-US`. El volumen del micrófono para el ojo sale de Web Audio. En iPhone no se abre ese segundo micrófono, porque Safari corta el dictado: ahí el ojo late a ritmo fijo.
- **Respuesta en voz alta:** si le hablas, Omni te responde hablando con `speechSynthesis`, en una voz en español. El botón del altavoz apaga la voz y calla a Omni en el acto. La preferencia queda guardada en el navegador.
- Sin dictado en el navegador, el botón grande pasa a ser «Enviar».

## Código

Todo está en `src/components/assistant/`:

| Archivo | Qué hace |
|---|---|
| `assistant-model.ts` | Estados y reductor puro, textos de cada estado, intención de la orden (a qué módulo va), resumen de la respuesta y texto para leer en voz alta. Sin React. |
| `omni-eye.tsx` | El ojo en SVG. Cada estado es una clase (`is-listening`…); las animaciones están en `globals.css`, en la sección «Asistente de Omni». |
| `omni-assistant.tsx` | El panel: ojo, estado, lo que dijiste, respuesta, aviso en vivo, órdenes rápidas y campo. Las órdenes van a `/api/v1/agent/chat`, el mismo agente del chat. |
| `quick-orders.tsx` | Lista de órdenes rápidas con sus contadores. |
| `assistant-composer.tsx` | Campo para escribir y botón de micrófono, enviar o detener. |
| `assistant-provider.tsx` | Abre y cierra el asistente (pestaña, encabezado, Ctrl+K). |
| `use-speech-input.ts`, `use-audio-level.ts`, `use-speech-output.ts` | Dictado, volumen del micrófono y voz. |
| `use-live-approvals.ts` | Aviso en vivo de lo nuevo por aprobar. |

Con `prefers-reduced-motion`, el ojo no se mueve: cada estado se distingue por su forma y su color, y la etiqueta de estado siempre está escrita.

## Ver sin configurar nada

En `/preview?screen=` están `asistente`, `asistente-escuchando`, `asistente-procesando` y `asistente-activo`. El workflow «Capturas de la interfaz» las fotografía en teléfono y compu y las deja en la rama `ui-checks`.

Pruebas: `tests/unit/assistant.test.ts` (estados, textos, intención, resumen de la respuesta y voz).
