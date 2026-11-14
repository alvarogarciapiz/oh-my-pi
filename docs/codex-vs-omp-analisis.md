# OpenAI Codex frente a oh-my-pi (MarIA Code): qué merece la pena adoptar

## Resumen ejecutivo

- **El núcleo del agente de omp ya está a la altura de Codex, o por encima**: clave de caché de prompt, contexto *append-only*, reintentos con *fallback* de modelo y de credencial, `AGENTS.md` en varios formatos, memoria semántica conectable, modo Plan con bloqueo real de escritura, `eval` como puente de herramientas, *blob-broker*, búsqueda de sesiones con FTS, esquema RPC generado con SDKs en Go/Python/Rust y edición con coincidencia difusa. Nada de eso hay que portarlo (sección «Dónde omp ya iguala o supera a Codex»).
- **La gran diferencia está en la seguridad de ejecución.** Codex trata la seguridad como varias capas independientes y redundantes; omp tiene una sola capa: aprobación previa por patrones de texto y, una vez aprobado, el comando corre con todos los permisos del usuario. Los seis primeros MUST forman un bloque coherente:
  1. **Sandbox del sistema operativo** (Seatbelt en macOS, Landlock + bubblewrap en Linux, token restringido en Windows).
  2. **Clasificador semántico de comandos** que desenvuelve `sudo`/`env`/`bash -c` antes de decidir.
  3. **Política de ejecución declarativa** con tests embebidos, aprendizaje de reglas persistente y canonicalización de comandos.
  4. **Control de confianza del proyecto** (hoy `isProjectTrusted: () => true`).
  5. **Revisor automático de riesgo con LLM** («Guardian»), que permite aprobar en automático sin bajar la guardia.
  6. **Proxy de red con lista de dominios permitidos** y broker de credenciales.
- Fuera de la seguridad hay cuatro MUST de producto con muy buena relación valor/esfuerzo: **`--output-schema` en el modo headless** (casi todo está ya escrito), **diff unificado por turno** como evento para la TUI y la extensión de VS Code, **`/review` como modo de primera clase** y **consolidación de memoria agéntica e incremental**.
- **Orden de ataque recomendado:**
  1. Ganancias rápidas: `--output-schema` (MUST 8), control de confianza (MUST 4) y canonicalización + clasificador semántico (MUST 2 y parte del 3).
  2. Mejoras medianas: política declarativa con aprendizaje de reglas (MUST 3), diff por turno (MUST 7), `/review` (MUST 9), Guardian v1 solo para `bash` (MUST 5).
  3. Apuestas grandes: sandbox de SO (MUST 1), después el proxy de red encima (MUST 6) y la Fase 2 de memoria agéntica (MUST 10).

## Metodología

- **Qué se analizó.** Clon de solo lectura de OpenAI Codex en el commit `7194b2177643` (13-11-2026). Se leyó sobre todo el workspace Rust `codex-rs/`:
  - Bucle y contexto: `core/src` (`turn.rs`, `compact*.rs`, `responses_retry.rs`, `state/`, `session/`, `agents_md.rs`, `turn_diff_tracker.rs`) y los crates `rollout-trace`, `thread-store`, `context-fragments`.
  - Herramientas y ejecución: `core/src/tools`, `core/src/unified_exec`, `core/src/exec_policy*`, `apply-patch`, `exec-server`, `git-utils`, `code-mode`.
  - Seguridad: `sandboxing`, `linux-sandbox`, `windows-sandbox-rs`, `network-proxy`, `execpolicy`, `shell-command`, `core/src/guardian`, `guardian-context`, `process-hardening`, `keyring-store`, `hooks`.
  - Multiagente: `core/src/tools/handlers/multi_agents_v2`, `agent-graph-store`, `message-board`, `worktree`, `agent-roles`.
  - Memoria: `memories/{read,write}`.
  - Plataforma: `exec`, `cli` (`doctor.rs`, `mcp_cmd.rs`), `features`, `app-server-protocol`, `plugin`, `otel-trace-websocket`, `skills`, `prompts`, `collaboration-mode-templates`.
- **Cómo se contrastó.** Ocho líneas de investigación (bucle y contexto, memoria, subagentes, herramientas, seguridad, plataforma, prompts y rincones sin cubrir) compararon cada candidato con el código real de omp. Después, una revisión final comprobó que cada ruta de Codex citada existe en el clon y que el hueco en omp es real (búsqueda dirigida en el repositorio). Los candidatos que resultaron cubiertos por omp se descartaron o se reformularon (ver «Dónde omp ya iguala o supera a Codex» y el apartado de correcciones al final de esta sección).
- **Deduplicación.** Varias líneas de investigación encontraron lo mismo desde ángulos distintos; aparece una sola vez: sandbox de SO, clasificador semántico de comandos, política declarativa (con aprendizaje de reglas y canonicalización), Guardian, diff por turno y presupuesto de bytes de `AGENTS.md`.
- **Relación con el análisis de ZCode** (`docs/zcode-vs-omp-analisis.md`). Algunos ítems coinciden con huecos ya señalados allí (control de confianza, clasificador semántico, reglas persistentes, servidor remoto). Se marcan con «coincide con el análisis de ZCode» y aquí se aporta la **implementación de referencia concreta de Codex**, que es más madura.
- **Leyenda de esfuerzo.**
  - **poco**: días.
  - **medio**: de 1 a 3 semanas.
  - **mucho**: más de 3 semanas o un subsistema nuevo.
- **Rutas.** Las de Codex son relativas a la raíz del clon (empiezan por `codex-rs/`); las de omp, a la raíz de este repositorio.
- **Correcciones aplicadas tras verificar.**
  - *SDKs oficiales no-TS*: descartado. omp ya los tiene (`sdk/go/omp-rpc`, `sdk/python/omp-rpc`, `sdk/rust/omp-rpc`), generados desde el esquema RPC.
  - *Esquema versionado del protocolo RPC*: reformulado. omp ya genera `packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json` con `bun run gen:rpc` (`packages/coding-agent/scripts/gen-rpc/index.ts`) y lo protege con `packages/coding-agent/test/rpc-wire/generated.test.ts`; solo falta marcar la estabilidad (Interesante 18).
  - *Aplicación de parches tolerante*: descartado. omp tiene `edit.fuzzyMatch` (activo por defecto) y `edit.fuzzyThreshold` = 0,95 en `packages/coding-agent/src/edit/settings.ts`.
  - *Sesiones de terminal persistentes con `write_stdin`*: reformulado. omp ya lanza servicios de larga duración desde `bash` (`name`, `pty`) y acepta escribir en su entrada estándar vía `proc://<id>`. El hueco real es más estrecho (Interesante 1).
  - *Reparación ante `content_filter`* y *reconexión ante caídas de red*: rebajados a Interesantes. omp ya tiene un sistema de recuperación de turno muy completo (`packages/coding-agent/src/session/turn-recovery.ts`, `retry.maxRetries` = 10 con espera exponencial y *fallback* de modelo ante rechazos de clasificador).
  - *Continuar con el mejor juicio si `ask` no obtiene respuesta*: descartado. `packages/coding-agent/src/tools/ask.ts` ya selecciona automáticamente la opción recomendada al expirar el tiempo y no ofrece la herramienta si no hay interfaz.

## Tabla resumen

### MUST (imprescindibles)

| # | Nombre | Área | Esfuerzo | Qué tiene omp hoy |
|---|---|---|---|---|
| 1 | Sandbox de proceso a nivel de SO con reintento sin sandbox | Seguridad / ejecución | mucho | Nada: `bash` corre en el host con todos los permisos del usuario; `crates/pi-iso` solo clona ficheros. |
| 2 | Clasificador semántico de comandos peligrosos (desenvuelve *wrappers*) | Seguridad / permisos | medio | `CRITICAL_BASH_PATTERNS`: expresiones regulares sobre el texto, sin desenvolver `sudo`/`env`/`bash -c`. |
| 3 | Política de ejecución declarativa + aprendizaje de reglas + canonicalización | Seguridad / permisos | medio | Lista plana `BashApprovalPatternRule[]`; no aprende reglas ni normaliza comandos equivalentes. |
| 4 | Control de confianza del proyecto | Seguridad | medio | `isProjectTrusted: () => true`; todo lo del proyecto se carga sin preguntar. |
| 5 | Revisor automático de riesgo con LLM (Guardian) | Seguridad / autonomía | mucho (v1: medio) | Solo reglas estáticas y *hooks* booleanos. |
| 6 | Proxy de red con lista de dominios permitidos y broker de credenciales | Seguridad / red | mucho | Ningún control de red para comandos. |
| 7 | Diff unificado por turno como evento de protocolo | UX / revisión | medio | Diff por llamada de edición; ningún agregado por turno. |
| 8 | `--output-schema` en el modo headless | Plataforma / CI | poco | El validador existe, pero solo para subagentes y el SDK. |
| 9 | `/review` como modo de primera clase | Calidad / flujo | medio | Subagente genérico `reviewer` vía `task`, sin objetivo tipado ni restricciones forzadas. |
| 10 | Consolidación de memoria agéntica e incremental (diff git) | Memoria / coste | mucho | Una sola llamada que regenera toda la memoria en JSON. |

### INTERESANTES

