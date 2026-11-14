# Análisis de brecha MarIA Code ↔ upstream oh-my-pi v18.18.9

> Fecha de corte: 2026-11-11. Repo: `/Users/nuevousuario/Documents/oh-my-pi` (MarIA Code, rama `main`, HEAD `d015e8dfb3`). Upstream: remoto `upstream` = `can1357/oh-my-pi`, `upstream/main` = v18.18.9 (2026-11-11). Merge-base: `1a82897c0f` (2026-10-11).
> Público: ingeniería. Todas las afirmaciones proceden de las verificaciones con git de los slices E/M/L/C/N (`/tmp/omp-upstream/verified/*.md`) y del inventario del fork. Lo no observado se marca `[INFERENCIA]`.

---

## 1. Resumen ejecutivo

### 1.1 Estado de upstream hoy
- **37 releases** desde el fork en 31 días (v18.9.2 → v18.18.9; 18.18.5 solo es un bump de versión). Cadencia: ~1,2 releases/día.
- **Deriva total upstream** desde `1a82897c0f`: 5.923 ficheros, +954.915/−259.762. Solo `packages/*/src` + `crates`: 3.504 ficheros, +666.666/−175.251. `crates/` concentra ~1.792 ficheros, +512k/−99k, sobre todo por el **motor Bash 5.3 propio** (`44711a78c1`, v18.17.0) que sustituye a brush.
- **El fork no contiene ningún commit upstream posterior al merge-base**: los 73 commits de `1a82897c0f..HEAD` son propios. El merge-base cae entre v18.9.1 y v18.9.2, así que 4 de las 10 entradas de 18.9.2 ya estaban en el fork (E1). Todo lo demás está ausente salvo que exista un equivalente propio, y los casos se señalan.
- **Fork propio**: 446 ficheros, +45.834/−802. De ellos, 119 ficheros y +24.668 son la extensión VS Code, que es un paquete nuevo. En `packages/{coding-agent,agent,ai,tui,catalog,utils}/src` hay 230 ficheros, +12.904/−679. `crates/` y `packages/natives`: 0 líneas.
- **Requisito de motor**: upstream exige Bun ≥1.4.4 (CVE-2026-91403 y CVE-2026-111497). El fork declara `>=1.3.14`, compila con `BUN_VERSION=1.4.3` en sus 3 Dockerfiles, y la estación local tiene Bun 1.4.3.

### 1.2 Tamaño del gap (tras deduplicar los 5 slices)

| Grupo | Ítems finales | Qué contiene |
|---|---|---|
| **ESTRICTAMENTE NECESARIAS** | **49** (N-01…N-49) | Seguridad y CVE, agent loop/RPC, orquestación de subagentes, prompt cache, conteo de tokens y compactación, robustez de streams Claude/gateway, corrección de tools, natives/utils |
| **POTENCIALES** | **59** (P-01…P-59) | Capacidades nuevas potentes pero opcionales (worker threads, Ask-and-remember, `--max-cost`, `task.perCallModel`, ask HTML…) y bolsas de fixes de valor medio |
| **OTRAS** | **47** (O-01…O-47) | TUI/Tern, proveedores no usados, computer/browser, refactors, borrados |
| Descartados | 17 entradas (§8) | Ya presentes, duplicados del changelog, afirmaciones erróneas de los scouts |

Cobertura: todos los IDs de origen E1–E62, M1–M45, L1–L52 (más L16b y L21b), C1–C38, C40–C65, C70–C78 y N1–N47 aparecen en el anexo A con su ID final o con «descartado».

### 1.3 Conclusiones clave
1. **Hay un CVE abierto y es barato cerrarlo** (N-01): se arregla con 10 líneas (engines, 3 Dockerfiles, pin de CI) y un rebuild. Es prerrequisito de varios cambios upstream (C30, `fs.openSync`).
2. **Hay fugas de seguridad activas por defecto**: Auto-QA envía a `qa.omp.sh` rutas con el home y el login (`dev.autoqaPush.endpoint` está activo por defecto en HEAD); `PI_REQ_DEBUG` vuelca credenciales en claro; el discovery carga `.omp` desde `/tmp` o desde un `~/.omp` ajeno; los settings de proyecto pueden anular el `deny` del operador; y los MCP remotos ignoran el `NODE_EXTRA_CA_CERTS` que la propia extensión inyecta para Netskope. Ver N-02…N-05.
3. **El agent loop y el contrato RPC con VS Code tienen bugs reales**:
   - un «Detener» se deshace solo cuando acaba un subagente (M2);
   - se pierden mensajes en cola tras abort o compactación (M13);
   - `isSettled` es falso tras un `todo` fallido (M14);
   - cambiar de chat entrega jobs al chat equivocado (M15);
   - hay carreras al enviar un prompt tras un interrupt (E59, M12).
   Ver N-06 y N-07.
4. **La orquestación de subagentes, que es el uso intensivo de MarIA, pierde o corrompe resultados**:
   - un mensaje de un peer sustituye al informe final (N-08);
   - un fallo en workpool cancela todo el lote (N-13);
   - `yield` rechaza `data` válido de gateways no estrictos (N-12);
   - `wait` puede bloquear hasta 30 min (N-11);
   - IRC inyecta mensajes con autoridad no-usuario (N-10).
5. **El coste y la latencia de prompt cache sufren fugas evitables**: re-render del system prompt en cada salto de fallback y cambio de roster (N-15), tools MCP de subagentes que reescriben el prompt del principal (N-16), y caché de 1 h ignorada en Vertex Claude, que se arregla con 8 líneas (N-18).
6. **El conteo de contexto está mal para los modelos de MarIA**:
   - Opus 5.5 con thinking sale ~55 % sobrecontado (N-20);
   - los modelos sin familia de tokenizador tras LiteLLM salen infracontados hasta un 48 % (N-22);
   - los modelos chat-completions cuentan thinking que no se envía (N-23).
   Con ello la compactación salta antes o después de tiempo, entra en bucle (N-24, N-25) o descarta resúmenes ya pagados (N-26).
7. **`crates/` + `packages/natives` + `packages/utils` se pueden sincronizar en bloque sin conflicto textual**, porque el fork tiene 0 líneas en crates y natives y solo `dirs.ts` (+5) en utils. Esa sincronización trae el motor Bash 5.3, decenas de fixes de cuelgues, OOM, crashes y corrupción, y el rendimiento nativo de las rutas calientes (N-45…N-48). El coste real está solo en 5–6 consumidores TS conocidos.
8. **El merge completo choca con contratos propios del fork**:
   - `navigate_tree` tiene el mismo nombre pero otra forma (P-20);
   - `ask` pasa a formulario HTML, lo que es una regresión para los diálogos de VS Code (P-19);
   - `task.structured` queda off por defecto, lo que rompe `acceptanceCriteria`, recibos y ledger (P-03);
   - `ui.approve()` cambia a `'once'|'session'|'deny'` (O-05);
   - se elimina `Composer.pinInputToBottom()` (O-39);
   - `rpc-dictation.ts` choca como add/add;
   - `compaction.ts` tiene 6 hunks;
   - la API de snapcompact cambia en 21 usos.

### 1.4 Recomendación de estrategia
**Recomendación: port selectivo por oleadas para las 49 NECESARIAS (olas 0–4), con sincronización en bloque de `crates/natives/utils` y sin merge completo por ahora.** El merge completo (re-baseline sobre v18.18.9) queda como decisión estratégica aparte, para cuando el dueño acepte los breaking de contrato de §7.

Evidencia:
- `git merge-tree --write-tree HEAD upstream/main` → **104 ficheros en conflicto**: 74 en `packages/coding-agent`, 9 en `tui`, 3 en `agent`, 3 en `catalog`, y el resto en sdk/docs/bun.lock. Incluye 6 modify/delete (Code Mode, `archive/declarations.d.ts`, `priority.json`) y 2 add/add (`rpc-dictation.ts` y su test).
- Los conflictos se concentran justo en los hotspots del fork: `agent-session.ts` (+339 del fork), `sdk.ts` (+295), `task/executor.ts` (+272), `rpc-mode.ts` (+223), el wire RPC (+570 en schema), `compaction.ts` (+343) y `composer.ts` (+340).
- Un merge completo obliga a adoptar a la vez ask HTML, `task.structured` off, la retirada de `display()`, worker threads (210 ficheros), el nuevo `navigate_tree` y `ui.approve`. Cada uno exige rehacer partes de la extensión VS Code o de las features propias.
- Al revés, `crates/` y `packages/natives` mezclan sin conflicto, y el `openai-completions.ts` del fork mezcla limpio.

Lo que cambiaría la recomendación:
- Si el objetivo es seguir a upstream de forma continua, cada ciclo de port selectivo encarece el siguiente. `[INFERENCIA]` Tras 2–3 ciclos, el re-baseline sale más barato.
- Si el dueño decide adoptar ask HTML y `task.structured: true` como default propio, el merge completo pasa a ser la opción preferente. En ese caso las olas de §6 sirven como orden de resolución de conflictos dentro de la rama de integración.

---

## 2. Metodología y fuentes

- **Versiones cubiertas**: coding-agent 18.9.2 → 18.18.9 (slices E: 18.9.2–18.11.3; M: 18.12.0–18.13.3; L: 18.14.0–18.18.9). Además, agent/ai/catalog (slice C) y natives/tui/utils/omptype/wire/stats/mnemopi/snapcompact/browser-relay/collab-web/metaharness/robomp/crates (slice N).
- **Fuentes por slice**:
  - Changelog de cada versión leído en **su propio tag** (`/tmp/omp-upstream/changelogs/<pkg>@<tag>.md`).
  - Commits por rango de tags (`git log --no-merges <prev>..<tag> -- <paths>`), con mapeo PR→commit.
  - Presencia de símbolos con `git grep` en `v18.9.1` / `HEAD` / `upstream/main`. Regla: presente en v18.9.1 = heredado; solo en HEAD = propio del fork; ausente en HEAD = gap.
  - Conflictos con `git merge-tree` (`/tmp/omp-upstream/merge-tree.txt`, árbol `84e257305a`).
- **Cifras del fork recalculadas con git** (`git diff --stat 1a82897c0f HEAD`), porque el inventario `ForkInventory` no tenía git.
- **Anexos**:
  - `late-entries.txt`: 568 entradas numeradas de 18.14–18.18 (los `#N` de las fichas L remiten a él).
  - `late-stats.txt`: numstat de unos 140 commits.
  - `core_changelog_raw.txt` y `core_commits.txt`.
- **Correcciones de los scouts**: incorporadas tal como las marcaron los verificadores (`[CORREGIDO]`). Las más relevantes:
  - Code Mode y el modo estructurado de subagentes son **heredados**, no decisiones del fork.
  - `pinnedToolDefinitions` y `adaptiveReserveTokens` son **propios del fork**, no pre-fork.
  - brush ya venía vendorizado por upstream, no por el fork.
  - pinnedInput, stickyPrompt y compactToolOutput son propios del fork y no tienen equivalente con ese nombre upstream.
- **Límites y supuestos no verificables desde el repo**:
  - La configuración real de **driver-ia/LiteLLM** (no está versionada). No se pudo verificar: número de modelos (>50, relevante para N-35), si expone `/v1/messages` (P-34), si anuncia `reasoning_effort_map` (P-06), si usa `cacheControlFormat: anthropic` (P-26), si sirve modelos sin visión ni qué modelos razonadores no-Claude usa (N-28).
  - El tipo de ADC de Vertex, por ejemplo Workforce Identity Federation (P-33).
  - Si MarIA activa memoria Hindsight o Mnemopi (default `off` en RPC), advisors o `snapcompact.toolResults` (default `false`).
  - El SO de despliegue: los puestos son macOS/Windows; Linux solo en contenedores (afecta a P-54/N17).
  - No se ejecutó ningún build ni test; la fiabilidad de cada port se infiere del diff upstream.
- **Rúbrica única de tiers**:
  - **NECESARIA** = corrección del motor o agent loop; contexto y compactación; coste o latencia de prompt cache; corrección de tools; orquestación de subagentes; robustez de proveedor o streaming en los proveedores de MarIA (Vertex Claude, Anthropic-compat, LiteLLM OpenAI-compat); seguridad o privacidad (incluidos CVE); pérdida de datos o crash en rutas RPC, subagente, compactación o sesión; rendimiento de rutas calientes.
  - **POTENCIAL** = capacidad nueva u opt-in valiosa, o fix condicionado a una configuración no verificada.
  - **OTRA** = TUI/Tern, proveedores no usados, refactors, observabilidad indirecta.
  - Cuando los slices discrepan, se resuelve de forma explícita en la ficha con la marca **[Resolución]**.

---

## 3. Estado actual de upstream

### 3.1 Línea temporal por versión (coding-agent salvo indicación)