| # | Nombre | Área | Esfuerzo | Qué tiene omp hoy |
|---|---|---|---|---|
| 1 | Sondeo incremental de procesos por el modelo (`unified_exec`) | Ejecución | medio | Servicios con `proc://` (stdin solo para servicios) y trabajos `async` sin entrada. |
| 2 | Reparación de turno ante `content_filter` | Bucle | poco | Error terminal en OpenAI; *fallback* de modelo solo para rechazos tipo Anthropic. |
| 3 | Reconexión desacoplada ante caídas de red | Bucle / fiabilidad | poco | Presupuesto único de 10 reintentos para todo tipo de error. |
| 4 | Bundle de trazas crudas con reductor offline | Observabilidad | mucho (reducido: medio) | `debug/report-bundle.ts` y métricas agregadas; sin grafo padre-hijo. |
| 5 | Compactación remota especulativa en segundo plano | Contexto / latencia | medio | Compactación síncrona al cruzar el umbral. |
| 6 | Aviso en dos etapas antes de compactar | Contexto | poco | Un único disparo. |
| 7 | Presupuesto de bytes para `AGENTS.md` con aviso de truncado | Contexto / coste | poco | Sin límite ni aviso. |
| 8 | `AGENTS.override.md` de reemplazo por directorio | Contexto | poco | Solo `AGENTS.local.md` aditivo. |
| 9 | Citas de memoria y retención por uso real | Memoria | medio | Poda solo por recencia. |
| 10 | Fuentes de memoria conectables con `instructions.md` | Memoria | poco | Solo rollouts propios y `learned.md`. |
| 11 | Guardia de *rate-limit* antes del pipeline de memoria | Memoria / coste | poco | El pipeline siempre llama al modelo. |
| 12 | Interrupción preventiva de un subagente | Multiagente | medio | Los mensajes IRC se encolan. |
| 13 | Grafo de *spawn* consultable y herramienta `list_agents` | Multiagente | medio | `DelegationLedger` solo con hijos directos; sin herramienta. |
| 14 | Tablón de mensajes multicanal con hilos y búsqueda | Multiagente | medio | IRC plano y tablón de tareas. |
| 15 | Tope global del pool de *worktrees* | Multiagente / limpieza | poco | Limpieza por tarea, sin tope global. |
| 16 | Endurecimiento del proceso al arrancar | Seguridad | poco | Nada. |
| 17 | Fijación de confianza de plugins y *hooks* por hash de contenido | Seguridad | poco | `enabled` booleano. |
| 18 | Marcado de estabilidad en el contrato RPC | Plataforma | poco | Esquema generado, sin anotar estable/experimental. |
| 19 | `omp doctor` global | Plataforma / soporte | medio | `doctor` locales e informe de depuración. |
| 20 | Registro central de *feature flags* por etapas + `/experimental` | Plataforma | medio | Ajustes dispersos sin ciclo de vida. |
| 21 | `omp mcp login/add/list/remove` fuera de sesión | Plataforma / CI | medio | OAuth de MCP solo dentro de una sesión. |
| 22 | Bóveda de credenciales en el llavero del SO | Seguridad | medio | Ficheros planos en disco. |
| 23 | Reenvío en vivo de trazas OTel por WebSocket | Observabilidad | poco | Exportación OTLP por lotes. |
| 24 | Manifiesto de plugin con metadatos de tienda | Ecosistema | poco | Manifiesto mínimo. |
| 25 | Atribución de reglas del repositorio en los hallazgos de revisión | Calidad | poco | El revisor no cita `AGENTS.md`. |
| 26 | Detección de uso implícito de skills | Skills | poco | Solo se reconoce el uso explícito. |
| 27 | *Hooks* externos por comando (JSON por stdin) | Extensibilidad | medio | *Hooks* TS/JS dentro del proceso. |
| 28 | «Proyectos» que agrupan sesiones de varios directorios | Sesiones / UX | medio | Agrupación implícita por `cwd`. |
| 29 | Servidor de ejecución remoto (`exec-server`) como diseño de referencia | Plataforma | mucho | SSH que ejecuta un comando por llamada. |

---

## MUST — imprescindibles

### 1. Sandbox de proceso a nivel de SO con reintento sin sandbox

*Problema que resuelve:* hoy, cuando omp ejecuta un comando aprobado, ese comando puede leer, escribir y conectarse a cualquier sitio que pueda el usuario. Si una aprobación es un error (humano o de una regla) o un comando se cuela por un fallo del filtro, no hay segunda barrera.

**Descripción de la mejora**
Ejecutar cada comando de `bash` (y, por extensión, cualquier herramienta que lance procesos) dentro de un **sandbox del sistema operativo**: un mecanismo del núcleo que limita qué ficheros puede tocar el proceso, si puede usar la red y qué llamadas al sistema puede hacer. El perfil típico es *workspace-write*: escritura solo dentro del directorio del proyecto (y temporales), lectura del resto, red cortada o filtrada. Si el sandbox bloquea algo legítimo, el agente detecta la denegación, pide aprobación para repetir sin sandbox y recuerda la decisión. Aprobación y sandbox pasan a ser **capas independientes**: la aprobación evita preguntar demasiado; el sandbox contiene los errores.

**En qué consiste en Codex**
- **Un backend por plataforma** en el crate `codex-rs/sandboxing/src`:
  - macOS: perfiles Seatbelt (el lenguaje SBPL de `sandbox-exec`) en `seatbelt.rs`, con políticas base en `seatbelt_base_policy.sbpl`, `seatbelt_network_policy.sbpl` y `seatbelt_read_only_platform_defaults.sbpl`.
  - Linux: Landlock (restricción de ficheros sin privilegios del núcleo) + bubblewrap (`bwrap`, espacios de nombres) en `landlock.rs`, `bwrap.rs` y `linux_pid_namespace.rs`; el binario de bubblewrap se distribuye junto al agente (crate `codex-rs/linux-sandbox`).
  - Windows: token restringido o backend MXC (`windows.rs`, `windows_mxc.rs`, crate `codex-rs/windows-sandbox-rs`).
- **Selección y envoltura.** `SandboxManager` (`sandboxing/src/manager.rs`) elige el backend según la política de permisos del turno y transforma el comando en uno envuelto (`policy_transforms.rs`, `launch.rs`, `spawn.rs`).
- **Diagnóstico de denegaciones.** `violation.rs` clasifica la salida de un proceso fallido («operation not permitted», seccomp, Landlock, Seatbelt, código de salida 128+SIGSYS) en un evento tipado; `denial.rs::is_likely_sandbox_denied` decide si el fallo se debe probablemente al sandbox.
- **Orquestación.** `codex-rs/core/src/tools/orchestrator.rs` (`ToolOrchestrator`) y `codex-rs/core/src/tools/sandboxing.rs` (`ApprovalStore`, `Approvable`) encadenan aprobación → primer intento en sandbox → si hay denegación, petición de aprobación para reintentar fuera del sandbox → la decisión queda en caché para la sesión.

**Por qué encaja con el código actual de omp / MarIA Code**
- El punto de enganche es único y conocido: la ejecución de `bash` en `packages/coding-agent/src/tools/bash.ts` y el ejecutor `packages/coding-agent/src/exec/bash-executor.ts`. Envolver el comando en `sandbox-exec -p <perfil>` (macOS) o `bwrap … --` (Linux) es una transformación de argv en ese punto.
- Verificado: no hay ninguna referencia a Seatbelt, Landlock, bubblewrap ni `sandbox-exec` en el código de ejecución de omp. Solo `packages/coding-agent/src/tools/file-write-fallback.ts` menciona Seatbelt como algo que el SO *podría* imponer desde fuera.
- **Piezas reutilizables:**
  - `crates/pi-iso` hace clonación *copy-on-write* del sistema de ficheros (APFS, Btrfs, ZFS, overlayfs, reflink). **No es un sandbox de procesos**, pero combinado con uno da un perfil muy potente: ejecutar en una copia del workspace con escritura confinada a esa copia.
  - El modelo de aprobación (`packages/coding-agent/src/tools/approval.ts`, modos `always-ask`/`write`/`yolo`) ya tiene el lugar natural para el «reintentar sin sandbox».
  - Los subagentes aislados en *worktrees* (`packages/coding-agent/src/task/isolation-runner.ts`) son el primer candidato a usar el perfil *workspace-write* (su raíz es el *worktree*).
- La extensión de VS Code (MarIA Code) se beneficia directamente: es el caso de uso con más riesgo de abrir repositorios ajenos.

**Qué mejora aportaría**
- **Seguridad:** cierra la brecha más grande frente a Codex. Un comando aprobado por error o un falso negativo del clasificador ya no tiene acceso total al disco ni a la red.
- **Autonomía:** con contención real se puede ampliar la lista de comandos que se ejecutan sin preguntar (menos interrupciones) sin aumentar el riesgo.
- **Requisitos corporativos:** en un entorno bancario, poder afirmar «el agente no escribe fuera del proyecto ni sale a la red» es una condición habitual para autorizar la herramienta.

**Esfuerzo**
mucho — subsistema nuevo con tres backends de SO, perfiles que mantener y pruebas por plataforma; empezar por macOS (Seatbelt, sin binarios extra) y Linux (bubblewrap/Landlock) y dejar Windows para después.

---

### 2. Clasificador semántico de comandos peligrosos (desenvuelve *wrappers*)

*Problema que resuelve:* las reglas de omp buscan patrones en el texto del comando. Un comando peligroso escondido dentro de un envoltorio (`env FOO=1 sudo bash -c 'rm -rf …'`) depende de que la expresión regular acierte con la subcadena, y una regla del usuario como «denegar `rm -rf`» no se evalúa contra lo que va dentro de `bash -c "…"`. *Coincide con el análisis de ZCode (MUST 5); aquí se aporta la implementación de referencia de Codex.*

**Descripción de la mejora**
Antes de decidir si un comando es peligroso o si una regla de aprobación coincide, **convertir el comando en un árbol** y desenvolver recursivamente los *wrappers* (envoltorios: programas que solo lanzan a otro programa) más comunes: `sudo`, `env VAR=… cmd`, `trap '…' SEÑAL`, `bash -c`/`sh -c`/`bash -lc`, intérpretes con código en línea (`deno eval`, `bun -e`, `Rscript -e`, `cmd.exe /c`, PowerShell). Cada comando interno se evalúa igual que si se hubiera escrito directamente. Si el anidamiento supera una profundidad máxima, el resultado es «peligroso» (fallo cerrado). Así, un *wrapper* nunca puede dar más confianza que el comando que envuelve.

**En qué consiste en Codex**
- `codex-rs/shell-command/src/command_safety/is_dangerous_command.rs`:
  - tokeniza el comando y desenvuelve `sudo`, `env [ASIGNACIONES…]`, `trap '<script>'` (reescrito como `sh -c <script>`) y cualquier `bash -c`/`sh -c` anidado;
  - el límite `MAX_DANGEROUS_COMMAND_WRAPPER_DEPTH = 8` falla cerrado si se supera;
  - detecta `rm` forzado (`-f`, `-rf`, `--force`) en cualquier posición de los argumentos.
- En Windows añade un análisis del árbol sintáctico de PowerShell con tree-sitter (`powershell_tree_sitter.rs`, `windows_dangerous_commands.rs`).
- En la ruta de aprobación, `codex-rs/core/src/exec_policy/executable_identity.rs` (`create_exec_approval_requirement_for_shell`) compara el ejecutable real tras desenvolver con el comando original; si difieren, extrae los comandos internos y los antepone a la evaluación de la política.
- `codex-rs/core/src/exec_policy.rs` mantiene `BANNED_PREFIX_SUGGESTIONS`, una lista de unos 30 intérpretes y *wrappers* para los que nunca se sugiere una regla de «permitir siempre por prefijo», porque permitirían cualquier cosa.

**Por qué encaja con el código actual de omp / MarIA Code**
- `packages/coding-agent/src/tools/bash.ts` ya separa comandos compuestos: `approval()` (desde la línea ~515) usa `extractLiteralAndChainSegments` de `packages/coding-agent/src/tools/shell-tokenize.ts` para trocear por `&&`, `;` y `|`, y aplica `CRITICAL_BASH_PATTERNS` (línea 187) y las reglas del usuario a cada segmento. Falta el paso recursivo: desenvolver cada segmento antes de evaluarlo.
- `shell-tokenize.ts` (que ya tiene `tokenizeShellSegments` y `extractLeadingCdTarget`) es el sitio natural para un `unwrapCommand(argv, depth)`.
- Base compartida con el MUST 3: la política declarativa debe evaluar el comando ya desenvuelto.

**Qué mejora aportaría**
- **Seguridad:** menos falsos negativos con envoltorios triviales, que son exactamente los que un modelo o una inyección de prompt usarían para colarse.
- **Menos falsos positivos:** al razonar sobre argv en vez de texto, se puede bloquear `rm -rf` sin bloquear `echo "rm -rf"`.
- **Coherencia:** las reglas del usuario significan lo que el usuario cree que significan.

**Esfuerzo**
medio — tabla de *wrappers*, recursión acotada sobre el tokenizador existente y una batería de tests adversariales; PowerShell sería una segunda fase.

---

### 3. Política de ejecución declarativa + aprendizaje persistente de reglas + canonicalización

*Problema que resuelve:* las reglas de aprobación de omp son una lista plana de patrones en la configuración: no se pueden probar, no explican por qué existen, no distinguen «prohibido» de «preguntar», no se aprenden a partir de las aprobaciones del usuario, y dos formas equivalentes del mismo comando (`/bin/bash -lc "git status"` y `bash -lc "git status"`) se tratan como distintas. *El aprendizaje de reglas coincide con el análisis de ZCode (MUST 6).*

**Descripción de la mejora**
Tres piezas que se refuerzan entre sí:
1. **Lenguaje de políticas declarativo.** Ficheros de reglas versionables donde cada regla dice qué prefijo de comando cubre, su decisión (`allow`, `prompt` o `forbidden`), su justificación y **ejemplos que deben y no deben coincidir**, que se validan al cargar el fichero (la regla se autoprueba). La decisión efectiva es la más estricta entre las reglas que coinciden.
2. **Aprendizaje de reglas.** Cuando el usuario aprueba un comando con «permitir siempre», se añade al fichero de política la regla **mínima** que lo cubre (nunca un prefijo que abarque un intérprete entero), de forma atómica y segura frente a escrituras concurrentes.
3. **Canonicalización.** Antes de buscar en la caché de aprobaciones o de evaluar reglas, el comando se normaliza a una forma canónica, de modo que las variantes equivalentes comparten decisión.

**En qué consiste en Codex**
- **Lenguaje:** crate `codex-rs/execpolicy` (`README.md`, `src/policy.rs`, `src/rule.rs`, ejemplo en `examples/example.codexpolicy`). La sintaxis es tipo Starlark: `prefix_rule(pattern=[…], decision="allow"|"prompt"|"forbidden", justification=…, match=[…], not_match=[…])`. `host_executable(name, paths)` ata un nombre corto a rutas absolutas concretas, para que un `/tmp/evil/git` no herede la confianza de `git`.
- **Integración:** `codex-rs/core/src/exec_policy.rs` carga un `default.rules` empaquetado más las reglas del usuario y del proyecto, y evalúa el comando ya desenvuelto (MUST 2).
- **Aprendizaje:** `codex-rs/execpolicy/src/amend.rs` (`blocking_append_allow_prefix_rule`, `blocking_append_network_rule`) añade reglas de comando o de red (host + protocolo + decisión + justificación) con un bloqueo de fichero *advisory*. `BANNED_PREFIX_SUGGESTIONS` impide sugerir prefijos peligrosos como `bash -c` o `env`.
- **Canonicalización:** `codex-rs/core/src/command_canonicalization.rs` (`canonicalize_command_for_approval`) colapsa `/bin/bash -lc` y `bash -lc` al script interno tokenizado. Lo que no se puede tokenizar con seguridad se representa con el prefijo fijo `__codex_shell_script__` + el texto exacto, para no generalizar de más.
- **Proyectos no confiables:** la política declarativa es lo único que permite ejecutar sin preguntar cuando el proyecto no es de confianza (MUST 4).

**Por qué encaja con el código actual de omp / MarIA Code**
- El modelo actual es la base: `BashApprovalPatternRule[]` (`match` + `approval: allow|prompt|deny`) en `packages/coding-agent/src/tools/bash.ts` y los modos de `packages/coding-agent/src/tools/approval.ts`. La política declarativa puede **leer las reglas actuales como caso particular** (migración sin ruptura).
- El tokenizador de `packages/coding-agent/src/tools/shell-tokenize.ts` sirve para canonicalizar y para el emparejamiento por prefijo de argv.
- El modo ACP ya expone «Always allow» y «Always reject» (`packages/coding-agent/src/session/acp-permission-gate.ts`), pero no hay una ruta que convierta esa elección en una regla persistente mínima. Es el punto donde se engancha el aprendizaje, igual que el diálogo de aprobación de la TUI y de la extensión de VS Code.
- Los ajustes se registran con el mismo patrón que el resto (`register({ id: … })` en `packages/coding-agent/src/session/settings.ts`).

**Qué mejora aportaría**
- **Seguridad auditable:** cada regla es revisable en un PR, explica su porqué y trae sus propios tests; se acabó la lista de expresiones regulares opaca.
- **Menos interrupciones:** aprender reglas mínimas y canonicalizar elimina preguntas repetidas por variantes del mismo comando.
- **Gobierno corporativo:** un equipo de seguridad puede distribuir una política base (por ejemplo, `forbidden` para `curl | sh`) que el usuario no puede rebajar.
- **Base para el resto:** es el prerrequisito natural del MUST 4, del proxy de red (reglas de red, MUST 6) y de Guardian (MUST 5, que solo debería ver lo que la política deja en `prompt`).

**Esfuerzo**
medio — gramática simple de prefijos sobre el tokenizador existente, escritura atómica de reglas y migración de `BashApprovalPatternRule`; la canonicalización por sí sola es de pocos días.

---

### 4. Control de confianza del proyecto

*Problema que resuelve:* abrir con omp un repositorio clonado de una fuente hostil carga sin preguntar su `.omp/`, sus *hooks*, extensiones, skills, servidores MCP y ficheros de instrucciones, y con ello puede ejecutar código arbitrario al iniciar la sesión. *Coincide con el análisis de ZCode (MUST 7); aquí se aporta cómo lo resuelve Codex.*

**Descripción de la mejora**
La primera vez que se abre un directorio, preguntar si es de confianza y guardar la respuesta. Mientras **no** lo sea:
- no se cargan la automatización del proyecto (*hooks*, extensiones, MCP del proyecto) ni sus instrucciones;
- todo comando requiere aprobación salvo que una regla explícita de la política lo permita.

La decisión puede atarse a un hash de los ficheros de configuración del proyecto, para volver a preguntar si cambian.

**En qué consiste en Codex**
- `AskForApproval::UnlessTrusted` (`codex-rs/protocol/src/protocol.rs`, en torno a la línea 1192) es un valor de primera clase de la política de aprobación: en un proyecto no confiable todo comando requiere aprobación salvo regla `execpolicy` que lo permita.
- La confianza afecta también al **contexto**: `codex-rs/core/src/agents_md.rs` (línea 65) no carga los `AGENTS.md` del proyecto si `config.active_project.is_untrusted()`, de modo que un repositorio hostil ni siquiera puede inyectar instrucciones.
- `codex exec` acepta `--trust` para automatizaciones que ya saben que el directorio es seguro (`codex-rs/exec/src/cli.rs`).

**Por qué encaja con el código actual de omp / MarIA Code**
- El contrato ya existe y solo devuelve `true`: `isProjectTrusted: () => true` en `packages/coding-agent/src/extensibility/extensions/runner.ts:1392` y `packages/coding-agent/src/session/agent-session.ts:8493`. La interfaz (`packages/coding-agent/src/extensibility/extensions/types.ts:659-665`) documenta literalmente «OMP performs no project-trust gating».
- El descubrimiento de capacidades está centralizado por proveedor y nivel (`level: "user" | "project"` en `packages/coding-agent/src/capability/hook.ts`, `discovery/*.ts`). Filtrar todo lo de nivel `project` cuando el directorio no es de confianza es un único punto de decisión.
- La extensión de VS Code puede reutilizar el aviso de «Workspace Trust» de VS Code como fuente de la decisión.

**Qué mejora aportaría**
- **Seguridad:** cierra el vector «clonar y abrir» en el arranque de la sesión, antes de que el usuario haya escrito nada.
- **Cumplimiento:** comportamiento alineado con VS Code, Codex y Claude Code, que ya preguntan.
- Bajo coste para el usuario: una pregunta por directorio.

**Esfuerzo**
medio — registro persistente por ruta (y opcionalmente hash), filtrado por nivel en el descubrimiento, flujo de pregunta en TUI/VS Code/RPC y un indicador para el modo headless.

---

### 5. Revisor automático de riesgo con LLM (Guardian / AutoReview)

*Problema que resuelve:* hoy en omp solo hay dos extremos: preguntar al humano (interrupciones constantes) o confiar en todo (`yolo`). Las reglas estáticas no razonan sobre la intención: no saben si un `curl` es la consecuencia razonable de lo que pidió el usuario o una exfiltración inducida por una inyección de prompt.

**Descripción de la mejora**
Cuando una acción queda en «preguntar» (comando, parche fuera del proyecto, acceso de red, llamada MCP), en lugar de interrumpir al usuario se envía a un **subagente revisor** que solo puede leer y devuelve un veredicto estructurado: nivel de riesgo, si el usuario lo ha autorizado de verdad, permitir o denegar, y la razón. El revisor recibe un contexto **blindado contra inyección**: solo los mensajes del usuario cuentan como autorización, y la salida de las herramientas y del propio asistente se marcan como datos no confiables. Solo lo que el revisor no puede aprobar llega al humano.

**En qué consiste en Codex**
- **Activación:** `ApprovalsReviewer::{User, AutoReview}` (`codex-rs/protocol/src/config_types.rs`).
- **Ciclo de vida:** `codex-rs/core/src/guardian/` (`review.rs`, `review_session.rs`, `review_session_setup.rs`, `reviewer_config.rs`, `decision.rs`, `routing.rs`):
  - la sesión revisora corre en solo lectura y con la política de aprobación «nunca»;
  - un pool reutilizable (`ReviewerPool`, en `codex-rs/ext/guardian-reviewer/src/lib.rs`) usa una clave de reutilización (`GuardianReviewSessionReuseKey`) que comprueba que modelo, permisos, MCP y `cwd` coinciden;
  - al reutilizar una sesión solo envía el delta del historial desde el último punto de control (`review_session_context.rs`);
  - `prepare_review_prewarm` precalienta la sesión para no pagar la latencia de arranque en la primera revisión;
  - `ReviewDeadline` acota el tiempo de cada revisión.