| Versión | Fecha | Lo más relevante |
|---|---|---|
| 18.9.2 | 10-11 | Refinamiento de `apply_patch`, tope de preguntas al juez de `find`, `gc --apply` de temporales, variantes de OpenRouter, split de bundles (#15298). utils: parser JSON en streaming de los args de tools. ai: breakpoints de caché Anthropic en una pasada; `TypeSafeJudge`→`NativeJudge`. |
| 18.10.0 | 10-12 | IPC nativo owner-only + servidor de embeddings Mnemopi compartido; fix de `RpcClient.stop()`/`ChildProcess.kill`; reescritura del retiro a scrollback en la TUI (**elimina `Composer.pinInputToBottom()`**); `ask` ocultable. |
| 18.10.1 | 10-12 | Tern: botón Copy, contador único agentes/jobs, modales nativos. |
| 18.10.2 | 10-12 | **`task.structured` (off por defecto): los subagentes devuelven texto plano**; jobs en background con salida en vivo; `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`; imágenes con transparencia; builtins coreutils. |
| 18.10.3 | 10-12 | `--restore`; conteo de thinking y imágenes de Claude (`keepRecentTokens` a la mitad); `snapcompact.toolResults` sin romper caché; límites por endpoint oficial; `task.agentSoftRequestBudget`; presupuestos snapcompact desde el catálogo (BREAKING). |
| 18.10.4 | 10-13 | **Eliminado Codex Code Mode**; `reasoning_extraction` tras snapcompact con otro modelo; `gc --compress`; API de plan review para extensiones; aprobaciones como `ask`. |
| 18.11.0 | 10-14 | **Seguridad del discovery (`/tmp`, `~/.omp` ajeno)**; aprobaciones bash en ACP; orden estable de las instrucciones MCP; fixes de compactación remota; fuga de `AgentSession`+MCP; identidad de build en sesiones; hashline que truncaba colas; frontmatter `structured`. |
| 18.11.1 | 10-15 | Escrituras de sesión íntegras; workpool que no cancela el lote; length-stop con umbral bajo; **caché de 1 h en Vertex Claude**; corte de compactación con el último turno Claude; `yield` strict en Anthropic; finish reasons de gateway; caps de salida en `openai-models-list`. |
| 18.11.2 | 10-16 | `yield` con `error` placeholder; grep del fichero completo; bucle de retry en cooldown; reparación de JSONL truncado; `auth-gateway --clients`; `lsp.requestTimeout`. |
| 18.11.3 | 10-16 | `imageCountBudget`; `prewalk.auto`; `/seance`; overflow reportado como éxito; carrera de prompt interrumpido; **`ui.approve()` → `once/session/deny` (BREAKING)**; `system` final en Opus 5.5. |
| 18.12.0 | 10-17 | Re-drive de edición streamed; asentado de Esc; escapes de terminal en la TUI; compresión y prewarm de peticiones (ai); 400 por nombres de tool reproducidos; diagnóstico de errores de red. |
| 18.12.1 | 10-18 | **`display()` eliminado de eval**; `advisor.continueSeverity`. |
| 18.12.2 | 10-18 | Tool `computer` ampliada; shell persistente con auto-background; idle compaction a 1 h; juez por defecto Jev. |
| 18.12.3 | 10-19 | Ask and remember; job widgets; paquete de fixes de `wait`/IRC; guards de hashline; redacción de `PI_REQ_DEBUG`; snapcompact >500k. |
| 18.12.4 | 10-20 | Wake en background tras Esc; cancelación y no-replay en MCP; privacidad de Auto-QA; caché al revivir subagentes; compactación nativa en Bedrock; `PI_SESSION_ID`. |
| 18.12.5 | 10-21 | Caché de 12 h en GPT-5.6; fix de `effort`. |
| 18.12.6 | 10-21 | Extensiones diferidas; steering en ACP; `/mcp reauth` por RPC. |
| 18.13.0 | 10-26 | **Binarios en Bun 1.4.4 (CVE)**; informe de subagente frente a mensaje de peer; 11,5k inline; histéresis de compactación; `--warn-cost/--max-cost`; `/resume` cancela jobs; TTSR lineal; frame `error` in-band; short summary no fatal; esquemas hacia Anthropic. |
| 18.13.1 | 10-27 | `tools.restrictedFolders`; `/pause`; `Agent.isPaused`. |
| 18.13.2 | 10-27 | System prompt estable en fallback (#17014); `navigate_tree` con `summarize`/`set_label`; `abort_and_restore_queue`; Context Viewer; `advertisedReasoning`; STT por RPC; `handlesToolInterrupt`; fixes de shell (timeout/FIFO/OOM). |
| 18.13.3 | 10-28 | **`engines.bun >=1.4.4`**; paginación de LiteLLM; compactación prematura en OpenAI-compat; `isSettled`; latch de wakes; eventos de compactación manual; `rateLimitWalksChain`. |
| 18.14.0 | 10-29 | **Runtime FS asíncrono + grep-searcher vendorizado + pi-walker**; builtins rsync/ast-grep; selectores de modelo exactos; `task.file`; `out://`; proveedores lazy; WebMCP nativo; fuera los workarounds de event loop de Bun. |
| 18.14.1 | 10-31 | `withInactiveTools`; compactación encolable; drenaje keep-alive en Anthropic; `reasoning_effort_map`; padding de imágenes estrechas. |
| 18.14.2 | 10-31 | `task.perCallModel`; `loopGuardLevel` (Claude off); deadline de jueces; stall con deltas vacíos; rechazo de resúmenes truncados. |
| 18.15.0 | 11-01 | Job captions; mensaje temprano a un worker; caché ante cambio de fecha; WIF en Vertex; snapcompact `viewWithoutFrames`; utils sin handlers globales. |
| 18.16.0 | 11-02 | o200k por defecto; Hindsight global; locks SQLite OFD (Linux); `write` rechaza lecturas cortadas; export HTML en streaming. |
| 18.17.0 | 11-06 | **Motor Bash 5.3 propio**; visualización de shell; `omp zsh/bash/sh`; **subagentes en worker threads**; escalera de `wait`; tools MCP acotadas por sesión; segmento `cache`; Text Verbosity `low` por defecto; subagentes sin broadcast; Anthropic threads; ovnfs; presentadores de transcript; omptype 2020-12. |
| 18.18.0 | 11-07 | Outbox de Hindsight; runtime propio para recorridos de FS; aprobación de `task.file`. |
| 18.18.1 | 11-08 | Rust SDK `exclude_from_context`; `/restart` mantiene los subagentes; precedencia de `deny` en bash; JPEG truncado; stall de edit con ruta inexistente. |
| 18.18.2 | 11-08 | `Shell.fork()`; `gc --strip`; **MCP con `NODE_EXTRA_CA_CERTS`**; abort de jq; `__proto__`; `logoutCredential`/`scanLines` (BREAKING). |
| 18.18.3 | 11-09 | **`ask` como formulario HTML (BREAKING)**; delegation-bias `balanced`; `task.eager` solo para el principal; fixes de `omp sh`. |
| 18.18.4 | 11-09 | Bucle de compactación con system prompt fuera de presupuesto; `followUps`; `resolveToolConcurrency`; `perCallModel` anunciado solo si `on`. |
| 18.18.5 | 11-09 | Solo bump de versión (no hay sección coding-agent). |
| 18.18.6 | 11-10 | Discovery de LiteLLM acotado a la key; `settledAtMs`; reindexado de sesiones sin id. |
| 18.18.7 | 11-10 | Presupuestos LiteLLM en `/usage`; `autoRedeem*` renombrados. |
| 18.18.8 | 11-11 | `PI_CODING_AGENT_DIR` en todo; instaladores standalone; `getConfigAgentDirName` eliminado; anclas multi-fichero en edit. |
| 18.18.9 | 11-11 | **IRC como turnos de usuario**; `read` tras `bash` (`earlierEffectsSettled`); jq 1.8.2; `/session delete` por RPC; smithery eliminado; categorías en `/context`. |

### 3.2 Grandes temas y arquitectura nueva
- **Motor Bash 5.3 propio** (`crates/pi-shell`, `44711a78c1`, v18.17.0): lexer y parser propios, IR + VM con safepoints y `RunTrace`. Sustituye a brush-core/brush-parser. Es la base de `Shell.fork()`, de la visualización de shell, de `omp zsh` y de la mayoría de fixes POSIX. Diff de `crates/pi-shell`: 824 ficheros, +325k.
- **Runtime FS asíncrono** (`37d3f1d0c0`, v18.14.0; `fcf34aaeb0` pi-walker; `c0c43f6aee` fs-worker en v18.18.0): búsqueda push-based con un `grep-searcher` vendorizado, cancelación de búsquedas y builtins, y un runtime separado para que los recorridos no acaparen los hilos del shell. Elimina `invalidateFsScanCache`.
- **Subagentes en worker threads** (`d14c75a528`, v18.17.0; 210 ficheros, ±23.825): nuevo `src/thread/` con RPC interno.
- **Job widgets** (`9df0457b31`, v18.12.3): rol `widget`, `proc://<id>/streams`, tiles en `wait` y captions (v18.15).
- **`ask` como formulario HTML** (`ec06d26987`, v18.18.3): `{ html }`, `ui.formDialog()`. En RPC el tool degrada a preguntas campo a campo.
- **Aprobaciones de nueva generación**: `ui.approve()` tri-estado (18.11.3), Ask and remember con `approval-cache.db` (18.12.3), `tools.restrictedFolders` (18.13.1) y precedencia de `deny` (18.18.1).
- **Catálogo como política** (KDL): ejes `thinking-replay-tokens`, `image-count-budget`, `loopGuardLevel`, `delegation-bias balanced`, `shared-prompt-cache`, `supports-long-cache-retention`, etc. Muchos fixes se activan solo regenerando `rules.json`/`models.json`.
- **Prompt cache como objetivo de diseño**: system prompt estable en fallback y roster, recordatorio de fecha append-only, `wireToolsFingerprint`, segmento `cache` y marcador de cache-miss.
- **Orquestación**: escalera de `wait`, mensajes agente-a-agente siempre como turno de usuario, subagentes sin broadcast, `task.perCallModel`, `task.file`, `/seance`.
- **Seguridad**: Bun 1.4.4, discovery sin raíces temporales, redacción de credenciales, `__proto__`, permisos de ficheros 0600 y precedencia del operador.

---

## 4. Qué tiene MarIA Code que upstream no tiene y dónde chocará

### 4.1 Inventario propio (73 commits)
- **Extensión VS Code** (`packages/vscode-extension`, 119 ficheros, +24.668; versiones 0.1→0.36): chat en el Secondary Side Bar sobre `omp --mode rpc-ui`. Incluye sesiones, selector de modelo y thinking, diálogos nativos, plan mode con tarjeta de revisión, pool de `AgentHost`, restaurar cambios al editar un prompt, dictado Groq Whisper, almacén de certificados del SO (Netskope), búsqueda, ghost-text, tarjetas Today, favoritos y popup de background tasks (polling de `get_async_jobs` cada 2 s).
- **Comandos RPC nuevos**: `set_plan_mode`, `navigate_tree`, `dictation_*`, `scope_checkpoint`, `set_delegate_mode`, `get_async_jobs`/`cancel_async_job`, `hurry_subagents`, `PI_RPC_AUTO_TITLE` y `config list --json` con metadatos. Afectan a `rpc-mode.ts` (+223), `rpc-types.ts` (+94), `rpc-wire.schema.json` (+570), `rpc-wire.generated.ts` (+173), `rpc-client.ts` (+106), `rpc-plan.ts` (+253) y `rpc-dictation.ts` (+201).
- **Motor y contexto**:
  - reserva de compactación adaptativa y juez de fidelidad (`compaction.ts` +343, `fidelity.ts` +233);
  - `completeWithTruncationRetry`;
  - `pinnedToolDefinitions`/`getSentToolDefinitions` para que los hijos forkeados compartan la caché;
  - `resolveToolConcurrencyMode()`;
  - división de tool calls paralelas fusionadas por gateways (`openai-completions.ts` +111).
- **Subagentes**:
  - `acceptanceCriteria` (`acceptance-checks.ts` +190);
  - recibos de tools (`tool-receipts.ts` +133);
  - ledger de delegación (`delegation-ledger.ts` +119);
  - `task.maxSubagentsPerPrompt`;
  - `fork: true`;
  - `team_task` (`team-board.ts` +443);
  - modo delegado;
  - `hurry_subagents`.
- **Tools**: guard read-before-overwrite (`write.ts`), sinopsis de salida derramada (`output-synopsis.ts` +301), guards de bucle de tools, `archive.find/open` + `session_search` (FTS, `session-search/*`), contrato tipado eval→tools (`call-scheduler.ts`), `bash-hints.ts`, `read-versions.ts`.
- **Skills**: auto-mejora con rol `curator` (`skill-curation/*`, ~1.400 líneas) e historial reversible.
- **Prompt e identidad**: `system-prompt-general.md` (+336), `system-prompt.md` (+160), workspace snapshot, idioma estricto, estilo cognitivo, checkpoints de alcance y `verify-tracker.ts` (+376).
- **TUI**: `tui.pinnedInput`, `mouseSelection`, `stickyPrompt`, `display.compactToolOutput` y `answerDivider` (`composer.ts` +340, `tool-execution.ts` +184, `transcript-container.ts` +112).
- **Proveedores**: Groq (STT) en el catálogo.

### 4.2 Hotspots del fork que coinciden con conflictos del merge-tree (cifras `git diff --stat 1a82897c0f HEAD`)

| Fichero | Δ fork | ¿Conflicto? | Cambios upstream que caen encima |
|---|---|---|---|
| `coding-agent/src/session/agent-session.ts` | +339 | Sí | M2/M3, M8, M9, M12–M15, E46, E59, L4, L17, L34, worker threads |
| `coding-agent/src/sdk.ts` | +295 | Sí | E29, L15, L31, L18, E30 |
| `coding-agent/src/task/executor.ts` | +272 | Sí | M4, M9/C17, M11, E16, L5, L35, L36, E58 |
| `coding-agent/src/modes/rpc/rpc-mode.ts` / `rpc-types.ts` / `wire/*` / `rpc-wire.schema.json` | +223 / +94 / +570 | Sí | M29 (`navigate_tree`), M30, L33, E48/C22 (`resumedToolCallIds`), M44 |
| `coding-agent/src/modes/rpc/rpc-dictation.ts` | +201 (nuevo) | **add/add** | Upstream añadió su propio STT por RPC (#17158, M44) |
| `agent/src/compaction/compaction.ts` | +343 | Sí (6 hunks) | C4–C8, C37, C38, M7 |
| `coding-agent/src/session/session-maintenance.ts` | +58 | Sí | M7/C5, E28, E38, E57, L16, N24/N25 (16 usos de snapcompact) |
| `coding-agent/src/task/result-summary.ts` | +12 | Sí | M10 (11,5k) frente a los recibos del fork |
| `coding-agent/src/tools/bash.ts` / `write.ts` / `read.ts` / `grep.ts` | +58 / +7 / +6 / +28 | Sí | L39, L40, M18; L22; L21; M39 |
| `coding-agent/src/eval/**` | prelude y tool-bridge del fork | Casi todo `eval/**` en conflicto | M28 (`display()`), L42 |
| `coding-agent/src/prompts/system/*.md`, `prompts/tools/{task,wait,ask,todo,eval}.md` | +160 system-prompt, prompts propios | Sí | E9, E47, L2, L38, C70 |
| `agent/src/agent-loop.ts` / `agent.ts` | +40 / +24 | Sí (1 hunk cada uno) | C16 (`resolveToolConcurrency`), C31 (`withInactiveTools`) |
| `tui/src/prompt/composer.ts`, `chrome/transcript-container.ts`, `chat/tool-execution.ts`, `tui.ts` | +340 / +112 / +184 / +21 | Sí | N31 (retiro a scrollback), N30 (presenters); upstream +2170/−350 en esos ficheros |
| `catalog/src/compat/rules/auth/_order.kdl`, `rules.json`, `models.json` | Groq | Sí | Se regeneran |
| Code Mode (`code-mode-declarations.ts` en tui, `eval-code-mode.md`, tests), `archive/declarations.d.ts`, `priority.json` | modificados | **modify/delete** | Upstream los borró (E23 y otros) |

### 4.3 Choques concretos de contrato o semántica (hay que decidir antes de portar)
1. **`navigate_tree`** (M29 → P-20): el fork lo creó en `47e2dfe1c2` con forma `{type:"navigate_tree"; entryId}` y resultado `{cancelled, editorText, editorImages}`. Upstream usa el **mismo nombre** con `summarize?`, `customInstructions?` y `RpcNavigateTreeResult`, y añade `abort_branch_summary`/`set_label`. Como la extensión VS Code depende de la forma del fork, hay que renombrar uno de los dos o versionar el comando.
2. **`ui.approve()` → `'once'|'session'|'deny'`** (E60, BREAKING 18.11.3): el fork usa `RpcExtensionUIContext` (`rpc-mode.ts:1716`) y los diálogos de `vscode-extension/src/dialogs.ts`, que esperan un booleano. Portarlo exige actualizar la extensión. Ask and remember (P-04) se apoya en el contrato nuevo (`prompt.grants`, `{grant, always}`).
3. **`ask` HTML frente a los diálogos de VS Code** (L29/N29 → P-19): en RPC sin `formDialog`, el tool upstream responde campo a campo con `select`/`input`/`editor`. La extensión pinta hoy el diálogo multi-pregunta nativo (`dialogs.ts:168`), y el plan mode RPC del fork usa `select`. Además `NavigateTreeResult.reopenAsk` pasa a llevar `html`.
4. **`task.structured` off por defecto frente a `acceptanceCriteria`/recibos/ledger** (E9 → P-03): el modo siempre estructurado es heredado de v18.9.1, pero las extensiones del fork (`b877edae80`) dependen de `yield`. Hay que portarlo con `task.structured: true` como default del fork o con frontmatter `structured: true` (E32) en los agentes propios.
5. **`Composer.pinInputToBottom()` eliminado** (tui 18.10.0, N31 → O-39): el fork lo llama en `interactive-mode.ts:8289` y `composer.ts:415`. El pinned input (+340) está construido sobre el modelo anterior de retiro a scrollback.
6. **`resolveToolConcurrency` frente a `resolveToolConcurrencyMode`** (C16): es el único hunk en conflicto de `agent-loop.ts`. Hay que adoptar el nombre y la firma upstream `(tool, args)` y borrar el propio. Es prerrequisito de N-39 (`earlierEffectsSettled`).
7. **`compaction.ts`, 6 hunks**:
   - hunk 3: `completeWithTruncationRetry` (fork) frente al `switch(outcome.kind)` de C6;
   - hunks 1195/1317/2678: `createTruncatedSummaryError` (fork) frente a `incompleteOutputError` (C7);
   - hunk 4: `stripCompactionFidelityBlocks(previousSummaryForReader)` (C37);
   - hunk 5: `snapcompact.computeFileLists` (C38), insertando `buildCompactionFidelity`/`upsertCompactionFidelity` tras las llamadas a `snapcompact.*`.
   La reserva adaptativa del fork mezcla sin conflicto con la histéresis de C5, pero hay que comprobar que el umbral se calcule con la reserva **efectiva**.
8. **`SentToolDefinitions.inactiveFor` → `withInactiveTools(context)`** (C31): es el único hunk de `agent.ts`. Se mantiene la sustitución `pinnedToolDefinitions` y después se llama a `withInactiveTools`.
9. **API de snapcompact** (N24 → P-28): `providerImageBudget(model)`/`providerFrameBudget(model)`; desaparecen `PROVIDER_IMAGE_BUDGETS` y `FRAME_DATA_BYTES_BUDGET`. Afecta a **21 usos + 1 import en 4 ficheros fuente** (16 de ellos en `session-maintenance.ts`, que está en conflicto) y a 9 usos en 4 tests.
10. **`display()` eliminado de eval** (M28 → O-16): el fork lo mantiene (heredado) y casi todo `eval/**` está en conflicto. Portarlo rompe skills y prompts que lo usen.
11. **`rpc-dictation.ts` add/add**: hay dos implementaciones de STT por RPC. La del fork usa Groq; la de upstream es #17158. Hay que elegir una o fusionarlas.
12. **Prompts de sistema**: upstream reescribe `system-prompt.md` (L38, C70, E47) y el fork tiene sus propios prompts (`system-prompt-general.md` +336). Conviene tratar los cambios upstream como inspiración, no como merge literal.
13. **IRC y ledger**: L3 elimina 53 líneas de `irc-bridge.ts` y cambia la semántica de entrega, lo que afecta a `team-board` y ledger. L37 quita el broadcast a subagentes, mientras que los prompts del fork lo mencionan.
14. **`getConfigAgentDirName()` eliminado** (N23): el fork lo usa en 4 ficheros. `invalidateFsScanCache` eliminado: hay que borrar `tools/fs-cache-invalidation.ts`. `encodeSixel` exige un 4º argumento (`tui/src/components/image.ts:713,727`). `readTarEntriesFromBuffer` pasa a ser asíncrona. `ContextUsageView` desaparece y el fork lo usa en 4 ficheros.

---

## 5. Lista de features

Formato de cada ficha:
- **Origen**: IDs de los slices · versión · paquete.
- **Qué hace**.
- **Por qué importa para MarIA**.
- **Estado en el fork**.
- **Commits upstream**.
- **Esfuerzo / Dependencias / Riesgo de conflicto**. `[C]` indica que el fichero está en `merge-tree`.

Orden: por valor global dentro de cada grupo.

### 5.1 ESTRICTAMENTE NECESARIAS (49)

#### Bloque A — Seguridad y CVE

**N-01 — Bun ≥1.4.4: CVE-2026-91403 (CA eMudhra) y CVE-2026-111497 (Brotli OOB)**
- **Origen**: M1, N46 (Bun), N42 (Bun) · 18.13.0 / 18.13.3 · raíz/build y todos los `package.json`.
- **Qué hace**: los binarios se compilan con Bun 1.4.4 y se exige `engines.bun >=1.4.4` y `packageManager bun@>=1.4.4`. De forma opcional se sustituye `openCloexecSync` por `fs.openSync`.
- **Por qué MarIA**: los binarios actuales confían en CAs intermedias comprometidas y llevan un decodificador Brotli con escritura fuera de límites. El almacén de certificados del SO que añade el fork no retira las CAs embebidas en Bun.
- **Estado fork**: ausente. `package.json` declara `bun@>=1.4` y engines `>=1.3.14`; `Dockerfile:25`, `Dockerfile.robomp:20` e `infra/runner.Dockerfile:23` fijan `BUN_VERSION=1.4.3`; el CI no fija versión; local 1.4.3.
- **Commits**: `0f04280fcf` (#16865), `f725d0c17c`, `460030f75a`, `339940e55d`, `c3b645cb27`.
- **Esfuerzo**: bajo (~10 líneas + rebuild). **Dependencias**: ninguna; desbloquea P-32. **Riesgo**: bajo (`package.json` raíz y `bun.lock` están [C] por otras causas; se regeneran).

**N-02 — Fugas de credenciales y privacidad (Auto-QA, `PI_REQ_DEBUG`, permisos 0600, `/memory clear`)**
- **Origen**: M22, C46(a) · 18.12.3 / 18.12.4 / 18.13.0 · coding-agent, ai.
- **Qué hace**:
  - #16409: Auto-QA deja de enviar a `qa.omp.sh` rutas con el home y el login del usuario.
  - fd74e5ee28/eb6b3c7d7b: `PI_REQ_DEBUG=1` redacta la API key, el bearer y las cookies (`utils/request-debug.ts`, `http-inspector.ts`).
  - #16368: `omp-plugins.lock.json` se escribe con 0600.
  - #16654: la migración de `models.yml` es atómica y 0600 (antes podía perder todos los providers custom).
  - #16657: `/memory clear` ya no borra la memoria de todos los proyectos.
- **Por qué MarIA**: en HEAD, `dev.autoqaPush.endpoint` apunta por defecto a `https://qa.omp.sh/v1/grievances` (`tools/settings.ts:1043-1045`) y el reporting está activo tras consentimiento (`report-tool-issue.ts:25`). `models.yml` contiene la config de driver-ia. Es entorno bancario.
- **Estado fork**: ausente.
- **Commits**: los citados, más los commits de #16409/#16368/#16654/#16657 (rango 18.12.4–18.13.0).
- **Esfuerzo**: bajo (<60 líneas cada uno). **Dependencias**: ninguna. **Riesgo**: bajo. **Recomendación adicional**: valorar desactivar o redirigir `dev.autoqaPush` en el fork.

**N-03 — Discovery de proyecto que carga `.omp` desde raíces temporales compartidas o desde un `~/.omp` ajeno**
- **Origen**: E24 · 18.11.0 · coding-agent (`discovery/*`).
- **Qué hace**: el recorrido de discovery no sube a `/tmp`, `/var/tmp` ni al temp dir, y no carga plugins, SYSTEM.md, rules, context files ni skills de un `~/.omp` ajeno cuando `HOME` está sobrescrito.
- **Por qué MarIA**: es inyección de instrucciones desde ubicaciones escribibles por terceros. Los chats «sin workspace» del fork (`62f2b2a681`) pueden arrancar con un cwd no anclado.
- **Estado fork**: ausente (`isTempRoot`/`TEMP_ROOTS` → 0).
- **Commits**: merge `b6beb0cb86`, `2e8650979f`, `6dc13f5e56`.
- **Esfuerzo**: bajo (~150 líneas, 4 ficheros). **Riesgo**: bajo (`discovery/*` no está [C]).

**N-04 — Aprobaciones del bash tool: precedencia de `deny`, autoridad del operador y reglas `prompt` en yolo**
- **Origen**: L39 · 18.14.0 / 18.15.0 / 18.18.1 / 18.18.9 · coding-agent.
- **Qué hace**:
  - #364: un `deny` bloquea en cualquier segmento `; | || &&`, y los settings de proyecto ya no pueden anular con `allow` los `deny`/`prompt` del operador.
  - #546: las reglas `prompt` siguen vigentes en yolo.
  - #125: un comando interceptado no pide aprobación antes de bloquearse.
  - #40: un grant de carpeta cacheado no cubre objetivos ajenos.
- **Por qué MarIA**: un repo hostil podría relajar las reglas del operador. Corrige permisos.
- **Estado fork**: ausente.
- **Commits**: `2277c47058` (`tools/bash.ts` +104/−57), `ff20c711f2`, `00929d42c2`, `4ad05f8908`, `058ef003cb`.
- **Esfuerzo**: bajo (~300 líneas). **Riesgo**: medio (`tools/bash.ts` [C], con +58 del fork).

**N-05 — Los MCP remotos (HTTP/SSE) respetan `NODE_EXTRA_CA_CERTS`**
- **Origen**: L12 · 18.18.2 · coding-agent (`mcp/transports/header-policy.ts`).
- **Qué hace**: las conexiones MCP HTTP y SSE usan el bundle de CA del entorno, incluidos los certificados cargados tras el arranque.
- **Por qué MarIA**: la extensión inyecta `NODE_EXTRA_CA_CERTS` con el almacén del SO y las CA de Netskope (`vscode-extension/src/system-ca.ts:107-122`). Hoy los MCP remotos lo ignoran y fallan tras el proxy que re-firma TLS.
- **Estado fork**: ausente.
- **Commits**: `51d9123be5` (4 ficheros ±92).
- **Esfuerzo**: bajo (<20 líneas). **Riesgo**: bajo.

#### Bloque B — Agent loop y contrato RPC con VS Code

**N-06 — Tras Esc/abort, un job o subagente en background ya no relanza el run (con su latch corregido)**
- **Origen**: M2 + M3 · 18.12.4 + 18.13.3 · coding-agent.
- **Qué hace**:
  - M2: las finalizaciones en background (resultados async, asides MCP/LSP/advisor) no reinician un run detenido; se pliegan al contexto.
  - M3: el latch se activa solo si el interrupt detuvo algo y se libera cuando un turno posterior termina por sí solo (`#turnSettledSinceUserInterrupt`, `suppressAutoResumeUntilPrompt()`).
- **Por qué MarIA**: con delegación intensa, un «Detener» de VS Code (RPC `abort`) se deshace solo al terminar cualquier subagente.
- **Estado fork**: ausente. `agent-session.ts:2013` `injectIdle` llama a `prompt()` sin consultar `autoResumeSuppressed`. El fork tiene el bug inverso al de M3: `:9972` activa el latch en todo interrupt.
- **Commits**: `bb90cc8aa2`, `9d16dff66d` (#17243).
- **Esfuerzo**: bajo (~50 líneas + test). **Dependencias**: M2 y M3 se portan **juntos**; la parte de `event-controller.ts` de M3 depende de #17032 (TUI, opcional). **Riesgo**: alto en fichero (`agent-session.ts` [C]), pero el hunk es pequeño.

**N-07 — Colas, interrupts, settled y cambio de sesión en RPC**
- **Origen**: M12, M13, M14, M15, E59 · 18.11.3–18.13.3 · coding-agent.
- **Qué hace**:
  - M13 #17161: Esc o `abort_and_restore_queue` ya no descartan mensajes en cola de agentes o extensiones, y una entrega fallida tras compactación no borra la cola ni duplica el primer mensaje.
  - M12 #16038: un prompt enviado mientras Esc interrumpe se ejecuta.
  - M14 #17238: `isSettled`/`session_settled` se emiten aunque un `todo` fallido haya encolado un recordatorio.
  - M15 #16760: `/resume` u `open_session` cancelan los jobs de la sesión anterior.
  - E59 #15946: un prompt interrumpido ya no marca idle al siguiente antes de tiempo.
- **Por qué MarIA**: es el patrón de uso de VS Code (detener y escribir enseguida, cambiar de chat con subagentes vivos, depender de settled). La extensión envía prompts sin esperar checkpoint (`1e25042029`).
- **Estado fork**: ausente (`abort_and_restore_queue`, `isSettled` y `session_settled` son heredados, sin estos fixes).
- **Commits**: `ee84ac554e` (1084+/93−), `12d5ccabe4`, `59bfec1618`, `fd440d9a6d`, `8fbaf75aa2`.
- **Esfuerzo**: medio-alto (M13 es grande; el resto son <60 líneas). **Riesgo**: alto (`agent-session.ts`, `input-controller.ts` [C]).

#### Bloque C — Orquestación de subagentes

**N-08 — El informe final de un subagente no se pierde si llega un mensaje de un peer justo al terminar**
- **Origen**: M9 + C17 + C13 (mismo PR #16583) · 18.13.0 · agent + coding-agent.
- **Qué hace**: el resultado o `yield` ya no se sustituye por la respuesta corta al mensaje peer, y el mensaje obtiene su propio turno. Los proveedores aside reciben la frontera `"work"`/`"stop"` para no colarse en un turno ya terminado.
- **Por qué MarIA**: corrompe resultados de delegación con IRC entre peers, que es el uso intensivo de MarIA.
- **Estado fork**: ausente.
- **Commits**: merge `4eec89dd81` (995+/118−, 20 ficheros) = `f13aa651eb` y relacionados (`agent-loop.ts`, `agent.ts`, `types.ts`, `task/executor.ts` +63, `irc-bridge.ts`, `agent-session.ts`).
- **Esfuerzo**: alto. **Riesgo**: alto (`agent-loop.ts`, `agent-session.ts` y `executor.ts` [C]; el fork tocó recibos y ledger en la misma zona).

**N-09 — Paquete de fiabilidad de `wait`/IRC y acks de peers**
- **Origen**: M16 + L4 · 18.12.3–18.15.0 · coding-agent.
- **Qué hace**:
  - `wait` con «Skipped due to a queued background completion» (#16301, #17174).
  - El broadcast `agent://all` despertaba a todos los agentes ociosos (#16312).
  - Un subagente despertado por IRC enviaba el turno entero concatenado (#16302).
  - `agent://` no se actualizaba tras un follow-up (#16305).
  - Se perdía el segundo aside (#16292).
  - Un subagente aparcado despertaba con `todo` (#16281).
  - `wait` por la respuesta a un mensaje (#16445).
  - `proc://<agent>-2` (#17020); «finished without replying» (#16929); `history://Foo-2` (#17112).
  - Subagentes interrumpidos rechazaban mensajes como hard-aborted.
  - L4 #45: un ack de peer no cuenta como respuesta final.
  - L4 #103: un worker al que se escribe mientras arranca no corre sin su `tasks[].task`.
- **Por qué MarIA**: es el núcleo de la orquestación. Hoy hay resultados erróneos y turnos inútiles.
- **Estado fork**: ausente (`irc/bus.ts:110` sigue devolviendo «was hard-aborted…»).
- **Commits**: `05b355a459`, `896aa52a1a`, `0c12c9054a`, `209cafd9b1`, `c388b92d31`, `1ea8ad1efa`, `2bdda7ed8c`, `d33411aee7`, `64ccf65a5a`, `19dd7bc0a3`, `b3baadf2a3`.
- **Esfuerzo**: alto en conjunto (~1.800 líneas, ~12 PRs portables por separado). **Riesgo**: medio (`tools/wait.ts` no está [C]; `irc/bus.ts`, `registry/*` y `executor.ts` parcialmente [C]).

**N-10 — Los mensajes agente-a-agente llegan siempre como turno de usuario**
- **Origen**: L3 · 18.18.9 · coding-agent.
- **Qué hace**: un mensaje IRC que termina un `wait` llega como turno de usuario justo después, nunca con autoridad developer/system.
- **Por qué MarIA**: corrige la autoridad de los mensajes entre agentes (vector de inyección) y el orden de entrega.
- **Estado fork**: ausente (`irc-bridge.ts:196,221` inyecta `role:"custom"`/`"user"` según el camino).
- **Commits**: `7b42b1be60` (21 ficheros ±565).
- **Esfuerzo**: medio. **Dependencias**: N-11. **Riesgo**: medio (semántica de entrega frente a team-board y ledger).

**N-11 — `wait`: escalera de espera ociosa (5 s → 5 min), sin bloqueos de 30 min**
- **Origen**: L2 · 18.17.0 (+18.18.4/18.18.6) · coding-agent.
- **Qué hace**:
  - vuelve a los 5 s si no hay novedades y escala hasta 5 min (#196);
  - agrupa finalizaciones separadas por menos de 1,5 s (#197);
  - los broadcasts y el progreso no cortan la espera (#198);
  - la espera de respuesta se reduce a 5 min (#199);
  - explica cuánto esperó y cómo llegó cada resultado (#474, #497).
- **Por qué MarIA**: latencia y fiabilidad con muchos jobs y subagentes.
- **Estado fork**: ausente (`tools/wait.ts:25` `WAIT_MAX_MS = 30*60_000`).
- **Commits**: `4565560e28`, `adcb8800b6` (29 ficheros ±950), `cb3ff7a044`, `974c8b5a43`.
- **Esfuerzo**: medio (~1,5k líneas). **Dependencias**: L37 (P-10, por `adcb8800b6`), N-09. **Riesgo**: medio (`prompts/tools/wait.md` [C]).

**N-12 — `yield` y esquemas hacia Anthropic: `data` válido con `error` placeholder, `yield` strict, demasiados opcionales, uniones en la raíz**
- **Origen**: E44 + C44 (partes NECESARIAS) · 18.11.1 / 18.11.2 / 18.13.0 · coding-agent, ai.
- **Qué hace**:
  - E44 #15633: acepta `data` si `error` es `unused`/`n/a`.
  - C44: `yield` strict y bufferizado para Claude (2acddcefb6, b907a0a4de); «Schemas contains too many optional parameters» con `outputSchema` grandes (c1f72c9752, 9782c3d2fb); `anyOf/oneOf/allOf` en la raíz enviado como objeto vacío (0d20eee217).
- **Por qué MarIA**: todos los subagentes usan `yield`, los modelos OpenAI-compat vía gateway no son estrictos, y `acceptanceCriteria`/`outputSchema` del fork generan esquemas grandes. Las tools MCP con uniones quedan inutilizables.
- **Estado fork**: ausente.
- **Commits**: `e4091ebccc`, `379903fbea` y los de C44.
- **Esfuerzo**: medio (~500 líneas). **Riesgo**: bajo (`yield.ts` y `anthropic.ts` no están [C]). Las partes POTENCIAL de C44 están en P-14/P-26.

**N-13 — Workpool que no cancela el lote por un ítem, y `task` rechazado que aparecía como éxito**
- **Origen**: E37 + E33 (#15573) · 18.11.0 / 18.11.1 · coding-agent.
- **Qué hace**: conserva el error por ítem sin abortar el lote. Un `task` rechazado ya no se reporta como éxito al host SDK/RPC (1 línea).
- **Por qué MarIA**: orquestación paralela (workpool, delegación); hoy el host VS Code ve éxitos falsos.
- **Estado fork**: ausente.
- **Commits**: `de5727e1b7` (`task/workpool.ts` +13, `tools/yield.ts` +15), `d424cf602d`.
- **Esfuerzo**: bajo. **Riesgo**: bajo (`workpool.ts` y `yield.ts` no están [C]; `task/index.ts` [C], trivial).

**N-14 — Resultado de subagente inline hasta 11.500 caracteres**
- **Origen**: M10 · 18.13.0 · coding-agent.
- **Qué hace**: el padre recibe el informe completo hasta 11,5k en lugar de una vista previa de 5k.
- **Por qué MarIA**: ahorra una lectura extra de `agent://` en cada delegación.
- **Estado fork**: ausente (`result-summary.ts:16` `FULL_OUTPUT_THRESHOLD = 5000`).
- **Commits**: `87a018e0c8`.
- **Esfuerzo**: bajo. **Riesgo**: medio (`result-summary.ts` [C]; el fork añadió recibos ahí).

#### Bloque D — Prompt cache (coste y latencia)

**N-15 — System prompt estable en saltos de fallback, cambios de roster de peers y revivals**
- **Origen**: M4 + M11 · 18.12.4 / 18.13.2 · coding-agent.
- **Qué hace**:
  - un salto de `retry.fallbackChains` no re-renderiza el system prompt salvo que cambie el edit mode, el manejo de descriptores o el toolset (`syncAfterModelChange(prev,{retryFallback:true})`);
  - el roster de peers de un subagente vivo queda congelado (`heldIrcRoster`);
  - un subagente aparcado revive con un prompt byte-estable.
- **Por qué MarIA**: hoy cada salto obliga a Anthropic a reescribir toda la conversación cacheada; se usan cadenas de fallback y peers de forma intensiva.
- **Estado fork**: ausente (`session-tools.ts:886` reconstruye siempre; `turn-recovery.ts:2167/2377/2445` sin `retryFallback`).
- **Commits**: `68c13666af` (279+/25−), `b44c241725` (176+/37−).
- **Esfuerzo**: medio (~300 líneas). **Riesgo**: medio (`turn-recovery.ts` y `session-tools.ts` no están [C]; `executor.ts` y `agent-session.ts` sí).

**N-16 — Instrucciones MCP en orden estable y tools MCP acotadas a la sesión que las cargó**
- **Origen**: E27(a) + L13 · 18.11.0 / 18.17.0 / 18.18.0 · coding-agent.
- **Qué hace**:
  - `## MCP Server Instructions` se ordena por nombre, así que las reconexiones no reescriben la caché (#15705);
  - un subagente que carga tools MCP no cambia las tools ni el prompt del principal (#212);
  - las llamadas MCP concurrentes se conceden a la sesión correcta (#313).
- **Por qué MarIA**: fugas de caché directas en sesiones largas con MCP y subagentes.
- **Estado fork**: ausente (`mcp/manager.ts:182` solo ordena las tools).
- **Commits**: `bbd31f65fe`, `c4917829f8` (30 ficheros ±913).
- **Esfuerzo**: bajo (E27a, 12 líneas) + medio (L13). **Riesgo**: bajo-medio (`mcp/manager.ts` no está [C]; `agent-session.ts` sí).

**N-17 — Caché conservada al reanudar, en forks con eval, ante cambio de fecha, con auto-learn y con settings desconocidos**
- **Origen**: L15 + E27(b) · 18.11.0, 18.15.0–18.18.9 · coding-agent.
- **Qué hace**:
  - la fecha nueva al reanudar otro día o despertar un aparcado ya no reenvía el primer mensaje (#161);
  - la captura de auto-learn reutiliza la caché (#127);
  - una skill auto-escrita se anuncia en el transcript, sin rebuild (#418);
  - prune, rewind y branch conservan los aciertos (#427);
  - un valor de `config.yml` desconocido no hace caer el ajuste a su default (#240);
  - montar una tool MCP no cambia la descripción de eval (#213);
  - los `xd://` de aparcados se conservan (#157);
  - los forks y recargas tras compactación con historial `eval` no pierden caché (#15695).
- **Por qué MarIA**: sesiones largas, reanudaciones diarias y subagentes.
- **Estado fork**: ausente (`date-cwd-reminder.ts` y `config/settings.ts` siguen como en v18.9.1).
- **Commits**: `ee92de203f`, `61a7d88740`, `0f71b2cfde`, `d618f6010c`, `98aa904231`, `7a6550c373`, `ddc1f4d337`. #539 (`82685417be`) requiere P-15.
- **Esfuerzo**: medio (~1,5k líneas en 7 commits independientes). **Riesgo**: medio (`sdk.ts`, `agent-session.ts` y `session-maintenance.ts` [C]).

**N-18 — Vertex Claude: caché de prompt de 1 h (`cacheRetention:"long"`)**
- **Origen**: C40 · ai/catalog 18.11.1.
- **Qué hace**: activa `supports-long-cache-retention` en `google-vertex.kdl` y deja de enviar la beta `extended-cache-ttl-2025-04-11`, que Vertex rechaza.
- **Por qué MarIA**: Vertex Claude es el proveedor principal (`google-vertex/claude-opus-5-5@default`). Con pausas en VS Code, la caché caduca hoy a los 5 min. Requiere además `cacheRetention: long` o `PI_CACHE_RETENTION=long`.
- **Estado fork**: ausente (`anthropic.ts:740` exige `supportsLongCacheRetention`).
- **Commits**: `1924a576ed`.
- **Esfuerzo**: muy bajo (8 líneas + regenerar `rules.json`). **Riesgo**: bajo.

**N-19 — `imageCountBudget` para modelos custom y `modelOverrides`**
- **Origen**: E54 · 18.11.3 · catalog + coding-agent.
- **Qué hace**: un gateway custom declara su límite de imágenes. Hoy el default es 5, y al superarlo se descartan las más antiguas en cada imagen nueva, lo que reescribe la caché en cada turno.
- **Por qué MarIA**: los modelos de visión tras driver-ia sufren esto, y la extensión permite pegar imágenes (`9fe8431258`).
- **Estado fork**: ausente.
- **Commits**: `a49dcbd4f7`, `d2dfdfe98e`.
- **Esfuerzo**: bajo (~30 líneas). **Dependencias**: `request-size.ts` de P-28, aunque se puede adaptar sin él. **Riesgo**: bajo.

#### Bloque E — Conteo de contexto y compactación

**N-20 — Claude: thinking reproducido contado por su salida facturada, imágenes a la tarifa del lector y `keepRecentTokens` sin recortar a la mitad**
- **Origen**: E14(a) + C1 · 18.10.3 · agent/catalog/ai.
- **Qué hace**:
  - el thinking firmado se cuenta por los tokens que Claude facturó, no por el tamaño de la firma (Opus 5.5 salía ~55 % por encima);
  - las imágenes se cuentan con `Tokenizer.imageTokens(size, detail)` del modelo lector;
  - los ejes `thinking-replay-tokens` e `image-tokenization.verified`, y `elidedOutputTokens`.
  - Efecto: la compactación conservaba ~la mitad de `keepRecentTokens`.
- **Por qué MarIA**: Opus 5.5 con thinking en sesiones largas. Hoy la compactación se adelanta y se pierde historial reciente.
- **Estado fork**: ausente (`thinking-replay-tokens` y `elidedOutputTokens` → 0).
- **Commits**: `bec828006f` (#15446), `c1a9d9a43e`, `e9b524cb94`, `7828c571bf`, `01306e4387`, `53516eb568`.
- **Esfuerzo**: medio (~400–500 líneas). **Dependencias**: comparte `tokenizer.ts` con N-22; trae el breaking `applyShakeRegion(s)` / `estimateImageContentTokens`. **Riesgo**: bajo (ni `tokenizer.ts` ni `shake.ts` están tocados por el fork; `rules.json` y `models.json` se regeneran).

**N-21 — Punto de corte de compactación con el último turno Claude**
- **Origen**: C4 · 18.11.1 · agent/ai.
- **Qué hace**: `Tokenizer.countLatestTurn` e `isSurvivingAssistant` cuentan el reasoning firmado que se conserva al cortar, así que no se guarda más de `keepRecentTokens`.
- **Por qué MarIA**: Claude por Vertex usa la API Messages. Tras compactar queda poco margen.
- **Estado fork**: ausente.
- **Commits**: `ea3de8a958`, `3cdf222208`.
- **Esfuerzo**: bajo-medio (~100 líneas). **Dependencias**: N-20. **Riesgo**: medio (`compaction.ts` [C], fuera de los hunks del fork).

**N-22 — Tokenizador o200k_base por defecto y `tokenizer: o200k` en models.yml**
- **Origen**: C2 + E14(b) · 18.10.3 / 18.16.0 · agent/ai/catalog/coding-agent.
- **Qué hace**:
  - los modelos sin familia conocida (Gemini, GLM, Kimi… tras un gateway) se cuentan con o200k en vez de bytes/4, que infravaloraba un 11–48 %;
  - no se cobran al lector las firmas ajenas que la petición elimina (`dropsForeignReasoningPayload`);
  - `o200k` se admite como `tokenizer` en models.yml;
  - el conteo GPT-5+ se hace como el proveedor;
  - el fallback ya no rechaza modelos con ventana menor;
  - se elimina `PI_TOKENIZER_ACCURATE`.
- **Por qué MarIA**: los modelos de driver-ia se infracuentan, la compactación llega tarde y hay riesgo de desbordar la ventana.
- **Estado fork**: ausente (`tokenizer.ts:12,32-36,155` con la heurística; el enum de models.yml no incluye o200k, `models-config-schema-bundle.ts:171-173`).
- **Commits**: `14df7036e7`, `07ec947101`, `0e04ae9c4b`, `7b13d2449d`, `b947e4ac80` (#15447).
- **Esfuerzo**: medio. **Dependencias**: N-20. **Riesgo**: bajo. **Ojo**: el tokenizador nativo pasa a estar siempre activo; conviene medir la CPU (N-47 lo acelera un 11–30 %).

**N-23 — Chat completions: no contar el thinking pasado que no se reenvía**
- **Origen**: M6 + C3 (mismo PR #17231) · 18.13.3 · agent/ai.
- **Qué hace**: la estimación deja de incluir el reasoning que el proveedor no reproduce, así que la compactación ya no salta antes de tiempo.
- **Por qué MarIA**: es exactamente el caso de driver-ia (OpenAI-compat con razonadores).
- **Estado fork**: ausente.
- **Commits**: merge `47c07e4269` = `9ca3b969ec`.
- **Esfuerzo**: bajo (~60–100 líneas). **Riesgo**: bajo (`openai-completions.ts` mezcla limpio con el fork).

**N-24 — Compactación sin bucles: histéresis y no confirmar resúmenes que aumentan el contexto**
- **Origen**: M7 + C5 (mismo commit) · 18.13.0 · agent + coding-agent.
- **Qué hace**:
  - `COMPACTION_RECOVERY_BAND = 0.8`;
  - no confirma un resumen que deja más contexto que antes;
  - no reintenta el mismo cut point;
  - limita lo conservado a lo que cabe bajo el disparador;
  - descarta el usage previo a la compactación;
  - deja de contar el estado cifrado de Codex.
- **Por qué MarIA**: bucles de compactación con auto-continue en sesiones largas.
- **Estado fork**: ausente.
- **Commits**: `c0ddc4b773` (769+/111−, `session-maintenance.ts` +360/−111).
- **Esfuerzo**: medio. **Riesgo**: alto (`compaction.ts` y `session-maintenance.ts` [C]). Es compatible con la reserva adaptativa del fork, pero hay que calcular el umbral con la reserva efectiva.

**N-25 — Compactación: sin bucle cuando el prompt fijo excede el presupuesto, resumen de display sin reasoning, resultados en background durante `/compact`, uso de contexto inflado**
- **Origen**: L16 · 18.14.0 / 18.15.0 / 18.18.4 · coding-agent/agent.
- **Qué hace**:
  - #469: avisa una vez en vez de compactar en cada turno.
  - #480: el display summary se pide sin reasoning (antes salía vacío).
  - #111: los resultados en background durante un `/compact` manual ya no arrancan turnos sobre historia vieja ni desaparecen.
  - #38: los descriptores de tools inline ya no inflan el conteo.
- **Por qué MarIA**: corrección de la compactación y pérdida de datos.
- **Estado fork**: ausente (`disableReasoning` → 0 en `compaction/`).
- **Commits**: `b7968ed353`, `6ddfe5a1d8`, `dc44458606`, `9551c060ed`, `99fb3a561a`, `661233169b`.
- **Esfuerzo**: bajo (~300 líneas). **Riesgo**: alto en `session-maintenance.ts` (conflicto seguro con la reserva adaptativa).

**N-26 — El short summary opcional ya no tumba la compactación**
- **Origen**: C6 · 18.13.0 · agent.
- **Qué hace**: si el blurb falla, devuelve error o vuelve vacío, la compactación termina sin él (`ShortSummaryOutcome`).
- **Por qué MarIA**: hoy un fallo del blurb descarta un resumen completo ya pagado (`compaction.ts:2236` sin captura; el fork solo tolera `length`).
- **Estado fork**: ausente.
- **Commits**: `649b095b95`.
- **Esfuerzo**: bajo (~100 líneas). **Riesgo**: alto pero mecánico (hunk 3 de `compaction.ts`: combinar `completeWithTruncationRetry` con `switch(outcome.kind)`).

**N-27 — Rutas de fallo de la compactación: esperas de `retry-after` de horas, length-stop, overflow tomado por éxito, tool result perdido en `/compact`**
- **Origen**: E28(b), E38(a), E57, M8 · 18.11.0–18.12.3 · coding-agent/agent.
- **Qué hace**:
  - E28b #15311: la auto-compactación no espera un `retry-after` de 16 h y prueba el siguiente método.
  - E38a #15870: la salida descartada no cuenta contra el umbral y la respuesta truncada se conserva.
  - E57 #15897: un overflow no compactable deja de devolver al padre una respuesta antigua como si fuera final.
  - M8 #16241/#16362: el resultado de un tool abortado por `/compact`, `/new` o cambio de sesión se persiste (antes «No result provided»).
- **Por qué MarIA**: sesiones bloqueadas, orquestación corrompida y pérdida de datos en rutas RPC (`compact`, cambio de chat).
- **Estado fork**: ausente.
- **Commits**: `6829f4af94`, `0aa87dd96d`, `1df9f0d2d8`, `e5c9dbaeef`, `12e8a24608`, `eb86821325`, `86f458875e`.
- **Esfuerzo**: bajo-medio. **Riesgo**: alto-trivial (`session-maintenance.ts`, `agent-session.ts` [C]).

**N-28 — snapcompact: vistas para el lector sin frames y sin reasoning, y resumidor Claude sin reasoning de otro modelo**
- **Origen**: N25 + E18 + C37 · 18.10.4 / 18.15.0 / 18.16.0 · snapcompact, agent, catalog, coding-agent.
- **Qué hace**:
  - `viewWithoutThinking()`/`Archive.withoutThinking` y `viewWithoutFrames` (un modelo sin visión lee el texto conservado);
  - `archiveIncludesThinking()`, `viewSummary()`;
  - Claude, `/btw`, `/handoff` y la compactación leen una copia sin razonamiento, lo que evita el rechazo `reasoning_extraction` en cada turno (#15436);
  - eje `classifier-cot-extraction`.
- **Por qué MarIA**: snapcompact es el 2.º método del orden por defecto (`compaction-methods.ts:44`) y en la práctica el primero para Claude y LiteLLM `[INFERENCIA: "remote" solo aplica a endpoints OpenAI Responses]`. Los modelos sin visión o los razonadores no-Claude tras driver-ia reciben hoy frames ilegibles o razonamiento ajeno.
- **Estado fork**: ausente (`viewWithoutThinking` → 0).
- **Commits**: `6f32daf6cc`, `31863e466f`, `ee263c01a1`, `432073b7de`, `125d01c740`, `60b38ec2d7`, `41468ea5c9`, `921f5562ca`, `dc0b2034f5`, `ef936daf02`, `378971a58c`, `140645efb7`, `004215024b`.
- **Esfuerzo**: medio (~750 líneas). **Dependencias**: firma por modelo de P-28 (parcial) y ejes de catálogo. **Riesgo**: medio-alto (`session-maintenance.ts` y hunk 4 de `compaction.ts` [C]).
- **[Resolución]**: E consideraba E18 POTENCIAL («solo si se alternan modelos») y N consideraba N25 NECESARIA. Se unifican como NECESARIA porque la vista sin frames aplica a cualquier modelo sin visión del gateway, no solo al cambio de modelo.

#### Bloque F — Robustez de proveedor y streaming (Vertex/Anthropic/LiteLLM)

**N-29 — Guard de bucle de thinking por niveles (Claude desactivado)**
- **Origen**: C41 · ai/catalog 18.14.2 (BREAKING `isLoopGuardedModel` → `loopGuardLevel`).
- **Qué hace**: el guard pasa a ser un eje de catálogo: Claude `off`, Gemini/DeepSeek/Grok `semantic`, el resto `exact`, y los ciclos exactos multilínea necesitan 1.024 caracteres.
- **Por qué MarIA**: Opus 5.5 repite líneas de progreso en su thinking, y un falso «Thinking loop detected» aborta el turno del modelo principal.
- **Estado fork**: ausente (`thinking-loop.ts:126-134` aplica la detección exacta a todos los modelos).
- **Commits**: `883431d5fa`.
- **Esfuerzo**: bajo-medio (~150 líneas + regenerar). **Riesgo**: bajo.

**N-30 — Streams Anthropic robustos ante gateways y proxies**
- **Origen**: C42 (partes NECESARIAS) + M19 · 18.12.3 / 18.13.0 / 18.14.2 · ai + coding-agent.
- **Qué hace**:
  - un stream que solo envía deltas vacíos ahora expira (#17484);
  - un corte tras `message_start` con frame `error` in-band se trata como truncamiento reintentable y continúa desde la respuesta parcial (#16990);
  - un corte antes de `message_delta` es reintentable.
- **Por qué MarIA**: Netskope y LiteLLM cortan streams. Hoy el agente se cuelga o termina el turno.
- **Estado fork**: ausente (el fork no tocó `anthropic.ts`).
- **Commits**: `90d309a8b3`, `a7964062c9` (271+/39−), `c5052b8064`.
- **Esfuerzo**: bajo-medio (~250 líneas). **Riesgo**: bajo (`turn-recovery.ts` no está [C]). Las partes POTENCIAL de C42 están en P-34.

**N-31 — Sesiones Anthropic atascadas: thinking modificado tras fallback o rechazo, `system` final en Opus 5.5, nombres de tools no soportados**
- **Origen**: C43 + C45 · 18.11.0 / 18.11.3 / 18.12.0 / 18.18.2 · ai.
- **Qué hace**:
  - recupera el 400 «thinking… cannot be modified» tras un fallback a mitad de turno (5039c3f95a) y tras un turno rechazado con thinking seguido de steer o recordatorio (7adf3403b3);
  - en Opus 5.5, las menciones `@file` y los mensajes ocultos cierran en turno de usuario en vez de `system` final (b5e360c431);
  - los nombres de tool no soportados por el wire destino ya no bloquean la sesión con HTTP 400 (37091247c5).
- **Por qué MarIA**: es pérdida de sesión en el camino Claude, y los steers y recordatorios son constantes en MarIA.
- **Estado fork**: ausente.
- **Commits**: los citados.
- **Esfuerzo**: medio. **Riesgo**: bajo-medio.

**N-32 — Reintentos y fallback de proveedor**
- **Origen**: L18 + E46 + C47 (77e080cb83) · 18.11.1–18.18.6 · coding-agent/ai.
- **Qué hace**:
  - sin credencial usable, salta al primer candidato con credencial (#110);
  - la falta de saldo (402/budget de LiteLLM) falla al instante (#273);
  - máximo 3 abortos genéricos (#481);
  - un usage-limit tardío ya no bloquea el proveedor actual (#487);
  - `--model @rol` recorre la cadena (#467);
  - la rotación denegada queda acotada (#69);
  - el sueño cuenta para el reset (#113);
  - E46 #14611: bucle infinito de reintentos al expirar el cooldown del primario;
  - C47: «temporarily unavailable» y los finish reasons `unknown/other/unspecified` reintentan.
- **Por qué MarIA**: es la robustez en los caminos de MarIA (gateway, fallback, presupuesto).
- **Estado fork**: ausente (`turn-recovery.ts` igual que en v18.9.1).
- **Commits**: `fd83e87761`, `7126fa67d7`, `784f39c011`, `1af565e2ee`, `8cf606f833`, `34165c9209`, `fe4dc2b8c8`, `77e080cb83`.
- **Esfuerzo**: medio (~850 líneas). **Riesgo**: bajo-medio (`sdk.ts`, `main.ts` y `agent-session.ts` [C] solo en hunks pequeños).

**N-33 — Los selectores de modelo con proveedor exigen ID exacto (BREAKING)**
- **Origen**: L1 · 18.14.0 · coding-agent.
- **Qué hace**: `proveedor/id` en `--model`, settings, roles y `task` debe coincidir exactamente; un casi-acierto falla con sugerencias. Avisa si el modelo por defecto o el de dictado no existe. Los roles de models.yml dejan de distinguir mayúsculas.
- **Por qué MarIA**: hoy un typo en `driver-ia/…` o en `modelRoles` enruta en silencio a otro modelo.
- **Estado fork**: ausente (`model-resolver.ts:14,730` con «provider-scoped fuzzy → substring»).
- **Commits**: `43a2bd4216`, `0a809c9487`.
- **Esfuerzo**: bajo (~120 líneas). **Riesgo**: bajo, pero hay que revisar los alias de driver-ia.

**N-34 — Discovery OpenAI-compat: límites de salida correctos**
- **Origen**: E40 + E49 (max_tokens) · 18.11.1 / 18.11.2 · coding-agent (`config/model-discovery.ts`).
- **Qué hace**: toma el límite de salida de `top_provider.max_completion_tokens`, de `max_output_tokens`/`max_completion_tokens` de primer nivel y de `max_tokens` plano, en vez de heredar un cap tan grande como la ventana.
- **Por qué MarIA**: un `max_completion_tokens` sobredimensionado provoca 400 en driver-ia.
- **Estado fork**: ausente.
- **Commits**: `25e006079e`, `89e1bdbfe8`, `8235fb41dc`, `695abf71f3`.
- **Esfuerzo**: bajo (~55 líneas). **Riesgo**: bajo.

**N-35 — LiteLLM: paginación de `/v2/model/info`**
- **Origen**: M5 + C51 (pieza catalog) · 18.13.3 · catalog + coding-agent.
- **Qué hace**: lee todas las páginas antes de fijar el roster (antes cacheaba solo 50 entradas), con fallback ante una paginación malformada y refresco de los rosters cacheados.
- **Por qué MarIA**: un driver-ia con más de 50 modelos los pierde en silencio `[no verificable: tamaño del roster]`.
- **Estado fork**: ausente (`openai-compat.ts:5499` sin paginación).
- **Commits**: merge `cae8b7b9e7` = `d9d4c21794`.
- **Esfuerzo**: bajo-medio (~240 líneas). **Riesgo**: bajo.

#### Bloque G — Integridad de sesión, tools y MCP

**N-36 — Integridad de sesión y fuga de memoria en el host**
- **Origen**: E36, E48 (#14582), L17 (#224, #392, #551), E29 · 18.11.0–18.18.9 · coding-agent.
- **Qué hace**:
  - E36 #15588: espera a las escrituras en streaming antes de publicar (antes el historial se sustituía por reescrituras incompletas).
  - E48 #14582: repara un JSONL que acaba en un registro truncado.
  - L17 #224: un getter de `details` que lanza ya no detiene todos los guardados posteriores.
  - L17 #392: las transiciones solapadas switch/fork/new se serializan.
  - L17 #551: `/session delete` en RPC cambia primero la sesión viva.
  - E29 #15386: se libera el `AgentSession` desechado junto con su MCP manager.
- **Por qué MarIA**: pérdida de datos en sesiones largas y un host RPC de vida larga que crea y descarta sesiones (`93fdd69cf1` keep warm).
- **Estado fork**: ausente.
- **Commits**: `aa43e7263a`, `40fb36694c`, `8e95a8e25f`, `2900bf5a6c`, `f8ce71170d`, commits de #551, `233e444c03`.
- **Esfuerzo**: bajo-medio. **Riesgo**: bajo en storage/loader/persistence; medio en `agent-session.ts`, `sdk.ts` [C]. El resto de L17 (#404, #95, #164, #396/#430, #496) está en P-02.

**N-37 — Integridad de edit/write: colas truncadas por columna, tags obsoletos, PUT que repite la línea vecina, CRLF/BOM, hex dumps**
- **Origen**: E34 (hashline #15649), M17, L22 · 18.11.0–18.16.0 · crates/pi-edit + coding-agent.
- **Qué hace**:
  - hashline rechaza una edición sobre una línea cortada por `read`/`grep` hasta un `:raw` (#15649, #16171);
  - `PUT N*`/`CUT N*` sobre líneas no vistas (#16209);
  - líneas desplazadas desde `grep -n` bajo tag viejo (#16383, #16422, #17033/#16208);
  - `REM`/`MV` con tag inventado (#16381);
  - #16423, #16425;
  - `write` borraba números iniciales (#16441);
  - moves sin bit ejecutable (#16042);
  - PUT que repite la línea vecina (#17028);
  - CRLF→LF y BOM (#16575);
  - apply_patch por líneas completas (#17184);
  - L22 #160: `write` rechaza contenido procedente de un `read` con líneas cortadas.
- **Por qué MarIA**: corrupción silenciosa de ficheros con la herramienta principal. El guard read-before-overwrite del fork comprueba que hubo lectura, no que fuera completa; son complementarios.
- **Estado fork**: ausente.
- **Commits**: `c7648f680f`, `161920c920`, `f1b410824b`, `fd4fea523a`, `25b4ab1646`, `890cb73f46`, `1e479b58d7` y los del grupo M17.
- **Esfuerzo**: medio-alto (mucho Rust en `pi-edit`). **Riesgo**: medio (`write.ts` [C] con el guard del fork; `edit/settings.ts` [C]; los crates no tienen conflicto).

**N-38 — Edición streamed fallida: se re-ejecuta el turno en vez de terminar el run**
- **Origen**: M21 · 18.12.0 · coding-agent.
- **Qué hace**: un preview de edición streamed que falla ya no termina el run entero sin reintento.
- **Por qué MarIA**: runs que mueren a mitad de tareas largas.
- **Estado fork**: ausente.
- **Commits**: `28ebf76974` (#15790, 494+).
- **Esfuerzo**: medio. **Riesgo**: medio.

**N-39 — `read` en el mismo mensaje que `bash` ya no devuelve el fichero anterior (`toolCall.earlierEffectsSettled`)**
- **Origen**: L21 + C15 · 18.18.9 · agent + coding-agent.
- **Qué hace**: una llamada especulativa espera a que se asienten los efectos de las llamadas previas del mismo mensaje que pueden escribir; si se cancela mientras espera, no hace commit.
- **Por qué MarIA**: el modelo emite `bash` y `read` en paralelo, y la división de tool calls paralelas del fork aumenta la exposición. El guard read-before-overwrite no lo cubre.
- **Estado fork**: ausente (la ejecución especulativa es heredada).
- **Commits**: `c0c093fd91`, `4b8a249e50`, `40e38a0c1f`, `0acf8cc784`, `f5c214f86e`, `491f5f5b03`, `2bf9cbc0ed`, `62c255338b`, `1b4637096c`, `6a4156871d`, `70bcbe0ec4`, `0dba333023`, `99c165f530`.
- **Esfuerzo**: medio (agent ~50 líneas, `read.ts` ~600). **Dependencias**: `ad77cd0877` (C16: adoptar `resolveToolConcurrency` y retirar `resolveToolConcurrencyMode`). **Riesgo**: alto (`read.ts` [C], `agent-loop.ts` [C] junto al hunk de concurrencia).

**N-40 — `read`/`grep` sin falsos negativos: directorios ocultos, líneas largas, listas `;`, truncado por fichero sin aviso**
- **Origen**: L21b + M39 (#16594) · 18.13.0–18.18.8 · coding-agent + natives.
- **Qué hace**:
  - `read` de un directorio ya no oculta `dist`/`build`/`node_modules`/`.git` (#87);
  - una URL cuya primera línea pasa de 50 KB devuelve contenido (#97);
  - la paginación cuenta el ancho mostrado (#159);
  - `grep`/`glob` buscan en cada objetivo de una lista `;` que mezcla URL interna y ruta (#531);
  - grep avisa al recortar a 20 coincidencias por fichero (#16594).
- **Por qué MarIA**: hoy el modelo concluye «no existe» cuando sí existe.
- **Estado fork**: ausente.
- **Commits**: `dcb4d4a5c4`, `3b04762106`, `12a095085d`, `44d9bc2cb0`.
- **Esfuerzo**: bajo-medio. **Riesgo**: medio (`read.ts`, `glob.ts`, `grep.ts` [C]).

**N-41 — TTSR: coste cuadrático con argumentos largos**
- **Origen**: M20 · 18.13.0 · coding-agent (`export/ttsr.ts`).
- **Qué hace**: 64 KB con 10 reglas pasan de 120 ms a 4,5 ms.
- **Por qué MarIA**: es la ruta caliente del streaming de cada tool call, con las reglas `ts-*` integradas activas.
- **Estado fork**: ausente.
- **Commits**: `20d1113fc9`.
- **Esfuerzo**: bajo. **Riesgo**: bajo. Las relacionadas #16242/#16556/#16419/#16420/#17099 están en P-58.

**N-42 — MCP: no repetir una llamada si cae la conexión y cancelar de verdad las requests abortadas**
- **Origen**: M34 (#16429, #16430) · 18.12.4 · coding-agent.
- **Qué hace**: envía `notifications/cancelled` y deja de reproducir una llamada con efectos laterales tras una reconexión.
- **Por qué MarIA**: hoy una tool MCP con efectos laterales puede ejecutarse dos veces.
- **Estado fork**: ausente (`notifications/cancelled` → 0).
- **Commits**: los de #16429/#16430 (rango 18.12.4).
- **Esfuerzo**: medio. **Riesgo**: bajo-medio. El progreso MCP (#16431) está en P-08.

**N-43 — Imágenes que tumban la petición: padding de imágenes estrechas y JPEG truncado**
- **Origen**: L45 (#231, #320) + N27 · 18.13.0 / 18.14.1 / 18.17.0 / 18.18.1 · coding-agent, tui.
- **Qué hace**:
  - rellena las imágenes de tool muy estrechas hasta el mínimo de visión (antes 400 persistente);
  - rechaza y omite un JPEG truncado antes de EOI en vez de fallar toda la petición con «unsupported image» (#18385);
  - acepta base64 con padding malformado;
  - corrige el crash al reanudar con una ruta de tool-call no enlazable (#16806) y el de tablas casi iguales.
- **Por qué MarIA**: hoy la sesión queda atascada con Anthropic/Vertex, también desde VS Code al adjuntar imágenes.
- **Estado fork**: ausente.
- **Commits**: `68f44f01a4`, `11e450f1bf`, `1ee3353ca7`.
- **Esfuerzo**: bajo. **Riesgo**: bajo. El resto de L45 (#68/#74/#53) está en P-28.

**N-44 — Entorno del bash tool: cuelgues con Git Credential Manager y `rebase -i`, y fuga de shells por superficie**
- **Origen**: L40 (#124, #533) · 18.15.0 / 18.18.8 · coding-agent + `crates/pi-shell/src/git.rs`.
- **Qué hace**:
  - `git rebase -i` con `sequence.editor` y los prompts GUI de GCM ya no cuelgan;
  - se liberan los shells persistentes por superficie al cerrar o cambiar de sesión.
- **Por qué MarIA**: los equipos corporativos usan GCM, y las sesiones RPC son largas.
- **Estado fork**: ausente. `git.rs` y `non-interactive-env.ts` existen en HEAD, así que se puede portar sin N-45 `[INFERENCIA: adaptar el hunk al árbol brush]`.
- **Commits**: `c22b4b15de`, `2f833c5645`, `22db378ad6` y el commit de #533.
- **Esfuerzo**: bajo-medio. **Riesgo**: medio (`tools/bash.ts` [C]). El resto de L40 está en P-38.

#### Bloque H — Natives, crates y utils (sincronización en bloque)

**N-45 — Motor Bash 5.3 propio con todos los fixes del shell (sustituye a brush)**
- **Origen**: N1 + N2 + N3 + L23 + M18 · 18.11.0–18.18.9 · `crates/pi-shell`, `pi-builtins`, `packages/natives`.
- **Qué hace**: `Shell`/`executeShell` pasan a un motor propio con semántica 5.3, IR+VM y `RunTrace`, y parsean ~33 % más rápido. Incorpora:
  - N2: el `rm -rf C:` relativo a la unidad que borraba el cwd en Windows (#15511); `read` colgado con process substitution o en pipeline; `timeout`/abort que no paraba builtins; FIFOs; stack overflow en `rm -r`/`du`; OOM de grep en ficheros sin saltos de línea; `xargs`, globs, `sort`, `kill %N`, `$!`…
  - M18 #16153: el shell persistente perdía variables y funciones con auto-background o `set -e`.
  - N3: arrays asociativos O(n); git, hooks y ssh dejan de heredar el terminal; `env -i`; expansiones de llaves; glibc 2.17; Windows PATH.
  - Límite de anidamiento; crash con valores multibyte; `grep -e -x`.
- **Por qué MarIA**: bash es la tool más usada. Hoy hay cuelgues, OOM o stack overflow que matan la sesión, y un borrado de datos en Windows corporativo.
- **Estado fork**: ausente. El fork tiene 0 líneas en `crates/`; brush venía vendorizado por upstream desde v18.9.1.
- **Commits**: `44711a78c1` (1044 ficheros, +163k/−81k), `bba82e351a`, `6d543cb11a`, `ece055eb3c`, `ec8be1b324`, `1e2fbfd2e2` (base de P-17), `32524d8b07`, `2f833c5645`, `04875a734b`.
- **Esfuerzo**: alto en volumen pero **mecánico** (sustituir `crates/` + `packages/natives` en bloque). La parte TS se limita al renderer bash del TUI (`tui/src/tools/bash.ts`, +17 del fork) y `test/tools-native-shell.test.ts`.
- **Dependencias**: N-46 (runtime FS 18.14); N-01 (Bun 1.4.4). **Riesgo**: nulo en crates; bajo-medio en TS.
- **[Resolución]**: L puso L23 como POTENCIAL («coste y riesgo muy altos, no admite cherry-pick») y N puso N1 como NECESARIA. Se adopta **NECESARIA** con la evidencia de N: el fork no tiene ni una línea en crates, así que la sustitución en bloque no genera conflicto textual. Además, portar uno a uno los ~40 fixes de N2/N3 sobre brush costaría más. La visualización (L24), `omp zsh` (L25) y `Shell.fork` (P-17) quedan como decisiones aparte.

**N-46 — Runtime FS asíncrono, búsqueda con cancelación, runtime propio para recorridos y corrección de edit/ast/grep/git nativos y crashes**
- **Origen**: N5, N6, N9, N10, N11, E45, E42 (#15760), E61 (#15950) · 18.9.2–18.18.8 · `crates/pi-natives`, `pi-walker`, `pi-ast`, `pi-edit`, `pi-vcs`, `vendor/grep-searcher`.
- **Qué hace**:
  - N5: `search_push`; `rg`/`grep` paralelos; **las búsquedas y builtins se paran al cancelar o al timeout**; grep de un fichero nombrado completo en vez de 4 MiB (E45).
  - N6: `pi-fs-worker`, para que una búsqueda en un árbol frío no acapare los hilos del shell.
  - N9: memoria sin límite con gramáticas WASM; crash con Markdown muy anidado; stack overflow o stall de edit con ruta inexistente.
  - N10: **`astGrep`/`astEdit` reescribían ficheros que no parsean**; filtros `{src,test}` vacíos (E42 #15760); `ast_grep` «No matches» con patrón inválido (E61); `maxCountPerFile`; `rg`/`fd` vacíos bajo symlink (`/tmp` en macOS).
  - N11: `submodulePaths()` con `..` o rutas absolutas; `copyGitObjects` no atómico.
- **Por qué MarIA**: grep, glob, find y edit son rutas calientes; hay corrupción vía `ast_edit`, búsquedas vacías en macOS y bloqueos cruzados entre subagentes.
- **Estado fork**: ausente (`grep-searcher = "0.1"`, `grep.rs:41 MAX_FILE_BYTES = 4 MiB`).
- **Commits**: `37d3f1d0c0` (82 ficheros, +17k), `fcf34aaeb0` (111 ficheros), `c0c43f6aee`, `d52fd79e4b`, `5692998caa`, `2f1b49b19a`, `0bdbc3ed5e`, `1dac23d61d`.
- **Esfuerzo**: incluido en la sincronización de crates. En TS hay que **borrar `tools/fs-cache-invalidation.ts`** (`invalidateFsScanCache` eliminado) y aplicar las partes de `tools/grep.ts`.
- **Dependencias**: ninguna; N6 requiere N5. **Riesgo**: nulo en crates; medio en `tools/grep.ts` [C].

**N-47 — Rendimiento nativo en rutas calientes y minimizador de salida correcto**
- **Origen**: N8, N12, E52(a) · 18.10.0–18.17.0 · crates.
- **Qué hace**:
  - N8: tokenización un 11–30 % más rápida, formateo hashline, diffs de edición y fuzzy matching, git log reciente, menos allocations.
  - E52a: menos CPU en syntax checks y auto-repair.
  - N12: el minimizador de `git diff`/`show`/`diff -u` **perdía cambios e inventaba ficheros** con líneas `-- `/`++ ` (#16588); la salida ≤16 KB llega entera (#16589); ssh sin recorte; conteos de ruff, git status y cargo correctos; en tui, la salida minimizada respeta `tools.outputMaxColumns` (#16314).
- **Por qué MarIA**: es el coste por turno, y el modelo recibía diffs falsos.
- **Estado fork**: ausente.
- **Commits**: las entradas de natives 18.12.2–18.13.2 (#16210–#16214, #16349, #17016…) y `dbe5ee1861`.
- **Esfuerzo**: incluido en crates; la parte tui de N12 es pequeña. **Riesgo**: nulo (natives) o bajo (`tui/src/tools/bash.ts`).

**N-48 — utils: spawn/exec con descendientes, kill y señales, parser JSON de args en streaming, seguridad de archivos y JSON**
- **Origen**: N18, N19, N20, N21, E5 · 18.9.2–18.18.2 · `packages/utils`.
- **Qué hace**:
  - N18: los timeouts de `spawn`/`exec` saltan aunque la raíz salga antes; el abort ya no se bloquea con descendientes que retienen stdout.
  - N19/E5: `ChildProcess.kill()` señaliza directamente con SIGKILL tras la gracia (antes `RpcClient.stop()` podía esperar para siempre); no hay rechazo no manejado con una señal ya abortada; importar pi-utils no instala handlers globales (#17674); `fatal()` en worker.
  - N20: parser JSON en streaming de los args de tools, más rápido y correcto con strings largos.
  - N21: extracción en Windows siguiendo symlinks; bombas de descompresión (`maxStreamSize` 4 GB); **`__proto__` en JSON relajado** (prototype pollution).
- **Por qué MarIA**: cuelgues de tools, procesos zombis y seguridad. N20 afecta a todas las tool calls.
- **Estado fork**: ausente (0 diff en `ptree.ts`).
- **Commits**: `dc29de04db`, `f18113471c`, `399dc56cd3`, `7ed44e8b82`, `23716b3b1d`, `09e17512dc`, `487d9f0d17`.
- **Esfuerzo**: bajo-medio. **Dependencias**: hay que adaptar `readTarEntriesFromBuffer` (ahora async) y los 4 usos de `getConfigAgentDirName` si se sincroniza utils entero (O-37). **Riesgo**: nulo (`dirs.ts` mezcla sin conflicto).
- **[Resolución]**: E consideraba E5 POTENCIAL y N consideraba N19 NECESARIA (mismo commit `dc29de04db`). Se adopta NECESARIA: `ptree` es el helper general de terminación de procesos hijo.

**N-49 — TUI: secuencias de escape de ficheros llegaban al terminal**
- **Origen**: N26 · tui 18.12.0 (+ utils `sanitizeTextDeep`).
- **Qué hace**: los previews de grep/read y otras tarjetas dejan de pasar escapes crudos que podían conmutar a pantalla alternativa con reporte de ratón.
- **Por qué MarIA**: es inyección de terminal en el CLI (usuarios TUI). No afecta al render de VS Code, por eso va al final del grupo.
- **Estado fork**: ausente.
- **Commits**: #15963.
- **Esfuerzo**: bajo. **Dependencias**: `sanitizeTextDeep` (N22/O-45). **Riesgo**: bajo-medio (`tool-execution.ts` [C]).

### 5.2 POTENCIALES (59)

Formato compacto: **Origen** (IDs · versión · paquete) | **Qué hace** | **Por qué MarIA** | **Estado** | **Commits** | **Esfuerzo / Dependencias / Riesgo**. Salvo que se indique otra cosa, todas están ausentes en el fork.

**P-01 — Subagentes en worker threads (`task.workerThreads`, 4 por defecto) y sus fixes**
- **Origen**: L5 · 18.17.0–18.18.1 · coding-agent (`src/thread/`).
- **Qué hace**: los subagentes concurrentes corren en worker threads con RPC interno. Reduce la serialización (#194), elimina el streaming cuadrático de `task` (#215) y aplica el tope de coste en vivo (#193). Arrastra la cola de fixes #214, #252, #315, #369 y #372.
- **Por qué MarIA**: mejora la latencia de eventos con muchos subagentes. El frontend VS Code ya es otro proceso, así que no se gana en repintado. Es el primer potencial a evaluar si hay saturación.
- **Commits**: `d14c75a528` (210 ficheros ±23.825), `b4476d07a7`, `72d5cf31d8`, `68edf5833e`, `94593815ab`, `9abe1536c1`.
- **Esfuerzo**: alto. **Dependencias**: N-48 (`fatal()` en worker). **Riesgo**: alto (`executor.ts`, `task/index.ts`, `sdk.ts`, `agent-session.ts` [C], justo donde viven `acceptanceCriteria`, recibos y ledger).

**P-02 — Reanudación correcta y trazabilidad de sesiones**
- **Origen**: cobertura M (18.12.4 #16483 hoja fuera de rama; 18.13.2 «resume de la copia más nueva tras bifurcar el fichero»; 18.13.3 #17229; 18.12.2 #16195), L17 restantes (#404, #95, #164, #396/#430, #496), E48 (#13929/#14361 `history.db`, #14831 `/retry`) y E30 (identidad de build en las entradas, 18.11.0).
- **Qué hace**:
  - no reanuda en una rama abandonada;
  - `open_session` no revive una copia antigua;
  - resume tras handoff o prewalk;
  - `--resume` sin «(no messages)»;
  - la búsqueda no pierde sesiones;
  - `agent.db` no se corrompe en Linux;
  - el modo JSON no trunca eventos;
  - reindexa entradas sin id;
  - conserva títulos y recaps tras la cuarentena de `history.db`;
  - E30: cada entrada registra el build de omp que la escribió (versión y commit, o `OMP_BUILD_LABEL`) y `/session` lista los builds.
- **Por qué MarIA**: RPC `open_session` y el FTS/History de VS Code, que usa `history.db`. E30 da observabilidad de soporte con releases frecuentes.
- **Commits**: los de cada PR en su rango; `46a69a9b4c` (#404, introduce `scanLines`, BREAKING), `05715ffb82` (#164), `8b161bf5cf` y `db0f0b92d3` (E30, `session/runtime-identity.ts` +146).
- **Esfuerzo**: medio. **Riesgo**: medio (`agent-session.ts`, `main.ts`, `sdk.ts` [C]).

**P-03 — `task.structured` (off por defecto) y frontmatter `structured: true`**
- **Origen**: E9 + E32 · 18.10.2 / 18.11.0 · coding-agent.
- **Qué hace**: los subagentes devuelven texto plano sin `yield` ni schema. Las ejecuciones sin mensaje final fallan explícitamente.
- **Por qué MarIA**: ahorra tokens y fricción en subagentes triviales, pero **rompe** `acceptanceCriteria`, `outputSchema` y recibos del fork si se adopta el default upstream. Solo debe portarse con `task.structured: true` como default del fork, o por agente.
- **Estado**: el modo estructurado del fork es heredado de v18.9.1.
- **Commits**: `3ad2b788d7`, `5d7857e541`, `2b4e9121fe`.
- **Esfuerzo**: medio. **Riesgo**: alto (`task/{executor,index,settings,structured-subagent,types}.ts`, `task.md`, `subagent-system-prompt.md` [C]).

**P-04 — «Ask and remember», `tools.restrictedFolders`, `approvalCacheTargets`/`approvalRestrictionPaths` y diálogo de aprobación**
- **Origen**: M25, M26, C27, N33 · 18.10.4–18.14.0 · agent + coding-agent + tui.
- **Qué hace**:
  - modo `always-ask-cached` con `approval-cache.db`, `/forget-approvals` y `prompt.grants`;
  - carpetas restringidas que exigen aprobación explícita incluso en yolo;
  - `ApprovalDialogComponent`.
- **Por qué MarIA**: valor alto en un despliegue bancario. El host VS Code tendría que renderizar los grants y responder `{grant, always}`, lo que depende del contrato `ui.approve` (O-05).
- **Commits**: `61bc6d217e` (1931+, 42 ficheros), `c820f7ff25` (490+), `cb37f6cf35`, `0365af7610`.
- **Esfuerzo**: alto. **Dependencias**: M26 sobre M25; O-05 (`ui.approve` tri-estado). **Riesgo**: medio-alto (`cli/args.ts` [C]; contrato con VS Code).

**P-05 — LiteLLM: presupuestos de key/usuario en `/usage`, discovery acotado a la key y grupos `mode: decisions`**
- **Origen**: L20, C51 (excepto la paginación, que está en N-35) · 18.13.0 / 18.18.6 / 18.18.7 · ai/catalog/coding-agent.
- **Qué hace**:
  - adaptador `usage/litellm` con presupuesto en USD;
  - `replaceConfiguredProviders`;
  - lista solo los modelos que la key puede llamar (`e1f8422aa6`);
  - grupos `decisions` como jueces (`9eb940c25d`);
  - `response_format` deja de enviarse a GPT Image;
  - corrige el 422 `extra_forbidden` con Mistral.
- **Por qué MarIA**: visibilidad del presupuesto de driver-ia; deja de listar modelos no autorizados.
- **Commits**: `7647842761`, `e1f8422aa6`, `9eb940c25d`.
- **Esfuerzo**: bajo-medio. **Riesgo**: bajo.

**P-06 — Metadatos de razonamiento en discovery**
- **Origen**: M33, L19, C78 (subconjunto #17561, #16093, #18412, #17395) · 18.12.0–18.18.1.
- **Qué hace**:
  - `discovery.advertisedReasoning`;
  - niveles de razonamiento en `openai-models-list`;
  - metadatos anidados;
  - `compat.requiresThinkingPresence`;
  - modelos cacheados con `apiKey` a 0 al arrancar (#16965);
  - el `models.yml` explícito gana al catálogo (#16094, ligado a la migración KDL);
  - `reasoning_effort_map`/`reasoning_required`;
  - límites del proveedor en los recién descubiertos;
  - `providerType` integrado;
  - `compat.disabledThinking`;
  - `effortMap` al acotar.
- **Por qué MarIA**: providers custom de tipo LiteLLM. Sube a NECESARIA si driver-ia anuncia esos campos `[no verificable]`.
- **Commits**: `f59bbac3d5`, `34a2487bd5`, `a6ba0f20a0`, `8914406570`, `29842cb424`, `76c61b29a7`, `f37e2dd197`.
- **Esfuerzo**: medio. **Riesgo**: bajo-medio.

**P-07 — Fallback chains con thinking firmado de Claude, `retry.rateLimitWalksChain` y fallback Anthropic con system prompt obsoleto**
- **Origen**: M23, E34 (#15702) · 18.11.0–18.13.3 · coding-agent/ai.
- **Qué hace**:
  - un rechazo del clasificador salta al siguiente modelo (#17024);
  - Claude→Claude tras un turno con thinking firmado (#17115);
  - `:auto` en una entrada de fallback (#17100);
  - `rateLimitWalksChain` (opt-in);
  - el fallback por rechazo de Anthropic ya no usa system prompt y tools obsoletos (#15702).
- **Por qué MarIA**: aplica si driver-ia o Vertex usan cadenas Claude→Claude.
- **Commits**: `1d2378053c`, `c7ffd4f0e1`, `65b84e8eb1`, `c7b809a2b9`.
- **Esfuerzo**: medio. **Riesgo**: bajo (`turn-recovery.ts` no está [C]).

**P-08 — Robustez MCP: reconexión, OAuth, cabeceras `!command`, `/mcp reauth` por RPC y progreso**
- **Origen**: L14, M44 (#16046), E35 (`/mcp reauth` con `Bearer resource_metadata` #15690), M34 (#16431) · 18.11.0–18.18.8.
- **Qué hace**:
  - reintento ante DNS o socket;
  - un stdio no arranca tras una conexión cancelada;
  - un OAuth cancelado no tumba la sesión;
  - el endpoint de tokens de GitHub responde en JSON;
  - se usa el `resource` del servidor;
  - las cabeceras `!command` se re-ejecutan tras 401/403;
  - las tools desactivadas siguen inactivas;
  - reauth por RPC;
  - `notifications/progress`.
- **Por qué MarIA**: sube a NECESARIA si se usan MCP con tokens de vida corta.
- **Commits**: `f2ed64fc6d`, `1b95b2da13`, `bb41bb5e42`, `4f3570bb32`, `37fd5485a9` y los de #16046/#16431/#15690.
- **Esfuerzo**: bajo-medio. **Riesgo**: bajo (RPC [C] solo para #16046).

**P-09 — Estado del subagente en `wait`/`proc://` y job widgets**
- **Origen**: M27 · 18.12.3–18.13.3 · coding-agent/tui.
- **Qué hace**:
  - #16863: `wait` y `read proc://` muestran tiempo, requests, coste, llenado de contexto y fase del subagente;
  - rol `widget`, `async.widgets`, `proc://<id>/streams` y tiles (mayoritariamente TUI).
- **Por qué MarIA**: #16863 detecta bucles sin abrir el transcript (valor alto); los widgets requieren exponerse por RPC.
- **Commits**: `78e56f75af` (#16863), `9df0457b31`.
- **Esfuerzo**: bajo-medio (#16863) o alto (widgets). **Dependencias**: P-54 (PipeStreams) para los streams. **Riesgo**: medio-alto en `async/*` y `tools/wait.ts`.
- **[Resolución]**: los widgets no son NECESARIA (M los marcó así por corrección del scout); L48 (captions) queda en OTRAS.

**P-10 — APIs de `wait`/IRC: `handlesToolInterrupt`, `steeringSignal.reason`, `settledAtMs` y subagentes sin broadcast**
- **Origen**: C25, C26, N36 (`settledAtMs`, `assertModelSupportsEffortCeiling`, `mcp_progress`), L37 · 18.13.2–18.18.6.
- **Qué hace**:
  - `wait` consume los eventos de despertar en vez de saltarse;
  - el steer indica su fuente, así que un `ask` solo cede al usuario;
  - distingue un resultado terminado durante la llamada de uno recuperado;
  - `write agent://all` desde un subagente falla.
- **Por qué MarIA**: menos ruido y tokens en delegación intensiva; L37 es prerrequisito de N-11 (`adcb8800b6`).
- **Commits**: `2b754c833d`, `fdf09b771d`, `17ddab9cce`, `6267263a35`.
- **Esfuerzo**: bajo. **Riesgo**: medio (los prompts de subagente [C] mencionan el broadcast; `agent-loop.ts`).

**P-11 — Varios de subagentes**
- **Origen**: M42, E33 (resto), E58, E19, E43 (subagentes) · 18.10.4–18.13.2.
- **Qué hace**:
  - `effort` ignorado (#16402); cadena vacía que hereda `default` (#16548);
  - **resolución de modelo que saltaba entradas autenticadas posteriores** (#16640);
  - lote `task` con agente en el nivel superior (#12610); `model` ignorado en lote con seance (#17107);
  - tools de extensión perdidas al revivir (#16597);
  - timeout de celda eval que aborta `tool.task` (#16154);
  - `tools` inválido de un agente concedía todas las tools (#15718);
  - el retry salía del pool `task.agentAccountPools` (#15423);
  - guía de background en la descripción del tool (#15477);
  - jobs reinyectados tras `wait()` (#15625);
  - `agent://<id>` vacío a capacidad completa (#15948, E58);
  - un probe tardío rebobinaba (#15594, E19);
  - skills autoload, wakes con IRC y steer cancelado (E43).
- **Por qué MarIA**: #16640 con listas de modelos de driver-ia, #15718 por permisos, #16154 si se orquesta desde eval.
- **Commits**: `52aa85e14d`, `bcd11cb1cc`, `10a2bd03c2`, `3b94ca1dfb`, `5415664d35` y los de cada PR.
- **Esfuerzo**: bajo-medio cada uno. **Riesgo**: medio (`task/executor.ts` [C]; `turn-recovery.ts` y `registry/*` no).

**P-12 — `omp --restore` y subagentes que sobreviven a `/restart`/`--restore`**
- **Origen**: E12 + L35 · 18.10.3 / 18.18.1.
- **Qué hace**: continúa el turno interrumpido por un crash y relanza los subagentes que estaban en marcha, que entregan el resultado al padre.
- **Por qué MarIA**: valioso, pero hay que exponerlo como flag o RPC desde la extensión VS Code.
- **Commits**: `2051670f54`, `8306d2a133`.
- **Esfuerzo**: medio + integración en la extensión. **Riesgo**: alto (`main.ts`, `task/executor.ts` [C]).
- **[Resolución]**: el scout la puso NECESARIA y E la rebajó; se mantiene POTENCIAL.

**P-13 — Control de gasto: `--warn-cost`/`--max-cost`, `task.agentSoftRequestBudget` y fixes de topes**
- **Origen**: M24 + E16 + L36 · 18.10.3–18.18.2 · coding-agent.
- **Qué hace**:
  - M24 #16803: `session.warnCost`/`session.maxCost` dan un aviso al primer umbral y cortan las requests al segundo, subagentes incluidos; en print, la salida capada termina con código 3.
  - E16: presupuesto blando por agente nombrado (hoy `task.softRequestBudget` solo puede bajar el tope).
  - L36: el tope de coste se informa como negativa (#365); el budget sobrevive a wakes, restore y workpool (#257); el auto-repair respeta el tope (#432); las skills dejan de gastar al tope (#247, #341).
- **Por qué MarIA**: control de facturación corporativa; requiere que el coste por modelo de driver-ia esté poblado. Los agentes largos de delegate mode cortan hoy a 200 requests.
- **Commits**: `44f3c9ce1a` (1261+, 46 ficheros), `0f23666942`, `3b063cc7af`, `bf7bf51aea`, `3925851d9b`, `7baa18f40d`.
- **Esfuerzo**: alto (M24) / bajo (resto). **Dependencias**: L36 #365 asume los topes de M24; enlaza con el tope de coste en vivo de P-01 (#193). **Riesgo**: alto (`task/executor.ts`, `task/settings.ts`, `cli/args.ts`, `main.ts` [C]).
- **[Resolución]**: el scout puso M24 como NECESARIA y M lo rebajó a POTENCIAL; se mantiene POTENCIAL porque no corrige el motor.

**P-14 — `yield` y validación: campos raíz no soportados y claves raíz con nombre de prototipo**
- **Origen**: C28 + cobertura M 18.12.3 #16317 + C44 (resto: normalización mutante y memoización, dereferencia `const`/`enum`, single-string ambiguo) · 18.11.2–18.13.0.
- **Qué hace**:
  - `yield` ya no omite campos raíz;
  - `lenientArgValidation` con `keepUnknownRootKeys`;
  - la normalización de esquemas no muta el esquema del llamante y gasta menos CPU por llamada.
- **Por qué MarIA**: respuestas estructuradas de subagentes (valor alto según M).
- **Commits**: `126aa8ae70`, `02b001d6bc`, `4b558180ae`, `a023ea8af3`.
- **Esfuerzo**: bajo-medio. **Riesgo**: bajo.

**P-15 — `task.perCallModel` (off/eval/on) y `perCallModelAllow`**
- **Origen**: L9 · 18.14.2–18.18.9.
- **Qué hace**: un ítem de `task` o `agent()` corre en un modelo exacto aprobado por el operador.
- **Por qué MarIA**: es una capacidad nueva desactivada por defecto. No tapa ningún agujero, porque HEAD no tiene campo `model` por llamada.
- **Commits**: `7eb7d04b52` (47 ficheros ±4745), `0e1b1fa57b`, `420d492c61`, `87538194ce`, `05a8b9c180`, `11e8ebe3c3`, `82685417be`.
- **Esfuerzo**: alto. **Dependencias**: N-33. **Riesgo**: alto (task/* [C], delegate mode).

**P-16 — Instrucciones de subagente desde fichero (`task.file`/`taskFile`)**
- **Origen**: L10 · 18.14.0 / 18.18.0.
- **Qué hace**: la asignación se carga desde una ruta absoluta o `local://` con SHA-256, y la aprobación queda ligada a ese destino.
- **Por qué MarIA**: ahorra tokens del padre en asignaciones largas.
- **Commits**: `76cc265d01`, `4bf07e0bb1`, `622406ad01`.
- **Esfuerzo**: medio. **Riesgo**: medio (`task/index.ts` [C]).

**P-17 — `Shell.fork()`: bash ocupado bifurcado para llamadas solapadas**
- **Origen**: N4 (+ L23 #381) · 18.18.2.
- **Qué hace**: las llamadas paralelas parten del estado del shell sin serializarse detrás de un comando largo.
- **Por qué MarIA**: menos latencia con la división de tool calls paralelas del fork.
- **Commits**: `1e2fbfd2e2`.
- **Esfuerzo**: bajo tras N-45. **Dependencias**: N-45. **Riesgo**: bajo-medio (`tools/bash.ts` [C]).

**P-18 — `jq` del shell con semántica jq 1.8.2, cancelación y vendoring de jaq**
- **Origen**: L27 + N7 · 18.17.0–18.18.9.
- **Qué hace**: pasa la batería de tests de jq 1.8.2, se para al abortar, elimina el coste cuadrático y da errores con posición.
- **Por qué MarIA**: el abort evita cuelgues; el resto es compatibilidad.
- **Commits**: `4fc9da4caf`, `d1a5b7c479`, `326202b2ac`.
- **Esfuerzo**: incluido en el bloque de crates. **Dependencias**: N-45. **Riesgo**: bajo.

**P-19 — Tool `ask` como formulario HTML (BREAKING) y `ui.formDialog()`**
- **Origen**: L29 + N29 + N44 · 18.18.3–18.18.9 · coding-agent, tui, collab-web.
- **Qué hace**: `<form>` con radios, checkboxes, selects, imágenes y SVG; respuestas en JSON; notas por opción; pestañas por fieldset.
- **Por qué MarIA**: es una regresión para VS Code salvo que se añada `formDialog` al protocolo RPC y la extensión implemente el formulario.
- **Commits**: `ec06d26987` (59 ficheros), `54f3265997`, `938bcc4f9b`, `e176b37fc7`, `72d36ab3f7`; fix independiente #93 `4eff8c8575`.
- **Esfuerzo**: alto (+ extensión). **Riesgo**: alto (`ask.md` [C]; plan mode RPC del fork).

**P-20 — `navigate_tree` con `summarize`/`customInstructions`, `abort_branch_summary`, `set_label` y deltas `message_update` reconstruibles**
- **Origen**: M29 · 18.13.2.
- **Qué hace**: permite resumir la rama al navegar y etiquetar entradas; los deltas se pueden reconstruir.
- **Por qué MarIA**: útil para el «editar prompt» de VS Code, pero hay **colisión de contrato** con el `navigate_tree` propio (§4.3.1).
- **Commits**: `cf1609633c`, `9362b39257`.
- **Esfuerzo**: medio. **Riesgo**: alto y seguro (rpc-types/mode/wire [C]).

**P-21 — Eventos `manual_compaction_start`/`_end`**
- **Origen**: M30 · 18.13.3.
- **Qué hace**: emite eventos al iniciar y terminar una compactación manual.
- **Por qué MarIA**: progreso de `/compact` en VS Code.
- **Commits**: `ad2118ae93`. **No copiar** `auth.db`/`models.db` incluidos por error en ese merge.
- **Esfuerzo**: bajo-medio. **Riesgo**: medio (RPC [C]).

**P-22 — RPC `bash` con `excludeFromContext` y campos de truncado (BREAKING en el Rust SDK)**
- **Origen**: L33 · 18.17.0 / 18.18.1.
- **Qué hace**: un `bash` por RPC queda fuera del contexto del modelo y reporta `elidedBytes`/`columnTruncated*`.
- **Por qué MarIA**: VS Code puede lanzar diagnósticos sin ensuciar el contexto.
- **Commits**: `af6d547fd6`.
- **Esfuerzo**: bajo, más regenerar el wire. **Riesgo**: alto (wire [C]).

**P-23 — RPC y host varios**
- **Origen**: M44 (#17139, #17080, #17246, #12590, #17135, #17262, #17158, #17197), M45 (#16690 `--wait-async`, #17120 `mcpReadOnlyHint`).
- **Qué hace**:
  - el arranque RPC ya no se cuelga por un diálogo en `session_start`;
  - `ctx.ui.input({secret})`;
  - `omp config list --scope`;
  - `set_todos` persistido;
  - `promptAndWait`;
  - renombrar desde el picker;
  - STT del borrador por RPC (**add/add con `rpc-dictation.ts` del fork**);
  - el intent `i` se conserva;
  - `omp -p --wait-async`;
  - `mcpReadOnlyHint`.
- **Por qué MarIA**: #17139, #17080, #17246 y #12590 sirven a la extensión.
- **Esfuerzo**: bajo cada uno. **Riesgo**: alto (RPC [C]).

**P-24 — Prompt cache append-only: recordatorio de fecha/cwd, resume con eval y Google/Vertex append-only**
- **Origen**: M41 + E49 (#14099 auto-learn en Responses) · 18.11.2–18.13.2.
- **Qué hace**: `date-cwd-reminder` pasa a append-only (#17117); `append-only` por defecto en Google/Vertex (#16979); resume con eval (#15736); auto-learn ya no reescribe el historial.
- **Por qué MarIA**: solo rompe la caché con handlers `context`, ofuscación de secretos o advisors.
- **Commits**: `9cdcfcfcaa` (1081+), `1747c6a462`.
- **Esfuerzo**: medio-alto. **Dependencias**: se solapa con N-17 (portar después). **Riesgo**: alto (`agent-session.ts`, `sdk.ts` [C]).

**P-25 — Observabilidad de la caché: segmento `cache`, marcador de cache-miss, `wireToolsFingerprint`, `queuedMessageGate`**
- **Origen**: L32 + N28 + C19 · 18.17.0.
- **Qué hace**: anuncia si el próximo mensaje leerá la caché y por qué no; detecta los turnos que reenvían casi todo; compara las tools tal como se envían.
- **Por qué MarIA**: habría que exponerlo por RPC. `wireToolsFingerprint` encaja con `pinnedToolDefinitions` del fork para verificar la caché padre/hijo.
- **Commits**: `c714bb5871`, `74bec17252`, `2b15045db7`, `1bceb753ae`, `0b9db39651`.
- **Esfuerzo**: bajo-medio. **Riesgo**: medio (`status-line-host.ts` [C], `agent.ts`).

**P-26 — Eficiencia de la caché Anthropic y OpenAI-compat**
- **Origen**: C52, C48, C20 · 18.9.2 / 18.13.0.
- **Qué hace**:
  - breakpoints Anthropic elegidos en una pasada hacia atrás (menos CPU y memoria por petición larga);
  - breakpoint estilo Anthropic sobre el último tool result con `cacheControlFormat: anthropic`;
  - comparación de segmentos de `append-only-context` sin `join` (CPU local).
- **Por qué MarIA**: C52 y C20 son ruta caliente con Claude. C48 pasa a NECESARIA si driver-ia expone Claude por chat completions con ese formato `[no verificable]`.
- **Commits**: `a400d6c731`, `3180c93807`, `6de9ca56cc`, `9fdda912b1`.
- **Esfuerzo**: bajo. **Riesgo**: bajo.

**P-27 — API del agent loop para hosts RPC**
- **Origen**: C14 + E10, C18, C21, C22 + E48 (#15466/`818c397400`), C23, C24, C29, C32, L34 · 18.10.2–18.18.4.
- **Qué hace**:
  - `onDetachedToolUpdate` (frames de jobs en background, salida en vivo; permitiría retirar el polling de 2 s de la extensión);
  - eventos de cola tras claim o entrega (`7c2d22973e`) y continuación forzada;
  - `prioritizeSteering`;
  - `agent_start.resumedToolCallIds` y transcript que no colapsa con una tool sin resultado;
  - `prepareQueuedMessages` con origen;
  - `Agent.isPaused`;
  - `Agent.logContext`;
  - **intents largos que ya no bloquean la ejecución** (C32, 11 líneas, recomendable);
  - `PromptOptions.followUps` y orden de las listas `->`.
- **Por qué MarIA**: la UI de VS Code depende de los eventos de cola y de la reconstrucción del transcript.
- **Commits**: `642ee7bd00`, `3b05510421`, `74d4cbb373`, `7c2d22973e`, `a89329f303`, `818c397400`, `6abf068e99`, `e3ef9ff7f9`, `e3f0804511`, `bc72c4cc89`, `0512c52405`, `61a33dbfb3`, `e0eba274da`.
- **Esfuerzo**: bajo-medio cada uno. **Riesgo**: medio (`agent.ts`, `agent-loop.ts`, wire [C]).
- **[Resolución]**: E consideraba E10 OTRA y C consideraba C14 POTENCIAL. Se adopta POTENCIAL: el popup del fork no lo necesita, pero ganaría salida en vivo.

**P-28 — snapcompact y presupuestos de imagen por modelo y host**
- **Origen**: N24, C72, E15, E13, M45 (#16282), N42 (18.17.0 imágenes previas a 16.1.0), L45 (#68, #74, #53), cobertura M #15899 · 18.10.3–18.17.0.
- **Qué hace**:
  - `providerImageBudget(model)`, `image-count-budget`, `image-max-edge`, `snapcompact-image-reads`, `request-body-byte-limit`;
  - límites por endpoint oficial;
  - `snapcompact.toolResults` como imagen desde el primer envío (antes rompía caché y firmas cada turno);
  - el historial archivado >500k no se pierde al reanudar;
  - las imágenes Anthropic llegan hasta 128 MB;
  - los overrides de thinking sobreviven;
  - indentación en lecturas como imagen.
- **Por qué MarIA**: dimensionado exacto por modelo. E13 solo aplica si se activa `snapcompact.toolResults` (default `false`); #16282 tiene valor alto con snapcompact.
- **Commits**: `8c1aae1932`, `84a914abcd`, `eaf86e9076`, `de85403bde`, `f8b614606b`, `5611dfd6ae`, `15f2aab9fe`, `4ad9c999d6`, `f132b3f328`, `11e450f1bf`, `5d30c790b8`, `e6eba3dc43`.
- **Esfuerzo**: medio-alto (21 usos + 1 import en 4 ficheros fuente y 9 en tests). **Riesgo**: medio-alto (`session-maintenance.ts` [C]).
- **[Resolución]**: E consideraba E15 OTRA y C consideraba C72 POTENCIAL. Se unifican como POTENCIAL porque N-19 y N-28 consumen parte de esta base.

**P-29 — Restos de compactación**
- **Origen**: C7 (rama), C8, E38(b, c), L16b · 18.11.1–18.18.2.
- **Qué hace**:
  - rechaza el `length` en `generateBranchSummary` (lo demás de C7 ya lo tiene el fork, y mejor);
  - el contexto de `session.compacting` llega al resumen del split-turn (1 línea);
  - la auto-compactación respeta `retry.waitForUsageReset`;
  - el advisor no tira el último turno;
  - `/compact` encolable;
  - fixes de snapcompact #105–107;
  - historia tras compactación remota al cambiar de proveedor.
- **Commits**: `bc8a9b2ddd`, `00c4108650`, `6fd0d51647`, `a89329f303`, `1a55c4cda9`, `f470ea46f9`, `b899f57f13`.
- **Esfuerzo**: bajo. **Riesgo**: bajo-medio (3 hunks triviales de `compaction.ts`; controllers [C]).

**P-30 — Memoria Hindsight: outbox durable, cuarentena y avisos de fallo**
- **Origen**: L6 + L8 · 18.14.0–18.18.4.
- **Qué hace**: `retain`/`learn` persistentes con reintento y sin duplicados; avisos visibles cuando falla; `mnemopi.dbPath` con `~`.
- **Por qué MarIA**: solo aplica si se activa Hindsight (memoria `off` por defecto en RPC).
- **Commits**: `dc12e5a4bd`, `80814f9845`, `70a0b62a8c`, `15275390e4`, `7113ceaf5e`, `bfb9e50dab`, `76772d0c97`, `ff6e544cce`.
- **Esfuerzo**: medio. **Riesgo**: bajo.

**P-31 — Arranque más rápido: UI diferida, proveedores lazy y bundles divididos**
- **Origen**: L31, C55, E2 (#15298) · 18.9.2 / 18.14.0 / 18.17.0.
- **Qué hace**: carga perezosa de proveedores, menos CPU al refrescar modelos y menos memoria de arranque del binario.
- **Por qué MarIA**: acorta el arranque de `omp --mode rpc-ui` en cada chat nuevo.
- **Commits**: `8e47fb64f3`, `e902fabee5`, `ee7899a950`, `07ece3b0fb`, `8bafb95398`.
- **Esfuerzo**: medio-alto (BREAKING en los imports de `ai`). **Riesgo**: medio (`sdk.ts` [C]).

**P-32 — Retirada de los workarounds del event loop de Bun y `withInactiveTools`**
- **Origen**: C30 + C31 · 18.14.0 / 18.14.1.
- **Qué hace**: menos sleeps cooperativos durante el streaming; `inactiveTools` deja de quedarse obsoleto (Anthropic `tool_removal` con hijos forkeados).
- **Commits**: `133f055cdb`, #17492.
- **Esfuerzo**: medio. **Dependencias**: N-01 (Bun 1.4.4). **Riesgo**: medio (único hunk de `agent.ts`: mantener `pinnedToolDefinitions`).

**P-33 — Vertex: ADC con Workforce Identity Federation, sufijo de revisión `@default` y Gemini en Vertex**
- **Origen**: C57, C74, C58 · 18.13.0–18.15.0.
- **Qué hace**: corrige el refresh WIF contra el endpoint correcto; añade el eje `selector-revision-suffix`; arregla el timeout de Gemini a ~5 min de prefill y `maxTokens` pequeño.
- **Por qué MarIA**: sube a NECESARIA si Unicaja usa WIF `[verificar el tipo de ADC]`.
- **Commits**: `7bfa32c1d9`, `5fe44438dc`, `fcc2ba69e5`, `868783e34`.
- **Esfuerzo**: bajo. **Riesgo**: bajo.

**P-34 — Compatibilidad Anthropic: kill switch de betas, mTLS, versión de API y keep-alive**
- **Origen**: E8, C60, C61, C62, C42 (resto: Bun 1.3 sin cabeceras, drenaje de body 2,5 s, firma en `content_block_start`) · 18.10.2–18.14.2.
- **Qué hace**: `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`; `CLAUDE_CODE_CLIENT_CERT/KEY`; `PI_ANTHROPIC_API_VERSION`; padding de thinking para validadores estrictos.
- **Por qué MarIA**: pasa a NECESARIA si driver-ia expone `/v1/messages` y devuelve 400 por betas. mTLS aplica a red corporativa con certificado de cliente.
- **Commits**: `e11786674c`, `6a5198ce8c`, `3e62ba6176`, `1d6cc41338`, `f1ef2c941d`, `2eb55e774f`, `897a9f0208`, `89897c4b64`, `b4fc84b4f5`, `d3d77025b2`, `a405e525e9`.
- **Esfuerzo**: bajo-medio. **Riesgo**: bajo.

**P-35 — Errores y reintentos de gateway (resto de C47)**
- **Origen**: C47 (excepto 77e080cb83, que está en N-32) · 18.11.0–18.18.1.
- **Qué hace**:
  - `use of closed network connection` y WS cerrado antes de `completed` se reintentan;
  - `finish_reason:"repetition"`;
  - salida descartada;
  - **errores de red con host y causa (TLS, refused)**;
  - motivo del llamante al interrumpir;
  - `x-should-retry:false`;
  - **429/402 redactado como overflow ya no dispara compactación**.
- **Por qué MarIA**: diagnóstico tras Netskope y menos compactaciones espurias detrás del gateway (valor alto para los dos puntos en negrita).
- **Commits**: `949f1c7d10`, `e5478e79f8`, `c9b360b4d5`, `791feed73b`, `9cad5d11d9`, `89ac5cf966`, `5e48d83962`, `9941ba328a`, `0e0bce45c1`, `f5c15583f8`.
- **Esfuerzo**: bajo por punto. **Riesgo**: bajo.

**P-36 — Gemini, DeepSeek y Gemini 4 vía gateway**
- **Origen**: C33, C50, E39 · 18.11.0–18.12.3.
- **Qué hace**: DSML y tokens de chat-template de DeepSeek; `reasoning_signature` de Gemini; orden de resultados paralelos; turno con solo thinking firmado.
- **Por qué MarIA**: aplica si driver-ia sirve esos modelos.
- **Commits**: `83018bbc6b`, `3291a5ef32`, `bc6d1c686b`, `0c242e191a`, `19c51e8de7`.
- **Esfuerzo**: bajo. **Riesgo**: bajo.

**P-37 — Tools de lectura y web**
- **Origen**: M40, E42 (read), E61 (read/feeds, GITHUB_TOKEN, MCP duplicado, REM), E34 (#15668, #15667, #15648), L49, N35, M39 (#16920) · 18.11.0–18.18.2.
- **Qué hace**:
  - URLs >500k caracteres; paginación a artifact; secciones colapsadas; reintento de UA en 403/429;
  - tablas; `artifact://` sin directorio; xlsx; `?q=` en `local://`; `:raw`; selectores `17:raw`;
  - RSS/Atom; `llms.txt`;
  - meta-tags (~6 % menos tokens); anti-bot; Reddit;
  - descargas de herramientas con `GITHUB_TOKEN`; tools MCP listadas dos veces (#15982);
  - exclusiones `!` en grep.
- **Por qué MarIA**: fiabilidad de la lectura (#16277 y #17009 con más peso) y tokens del system prompt (#15982).
- **Commits**: `512087bc33`, `18fc6ceca4`, `67b2cc8beb`, `402967a964`, `eb38b9153f`, `bce2304ed5`, `eebc54f49d` y los de cada PR.
- **Esfuerzo**: medio. **Riesgo**: medio (`read.ts`, `grep.ts` [C]).

**P-38 — Bash tool: resto de entorno y tokens**
- **Origen**: L40 (resto), M18 (relacionados #17067, #17022, #14838), E17(b), E34 (#15653) · 18.10.3–18.18.8.
- **Qué hace**:
  - `cd` con wrappers mise/zoxide; `C.UTF-8`; no toca el historial del usuario;
  - `cd <dir>;` como cwd; `(no output)`; argumentos `skill://`; espera al matar tras abort;
  - los aliases del rc no se filtran;
  - `2>file` no bloquea;
  - sin timing subsegundo ni metadatos redundantes (tokens en cada bash);
  - el steer no espera a la readiness de un servicio.
- **Commits**: `2f833c5645`, `6ad51806eb`, `9db90c7d05`, `f5b73914f6`, `adc7fed5c9`, `8a70198162`.
- **Esfuerzo**: bajo-medio. **Riesgo**: medio (`tools/bash.ts` [C]).

**P-39 — LSP**
- **Origen**: E50, L41, cobertura M (#16649 rename que corrompía ficheros, #16880, #16836, #15418) · 18.11.2–18.18.6.
- **Qué hace**: `lsp.requestTimeout`; diagnósticos sin cuelgues ni «limpio» falso; ficheros editados fuera de OMP; `formatOnWrite` sin re-indentado (#482); `lsp.enabled=false` respetado en write/edit.
- **Por qué MarIA**: #16649 y #482 rozan NECESARIA si se usan rename o formatOnWrite.
- **Commits**: `f204399ef1`, `865a3759d1`, `a8bb41d2ee`.
- **Esfuerzo**: medio. **Riesgo**: medio (`lsp/settings.ts`, `write.ts`, `edit/index.ts` [C]).

**P-40 — Eval**
- **Origen**: L42, E42 (eval), cobertura M (#15859, #16032, #16300, #17178, #17250, #16808/#16810/#16578) · 18.11.1–18.18.9.
- **Qué hace**: aviso de kernel reiniciado; `sh()`; cancelar un `await` conserva el kernel; deadlock de `@tool` con `asyncio.Lock` entre subagentes; `completion()` entre celdas; `wait(handles,{timeout})`; `artifact://` de otra celda; `%pip` en venv sin pip; `tool.<name>` acepta `xd://`.
- **Por qué MarIA**: el fork usa eval y orquestación desde eval.
- **Commits**: `43f581d682`, `d013a0a269`, `e5ce454f94`, `f1c148afa3`.
- **Esfuerzo**: medio. **Riesgo**: alto (`eval/**` [C]).

**P-41 — Edit: anclas no vistas multi-fichero, sloppy parcial, `editRejections`, `REM`**
- **Origen**: L46, M45 (#16608), E53 (#14357), E61 (#15957) · 18.11.2–18.18.8.
- **Qué hace**:
  - **un edit multi-fichero con anclas no vistas las revela todas en un solo rechazo** (#525);
  - sloppy aplica las operaciones que casan;
  - los marcadores `*** End` de DeepSeek no se escriben;
  - telemetría `get_session_stats.editRejections`.
- **Por qué MarIA**: #525 roza NECESARIA (bucles de rechazo en el modo hashline que usa MarIA).
- **Commits**: `d4ef7acbb6`, `996f3cf8b9`, `ae923ccd72`.
- **Esfuerzo**: bajo-medio (Rust, entra con el bloque de crates). **Riesgo**: bajo.

**P-42 — IPC nativo owner-only, broker y browser compartido**
- **Origen**: E4, N14, E53 (#14466), E22 (#15561) · 18.10.0–18.11.2.
- **Qué hace**: IPC Unix/named pipes solo del propietario para broker, LSP mux y workers; Mnemopi compartido; el broker se recrea si se borra su runtime dir; el browser compartido no reabre todas las páginas.
- **Por qué MarIA**: seguridad local y robustez de `proc://` y LSP compartido.
- **Commits**: `a608a9ca07`, `eeab6fc43d`, `13e8fdc172`, `4a780a40cd`.
- **Esfuerzo**: alto (clientes TS; la parte nativa va en el bloque de crates). **Riesgo**: medio. BREAKING en Windows: los daemons previos no se reutilizan.

**P-43 — Seguridad adicional**
- **Origen**: E25, E35 (`ariaSnapshot`), M45 (#16919), M38 (AGENTS.md), E34 (gpgsign #14810), cobertura L #412 · 18.11.0–18.18.2.
- **Qué hace**:
  - las aprobaciones bash en ACP respetan `bash.patterns` y «Always allow» no cubre `rm -rf /`;
  - `ariaSnapshot()` deja de mostrar contraseñas;
  - `bash.gitGuard` tras un rebase con conflicto;
  - AGENTS.md del usuario ya no se filtra a subagentes con `--add-dir`;
  - `omp commit` firma con GPG;
  - los settings OTel no se filtran a procesos hijo.
- **Por qué MarIA**: E25 pasa a NECESARIA si se usa ACP; gpgsign aplica con firma obligatoria.
- **Commits**: `86e6cd3ae9`, `2a01291619` y los de cada PR.
- **Esfuerzo**: bajo. **Riesgo**: bajo.

**P-44 — `/seance`, agente `seance` y `prewalk.auto`**
- **Origen**: E56, E55, E53 (#15994) · 18.11.2 / 18.11.3.
- **Qué hace**: consultar sesiones pasadas con un agente; prewalk automático con juez; prewalk sin cambio de modelo en lookups MCP.
- **Por qué MarIA**: complementa `archive.find/open`, que encuentra sesiones pero no las consulta.
- **Commits**: `3f89ab0ac2` (38 ficheros), `63a7ba5dcc`, `72b5b97e78`.
- **Esfuerzo**: alto / medio. **Riesgo**: medio (`history-protocol.ts` [C]).

**P-45 — `omp gc --strip`**
- **Origen**: L28 · 18.18.2 / 18.18.6.
- **Qué hace**: elimina firmas y reasoning de replay de las sesiones inactivas sin perder la reanudación.
- **Commits**: `f91266ffbe`, `1077686838`, `23c663da4b`.
- **Esfuerzo**: medio. **Riesgo**: alto (`cli/gc-cli.ts` [C], con `deleteSessionSearchRows` del fork).

**P-46 — Guía de delegación: `balanced`, `task.eager` solo para el principal, sin empujones y scout con `ast_grep`**
- **Origen**: L38, C70, M45 (#17151) · 18.13.2–18.18.3.
- **Qué hace**: Claude y Gemini pasan a `balanced` (delegan menos); `delegationTier`; marcador ⁂.
- **Por qué MarIA**: es decisión del dueño, porque cambia el comportamiento por defecto de un producto que fomenta la delegación.
- **Commits**: `c28b3e3e42`, `0e2ab63349`, `1c241750ae`, `00984be143`.
- **Esfuerzo**: bajo (catalog) / medio (prompts). **Riesgo**: alto (prompts [C][F]); conviene portarlo como inspiración.

**P-47 — Context Viewer `/context` y cierre de code fences abiertas en instrucciones**
- **Origen**: L51, N32 (+ mid #16160) · 18.13.2 / 18.18.9.
- **Qué hace**: visor por categorías (instruction files, skills); un AGENTS.md con un fence sin cerrar ya no rompe el resto del system prompt (#565, se puede portar suelto); elimina `ContextUsageView`.
- **Commits**: `6c4ff7a13f`, `e11a302d3a`, `1e2552e34d`.
- **Esfuerzo**: bajo (#565) / medio. **Riesgo**: medio (`system-prompt.ts` [C]; 4 usos de `ContextUsageView`).
- **[Resolución]**: M dejó #16160 como OTRA (TUI) y N dejó N32 como POTENCIAL. Se adopta POTENCIAL por el valor diagnóstico y #565.

**P-48 — `/export` sin OOM**
- **Origen**: L43 · 18.16.0.
- **Qué hace**: el HTML se escribe en streaming.
- **Commits**: `5ac717a260`, `f1109edfc9`.
- **Esfuerzo**: bajo. **Riesgo**: bajo.

**P-49 — `PI_CODING_AGENT_DIR` para agentes, comandos y config de usuario**
- **Origen**: L50 · 18.18.8.
- **Qué hace**: estos elementos siguen la variable en vez de `~/.omp/agent` fijo.
- **Por qué MarIA**: la extensión ya respeta la variable (`vscode-extension/src/config.ts:61-64`) y omp no.
- **Commits**: `e137dca57c`.
- **Esfuerzo**: bajo. **Dependencias**: O-37. **Riesgo**: bajo.

**P-50 — Servicios de launch persistentes en sesiones no interactivas**
- **Origen**: L52 · 18.18.9.
- **Qué hace**: mantiene los servicios de launch en sesiones no interactivas. `[INFERENCIA: afecta a RPC]`
- **Commits**: `5bc2903877`.
- **Esfuerzo**: bajo. **Riesgo**: medio.

**P-51 — Advisor sin reintentos infinitos**
- **Origen**: L47 · 18.14.0–18.18.7.
- **Qué hace**: 3 intentos por lote; sin revisiones idénticas; cancela las revisiones obsoletas.
- **Por qué MarIA**: pasa a NECESARIA si se activan advisors.
- **Commits**: `58c2e74d0e`, `976f9da84d`, `c15453364e`, `e8aa5185bd`.
- **Esfuerzo**: bajo. **Riesgo**: bajo-medio.

**P-52 — Juicios nativos con deadline de 3 s y cooldown tras 404**
- **Origen**: L11 · 18.14.2 / 18.18.9.
- **Por qué MarIA**: latencia de curator, títulos y gráficas cuando hay fallback configurado.
- **Commits**: `5961eb552a`, `aadbce72e8`, `df77176486`, `8d92d4c3da`.
- **Esfuerzo**: bajo. **Riesgo**: bajo.

**P-53 — Catálogo y modelos**
- **Origen**: M36 + C63, C49 (guard), C73 · 18.11.0–18.13.0.
- **Qué hace**: retención de 12 h en GPT-5.6 vía Responses; guard de 8 líneas por id distinto en tool calls paralelas (defensa adicional al superconjunto del fork); test de conformidad del catálogo (protege la regeneración de `models.json`, que el fork hace por Groq).
- **Commits**: `7a5f1425b9`, `88e19a564d`.
- **Esfuerzo**: bajo. **Riesgo**: bajo.

**P-54 — Natives y utils opcionales**
- **Origen**: N13, N15, N16, N17, N22 (frontmatter #16481, JSONL más rápido, `readSalvageableRows`), N34 (Windows), N38 · 18.10.2–18.18.0.
- **Qué hace**:
  - builtins coreutils, rsync y `ast-grep` en proceso (útil en Windows sin coreutils);
  - `LineMatcher`/`PipeStreams`;
  - `listWorkspace` con errores, `followLinks` y `pruneExcludedDirs`;
  - locks SQLite OFD (solo Linux; pasa a NECESARIA en contenedores con varias sesiones);
  - la reparación de frontmatter ya no borra los comentarios HTML de prompts y skills;
  - Shift+Enter en Windows Terminal y ConPTY;
  - `fromJsonSchema` con exponentes y refs escapadas (18.12.0, bajo) y draft 2020-12 (18.17.0, BREAKING).
- **Commits**: `add3020f4f`, `0d00c86f99`, `05715ffb82`, `d115df34b1`.
- **Esfuerzo**: incluido en el bloque de crates, salvo los consumidores. **Riesgo**: nulo a medio.

**P-55 — Imágenes con transparencia y claves de routing fuera de los exports**
- **Origen**: E11, E17(a) (parte de privacidad) · 18.10.2 / 18.10.3.
- **Qué hace**: los iconos y capturas con alfa ya no se convierten en un cuadro negro; las claves privadas de routing de prompt-cache quedan fuera de las sesiones compartidas y del export HTML.
- **Commits**: `e19bb3cb23` (extraer `image-resize.ts`), `1ea9a1aa87` (2 líneas).
- **Esfuerzo**: bajo. **Riesgo**: medio (`read.ts` [C]).

**P-56 — Bucle del agente y prompts menores**
- **Origen**: E47, M43, E34 (#13291/#15720), cobertura M #16970, E53 (`faa55f02f5`, #15707, #14308/#14470) · 18.11.0–18.13.0.
- **Qué hace**:
  - `todo` junto a la siguiente llamada (3 líneas de prompt, ya casi presente);
  - recordatorios de `todo`; parada `MALFORMED_RESPONSE`;
  - la compresión de descripciones de skills ya no repite las peticiones al smol en cada sesión ni ignora `default`;
  - la smart unexpected-stop recovery deja de continuar respuestas acabadas;
  - `agent://<id>` tras follow-up;
  - un `write` rechazado en un subagente read-only señala `yield`.
- **Commits**: `ff0b9c2cac` y los de cada PR.
- **Esfuerzo**: bajo. **Riesgo**: medio (prompts y `write.ts` [C]).

**P-57 — Árbol de jobs**
- **Origen**: E41 · 18.11.1.
- **Qué hace**: modelo de árbol de jobs en `agent-session.ts`.
- **Por qué MarIA**: podría alimentar el popup de background tasks de VS Code (hoy es una lista plana).
- **Commits**: `e07c8bc2dc`.
- **Esfuerzo**: medio. **Riesgo**: alto (`agent-session.ts` [C]).

**P-58 — Bolsa de fixes POTENCIAL de la cobertura M (18.12–18.13) no citados arriba**
- Worktrees enlazados (#16068, #17181), SQLite (#16040, #16041, #16444, #16999, #17001), prompts de aprobación `xd://`/MCP (#16048, #17039), MCP OAuth scopes y auth server (#15996, #16339), auto thinking (#16327), `skills.customDirectories` con `~` (#16347), grep `;`/`:raw` (#14091, #14092), `conflict://` (#16267, #16269).
- `.vscode/mcp.json` warning (#16434, ruido en VS Code), custom tools en el binario (#16421), `omp update --check` con Artifactory (#16375), slash commands en `-p` (#16387), extensiones con rebuild único (#17088), `@path` con imagen/PDF/docx (#16853, #17193), `web_search` fallback (#16948), fila «waiting on background jobs» (#17032, base de M3 en TUI).
- isolated task capture (#16648), `rewind` doble (#16702), underscores Word/EPUB (#16607), `proc://…/kill` (#16580), `history://` sin transcript (#16645), extensión cargada dos veces (#16788), `write` read-only con `local://` (#17023), `autoResume` con modelo irrecuperable (#17163), `proc://<id>/mode` (#17170), skills tras `plugin upgrade` (#17027), session-stop extensions (#17129), vision más barato (#17196), plan mode que quitaba tools de extensión (#17085), rollover experimental (#17205).
- `@` imports con espacios (#16090), GitLab MR en `/review` (#16361, #16477), modelos de extensiones en `enabledModels` (#16096), reglas TTSR (#16242, #16556, #16419, #16420, #17099), docs RPC xd:// (#16864), globs/skill/find con enlaces (#17180), selectores JSON (#17179), Python PATH (#16824), LSP mux.
- **Esfuerzo**: bajo cada uno. **Riesgo**: variable (task/eval/RPC [C]).

**P-59 — Bolsa de fixes POTENCIAL de la cobertura L (late-entries) no citados arriba**
- #17 (detección automática de cambios de FS), #24 (gitGuard en worktrees enlazados), #28, #34 (init de `todo`), #44, #93 (un mensaje encolado cierra el `ask` pendiente, `4eff8c8575`), #129 (dictado local frente al RPC del fork), #167/#246/#247 (manualSkills), #226 (`find` con resultados parciales), #243 (apóstrofes en slash-commands), #310 (`@local://` abortaba la ejecución).
- #386 (**modelos acotados refrescados tras login/logout por RPC**, `45d99cff93`, afecta a VS Code), #389 (skills creadas en sesión descubribles al momento, afecta al curator del fork), #397, #425 (ACP sin turnos ocultos), #483 (sandbox aislado tras SIGHUP), #490 (pausar un plan no aprobado; revisar frente al plan mode RPC), #532 (tareas aisladas con espacios en el nombre).
- **Esfuerzo**: bajo cada uno.

### 5.3 OTRAS (47)

Valor indirecto para MarIA: TUI/Tern, proveedores no usados, refactors o borrados. Todas están ausentes en el fork salvo que se indique otra cosa.

| ID | Origen | Versión | Qué es | Por qué OTRA / nota |
|---|---|---|---|---|
| O-01 | E23 | 18.10.4 | Eliminación de Codex Code Mode (`7b2bd46db7`, −3.884; incluye `providers.openai-codex.codeMode*`) | Es código heredado con default `off`. Portarlo quita unas 2.700 líneas de mantenimiento. Al mezclar genera 6 modify/delete (`code-mode-declarations.ts`, `eval-code-mode.md`, tests) |
| O-02 | E2 (salvo #15298) | 18.9.2 | apply_patch normalizado, tope del juez de `find`, `gc --apply`, OpenRouter `:floor/:nitro`, helper `computer`, `/tan` billing, enlaces `omp://` | Fixes puntuales (`423992fc92`, `567cdd92ab`, `0affc77e41`, `032d7bd088`, `b4883087ab`, `12f795d3ee`, `f68ec6ef94`) |
| O-03 | E3 | 18.10.0 | `omp session pack/unpack/moved`, `omp auth export/import` (`3df76b1c6f`) | No es un flujo de MarIA. Además, auth export abre superficie de secretos |
| O-04 | E6, E7, E22 (renderMarkdown), E52 (status line), N37, N34 (no-Windows), L44, M45 (#16873 `/local`, #17073 `/pause`, #15753 `sessionModes`, #17136 idle maintenance) | 18.10–18.18 | Cosmética y UX de TUI/Tern: copy, contadores, modales, jobs sheet, Agent Hub, Colorful Markdown, motion, pins Alt+K/`/unpin`, tmux/kitty/iTerm2/SIXEL | MarIA se usa sobre todo desde VS Code. #15405 toca la TUI pinned del fork (conflicto alto) |
| O-05 | E21, E31, E60 | 18.10.4–18.11.3 | API de plan review para extensiones, composer durante la aprobación, **`ui.approve()` → `once/session/deny` (BREAKING)** | La aprobación por defecto es `yolo`. Hay que adoptarlo si se porta P-04, actualizando `dialogs.ts` |
| O-06 | E20, M45 (#17189) | 18.10.4 / 18.13.2 | `omp gc --compress`, `gc.autoCompress` | Ahorro de disco opt-in. `gc-cli.ts` [C] |
| O-07 | E26, L7, N41, E61 (#15826) | 18.11.0–18.18.4 | Memoria con scope del cwd de sesión, Hindsight `scope:"global"`, fixes de Mnemopi (incluido cambio de modelo que borraba vectores), 429 en la extracción | La memoria está `off` por defecto en RPC. Pasa a POTENCIAL si se activa |
| O-08 | E51, C65 (auth-gateway) | 18.11.2 | `omp auth-gateway serve --clients` y fixes del gateway | MarIA consume driver-ia, no opera el auth-gateway |
| O-09 | E62 | 18.11.3 | Eliminación de la regla `rs-parking-lot` | Solo afecta a Rust |
| O-10 | E17(a) (salvo la parte de privacidad), C71 | 18.10.3 / 18.13.0 | `shared-prompt-cache` (Muse Code/OpenCode Go) | No aplica a Anthropic, Vertex ni LiteLLM. El fork resuelve la caché padre/hijo con `pinnedToolDefinitions` |
| O-11 | E27(c) | 18.11.0 | `/tan` conserva la caché del padre | Comando TUI |
| O-12 | E28(a), C10, C9, C11 | 18.10.3–18.18.2 | Compactación remota nativa OpenAI/Codex/Bedrock (preflight, metadatos, atribución en `/chat/completions`), conteo de reasoning en Responses | **[Resolución]**: E puso E28a como POTENCIAL «si driver-ia expone compactación remota» y C puso C10 como OTRA. Se adopta OTRA: no son proveedores de MarIA. Sube si se activa `remoteCompaction` contra LiteLLM |
| O-13 | E33 (#15457, parte TS) | 18.11.0 | Tasks aisladas en worktrees con submódulos recursivos | La parte nativa viaja en N-46 |
| O-14 | E35 (browser/computer/plugins/Mermaid/Cursor), N45, N43, N44 | 18.11–18.18 | Tool `computer`, browser relay (¡18.18.1 amplía permisos de la extensión Chrome: requiere revisión corporativa!), collab-web | No son flujos de MarIA |
| O-15 | E42 (judge con imágenes), E43 (OTRA), E49 (resto), E53 (OTRA), E61 (Cursor, Isolate, perfil) | 18.11.x | Listas OTRA de los changelogs 18.11.1–18.11.3 | Enumeradas en `early.md` |
| O-16 | M28 | 18.12.1 | **`display()` eliminado de eval (BREAKING)** y render enriquecido de `print` (`e404beb2c1`, 64 ficheros) | Heredado. No da ganancia de motor y casi todo `eval/**` está [C] |
| O-17 | M31 | 18.12.2 / 18.12.6 | Idle compaction ajustada a la caché de 1 h | Solo se programa en la TUI; `rpc-mode.ts` no la usa |
| O-18 | M32 | 18.12.6 | Carga diferida de extensiones | Solo arranque interactivo; no acelera `rpc-ui` |
| O-19 | M35 | 18.12.4 | `PI_SESSION_ID`/`PI_SESSION_FILE` en bash | Parcial (`PI_SESSION_FILE` heredado) |
| O-20 | M37, C54 | 18.12.0 / 18.12.1 | Prewarm de conexiones para todos los providers y compresión de peticiones (`PI_CODEX_ZSTD`→`PI_REQUEST_COMPRESSION`) | Excluye explícitamente gateways y custom providers. Los proxies TLS (Netskope) rompen las subidas comprimidas |
| O-21 | M38 (flag) | 18.13.0 | `--no-context-files` | El fix de filtrado de AGENTS.md está en P-43 |
| O-22 | M45 (#16612 HEIC, `advisor.continueSeverity`, WATCHDOG `scope`, advisors 429 #17087, #16484) | 18.12–18.13 | Imágenes HEIC/AVIF, ajustes de advisor | `continueSeverity` cambia el default (`concern` reabre el run): revisar si se activan advisors |
| O-23 | L24 | 18.17.0+ | Visualización Raw/Pseudo de la ejecución bash (`488cafa0e0`, 192 ficheros) | TUI. Depende de N-45 |
| O-24 | L25 | 18.17.0+ | `omp zsh/bash/sh` interactivos | Shell para humanos. Depende de N-45 |
| O-25 | L26 | 18.17.0–18.18.2 | ovnfs (checkouts aislados, búsqueda en el daemon) | Requiere un binario externo. **Ojo**: se activa solo si está en `PATH` |
| O-26 | L30 | 18.14.0 / 18.14.2 | Respuestas intermedias por `out://` | Apagado en RPC |
| O-27 | L48 | 18.15.0 / 18.18.9 | Job captions con el rol `widget` | Depende de los job widgets (P-09) |
| O-28 | C12 | 18.13.0 | `--max-time` > 596 h | Caso límite |
| O-29 | C34, C35, C36 | 18.11–18.18 | llama.cpp chat-template, Ollama, Cursor | No usados. El `logger.warn` en catches vacíos de C36 es POTENCIAL bajo |
| O-30 | C38 | 18.16.0 | Helpers de file-ops de compaction re-exportados desde `@oh-my-pi/snapcompact` | Refactor, pero **obligatorio al mezclar** (hunk 5 de `compaction.ts`) |
| O-31 | C53 | 18.17.0 | Message threads de Anthropic | Solo API oficial de Anthropic, no Vertex ni LiteLLM |
| O-32 | C56 | 18.12–18.18 | OAuth: rotación, refresh concurrente, poll de uso | MarIA usa ADC y keys |
| O-33 | C59, C46 (b) | 18.9.2–18.17.0 | Jueces nativos (`NativeJudge`, renombrados BREAKING), credenciales en el estado del juez | El `judge` del fork usa modelos de chat |
| O-34 | C64 | 18.12–18.17 | Codex/Responses (WebSockets, Daybreak, 404 regionales…) | Proveedor no usado |
| O-35 | C65 (salvo el auth-gateway) | — | Cursor, Factory, Devin, Antigravity, GitLab Duo, Muse, etc. | No usados |
| O-36 | C75, C76, C77, C78 (salvo el subconjunto de P-06) | — | Ejes menores de catálogo, OpenCode Go, nuevos proveedores (SambaNova, Inception, Modular, Scaleway, Otari…), precios y ventanas | Llegan regenerando `models.json` |
| O-37 | N23 | 18.18.8 | **`getConfigAgentDirName()` eliminado** | Migración obligada si se sincroniza utils entero (4 usos en el fork) |
| O-38 | N30 | 18.17.0 | Presentadores de transcript y `CompactTranscriptBlock` | Análogo upstream de `compactToolOutput`. Decisión de arquitectura: re-expresar la feature del fork sobre ellos reduciría conflictos futuros |
| O-39 | N31 | 18.10.0+ | **Reescritura del retiro a scrollback: elimina `pinInputToBottom`, `retireDisplacedTranscript`, `transient`** | Choca con pinnedInput y stickyPrompt del fork. Coste alto |
| O-40 | N39 | 18.10–18.18 | Protocolo TSP (wire) de Tern | No lo usa la extensión |
| O-41 | N40 | 18.10–18.18 | `omp stats` (incluido el HTTP 431 con muchos subagentes) | Dashboard, no motor |
| O-42 | N42 (Factory) | 18.12.4 | Frames de Factory Droid | No usado |
| O-43 | N46 | varias | Resto de natives: Mermaid, SIXEL (BREAKING: RGB de fondo, `image.ts:713,727`), voz, `parseKey`, `htmlToMarkdown({hiddenContent})` (POTENCIAL bajo), build macOS `OMP_APPLEFM_*` | Viaja con el bloque de crates |
| O-44 | N47 | — | metaharness y python/robomp (17 commits) | Herramientas internas de upstream |
| O-45 | N22 (resto), N36 (resto) | varias | Helpers de utils y APIs de tui sin su consumidor upstream | Solo sirven junto con su feature |
| O-46 | Cobertura M marcada OTRA | 18.12–18.13 | Unas 150 entradas TUI, Tern, computer y proveedores (lista literal en `mid.md` §«Cobertura») | — |
| O-47 | Cobertura L marcada OTRA | 18.14–18.18 | Unas 250 entradas de `late-entries.txt` asignadas a OTRA en `late.md` §«Cobertura» (incluidos #1, #2, #5, #8–12, #14–16, #20–33…) | — |

---

## 6. Roadmap de port propuesto

Orden: dependencias primero y riesgo creciente. Cada ola se cierra con `bun run check` + `bun run test` + `cargo test` y una prueba de humo de la extensión VS Code en `rpc-ui`.

**Ola 0 — Seguridad, CVE y fixes triviales sin conflicto (≈1 semana)**
- N-01 (Bun 1.4.4 en `package.json`, los 3 Dockerfiles y CI; rebuild) → N-02 → N-03 → N-05 → N-18 (regenerar `rules.json`) → N-04.
- Proveedor y discovery: N-33, N-34, N-35, N-29, N-30, N-31.
- Subagentes de bajo riesgo: N-12, N-13, N-23, N-41, N-42, N-43, N-44, E27a (parte de N-16).
- Sesión: N-36 (storage, loader, persistence, `sdk.ts` E29).
- Decidir y aplicar ya el **default de `dev.autoqaPush`**.
- Adaptación del fork: ninguna estructural. Revisar los alias de driver-ia por N-33.

**Ola 1 — Conteo de tokens, compactación y prompt cache (`packages/agent` + `session-maintenance.ts`)**
- Orden por dependencias: N-20 → N-21 → N-22 → N-24 → N-26 → N-25 → N-27 → N-28 (necesita P-28 parcial: ejes de catálogo y firma por modelo) → N-19 → N-15 → N-16 (L13) → N-17.
- Adoptar C16 (`resolveToolConcurrency`) y después N-39.
- Adaptación del fork:
  - resolver los 6 hunks de `compaction.ts` según §4.3.7, conservando reserva adaptativa, juez de fidelidad y `completeWithTruncationRetry`;
  - calcular la histéresis de N-24 con la reserva efectiva;
  - mantener `pinnedToolDefinitions` al introducir `withInactiveTools` (si entra P-32);
  - re-encajar las 16 llamadas de snapcompact de `session-maintenance.ts`.

**Ola 2 — Sincronización en bloque de `crates/` + `packages/natives` + `packages/utils` a v18.18.9**
- Entran N-45, N-46, N-47 y N-48 y, sin coste añadido, P-17 (parte nativa), P-18, P-41 (Rust), P-54 y O-43.
- Después: la parte TS de N-37 (hashline/apply_patch/write) y de N-40 (grep).
- Adaptación del fork:
  - borrar `coding-agent/src/tools/fs-cache-invalidation.ts` (`invalidateFsScanCache`);
  - `encodeSixel*` con RGB (`tui/src/components/image.ts:713,727`);
  - `readTarEntriesFromBuffer` asíncrona;
  - `getConfigAgentDirName` → `getAgentDir()` (4 ficheros);
  - renderer bash del TUI (`tui/src/tools/bash.ts`, +17 del fork);
  - `test/tools-native-shell.test.ts`;
  - verificar `bun run build` del addon (Bun 1.4.4 ya está en Ola 0).

**Ola 3 — Agent loop, RPC y orquestación de subagentes (`agent-session.ts`, `task/*`, `irc/*`, `tools/wait.ts`)**
- Orden: N-06 (M2+M3 juntos) → N-07 → N-38 → N-08 → N-09 → P-10 (L37, prerrequisito) → N-11 → N-10 → N-14.
- Adaptación del fork:
  - re-aplicar recibos y `acceptanceCriteria` sobre el `executor.ts` y el `result-summary.ts` nuevos;
  - revisar team-board y ledger frente a la nueva semántica IRC (L3) y la retirada del broadcast;
  - actualizar los prompts propios que mencionan `agent://all`;
  - añadir tests de RPC (`abort`, `abort_and_restore_queue`, `open_session` con jobs vivos, `session_settled`).

**Ola 4 — POTENCIALES elegidas por el dueño**
- Paquete recomendado de menor riesgo y mayor retorno: P-02, P-14, P-27 (C32 + eventos de cola + `onDetachedToolUpdate` para quitar el polling), P-35, P-05, P-07, P-08, P-09 (#16863), P-11, P-13, P-26, P-33, P-47 (#565), P-49.
- Con impacto en la extensión VS Code (requieren diseño): P-04 (+O-05 `ui.approve`), P-19 (ask HTML + `formDialog` RPC), P-20 (`navigate_tree`: renombrar o versionar), P-21, P-22, P-23 (resolver el add/add de `rpc-dictation.ts`).
- Grandes: P-01 (worker threads), P-15, P-03 (con `task.structured: true` por defecto).

**Ola 5 — Decisión estratégica: re-baseline sobre upstream**
- Si se adoptan P-19, P-03, O-05 y O-16, el resto de la divergencia sería sobre todo aditivo. Entonces conviene rebasar el fork sobre `upstream/main` y re-aplicar las features propias como commits encima:
  - extensión VS Code (sin conflicto);
  - skills curation, team-board, session-search y verify-tracker (aisladas);
  - TUI pinned (re-expresada sobre O-38/O-39);
  - RPC propios.

---

## 7. Breaking changes, settings nuevos, renombrados y eliminados

### 7.1 Con impacto directo en el fork
- **Bun ≥1.4.4** en todos los paquetes (18.13.3). El fork declara `>=1.3.14` y compila con 1.4.3.
- **`ui.approve()` → `"once"|"session"|"deny"`** (18.11.3). Afecta al contrato RPC y a los diálogos de VS Code.
- **`ask` → `{ html }`** (18.18.3). Se eliminan `QuestionResult`, «Chat about this» y las notas por respuesta; `AskToolDetails {answers, timedOut?}`; `NavigateTreeResult.reopenAsk.html`; `ui.formDialog()`.
- **`navigate_tree`** con otra forma upstream (18.13.2), con el mismo nombre que el del fork.
- **`task`**:
  - devuelve texto plano por defecto con `task.structured` off (18.10.2) y frontmatter `structured` (18.11.0);
  - declara `model` en todo schema (18.14.2), pero solo lo anuncia con `task.perCallModel=on` (18.18.4);
  - `task.eager` solo para el agente principal (18.18.3).
- **`display()` eliminado** de eval JS/Python (18.12.1).
- **Selectores `proveedor/id` exactos** (18.14.0).
- **Subagentes sin broadcast** `agent://all` (18.17.0).
- **TUI**:
  - eliminados `Composer.pinInputToBottom()`, `Component.retireDisplacedTranscript` y `RuntimeChildrenOptions.transient` (18.10.0);
  - `ContextUsageView`/`renderContextUsage`/`describeContextUsage`/`contextUsageHead()` (18.13.2) y `estimateSkillsTokens()` (18.18.9);
  - `code-mode-declarations` (18.10.4, modify/delete).
- **natives**:
  - `invalidateFsScanCache` y las constantes `FS_SCAN_*` (18.14.0);
  - `encodeSixel*` exige RGB (18.12.0);
  - `parseShell()` → `RunTrace.present()` (18.17.0; sin impacto en el fork);
  - crates: salen `brush-core`/`brush-parser` y entran los vendor `grep-searcher` y `jaq-*`.
- **utils**: `readTarEntriesFromBuffer()` → `Promise` (18.12.4); se elimina `getConfigAgentDirName()` (18.18.8).
- **snapcompact**: `providerImageBudget(model)`/`providerFrameBudget(model)`/`maxFramesForDataBudget(shape, budget)`; se eliminan `PROVIDER_IMAGE_BUDGETS` y `FRAME_DATA_BYTES_BUDGET` (18.10.3).
- **agent**:
  - `estimateImageContentTokens()` → `Tokenizer.imageTokens(size, detail)` y `applyShakeRegion(s)` con `replacementTokens` (18.10.3);
  - eliminado `utils/yield` (18.14.0);
  - `SentToolDefinitions.inactiveFor` → `withInactiveTools(context)` (18.14.1);
  - helpers de file-ops de compaction deprecados y eliminado `PI_TOKENIZER_ACCURATE` (18.16.0);
  - `resolveToolConcurrency` frente a `resolveToolConcurrencyMode` (18.18.4).
- **coding-agent SDK**:
  - `logoutCredential()` recibe `AgentSession`; `setScopedModelsRefresher()`; fuera `refreshScopedModelsAfterLogin` (18.18.2);
  - `SessionStorage.hasAssistantTurn()` → `scanLines(path, visit)` (18.18.2; HEAD lo usa en 3 ficheros);
  - `snapshotJobs` sin `includeResults` y `buildJobResult` solo `"wait"`/`"cancel"` (18.13.0);
  - los custom tool loaders reciben `cwd` en vez de `pi` (18.14.0).
- **Rust SDK**: `BashCommand.exclude_from_context` y `ReadyEvent.supports_bash_exclude_from_context` (18.18.1).
- **omptype**: `fromJsonSchema` opaco, sin `.pick()`/`.props`; `format` solo como anotación; un `$ref` inválido lanza (18.17.0).

### 7.2 Cambios de default de comportamiento
- **Text Verbosity `low` por defecto**, también en Codex (18.17.0). Revisar en los endpoints OpenAI-compat de MarIA porque acortaría las respuestas.
- `delegation-bias` por defecto pasa de `eager` a `balanced` (18.18.3).
- `advisor.continueSeverity` por defecto `concern` (18.12.1).
- `bash.gitGuard` más estricto (18.13.0).
- Rol `judge` por defecto `typesafe/jev-1.14.0` y fallback de `computer` `takeover` (18.12.2).
- Idle compaction temporizada a ~54 min con caché de 1 h y fuera de Codex (18.12.2/18.12.6).
- `providers.openaiLiveSteering` off y `tui.autoGraph` `auto` (18.14.0).
- Flags de CLI y overrides del SDK ganan a las variables de entorno (18.17.0).
- ovnfs se activa solo si está el binario (18.17.0).
- Runtimes de voz local se instalan en el primer uso (18.17.0; puede fallar tras el proxy).
- Instaladores standalone por defecto (18.18.8).
- Daemons IPC de versiones previas no reutilizables en Windows (18.10.0).

### 7.3 Settings y variables
- **Renombrados**:
  - `codexResets.autoRedeem`/`claudeResets.autoRedeem` → `autoRedeem5h`/`autoRedeemWeekly` (+`claudeResets.autoRedeemFable`), con migración (18.18.7);
  - `PI_CODEX_ZSTD` → `PI_REQUEST_COMPRESSION` (ai 18.12.0);
  - `task-sibling-prompt-cache` → `shared-prompt-cache` (catalog 18.13.0);
  - `isLoopGuardedModel`/`thinkingLoopGuard` → `loopGuardLevel` (18.14.2);
  - `TypeSafeJudge` → `NativeJudge` y `TypeSafeApiError` → `JudgmentApiError` (ai 18.9.2);
  - `Editor.prediction` → `predictions` (tui 18.16.0);
  - `GroupedLineContext.isUrl` → `url` (tui 18.15.0);
  - `ShellTrace` → `ShellTraceBytes` (wire 18.18.0).
- **Eliminados**:
  - `providers.openai-codex.codeMode` y `codeModeDirectTools` (18.10.4);
  - `/mcp smithery-search/login/logout` (18.18.9; HEAD tiene 8 ficheros smithery);
  - regla `rs-parking-lot` (18.11.3);
  - `PI_TOKENIZER_ACCURATE` (18.16.0);
  - `toolMode code_mode_only` (catalog 18.10.4);
  - export crudo `@oh-my-pi/pi-catalog/models.json` (18.14.0);
  - `JUDGMENT_ROUTES`;
  - `toolNamespacesInfo`;
  - verbo TSP `t` y `TspPalette`.
- **Nuevos (selección relevante)**:
  - tareas: `task.structured`, `task.agentSoftRequestBudget`, `task.workerThreads`, `task.perCallModel(+Allow)`;
  - aprobaciones: `tools.approvalMode: always-ask-cached`, `tools.restrictedFolders`;
  - coste: `session.warnCost/maxCost`;
  - jobs: `async.widgets`, `async.printWake`;
  - reintentos: `retry.rateLimitWalksChain`;
  - discovery: `discovery.advertisedReasoning`, `compat.requiresThinkingPresence`, `compat.disabledThinking`, `imageCountBudget` y `tokenizer: o200k` (models.yml);
  - LSP y prewalk: `lsp.requestTimeout`, `prewalk.auto/autoTarget`;
  - mantenimiento: `gc.compress/compressAfterDays/autoCompress/stripAfterDays`;
  - jueces y memoria: `judgment.attemptTimeoutMs`, `hindsight.globalScope`;
  - display y tools: `display.shellVisualization`, `display.advisorCollapsedLines`, `tools.xdevNotices`;
  - sesión y advisor: `session.worktreeScope`, `advisor.continueSeverity`;
  - variables de entorno: `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, `CLAUDE_CODE_CLIENT_CERT/KEY`, `PI_ANTHROPIC_API_VERSION`, `OMP_BUILD_LABEL`, `MNEMOPI_EMBEDDING_BATCH_SIZE`, `OMP_FORCE_RUST_TASKS`, `OMP_APPLEFM_DISABLE`;
  - `PI_DISABLE_UUTILS_DESTRUCTIVE` cubre ahora `dd`/`rsync`.

---

## 8. Descartados (17)

| # | Entrada | Motivo |
|---|---|---|
| D-01 | E1: fixes de 18.9.2 (#15353, #15340, #15360, avisos de Ollama/LM Studio) | Ya presentes: son anteriores al merge-base |
| D-02 | C16 `resolveToolConcurrency` como feature | Duplica `resolveToolConcurrencyMode` del fork. Se adopta el nombre upstream al portar N-39, sin feature nueva |
| D-03 | C49 tool calls paralelas en gateways (#15682) | El fork ya tiene un superconjunto (`be96c1a9f6`). Solo se recomienda el guard de 8 líneas (P-53) |
| D-04 | C7, núcleo (rechazo de `length` en resumen, handoff y prefijo) | Ya está en el fork y mejor (`completeWithTruncationRetry`). El resto va a P-29 |
| D-05 | `ApprovalDetailsOptions` (C27) | Añadido en 18.10.4 y eliminado en 18.11.0: neto cero |
| D-06 | L #109 guía de `seance` | No aplica: el agente `seance` no existe en HEAD (se cubre como P-44 si se porta) |
| D-07 | L #61 Daybreak | La petición `daybreak_blue` ya está heredada. Codex no es proveedor de MarIA |
| D-08 | L #276–298 y #320–344 | Duplicados de 18.17.0 republicados en el tag v18.18.0 |
| D-09 | Duplicados literales de los changelogs | 37 líneas en 18.13.0, #16763, #17014, #17223, #15578, #15765; ai 18.12.4 (2); catalog 18.18.8 y 18.13.0; natives 18.13.0 (4); utils `setProcessName`. Se cuentan una vez |
| D-10 | «pinnedInput, stickyPrompt, compactToolOutput, answerDivider, selección con ratón son upstream» | Falso: son propios del fork (0 aciertos en upstream/main y en el merge-base) |
| D-11 | «brush vendorizado con parches del fork» | Falso: el vendoring es heredado de upstream v18.9.1 y el fork no tiene diff |
| D-12 | «El fork ya incorporó selectivamente partes de upstream (receipts, ledger, synopsis)» | Falso: son desarrollos propios y paralelos, con 0 commits upstream posteriores al merge-base |
| D-13 | «Bug de supresión permanente de wakes (#17243) presente en el fork» | No existe en el fork, que tiene el bug inverso. M3 solo se porta como pareja de M2 (N-06) |
| D-14 | «Sesiones fijadas ausentes» | `/pin` y «fijadas primero» son heredados de v18.9.1. Solo faltan Alt+K, el badge y `/unpin` (O-04) |
| D-15 | «Alcance global de memoria: equivalente propio del fork» | Para Mnemopi es heredado y no hay equivalente propio. El camino Hindsight está en O-07 |
| D-16 | Entradas Cursor del scout fechadas en 18.8.4 y 18.4.10 | Fuera de rango, anteriores al fork |
| D-17 | jaq 3.1.1 como gap y `sqliteFileIdentity` | Ya presentes (heredados). Solo faltan vendoring y cancelación (P-18) o el cambio de export |

---

## Anexo A — Índice de IDs de origen → ID final

Notación: `ID → destino`. Un ID con partes repartidas se indica entre paréntesis.

**Slice E (coding-agent 18.9.2–18.11.3)**
E1→D-01 · E2→O-02 (#15298→P-31) · E3→O-03 · E4→P-42 · E5→N-48 · E6→O-04 · E7→O-04 · E8→P-34 · E9→P-03 · E10→P-27 · E11→P-55 · E12→P-12 · E13→P-28 · E14→N-20 (a), N-22 (b) · E15→P-28 · E16→P-13 · E17→O-10 (a; privacidad→P-55), P-38 (b) · E18→N-28 · E19→P-11 · E20→O-06 · E21→O-05 · E22→O-04 (renderMarkdown), P-42 (#15561), O-36 (#15620 precios) · E23→O-01 · E24→N-03 · E25→P-43 · E26→O-07 · E27→N-16 (a), N-17 (b), O-11 (c) · E28→N-27 (b), O-12 (a) · E29→N-36 · E30→P-02 · E31→O-05 · E32→P-03 · E33→N-13 (#15573), P-11 (#15718, #15423, #15477, #15625), O-13 (#15457) · E34→N-37 (hashline #15649), P-38 (#15653), P-37 (#15668/#15667/#15648), P-07 (#15702), P-56 (#15720), P-43 (#14810) · E35→O-14 (resto), P-43 (`ariaSnapshot`), P-08 (`/mcp reauth`) · E36→N-36 · E37→N-13 · E38→N-27 (a), P-29 (b, c) · E39→P-36 · E40→N-34 · E41→P-57 · E42→N-46 (#15760), P-37 (read), P-40 (eval), O-15 (judge) · E43→P-11 (subagentes), O-15 (resto) · E44→N-12 · E45→N-46 · E46→N-32 · E47→P-56 · E48→N-36 (#14582), P-27 (#15466), P-02 (#13929/#14361, #14831), O-15 (#15612 SQL/Redis) · E49→N-34 (max_tokens), P-24 (#14099), O-15 (resto) · E50→P-39 · E51→O-08 · E52→N-47 (a), O-04 (b) · E53→P-44 (#15994), P-42 (#14466), N-45 (#15709), P-56 (`faa55f02f5`, #15707, #14308/#14470), P-41 (#14357), O-15 (resto) · E54→N-19 · E55→P-44 · E56→P-44 · E57→N-27 · E58→P-11 · E59→N-07 · E60→O-05 · E61→P-37 (GITHUB_TOKEN, read/feeds, #15982, REM), N-46 (#15950 ast_grep), O-07 (#15826), O-15 (resto) · E62→O-09

**Slice M (coding-agent 18.12.0–18.13.3)**
M1→N-01 · M2→N-06 · M3→N-06 · M4→N-15 · M5→N-35 · M6→N-23 · M7→N-24 · M8→N-27 · M9→N-08 · M10→N-14 · M11→N-15 · M12→N-07 · M13→N-07 · M14→N-07 · M15→N-07 · M16→N-09 · M17→N-37 · M18→N-45 (#16153), P-38 (#17067, #17022, #14838) · M19→N-30 · M20→N-41 (relacionadas→P-58) · M21→N-38 · M22→N-02 · M23→P-07 · M24→P-13 · M25→P-04 · M26→P-04 · M27→P-09 · M28→O-16 · M29→P-20 · M30→P-21 · M31→O-17 · M32→O-18 · M33→P-06 · M34→N-42 (#16429/#16430), P-08 (#16431) · M35→O-19 · M36→P-53 · M37→O-20 · M38→P-43 (AGENTS.md), O-21 (flag) · M39→N-40 (#16594), P-37 (#16920) · M40→P-37 · M41→P-24 · M42→P-11 · M43→P-56 · M44→P-23 (#17139, #17080, #17246, #12590, #17135, #17262, #17158, #17197), P-08 (#16046) · M45→P-28 (#16282), P-43 (#16919), P-41 (#16608), P-23 (#16690, #17120), P-46 (#17151), O-04 (#16873, #17073, #15753, #17136), O-06 (#17189), O-22 (#16612, continueSeverity, WATCHDOG, #17087, #16484) · Entradas de «Cobertura» M marcadas POTENCIAL→P-58 o P-02 (resume), OTRA→O-46

**Slice L (coding-agent 18.14.0–18.18.9)**
L1→N-33 · L2→N-11 · L3→N-10 · L4→N-09 · L5→P-01 · L6→P-30 · L7→O-07 · L8→P-30 · L9→P-15 · L10→P-16 · L11→P-52 · L12→N-05 · L13→N-16 · L14→P-08 · L15→N-17 (#539→P-15) · L16→N-25 · L16b→P-29 · L17→N-36 (#224, #392, #551), P-02 (#404, #95, #164, #396/#430, #496) · L18→N-32 · L19→P-06 · L20→P-05 · L21→N-39 · L21b→N-40 · L22→N-37 · L23→N-45 (#381→P-17) · L24→O-23 · L25→O-24 · L26→O-25 · L27→P-18 · L28→P-45 · L29→P-19 (#93→P-59) · L30→O-26 · L31→P-31 · L32→P-25 · L33→P-22 · L34→P-27 · L35→P-12 · L36→P-13 · L37→P-10 · L38→P-46 · L39→N-04 · L40→N-44 (#124, #533), P-38 (resto) · L41→P-39 · L42→P-40 · L43→P-48 · L44→O-04 · L45→N-43 (#231, #320), P-28 (#68, #74, #53) · L46→P-41 · L47→P-51 · L48→O-27 · L49→P-37 · L50→P-49 · L51→P-47 · L52→P-50 · Entradas de `late-entries.txt` marcadas POTENCIAL→P-59 (#412→P-43), OTRA→O-47, breaking→§7, duplicados→D-08

**Slice C (agent/ai/catalog)**
C1→N-20 · C2→N-22 · C3→N-23 · C4→N-21 · C5→N-24 · C6→N-26 · C7→D-04 (núcleo), P-29 (rama/display) · C8→P-29 · C9→O-12 · C10→O-12 · C11→O-12 · C12→O-28 · C13→N-08 · C14→P-27 · C15→N-39 · C16→D-02 (adoptar en N-39) · C17→N-08 · C18→P-27 · C19→P-25 · C20→P-26 · C21→P-27 · C22→P-27 · C23→P-27 · C24→P-27 · C25→P-10 · C26→P-10 · C27→P-04 (`ApprovalDetailsOptions`→D-05) · C28→P-14 · C29→P-27 · C30→P-32 · C31→P-32 · C32→P-27 · C33→P-36 · C34→O-29 · C35→O-29 · C36→O-29 · C37→N-28 · C38→O-30 · C40→N-18 · C41→N-29 · C42→N-30 (stall vacío, frame error, corte antes de `message_delta`), P-34 (resto) · C43→N-31 · C44→N-12 (yield strict, opcionales, uniones), P-14 (resto) · C45→N-31 · C46→N-02 (a), O-33 (b) · C47→N-32 (77e080cb83), P-35 (resto) · C48→P-26 · C49→D-03 (guard→P-53) · C50→P-36 · C51→N-35 (paginación), P-05 (resto) · C52→P-26 · C53→O-31 · C54→O-20 · C55→P-31 · C56→O-32 · C57→P-33 · C58→P-33 · C59→O-33 · C60→P-34 · C61→P-34 · C62→P-34 · C63→P-53 · C64→O-34 · C65→O-35 (auth-gateway→O-08) · C70→P-46 · C71→O-10 · C72→P-28 · C73→P-53 · C74→P-33 · C75→O-36 (C37 aparte) · C76→O-36 · C77→O-36 · C78→O-36 (subconjunto→P-06)

**Slice N (natives/tui/utils/paquetes nuevos/crates)**
N1→N-45 · N2→N-45 · N3→N-45 · N4→P-17 · N5→N-46 · N6→N-46 · N7→P-18 · N8→N-47 · N9→N-46 · N10→N-46 · N11→N-46 · N12→N-47 · N13→P-54 · N14→P-42 · N15→P-54 · N16→P-54 · N17→P-54 · N18→N-48 · N19→N-48 · N20→N-48 · N21→N-48 · N22→P-54 (frontmatter, JSONL, `readSalvageableRows`), O-45 (resto), N-49 (`sanitizeTextDeep`) · N23→O-37 · N24→P-28 · N25→N-28 · N26→N-49 · N27→N-43 · N28→P-25 · N29→P-19 · N30→O-38 · N31→O-39 · N32→P-47 · N33→P-04 · N34→P-54 (Windows), O-04 (resto) · N35→P-37 · N36→P-10 (`settledAtMs`, effort ceiling, `mcp_progress`), O-45 (resto) · N37→O-04 · N38→P-54 · N39→O-40 · N40→O-41 · N41→O-07 · N42→O-42 (Factory), P-28 (18.17.0), N-01 (Bun) · N43→O-14 · N44→P-19 / O-14 · N45→O-14 · N46→O-43 (Bun→N-01) · N47→O-44

**Totales**: NECESARIAS 49 · POTENCIALES 59 · OTRAS 47 · Descartados 17. Los 62 IDs E, 45 IDs M, 54 IDs L (L1–L52, L16b, L21b), 73 IDs C y 47 IDs N quedan asignados.