- **Veredicto obligatorio y estructurado:** `{risk_level: low|medium|high|critical, user_authorization, outcome: allow|deny, rationale}` (ver `core/src/guardian/tests.rs` y las *snapshots* en `core/src/guardian/snapshots/`).
- **Contexto blindado:** crate `codex-rs/guardian-context/src`:
  - `authorization.rs`: solo los mensajes `user` autorizan;
  - `verified_answers.rs`: respuestas del usuario verificadas por el host;
  - `trusted_tool.rs` y `trusted_skills.rs`: procedencia de herramientas y skills atestiguada por el host, para que el revisor no confunda una descripción de herramienta con una orden;
  - `budget.rs`, `allocation.rs` y `truncation.rs`: presupuesto de tokens por sección.
- En los accesos de red se incluye el **comando que los disparó**, para juzgar la causa y no solo el host.

**Por qué encaja con el código actual de omp / MarIA Code**
- omp tiene toda la maquinaria de subagentes: lanzamiento y aislamiento (`packages/coding-agent/src/task/executor.ts`, `task/isolation-runner.ts`) y salida estructurada validada (`packages/coding-agent/src/task/structured-subagent.ts`, `tools/output-schema-validator.ts`, modos `strict`/`permissive`). El veredicto de Guardian es exactamente un `outputSchema` en modo `strict`.
- El punto de decisión está en el flujo de aprobación de `packages/coding-agent/src/tools/bash.ts` y `tools/approval.ts`, y en el *hook* previo a la herramienta (`packages/coding-agent/src/extensibility/extensions/wrapper.ts`), que ya falla cerrado si vence el tiempo.
- Verificado: no hay nada llamado «guardian», «auto-review» o `risk_level` en `packages/coding-agent/src`.
- El contexto append-only de omp (`packages/agent/src/append-only-context.ts`) facilita enviar solo el delta al revisor reutilizado, como hace Codex.

**Qué mejora aportaría**
- **Autonomía segura:** sesiones largas y desatendidas (CI, subagentes, MarIA Code en tareas grandes) sin la disyuntiva entre preguntar siempre y confiar en todo.
- **Resistencia a la inyección de prompt:** una instrucción escondida en la salida de una herramienta no puede hacerse pasar por autorización del usuario.
- **Trazabilidad:** cada aprobación automática deja un veredicto con su razón, útil para auditoría.
- **Coste controlado:** pool, delta de contexto y precalentamiento mantienen bajos el gasto y la latencia; se puede usar un modelo barato.

**Esfuerzo**
mucho para la versión completa (contexto blindado con presupuesto por secciones, pool y reutilización); una **v1 acotada a comandos `bash`**, con plantilla fija y salida estructurada sobre `structured-subagent.ts`, es **medio**.

---

### 6. Proxy de red con lista de dominios permitidos y broker de credenciales

*Problema que resuelve:* un comando aprobado en omp puede conectarse a cualquier dirección de Internet o de la red interna sin restricción ni registro. Eso abre la puerta a la exfiltración de código o secretos, y a exponer credenciales reales de nube al proceso hijo.

**Descripción de la mejora**
Un proxy local (HTTP y SOCKS5) que es **la única salida de red** de los comandos ejecutados dentro del sandbox. Funciona así:
- deja pasar solo los dominios permitidos y bloquea por defecto IPs locales y privadas;
- ofrece un modo «limitado» de solo lectura (`GET`/`HEAD`/`OPTIONS`);
- registra cada decisión;
- opcionalmente actúa de **broker de credenciales**: el proceso hijo recibe una clave ficticia y el proxy firma las peticiones con la real, así que la clave nunca llega al proceso ni al texto que ve el modelo.

**En qué consiste en Codex**
- Crate `codex-rs/network-proxy/src`:
  - `proxy.rs` levanta el proxy HTTP y SOCKS5 en *loopback*;
  - `network_policy.rs` y `domain_matcher.rs` aplican la política: primero la lista de permitidos por dominio, comodines `*.`/`**.`, comodín global rechazado salvo activación explícita, bloqueo de IPs privadas y eventos auditables;
  - `mitm_hook.rs` inspecciona TLS con una CA gestionada y aplica *hooks* de cabeceras con alcance limitado;
  - `credential_broker.rs` y `aws_sigv4.rs` re-firman peticiones AWS SigV4 con la credencial real tras verificar el host.
- **Integración con el sandbox:** cuando el sandbox de SO no puede filtrar por dominio, corta toda la red salvo el proxy (`sandboxing/src/seatbelt_network_policy.sbpl`).
- Las reglas de red se aprenden igual que las de comandos (`execpolicy/src/amend.rs::blocking_append_network_rule`).

**Por qué encaja con el código actual de omp / MarIA Code**
- Depende del MUST 1: el perfil de sandbox es lo que obliga a los procesos a salir por el proxy.
- omp ya tiene experiencia con proxies y certificados corporativos: la extensión de VS Code lee la CA del sistema (`packages/vscode-extension/src/system-ca.ts`). Reutilizar esa CA simplifica una futura inspección TLS.
- La capa de secretos (`packages/coding-agent/src/secrets/index.ts`) ya ofusca secretos conocidos en el texto que ve el modelo. El broker es el complemento natural: que el proceso tampoco tenga el secreto real.
- Verificado: no hay ningún control de salida de red para comandos en `packages/coding-agent/src`.

**Qué mejora aportaría**
- **Seguridad:** cierra la exfiltración por red desde comandos aprobados, que es el riesgo restante incluso con sandbox de ficheros.
- **Protección de credenciales:** las claves de nube no quedan expuestas al proceso del agente.
- **Cumplimiento:** registro auditable de cada conexión, que en banca suele ser obligatorio.

**Esfuerzo**
mucho — proxy HTTP/SOCKS5 propio, política por dominio, integración con el sandbox y, para la versión completa, inspección TLS y broker; una primera versión **solo con lista de dominios permitidos**, sin inspección ni broker, es **medio**.

---

### 7. Diff unificado por turno como evento de protocolo

*Problema que resuelve:* tras un turno con muchas ediciones, el usuario de la TUI o de la extensión de VS Code tiene que reconstruir «qué ha cambiado» recorriendo el resultado de cada herramienta. No hay una vista única y fiable del cambio neto del turno para revisarlo, aceptarlo o descartarlo.

**Descripción de la mejora**
Un acumulador que registra, durante el turno, el estado anterior y posterior de cada fichero tocado por las herramientas de edición (y opcionalmente por `bash`). Al cambiar el agregado emite un evento con el **diff unificado neto del turno** (cambio neto: dos ediciones que se anulan no aparecen), con soporte de renombrados. La UI lo muestra como una única vista de revisión.

**En qué consiste en Codex**
- `codex-rs/core/src/turn_diff_tracker.rs` (`TurnDiffTracker`):
  - `track_delta` acumula en memoria cada delta aplicado, indexado por `(environment_id, ruta)` y con un contador de revisión;
  - gestiona renombrados;
  - memoriza el diff de cada par `(ruta, revisión)` (`DiffCacheKey`) para no recalcular ficheros sin cambios;
  - `get_unified_diff` devuelve el agregado.
- `codex-rs/core/src/tools/events.rs` decide tras cada herramienta que modifica ficheros si emitir `TurnDiffEvent`, que consumen la TUI y los IDE.
- Para cambios hechos fuera de las herramientas de edición (por ejemplo, un formateador lanzado por shell), Codex dispone de un repositorio git interno aislado que solo sirve como motor de diff: `codex-rs/git-utils/src/baseline.rs` (`ensure_git_baseline_repository`, con límite por fichero y bloqueo de concurrencia), independiente del `.git` del usuario.

**Por qué encaja con el código actual de omp / MarIA Code**
- omp ya calcula diffs por operación: `packages/coding-agent/src/session/session-history-format.ts` añade el diff unificado bajo cada línea de `edit`/`apply_patch`, y las herramientas de edición pasan por `packages/coding-agent/src/edit/store.ts`, que guarda instantáneas completas del fichero (las que generan las etiquetas *hashline*). Esas instantáneas son justo el «antes» que necesita el acumulador.
- El protocolo RPC tiene un catálogo declarativo de eventos (`packages/coding-agent/src/modes/rpc/wire/events.ts`) desde el que se generan el esquema JSON y los SDKs. Un evento `turn_diff` se propaga automáticamente a Go, Python y Rust con `bun run gen:rpc`.
- `crates/pi-vcs` ya ofrece operaciones git nativas reutilizables para la variante «baseline» de los cambios hechos por shell.
- Verificado: no existe ningún acumulador por turno ni evento equivalente en `packages/coding-agent/src` ni `packages/agent/src`.

**Qué mejora aportaría**
- **Revisión humana más rápida y fiable:** una sola vista por turno, la base de un flujo de «aceptar/descartar cambios» en MarIA Code como el de Cursor, Copilot o Codex.
- **Menos coste:** no hace falta releer el workspace ni pedir al modelo que resuma sus cambios.
- **Integraciones:** CI, `/review` (MUST 9) o el *rewind* de ficheros del análisis de ZCode pueden consumir el mismo evento.

**Esfuerzo**
medio — tracker en memoria enganchado a `edit/store.ts`, evento RPC nuevo y su presentación en la TUI y en VS Code; la variante con baseline git para cambios por shell es una segunda fase.

---

### 8. `--output-schema` en el modo headless

*Problema que resuelve:* quien integra `omp -p "…"` en un pipeline de CI no puede exigir que la respuesta final tenga una forma concreta (por ejemplo, un JSON con `{estado, ficheros, riesgos}`), así que tiene que parsear prosa y rezar.

**Descripción de la mejora**
Añadir a la CLI un parámetro `--output-schema <fichero>` con un JSON Schema. El turno principal debe terminar con una salida que cumpla el esquema; si no, se reintenta o se pide corrección y, al final, se sale con código de error. Opcionalmente, `--output-last-message <fichero>` para escribir solo el resultado final.

**En qué consiste en Codex**
- `codex-rs/exec/src/cli.rs` (líneas 58-59) declara `--output-schema <FILE>` como bandera global de `codex exec`; el turno no interactivo se restringe a ese esquema antes de terminar el proceso.
- Junto a `--json` y `--output-last-message`, forma el contrato de integración en CI de Codex.

**Por qué encaja con el código actual de omp / MarIA Code**
- **Toda la maquinaria existe ya** y es más rica que la de Codex: `outputSchema`/`outputSchemaMode` (`strict`/`permissive`) en `packages/coding-agent/src/task/structured-subagent.ts` y el validador en `packages/coding-agent/src/tools/output-schema-validator.ts`. El SDK programático ya la expone (`packages/coding-agent/src/sdk.ts:806-808`).
- Solo falta el cableado: el parser de argumentos (`packages/coding-agent/src/cli/args.ts`) y el modo headless (`packages/coding-agent/src/modes/print-mode.ts`) no aceptan el parámetro (verificado).

**Qué mejora aportaría**
- **Integración en CI y automatizaciones:** salidas verificables para pipelines, bots o flujos internos, sin parsear texto libre.
- **Fiabilidad:** el reintento ante salida inválida lo hace el agente, no el script que lo llama.
- **Coste mínimo:** reutiliza código maduro y probado.

**Esfuerzo**
poco — un parámetro de CLI, pasar el esquema al turno raíz y validar antes de salir.

---

### 9. `/review` como modo de primera clase

*Problema que resuelve:* para revisar código en omp hoy se lanza un subagente genérico `reviewer` que tiene que averiguar por su cuenta qué diff revisar. Las restricciones de una revisión (sin red, sin lanzar más subagentes, sin escribir) dependen de cómo lo lance el orquestador, y la TUI, VS Code y RPC no tienen una primitiva común.

**Descripción de la mejora**
Un comando `/review` con **objetivo tipado**: cambios sin confirmar, rama base, *commit* concreto o instrucciones libres. Lanza el revisor en una sesión aislada con restricciones **forzadas por configuración** (sin red, sin colaboración ni subagentes, sin aprobaciones, solo lectura), con un modelo revisor configurable aparte, una salida estructurada obligatoria (hallazgos con prioridad, fichero y líneas, y un veredicto global) y eventos de entrada y salida del modo que la UI sabe pintar.

**En qué consiste en Codex**
- Objetivo tipado en el protocolo: `enum ReviewTarget { UncommittedChanges, BaseBranch { branch }, Commit { sha }, Custom { instructions } }` (`codex-rs/protocol/src/protocol.rs`), que alimenta un selector de rama o *commit* en la TUI.
- `codex-rs/core/src/tasks/review.rs` (`ReviewTask`) arranca un subhilo aislado:
  - con `web_search` desactivado, colaboración y multiagente deshabilitados y política de aprobación «nunca»;
  - con las instrucciones base fijadas al rubric de revisión (`codex-rs/prompts/templates/review/rubric.md`);
  - con el modelo de revisión configurable (`review_model`).
- La salida estructurada (`ReviewOutputEvent`, prioridades P0-P3 y `overall_correctness`) tiene un *fallback* de extracción de JSON si el modelo no respeta el esquema.
- Los eventos de modo (entrada y salida de revisión) persisten en el historial (plantillas en `codex-rs/core/templates/review/`).

**Por qué encaja con el código actual de omp / MarIA Code**
- El revisor ya existe y es bueno: subagente `reviewer` (`packages/coding-agent/src/task/agents.ts`, prompt `packages/coding-agent/src/prompts/agents/reviewer.md`, con P0-P3, confianza y una comprobación de «cruce de fronteras» que Codex no tiene).
- La salida estructurada estricta ya existe (`task/structured-subagent.ts`).
- Los comandos de barra viven en `packages/coding-agent/src/slash-commands/builtin-*.ts`; hoy hay `plan-review`, pero no `/review` (verificado).
- El evento `turn_diff` del MUST 7 o `crates/pi-vcs` resuelven el diff del objetivo sin que el modelo lo busque.

**Qué mejora aportaría**
- **Calidad:** revisiones reproducibles sobre el diff correcto, con restricciones garantizadas y no dependientes del prompt.
- **Producto:** un botón «Revisar cambios» en MarIA Code y un comando equivalente en RPC/CI, sin reinventar la orquestación en cada cliente.
- **Coste:** revisor con un modelo propio (más barato o más fuerte, según el caso).

**Esfuerzo**
medio — comando y resolución del objetivo, configuración forzada del subagente, ajuste del modelo revisor y eventos RPC/UI; el revisor y la validación ya existen.

---

### 10. Consolidación de memoria agéntica e incremental (diff git)

*Problema que resuelve:* la consolidación de memoria de omp (Fase 2) reenvía en cada ejecución todo el corpus de memorias en bruto y pide al modelo que regenere desde cero, en un único JSON, toda la memoria curada y las skills aprendidas. Escala mal en coste a medida que crece el corpus, pierde lo bien curado («memoria de la memoria») y no permite editar de forma incremental skills con ficheros auxiliares.

**Descripción de la mejora**
Convertir el directorio de memorias en un repositorio git interno de línea base. En cada consolidación:
1. Se sincronizan los artefactos de entrada.
2. Se calcula el **diff desde la última consolidación**.
3. Si no hay cambios, se termina **sin coste de modelo**.
4. Si los hay, se lanza un **subagente con herramientas de fichero**, sin red, sin aprobaciones y con escritura limitada al directorio de memorias, que lee el diff y **edita in situ** `MEMORY.md`, el resumen y las skills, incluido borrar lo que perdió su fuente.
5. Si termina bien, se reinicia la línea base.

**En qué consiste en Codex**
- `codex-rs/memories/write/src/phase2.rs` orquesta: bloqueo global, sincronización de `raw_memories.md` y `rollout_summaries/`, diff, lanzamiento del subagente de consolidación y reinicio de la línea base tras el éxito.
- `codex-rs/memories/write/src/workspace.rs` escribe el diff en `phase2_workspace_diff.md` acotado a `workspace_diff::MAX_BYTES` (con corte en frontera de carácter) y usa `codex-git-utils` (`git-utils/src/baseline.rs`) para la línea base.
- El subagente se lanza con un perfil de permisos sin red, sin aprobaciones y con escritura solo local, y con la colaboración desactivada (prompts en `codex-rs/memories/write/src/prompts.rs` y plantillas de consolidación).
- Las extensiones de memoria más antiguas que `RETENTION_DAYS = 14` se podan para que la limpieza aparezca en el propio diff (`memories/write/src/extensions/prune.rs`).

**Por qué encaja con el código actual de omp / MarIA Code**
- omp ya replicó casi 1:1 la Fase 1 y la estructura de dos fases de Codex en `packages/coding-agent/src/memories/` (`index.ts`, `storage.ts`); lo que cambia es solo la Fase 2.
- Estado actual verificado: `runPhase2` llama a `runConsolidationModel` (`packages/coding-agent/src/memories/index.ts`, en torno a las líneas 587 y 996) con el prompt `packages/coding-agent/src/prompts/memories/consolidation.md`, que solo recibe `{{raw_memories}}` y `{{rollout_summaries}}` y debe devolver todo el JSON.
- **Piezas reutilizables:**
  - subagentes con aislamiento y salida validada (`task/executor.ts`, `task/structured-subagent.ts`);
  - herramientas de fichero `read`/`edit`/`write` con instantáneas (`edit/store.ts`);
  - operaciones git nativas (`crates/pi-vcs`);
  - el futuro sandbox del MUST 1 para limitar la escritura al directorio de memorias.

**Qué mejora aportaría**
- **Coste:** las consolidaciones sin cambios cuestan cero, y con cambios se envía el diff y no el corpus entero.
- **Calidad:** la memoria se refina en lugar de reescribirse; las skills complejas se actualizan por partes; lo obsoleto se elimina de forma explícita.
- **Escalabilidad:** el sistema sigue siendo viable con meses de historial.

**Esfuerzo**
mucho — línea base git, subagente con permisos restringidos, rediseño del prompt de consolidación de «devuelve JSON» a «edita ficheros» y migración de las memorias existentes.

---

## INTERESANTES

### 1. Sondeo incremental de procesos por el modelo (`unified_exec`)
- **Qué es:** el problema es que el modelo no puede llevar una conversación con un proceso que no sea un servicio (un REPL, un depurador o un instalador que pide confirmación, lanzados como comando corriente), ni pedir «dame la salida de los próximos 5 segundos» de forma incremental. Codex convierte cualquier ejecución en una sesión reutilizable: el modelo recibe un `process_id`, consulta la salida por trozos con un tiempo de espera elegido y escribe en su entrada cuando lo necesita.
- **Cómo lo hace Codex:** `codex-rs/core/src/unified_exec/mod.rs` (`UnifiedExecProcessManager`):
  - hasta `MAX_UNIFIED_EXEC_PROCESSES = 64` procesos PTY o no-PTY por sesión;
  - espera acotada entre `MIN_YIELD_TIME_MS = 250` y `MAX_YIELD_TIME_MS = 30_000`;
  - búfer de salida de `UNIFIED_EXEC_OUTPUT_MAX_BYTES` (1 MiB);
  - reutilización por `process_id` con la herramienta `write_stdin`.
  
  `codex-rs/core/src/unified_exec/stdin_approval.rs` (`TerminalPermissions::review_requirement`) vuelve a exigir aprobación si la política de sandbox, red o ficheros cambió desde el lanzamiento, en lugar de heredar la confianza original.
- **Estado en omp:** ya cubre gran parte. `bash` lanza servicios de larga duración (`name`, `pty`, `ready`) y `proc://<id>` admite escribir en su stdin (`packages/coding-agent/src/internal-urls/proc-protocol.ts`), pero **solo para servicios** (el código lo rechaza para trabajos y agentes). Los trabajos `async` de `packages/coding-agent/src/tools/bash.ts` no aceptan entrada, y `tools/bash-interactive.ts` es un PTY solo para humanos. Faltan el sondeo incremental con espera elegida por el modelo, el stdin para cualquier ejecución y la reaprobación al cambiar la política.
- **Valor:** desbloquea tareas interactivas sin intervención humana; la reaprobación es relevante en cuanto exista el sandbox (MUST 1).
- **Esfuerzo:** medio.

### 2. Reparación de turno ante `content_filter`
- **Qué es:** el problema es que, cuando el filtro de contenido de OpenAI corta una respuesta, omp aborta la tarea. Codex inyecta una guía correctiva y reintenta.
- **Cómo lo hace Codex:** `codex-rs/core/src/responses_retry.rs` construye un fragmento `ContentFilterGuidance` con un texto específico del modelo, lo graba en la conversación y reintenta con espera exponencial; `codex-rs/protocol/src/error.rs` da a `ContentFilter` una política de reintento (no es terminal).
- **Estado en omp:** `packages/ai/src/providers/openai-shared.ts:3834-3841` lanza `ProviderResponseError` con `kind: "content-blocked"`, y `packages/ai/src/error/flags.ts` excluye `ContentBlocked` de los reintentos. omp sí recupera los rechazos de clasificador tipo Anthropic (`stopReason` `refusal`/`sensitive`) cambiando de modelo (`isClassifierRefusal` en `packages/coding-agent/src/session/turn-recovery.ts`), pero no inyecta guía ni reintenta con el mismo modelo.
- **Valor:** menos tareas perdidas por falsos positivos del filtro; un solo reintento acotado.
- **Esfuerzo:** poco.

### 3. Reconexión desacoplada ante caídas de red
- **Qué es:** el problema es que un corte de red largo (VPN que cae, portátil suspendido) agota el mismo presupuesto de reintentos que un error real del servidor. Codex separa «se cayó la conexión» de «el servidor falló» y para lo primero espera de forma indefinida, avisando al usuario.
- **Cómo lo hace Codex:** `codex-rs/core/src/responses_retry.rs`, bajo `Feature::UnboundedConnectionRetries`: ante `ConnectionFailed` ignora `max_retries` y reconecta con espera desde `INITIAL_CONNECTION_RETRY_DELAY` (5 s), duplicándola hasta `MAX_CONNECTION_RETRY_DELAY` (60 s), con el aviso «Reconnecting… waiting for network».
- **Estado en omp:** `turn-recovery.ts` usa un presupuesto único: `retry.maxRetries` = 10, `retry.baseDelayMs` = 500 y `retry.maxDelayMs` = 5 min (`packages/coding-agent/src/session/settings.ts`). Eso aguanta varios minutos, pero agota los reintentos ante cortes largos y mezcla ambos tipos de error.
- **Valor:** tareas largas que sobreviven a la suspensión del portátil o a la VPN.
- **Esfuerzo:** poco.

### 4. Bundle de trazas crudas con reductor offline
- **Qué es:** el problema es que, cuando falla una cadena de subagentes, no se puede reconstruir qué vio exactamente cada modelo ni cómo se encadenaron las llamadas. Codex graba primero los eventos crudos, sin interpretarlos, e interpreta después con un reductor determinista.
- **Cómo lo hace Codex:** crate `codex-rs/rollout-trace` (activable con `CODEX_ROLLOUT_TRACE_ROOT`, ver `README.md`):
  - escribe un `trace.jsonl` ordenado por un único escritor;
  - guarda los payloads grandes (peticiones, respuestas, entradas y salidas de herramientas) en `payloads/*.zst`;
  - `codex debug trace-reduce` (`replay_bundle`) genera `state.json`, un grafo que separa lo que vio el modelo de los límites de ejecución e incluye los árboles de subagentes.
- **Estado en omp:** `packages/coding-agent/src/debug/report-bundle.ts` empaqueta sesión, logs e información del sistema en un `.tar.gz`, y `packages/agent/src/run-collector.ts`/`telemetry.ts` agregan métricas. No hay payloads completos de petición ni un grafo que enlace cada `task` con la transcripción del hijo.
- **Valor:** depuración de fallos complejos de multiagente; base para evaluaciones.
- **Esfuerzo:** mucho completo; una versión reducida (JSONL opcional con referencias a payloads + reductor del árbol padre-hijo) es medio.

### 5. Compactación remota especulativa en segundo plano
- **Qué es:** el problema es que el usuario espera mientras se compacta el contexto. Codex prepara la compactación en segundo plano antes de necesitarla y solo bloquea si de verdad llega al límite.
- **Cómo lo hace Codex:** `codex-rs/core/src/compact_remote_v2_attempt.rs` (`BackgroundCompactionCandidate`, `run_background_compaction`, `capture_background_input`) y `codex-rs/core/src/compact_remote_v2.rs` (espera sobre el intento ya en curso).
- **Estado en omp:** `packages/agent/src/compaction/compaction.ts` compacta de forma síncrona al cruzar el umbral.
- **Valor:** menos latencia percibida en sesiones largas.
- **Esfuerzo:** medio.

### 6. Aviso en dos etapas antes de compactar
- **Qué es:** el problema es que la compactación llega sin aviso. Codex primero avisa una vez al modelo de que se acerca al límite (para que cierre lo que tiene a medias) y solo al llegar a cero inyecta el *prompt* de reserva; además distingue si los tokens restantes los confirmó el servidor o son una estimación.
- **Cómo lo hace Codex:** `codex-rs/core/src/state/auto_compact_window.rs` (`claim_token_budget_reminder`, `claim_auto_compact_fallback`, `AutoCompactWindowPrefill::ServerObserved`) y `codex-rs/core/src/session/token_budget.rs`.
- **Estado en omp:** un único disparo (`shouldCompact`/`resolveThresholdTokens` en `packages/agent/src/compaction/compaction.ts`).
- **Valor:** compactaciones en mejores momentos y menos trabajo perdido a medias.
- **Esfuerzo:** poco.

### 7. Presupuesto de bytes para `AGENTS.md` con aviso de truncado
- **Qué es:** el problema es que un `AGENTS.md` enorme (generado o heredado de un monorepo) infla el prompt base sin que nadie se entere. Codex limita el total y avisa de forma explícita cuando recorta.
- **Cómo lo hace Codex:** `codex-rs/core/src/agents_md.rs` aplica `project_doc_max_bytes` (por defecto `DEFAULT_PROJECT_DOC_MAX_BYTES` = 32 KiB, en `codex-rs/config/src/config_toml.rs`) al conjunto de ficheros, de la raíz al `cwd`, y emite un aviso con ruta, bytes cargados y la guía `PROJECT_DOC_BUDGET_GUIDANCE` («increase `project_doc_max_bytes`»).
- **Estado en omp:** `packages/coding-agent/src/discovery/agents-md.ts` y `packages/coding-agent/src/capability/context-file.ts` cargan varios formatos con prioridad, pero sin límite total ni aviso.
- **Valor:** contexto y coste predecibles y transparentes.
- **Esfuerzo:** poco.

### 8. `AGENTS.override.md` de reemplazo por directorio
- **Qué es:** el problema es que no hay forma de anular localmente las instrucciones compartidas de un directorio sin editarlas. En Codex un fichero de reemplazo tiene prioridad sobre `AGENTS.md` en el mismo nivel.
- **Cómo lo hace Codex:** `LOCAL_AGENTS_MD_FILENAME = "AGENTS.override.md"` en `codex-rs/core/src/agents_md.rs:45`.
- **Estado en omp:** `AGENTS.local.md` es aditivo (`capability/context-file.ts`); no hay reemplazo.
- **Valor:** caso de uso menor, pero barato con la infraestructura actual de descubrimiento.
- **Esfuerzo:** poco.

### 9. Citas de memoria y retención por uso real
- **Qué es:** el problema es que omp no sabe qué memorias se usan de verdad: al llegar al tope descarta lo más antiguo, aunque sea lo más útil. En Codex el modelo cita de dónde saca cada dato y esas citas alimentan el ranking de retención.
- **Cómo lo hace Codex:** el modelo emite `<oai-mem-citation>` con `<citation_entries>` (fichero:líneas) y `<rollout_ids>`; se parsea en `codex-rs/core/src/stream_events_utils.rs` y `codex-rs/memories/read/src/citations.rs`, se retira del texto visible y se expone estructurado. La Fase 2 ordena por número de usos y último uso, y poda lo que lleva tiempo sin usarse.
- **Estado en omp:** `stage1_outputs` en `packages/coding-agent/src/memories/storage.ts` no tiene columnas de uso; `listStage1OutputsForGlobal` (línea 528) ordena solo por `source_updated_at DESC`.
- **Valor:** mejor memoria a largo plazo y trazabilidad («¿de dónde salió esto?») en la UI.
- **Esfuerzo:** medio.

### 10. Fuentes de memoria conectables con `instructions.md`
- **Qué es:** el problema es que añadir una fuente de memoria nueva (notas manuales, hallazgos de otra herramienta) obliga a tocar el pipeline. En Codex basta con dejar una carpeta con sus propias instrucciones de interpretación, que se tratan como datos y no como órdenes.
- **Cómo lo hace Codex:** `codex-rs/memories/write/src/extensions/ad_hoc.rs` y `prune.rs`, plantilla `codex-rs/memories/write/templates/extensions/ad_hoc/instructions.md`, con poda a los 14 días.
- **Estado en omp:** solo rollouts propios y `learned.md` (`packages/coding-agent/src/memories/`).
- **Valor:** extensibilidad barata de la memoria.
- **Esfuerzo:** poco.

### 11. Guardia de *rate-limit* antes del pipeline de memoria
- **Qué es:** el problema es que la extracción de memoria en segundo plano compite en silencio con la tarea del usuario por la misma cuota. Codex no la arranca si la cuota restante está por debajo de un umbral.
- **Cómo lo hace Codex:** `codex-rs/memories/write/src/guard.rs` con `min_rate_limit_remaining_percent`.
- **Estado en omp:** el pipeline de `packages/coding-agent/src/memories/` llama al modelo sin comprobar la cuota, aunque omp ya consulta el uso de muchos proveedores (`packages/ai/src/usage/`).
- **Valor:** evita que el trabajo de fondo agote la cuota del usuario.
- **Esfuerzo:** poco.

### 12. Interrupción preventiva de un subagente
- **Qué es:** el problema es que, cuando el orquestador descubre que una tarea delegada ya no tiene sentido, solo puede esperar a que termine o matarla perdiendo el progreso. Codex puede cortar el turno en curso del subagente y redirigirlo al momento.
- **Cómo lo hace Codex:** `codex-rs/core/src/tools/handlers/multi_agents_v2/interrupt_agent.rs` y `send_input` con `interrupt=true` (`codex-rs/core/src/tools/handlers/multi_agents_spec.rs`).
- **Estado en omp:** `packages/coding-agent/src/irc/messaging.ts` encola los mensajes; se entregan en el siguiente punto de parada del receptor.
- **Valor:** orquestación más eficiente y menos trabajo desperdiciado.
- **Esfuerzo:** medio.

### 13. Grafo de *spawn* consultable y herramienta `list_agents`
- **Qué es:** el problema es que, con árboles de subagentes de varios niveles, no hay forma barata de saber qué sigue vivo en todo el árbol, ni el propio modelo puede consultarlo (y tras una compactación lo olvida, lo que provoca delegaciones duplicadas).
- **Cómo lo hace Codex:**
  - `codex-rs/agent-graph-store/src/local.rs`: aristas padre-hijo en SQLite con estado abierto/cerrado y consulta en anchura de descendientes filtrada por estado;
  - `codex-rs/core/src/tools/handlers/multi_agents_v2/list_agents.rs`: herramienta del modelo con filtro por ruta jerárquica (`root/worker-2/helper`).
- **Estado en omp:** `packages/coding-agent/src/task/delegation-ledger.ts` reconstruye solo el último estado de los hijos directos; `packages/coding-agent/src/registry/agent-registry.ts` no se expone como herramienta.
- **Valor:** cierre en cascada, vistas de árbol y menos redelegación.
- **Esfuerzo:** medio.

### 14. Tablón de mensajes multicanal con hilos y búsqueda
- **Qué es:** el problema es que en enjambres grandes todo mensaje va 1:1 o a todos, sin histórico consultable. Codex tiene canales con permisos, hilos, suscripciones y búsqueda, expuestos también por MCP.
- **Cómo lo hace Codex:** `codex-rs/message-board/src` y el adaptador `message-board-mcp`.
- **Estado en omp:** `irc/` es punto a punto o difusión plana; `packages/coding-agent/src/task/team-board.ts` es un tablón de tareas, no de discusión.
- **Valor:** coordinación en enjambres grandes; los agentes que llegan tarde se ponen al día.
- **Esfuerzo:** medio.

### 15. Tope global del pool de *worktrees*
- **Qué es:** el problema es que los *worktrees* huérfanos (tras cierres anómalos) se acumulan sin límite. Codex limita cuántos hay y expulsa el más antiguo.
- **Cómo lo hace Codex:** `codex-rs/worktree/src/settings.rs` (`DEFAULT_WORKTREE_KEEP_COUNT = 15`, limpieza automática).
- **Estado en omp:** `packages/coding-agent/src/task/worktree.ts` limpia por tarea; `omp gc` (`packages/coding-agent/src/commands/gc.ts`) barre blobs, sesiones e informes, pero no *worktrees*.
- **Valor:** mantenimiento sin intervención manual.
- **Esfuerzo:** poco.

### 16. Endurecimiento del proceso al arrancar
- **Qué es:** el problema es que otro proceso del mismo usuario podría adjuntar un depurador al agente o leer un volcado de memoria con claves de API en claro. Codex lo impide antes de `main`.
- **Cómo lo hace Codex:** `codex-rs/process-hardening/src/lib.rs` (`pre_main_hardening`): `PR_SET_DUMPABLE=0` / `PT_DENY_ATTACH`, `RLIMIT_CORE=0` y limpieza de `LD_*`/`DYLD_*`.
- **Estado en omp:** nada equivalente (las coincidencias de `RLIMIT_CORE` en `crates/pi-shell` son el `ulimit` del shell, no endurecimiento).
- **Valor:** defensa en profundidad barata.
- **Esfuerzo:** poco (requiere un *binding* nativo mínimo).

### 17. Fijación de confianza de plugins y *hooks* por hash de contenido
- **Qué es:** el problema es que una actualización silenciosa de un plugin ya habilitado hereda la confianza anterior. Codex ata la aprobación al hash del contenido y vuelve a preguntar si cambia.
- **Cómo lo hace Codex:** `codex-rs/hooks/src/engine/plugin_trust.rs` (`PluginHookTrust`, SHA-256 del bundle).
- **Estado en omp:** `enabled` booleano (`packages/coding-agent/src/extensibility/plugins/`); sin hash.
- **Valor:** protección frente a la cadena de suministro; encaja con el MUST 4.
- **Esfuerzo:** poco.

### 18. Marcado de estabilidad en el contrato RPC
- **Qué es:** el problema es que un consumidor externo no sabe en qué partes del protocolo puede apoyarse. Codex marca campo a campo qué es experimental.
- **Cómo lo hace Codex:** la macro `ExperimentalApi` (`codex-rs/app-server-protocol/src/experimental_api.rs`) y las pruebas de compatibilidad del esquema.
- **Estado en omp:** **el esquema ya se genera**. `bun run gen:rpc` (`packages/coding-agent/scripts/gen-rpc/index.ts`) produce `rpc-wire.schema.json`, los tipos TS y los SDKs de Go, Python y Rust, y `test/rpc-wire/generated.test.ts` falla si están desactualizados. Solo falta una anotación de estabilidad en el catálogo (`packages/coding-agent/src/modes/rpc/wire/commands.ts`, `events.ts`) propagada al esquema y a los SDKs.
- **Valor:** contrato claro para integraciones externas (por ejemplo, herramientas internas sobre los SDKs).
- **Esfuerzo:** poco.

### 19. `omp doctor` global
- **Qué es:** el problema es que, para dar soporte, hay que recopilar a mano autenticación, red, terminal, instalación y estado. Codex lo agrega en un solo comando de solo lectura con salida humana o `--json` redactada.
- **Cómo lo hace Codex:** `codex-rs/cli/src/doctor.rs` y sus módulos (red, sandbox, git, disco, terminal, actualizaciones).
- **Estado en omp:** varios `doctor` locales (plugins en `extensibility/plugins/manager.ts`, `omp images doctor` en `cli/images-cli.ts`, `/doctor` del *blob-broker* en `blob-broker/broker.ts`) y un informe de depuración con información del sistema (`packages/coding-agent/src/debug/system-info.ts`, `report-bundle.ts`). Falta el orquestador único.
- **Valor:** soporte y diagnóstico más rápidos, sobre todo en entornos corporativos con proxy.
- **Esfuerzo:** medio (sobre todo reutilización).

### 20. Registro central de *feature flags* por etapas + `/experimental`
- **Qué es:** el problema es que las funciones experimentales están dispersas y sin ciclo de vida. Codex centraliza cada *flag* con su etapa (en desarrollo, experimental, estable, obsoleta, retirada) y expone un menú y una CLI.
- **Cómo lo hace Codex:** `codex-rs/features/src/lib.rs` (enum `Feature`, `Stage`) y `codex features list|enable|disable`.
- **Estado en omp:** ajustes en `packages/coding-agent/src/config/all-settings.ts` y `session/settings.ts` sin etapas.
- **Valor:** despliegues progresivos y retiradas ordenadas.
- **Esfuerzo:** medio.

### 21. `omp mcp login/add/list/remove` fuera de sesión
- **Qué es:** el problema es que, para usar un servidor MCP con OAuth en headless/CI, hoy hay que autenticarse antes dentro de una sesión interactiva. Codex tiene subcomandos independientes, con login cancelable por navegador o pegando el callback.
- **Cómo lo hace Codex:** `codex-rs/cli/src/mcp_cmd.rs` y `mcp_login.rs`.
- **Estado en omp:** el OAuth vive en `packages/coding-agent/src/mcp/manager.ts` y `oauth-flow.ts`, solo dentro de la sesión; no hay subcomando `mcp` en `packages/coding-agent/src/commands/`.
- **Valor:** pipelines con MCP listos de antemano.
- **Esfuerzo:** medio.

### 22. Bóveda de credenciales en el llavero del SO
- **Qué es:** el problema es que los secretos de omp viven en ficheros planos. Codex los guarda en el almacén nativo del sistema (Keychain en macOS, Credential Manager en Windows, Secret Service en Linux).
- **Cómo lo hace Codex:** crate `codex-rs/keyring-store` (`src/lib.rs`, sobre el crate `keyring` con los backends nativos `apple-native`, `windows-native` y `sync-secret-service` declarados en su `Cargo.toml`). El crate vecino `codex-rs/user-verification/src` añade espacios de nombres por clave (`key_namespace.rs`), bloqueo de ciclo de vida (`lifecycle_lock.rs`) y la integración específica de macOS (`platform_macos.rs`).
- **Estado en omp:** `packages/coding-agent/src/secrets/index.ts` ofusca secretos en el texto que ve el modelo (otro problema), pero `secrets.yml` y la clave HMAC están en disco sin cifrar.
- **Valor:** protección de credenciales en reposo, relevante en equipos corporativos.
- **Esfuerzo:** medio.

### 23. Reenvío en vivo de trazas OTel por WebSocket
- **Qué es:** el problema es que no hay forma de ver en directo, con un visor ligero, lo que hace una sesión. Codex reenvía los lotes OTLP locales por WebSocket.
- **Cómo lo hace Codex:** crate `codex-rs/otel-trace-websocket`.
- **Estado en omp:** `packages/coding-agent/src/telemetry-export.ts` solo exporta por lotes.
- **Valor:** depuración durante el desarrollo.
- **Esfuerzo:** poco.

### 24. Manifiesto de plugin con metadatos de tienda
- **Qué es:** el problema es que el manifiesto de omp no tiene campos de presentación. Codex incluye nombre visible, descripciones, categoría, URLs legales, iconos y capturas.
- **Cómo lo hace Codex:** `codex-rs/plugin/src/manifest.rs`.
- **Estado en omp:** `packages/coding-agent/src/extensibility/plugins/types.ts` (nombre, versión, descripción y componentes).
- **Valor:** solo si se quiere un *marketplace* visual (por ejemplo, en MarIA Code).
- **Esfuerzo:** poco.

### 25. Atribución de reglas del repositorio en los hallazgos de revisión
- **Qué es:** el problema es que el revisor puede inventar un estándar que el repositorio no sigue. Codex cita el `AGENTS.md` aplicable que respalda cada hallazgo de convención, tras deduplicar los hallazgos.
- **Cómo lo hace Codex:** sección «Repository Rule Attribution» de `codex-rs/prompts/templates/review/rubric.md`.
- **Estado en omp:** `packages/coding-agent/src/prompts/agents/reviewer.md` (con P0-P3, confianza y comprobación de fronteras) no pide citar las instrucciones del repositorio.
- **Valor:** hallazgos más accionables y menos falsos estándares; encaja con el MUST 9.
- **Esfuerzo:** poco (solo prompt).

### 26. Detección de uso implícito de skills
- **Qué es:** el problema es que, si el modelo ejecuta directamente el script de una skill o lee su documentación por ruta, omp no lo reconoce como uso de esa skill, ni siquiera si está desactivada para la sesión.
- **Cómo lo hace Codex:** `codex-rs/skills/src/invocation.rs` (`detect_implicit_skill_invocation_for_command`) contrasta el comando tokenizado o la ruta leída con los directorios `scripts/` y de documentación de las skills instaladas.
- **Estado en omp:** las skills (`packages/coding-agent/src/extensibility/skills.ts`, `internal-urls/skill-protocol.ts`) pueden desactivarse por sesión (retiradas del prompt, de `/skill:` y de `skill://`), pero un acceso directo por ruta no se detecta.
- **Valor:** coherencia de la desactivación por sesión y telemetría real de uso de skills (útil para la auto-mejora de skills).
- **Esfuerzo:** poco.

### 27. *Hooks* externos por comando (JSON por stdin)
- **Qué es:** el problema es que los *hooks* del ecosistema Claude Code/Codex (bash, Python, cualquier binario) no se pueden reutilizar en omp, y un *hook* en proceso que se cuelga comparte el bucle de eventos del agente. Codex ejecuta el *hook* como proceso aparte, con un contrato JSON por stdin y códigos de salida (0 continúa o reescribe, 2 bloquea).
- **Cómo lo hace Codex:** `codex-rs/hooks/src/events/pre_tool_use.rs` y el motor de `codex-rs/hooks/src/engine/`.
- **Estado en omp:** `packages/coding-agent/src/extensibility/hooks/loader.ts` carga módulos TS/JS con `import` nativo; los proveedores de Claude y Codex (`discovery/claude.ts`, `discovery/codex.ts`) solo cargan ficheros `pre-<tool>`/`post-<tool>` en TS/JS. La reescritura de argumentos ya existe para *hooks* TS (`extensibility/shared-events.ts`). Relacionado con el envoltorio de *hooks* del análisis de ZCode (MUST 8).
- **Valor:** compatibilidad de ecosistema y aislamiento con tiempo máximo.
- **Esfuerzo:** medio.

### 28. «Proyectos» que agrupan sesiones de varios directorios
- **Qué es:** el problema es que, en iniciativas con varios repositorios (frontend + backend, microservicios), cada `cwd` es una isla en el historial. Codex tiene proyectos con nombre y varias raíces.
- **Cómo lo hace Codex:** `codex-rs/thread-store/src/local/projects.rs` (CRUD de proyectos con varias raíces).
- **Estado en omp:** agrupación implícita por `cwd`; la búsqueda de sesiones (`packages/coding-agent/src/session/session-search/`) no tiene filtro por proyecto.
- **Valor:** organización del historial en MarIA Code y la TUI.
- **Esfuerzo:** medio.

### 29. Servidor de ejecución remoto (`exec-server`) como diseño de referencia
- **Qué es:** el problema es que omp no puede trabajar de forma fiable sobre una máquina remota (VM, contenedor) que sobreviva a cortes. Codex tiene un demonio JSON-RPC sobre WebSocket con el mismo modelo de procesos y ficheros que en local, reconexión, relé cifrado e identidad. *Coincide con el análisis de ZCode (MUST 17); aquí se aporta el diseño concreto de Codex.*
- **Cómo lo hace Codex:** `codex-rs/exec-server/README.md` (protocolo, modo remoto con registro y relé Noise, tramas segmentadas con `seq`/`ack`, tokens de portador o SigV4, modo *forward*) y su implementación en `codex-rs/exec-server/src` (`client_recovery.rs`, `environment_registry.rs`, …).
- **Estado en omp:** `packages/coding-agent/src/ssh/connection-manager.ts` ejecuta cada comando como una sesión SSH puntual (con ControlMaster).
- **Valor:** entornos remotos de desarrollo; aquí no es un hueco nuevo, sino la referencia para implementar el MUST 17 de ZCode.
- **Esfuerzo:** mucho.

---

## Dónde omp ya iguala o supera a Codex (no portar)

- **Clave de caché de prompt y contexto *append-only*:** `packages/agent/src/append-only-context.ts` (`StablePrefix` con huella por herramienta y `AppendOnlyLog`), más fino que el «world state» declarativo de Codex, que se re-renderiza y reconcilia en cada turno; clave derivada en `packages/ai/src/providers/openai-shared.ts`.
- **Reintentos y recuperación de turno:** `packages/coding-agent/src/session/turn-recovery.ts` (reintentos seguros de repetir, *fallback* de credencial y de modelo, recuperación de cortes a mitad de *stream*, «refusal walk») y `packages/ai/src/utils/empty-completion-retry.ts` son comparables o más cuidadosos que `responses_retry.rs`, con las excepciones puntuales de los Interesantes 2 y 3.
- **`AGENTS.md` y ficheros de contexto:** varios formatos (Codex, Claude, Copilot, Gemini, OpenCode) con imports `@`, prioridad por fuente y `AGENTS.local.md` (`packages/coding-agent/src/discovery/`, `capability/context-file.ts`); Codex solo soporta el suyo.
- **Memoria semántica:** backends conectables con recuperación por embeddings (`packages/coding-agent/src/memory-backend/`) y `learn`/`learned.md` para lecciones en caliente; Codex solo inyecta ficheros planos.
- **Aislamiento de subagentes:** `packages/coding-agent/src/task/executor.ts` fuerza `approvalMode: "yolo"` en los hijos, equivalente al `approval_policy=Never` de los delegados de Codex; reanudación automática al recibir un mensaje (`task/persisted-revive.ts`), sin necesidad de un `resume_agent` explícito.
- **Maquinaria multiagente:** `WorkPool`, `TeamTaskBoard`, `DelegationLedger`, comprobaciones de aceptación y *worktrees* aislados (`packages/coding-agent/src/task/`), más ricos que los roles TOML de Codex (`agent-roles`); nombres de agente en `task/name-generator.ts`.
- **Modo Plan:** bloqueo real de escritura a nivel de herramienta (`packages/coding-agent/src/tools/plan-mode-guard.ts`, enganchado en `tools/write.ts`) y aprobación vía `xd://propose` (`prompts/system/plan-mode-active.md`); Codex solo lo impone por prompt.
- **Especialización de prompts por modelo:** ejes de catálogo declarativos (`packages/catalog/src/compat/axes.ts`), frente a cinco ficheros `*_prompt.md` casi duplicados en Codex.
- **Control de esfuerzo de razonamiento y verbosidad:** mapas y *fallback* entre dialectos de proveedor en `packages/ai/src/providers/`, que cubren más proveedores.
- **Edición de ficheros:** coincidencia difusa (`edit.fuzzyMatch`, umbral 0,95 en `packages/coding-agent/src/edit/settings.ts`) y auto-reparación tras fallo de sintaxis (`packages/coding-agent/src/edit/auto-repair.md`); el `seek_sequence.rs` de Codex no aporta más.
- **Code mode:** `packages/coding-agent/src/tools/eval.ts` con declaraciones generadas ya es un puente JS de herramientas en producción; el V8 embebido de Codex (`codex-rs/v8-poc`) es solo una prueba de concepto.
- **Adjuntos:** `packages/coding-agent/src/blob-broker/` (deduplicación, *fallback* multi-backend, demonio compartido, túneles) supera al `AttachmentStore` de Codex.
- **Búsqueda de sesiones:** SQLite FTS con *worker* y reconciliación incremental (`packages/coding-agent/src/session/session-search/`), frente al `ripgrep` sobre rollouts de Codex.
- **Esquema RPC y SDKs no-TS:** esquema JSON generado, test de frescura y SDKs en `sdk/go/omp-rpc`, `sdk/python/omp-rpc` y `sdk/rust/omp-rpc`, todos generados desde el mismo catálogo.
- **Skills por sesión:** `get_skills`, `set_disabled_skills` y `reload_skills` por RPC (commit `25a6906f00`) cubren lo esencial de `codex-rs/skills`, salvo el Interesante 26.
- **Reescritura de argumentos en *hooks*:** `ToolCallEventResult.input` (`packages/coding-agent/src/extensibility/shared-events.ts`) equivale al `updated_input` de Codex.
- **`ask` sin respuesta:** autoselección de la opción recomendada al expirar el tiempo, y herramienta no ofrecida sin interfaz (`packages/coding-agent/src/tools/ask.ts`).
- **Herramientas de plan y tareas:** `todo` equivale a `update_plan`, que en Codex está desactivada por defecto.
- **Importación desde otros agentes:** `--from-claude`/`--from-codex` y plugins de Claude (`packages/coding-agent/src/discovery/claude.ts`, `claude-plugins.ts`) cubren lo que hace `external-agent-migration`.
- **Proveedores locales:** Ollama/LM Studio con descubrimiento y re-sondeo de contexto (`packages/ai/src/providers/ollama.ts`, `packages/coding-agent/src/config/model-discovery.ts`).
- **Descartados por no aplicar:** `agent-identity`, `cloud-tasks*` y `responses-api-proxy` (infraestructura propia de OpenAI); `personality` (obsoleto en el propio Codex); «ghost commit»/`undo` (Codex lo construyó y lo retiró: `Feature::GhostCommit` está marcado como eliminado en `codex-rs/features/src/lib.rs`, así que no conviene copiarlo); umbrales cuantitativos de verbosidad de `codex-rs/core/gpt_5_1_prompt.md` (el contrato de entrega de omp ya cubre el principio; ganancia marginal); revert/fork por posición de byte de `thread-store` (el árbol de sesión de omp ya es no destructivo y no tiene esa complejidad de almacenamiento que proteger); parser de `apply_patch` en *streaming* (no se demostró que sea un hueco en `crates/pi-edit`).

---

## Hoja de ruta sugerida

**Fase 1: ganancias rápidas (días)**
- `--output-schema` en headless (MUST 8).
- Primera versión del control de confianza por directorio (MUST 4), con `isProjectTrusted()` real y filtrado de lo de nivel `project`.
- Canonicalización de comandos y desenvoltura de *wrappers* en `shell-tokenize.ts` (MUST 2 y la parte de canonicalización del MUST 3).
- Arreglos baratos: presupuesto de `AGENTS.md` (I7), aviso en dos etapas (I6), reparación ante `content_filter` (I2), reconexión desacoplada (I3), guardia de *rate-limit* de memoria (I11), tope de *worktrees* (I15), endurecimiento del proceso (I16), hash de plugins (I17), atribución de reglas en la revisión (I25), marcado de estabilidad RPC (I18), uso implícito de skills (I26).

**Fase 2: mejoras medianas (semanas)**
- Permisos: política declarativa con tests embebidos y aprendizaje de reglas (MUST 3); Guardian v1 solo para `bash` sobre `structured-subagent.ts` (MUST 5).
- Producto: diff por turno con evento RPC y vista en MarIA Code (MUST 7); `/review` con objetivo tipado (MUST 9).
- Plataforma y soporte: `omp doctor` (I19), `omp mcp …` (I21), *feature flags* (I20), *hooks* por comando (I27).
- Memoria y contexto: citas y retención por uso (I9), compactación especulativa (I5).
- Multiagente: interrupción preventiva (I12), grafo y `list_agents` (I13).

**Fase 3: apuestas grandes (meses)**
- Sandbox de SO (MUST 1): macOS y Linux primero, Windows después; luego el sondeo incremental de procesos con reaprobación (I1).
- Proxy de red con lista de dominios permitidos y, más adelante, broker de credenciales (MUST 6), sobre el sandbox.
- Guardian completo con contexto blindado y pool (MUST 5, fase 2).
- Consolidación de memoria agéntica (MUST 10), usando el sandbox para confinar la escritura.
- Según demanda: trazas crudas (I4), bóveda en el llavero (I22), tablón multicanal (I14), proyectos (I28) y servidor remoto (I29, junto con el MUST 17 de ZCode).
