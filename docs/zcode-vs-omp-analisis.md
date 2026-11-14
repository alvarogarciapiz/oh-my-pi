# ZCode frente a oh-my-pi: qué merece la pena adoptar

## Resumen ejecutivo

- En el **núcleo del bucle del agente, omp ya supera a ZCode**: ejecución especulativa de herramientas, *steering* en vivo, clasificación de errores de proveedor, guardia de bucles entre turnos, contexto *append-only* para la caché de prompts, compactación mecánica con anclas de fidelidad y carga diferida de herramientas. Nada de eso hay que portarlo.
- ZCode marca la diferencia en cinco frentes donde omp sí tiene huecos reales:
  1. **Orquestación durable de tareas largas**: un motor de workflows DAG persistente que se reanuda tras una caída, con reintento por nodo, colecciones explorables, un bucle crítico y un DSL tipado.
  2. **Seguridad y confianza del workspace**: control de confianza por proyecto, clasificador semántico de comandos `bash` de solo lectura, *hooks* que fallan en cerrado, escapado de `<system-reminder>` y redacción de la telemetría.
  3. **Memoria selectiva por consulta**, en lugar de inyectar un resumen fijo.
  4. **Rewind real de ficheros**, no solo de la conversación.
  5. **Herramientas para evaluar prompts y proveedores**: snapshots byte a byte de las peticiones y regresión contra proveedores reales.
- Recomendación: empezar por los arreglos de seguridad baratos (ítems 14, 16, 15 y 7) y la memoria selectiva (9), y abordar como apuesta principal el motor durable de workflows (1-3), montándolo sobre la maquinaria de subagentes que omp ya tiene.

## Metodología

- **Qué se analizó.** Se revisó el repositorio de ZCode (clon de solo lectura, versión **v3.18.2** según su `README.md`). Paquetes principales:
  - `apps/zcode-cli/packages/core` (runtime, workflow, memory, tool, hooks, system-reminder, compact, context).
  - `apps/zcode-cli/packages/{bootstrap,telemetry,dynamic-workflow,node-repl-host,*-plugin,office-runtime}`.
  - `apps/zcode-cli/tools/{prompt-trajectory,provider-regression}`.
  - `packages/{services,formal-proof}` y `docs/`.
- **Cómo se contrastó.** Siete líneas de investigación (bucle de ejecución, contexto y memoria, subagentes y workflow, herramientas, plataforma y evaluación, servicios y documentación, rincones sin cubrir) compararon cada candidato con el código de omp. Un revisor verificó leyendo directamente los puntos críticos. Lo que ZCode hace peor o igual que omp se descartó y aparece en la sección «Dónde omp ya supera a ZCode».
- **Leyenda.**
  - **Impacto.** *Muy alto*: cambia lo que omp puede hacer o cierra un riesgo de seguridad. *Alto*: mejora clara de calidad, coste o tasa de éxito. *Medio*: mejora localizada o que depende de otra pieza.
  - **Esfuerzo estimado.** **S** = días; **M** = 1-2 semanas; **L** = 3-6 semanas; **XL** = más de 6 semanas o un subsistema nuevo.
  - **Rutas.** Las de ZCode son relativas a la raíz de ese repositorio; las de omp, a la raíz de este.
  - **Incertidumbre.** Los ítems marcados como *auditoría* son patrones que conviene revisar, no huecos demostrados.

## Tabla resumen

### MUST (imprescindibles)

| # | Nombre | Área | Impacto | Esfuerzo | Qué tiene omp hoy |
|---|---|---|---|---|---|
| 1 | Motor de workflows DAG durable y reanudable | Orquestación | Muy alto | XL | Subagentes reanudables uno a uno, pero sin estado durable del grafo ni planificador. |
| 2 | Colecciones explorables con expansión perezosa | Orquestación | Muy alto | L | `WorkPool` solo procesa listas finitas que pasa quien llama. |
| 3 | Bucle crítico con reapertura acotada de nodos | Orquestación / calidad | Alto | M | Comprobaciones deterministas de aceptación y autoestimación de progreso; sin un crítico que ordene retrabajo. |
| 4 | DSL de workflows dinámicos tipado y analizado | Orquestación | Muy alto | XL | Subagentes guiados en lenguaje natural y un tablero compartido, sin verificación estática ni diario de reanudación. |
| 5 | Clasificador semántico (AST/argv) de `bash` de solo lectura | Permisos | Muy alto | M | Reglas de patrón del usuario y `CRITICAL_BASH_PATTERNS`; todo lo demás pasa a `exec`. |
| 6 | Sugerencia de reglas persistentes acotadas | Permisos / UX | Alto | M | No sugiere ningún alcance seguro. |
| 7 | Control de confianza del proyecto/workspace | Seguridad | Muy alto | M | Ninguno: `isProjectTrusted: () => true`. |
| 8 | Envoltorio de ejecución de *hooks* | Seguridad | Alto | M | *Hooks* JS en proceso, siempre ejecutados y sin fallo cerrado. |
| 9 | Recuperación selectiva de memoria por consulta | Contexto / coste | Muy alto | M | Inyecta un `memory_summary.md` fijo truncado por presupuesto. |
| 10 | Rewind del workspace (ficheros) con alcances | Sesión / seguridad | Muy alto | L | `checkpoint`/`rewind` solo ramifican la conversación. |
| 11 | Canal de escalado bloqueante subagente → padre | Orquestación | Alto | M | No existe. |
| 12 | Arnés de trayectorias de prompt (snapshots byte a byte) | Evaluación | Muy alto | L | Nada equivalente. |
| 13 | Arnés de regresión contra proveedores reales | Evaluación | Alto | L | Nada equivalente. |
| 14 | Endurecimiento de `<system-reminder>` y registro central de fuentes | Seguridad | Muy alto | S (escapado) / M (registro) | Interpola el cuerpo de `AGENTS.md` sin escapar. |
| 15 | `turnControl.stopTurnAfterResult` en los resultados de herramienta | Bucle | Alto | S | Solo existe una puerta del host antes de la llamada al modelo. |
| 16 | Redacción de la telemetría antes de exportar a OTLP | Seguridad | Muy alto | S | El exportador OTLP no sanea nada. |
| 17 | Servidor remoto persistente, versionado y reconectable | Plataforma | Muy alto | XL | SSH como herramienta que ejecuta un comando cada vez. |

### INTERESANTES

| # | Nombre | Área | Impacto | Esfuerzo | Qué tiene omp hoy |
|---|---|---|---|---|---|
| 1 | Aviso de antigüedad en memorias recuperadas | Memoria | Medio | S | Solo una fecha (mnemopi) o nada (resumen local). |
| 2 | Consolidación de memoria contrastada con `AGENTS.md` | Memoria | Medio | S | La consolidación no recibe `AGENTS.md`. |
| 3 | Regla contra la sobrecoincidencia en memorias de perfil | Memoria | Medio | S | No hay tal advertencia. |
| 4 | Filtro de elegibilidad sin coste antes de extraer memoria | Memoria / coste | Medio | S | Filtra por inactividad y antigüedad; siempre llama al modelo. |
| 5 | Aviso de compactación sobre la cola literal | Compactación | Medio | S | No existe. |
| 6 | Guardia de no-progreso (resultados sin cambios e hitos de volumen) | Bucle | Medio | S | `ToolCallLoopGuard` detecta llamadas idénticas. |
| 7 | Plazo pausable mientras se espera admisión del proveedor | Herramientas | Medio | M | Timeouts planos de reloj de pared. |
| 8 | Herramientas de control de sesiones para agentes | Orquestación | Medio | M | Solo mediante ACP; `wait` se limita a trabajos propios. |
| 9 | Propagación de contexto de traza y diario de actividad | Observabilidad | Medio | M | `traceId` solo en el transporte MCP. |
| 10 | `WorkflowDefinition` declarativa como dato | Orquestación | Medio | S (con el 1) | La estructura vive en los prompts. |
| 11 | `ContextSection[]` con `cacheHint`/`injectionTarget` (auditoría) | Contexto / caché | Medio (por confirmar) | S (auditoría) | `StablePrefix`, más fino; falta comprobar dónde caen los datos volátiles. |
| 12 | Telemetría de TTFT por etapas | Observabilidad | Medio | M | Histogramas por ejecución, chat y herramienta. |
| 13 | Spans OTel vivos y proyecciones a semconv GenAI | Observabilidad | Medio | M | Métricas agregadas. |
| 14 | Bots de chat como front-end bidireccional | Plataforma | Alto | L | Solo subida de ficheros por webhook a Discord. |
| 15 | Enumeración exhaustiva del espacio de estados | Calidad | Medio | M | Tests de escenarios elegidos a mano. |
| 16 | Cola en segundo plano consciente de la capacidad | Plataforma | Medio | L | Pistas de *service tier* y trabajos en proceso. |
| 17 | Subagente juez visual con veredicto JSON por página | Calidad | Medio | S | Autoverificación ad hoc. |
| 18 | Automatización de simuladores iOS/Android | Herramientas | Medio | L | Nada. |
| 19 | Visor de documentos de oficina renderizados con anclas | Herramientas | Medio | L | `read` solo extrae texto. |
| 20 | Biblioteca de skills de diseño y documentos | Contenido | Medio | M | Solo documentación del mecanismo. |
| 21 | Skill-creator interactivo y metaskill `using-superpowers` | Skills | Medio | S | Solo curación automática a posteriori. |
| 22 | Convención `CONTRACT.md` + `contract.ts` + `contract.example.ts` | Ingeniería | Medio | S (continuo) | Documentación dispersa. |
| 23 | Lecciones del postmortem de deuda de arquitectura | Ingeniería | Medio | S (auditoría) | Ficheros de sesión muy grandes sin auditar. |
| 24 | Disciplina de escritor único (*task-facts*) (auditoría) | Ingeniería | Medio (por confirmar) | S (auditoría) | Sin auditar. |
| 25 | «invalidated/unknown» como resultado de primera clase (auditoría) | Ingeniería | Medio (por confirmar) | S (auditoría) | Sin auditar. |

---

## MUST — imprescindibles

### 1. Motor de workflows DAG durable y reanudable tras caídas (Expert Workflow)

**Qué es**
Un ejecutor de tareas largas (horas o días) que divide el trabajo en fases y en un grafo de nodos con dependencias. Guarda cada cambio de estado en disco antes de seguir, de modo que si el proceso muere la ejecución continúa desde el punto exacto donde se quedó.

**Cómo lo hace ZCode**
- **API.** `apps/zcode-cli/packages/core/src/workflow/expert/runtime.ts` (`ExpertWorkflowRuntime`) expone como única superficie `start`/`startBackground`/`resume`/`retry`/`cancel`/`status`/`list`/`events`.
- **Instantánea antes de continuar.** Cada transición (fase o nodo que empieza, termina o falla; expansión de colección; veredicto del crítico) genera un `ExpertWorkflowRunSnapshot` inmutable. Ese snapshot se escribe en un `WorkflowStorePort` **antes** de seguir trabajando (`workflow/expert/phase-runner.ts`, `workflow/scheduler/node-runner.ts`).
- **Reconciliación al reanudar.** `reconcileWorkflowSnapshotForResume` (`workflow/lifecycle.ts`) devuelve a `pending` todo lo que quedó `active` por una caída. Lo ya completado no se repite.
- **Reintento granular.** `prepareSnapshotForRetry` (`workflow/expert/retry-state.ts`) reinicia un nodo fallido, todos los nodos fallidos o activos de una fase, o la ejecución entera, según `activityId`/`nodeId`/`phase`. Nodos, fases y artefactos completados no se tocan.
- **Planificador.** `WorkflowGraphScheduler.run` (`workflow/scheduler.ts`, 216 líneas):
  - calcula los nodos listos con `deriveWorkflowSchedulerState`;
  - lanza hasta `maxConcurrentLoops` a la vez;
  - **pausa la fase entera** tras `maxConsecutiveErrors` fallos consecutivos (cortocircuito);
  - distingue el interbloqueo real (`blockedExecutableNodes`) de una finalización normal.
- **Valores por defecto** (`workflow/definition.ts`): `maxConcurrentLoops: 2`, `maxConsecutiveErrors: 3`, `frontierTarget: 3`, `maxPlannerRuns: 10`, `finalCritic.maxIterations: 3`, `reactLoop.maxRounds: 30`.

**Qué tiene omp hoy**
- Cada subagente **se puede reanudar o revivir de forma individual** desde su transcripción (`packages/coding-agent/src/task/executor.ts:3380-3443`, `packages/coding-agent/src/task/persisted-revive.ts`).
- Coordinación más rica que la de ZCode en varios ejes: `task/workpool.ts`, `task/team-board.ts`, `task/delegation-ledger.ts`, `task/acceptance-checks.ts`, `task/isolation-runner.ts`.
- **Lo que falta** es un estado durable a nivel de ejecución o grafo: no hay snapshot del DAG, ni planificador central que asigne trabajo a la capacidad libre según las dependencias, ni reintento por nodo o fase.
- `async/job-manager.ts` trabaja en memoria del proceso. `goals/runtime.ts` controla el presupuesto de una sola sesión. `team-board.ts` funciona por autoservicio (*claim*/*release*) y su `reopen` solo cambia un estado, sin un motor que vuelva a despachar.

**Por qué es un salto**
Hoy, si `omp` muere o el portátil se suspende en mitad de una tarea con muchos agentes, hay que recomponer a mano el estado global aunque cada subagente pueda revivirse. Un motor durable convierte las tareas de varias horas en algo fiable. Además, el cortocircuito evita quemar presupuesto en cascadas de fallos y la detección de interbloqueo evita esperas silenciosas.

**Propuesta para omp**
- Crear una capa nueva, `packages/coding-agent/src/workflow/`, que **no sustituya** a `task/` sino que la use como ejecutor de nodos: cada nodo se lanza con la maquinaria actual de subagentes y su reanudación individual.
- Persistir el snapshot del grafo (nodos, estado, artefactos, `sessionId` de cada nodo) junto a la sesión, con escritura atómica antes de cada despacho.
- Modelar los nodos sobre `TeamTaskBoard` (ya tiene dependencias y avisos de solapamiento de escritura) y añadir un despachador central con `maxConcurrent`, cortocircuito por errores consecutivos e interbloqueo.
- Reutilizar `acceptance-checks.ts` como criterio de cierre de cada nodo.
- Primeros pasos:
  1. Formato de snapshot y `reconcileForResume`.
  2. Planificador puro y testeable sin modelo.
  3. Comando de usuario (p. ej. `/workflow start|resume|status|retry`) y equivalente RPC.

**Esfuerzo / riesgos**
XL. Riesgos: duplicar conceptos con `team-board`/`workpool` (hay que integrarlos, no crear una segunda convención), la consistencia entre el snapshot y las transcripciones de los subagentes, y la gestión de *worktrees* al reanudar.

### 2. Colecciones explorables con expansión perezosa dirigida por un agente planificador

**Qué es**
Una región del grafo que empieza con pocos nodos y que un agente planificador va ampliando a medida que se descubre trabajo nuevo. Sirve para tareas de tamaño desconocido, como «migra todos los usos de la API X».

**Cómo lo hace ZCode**
- `apps/zcode-cli/packages/core/src/workflow/scheduler/collection-planner.ts` (393 líneas), con `collection-runtime.ts` y `planner-expansion.ts` en el mismo directorio.
- Cuando la «frontera» de nodos en curso baja de `frontierTarget` (3 por defecto), invoca a un subagente planificador que genera más nodos a partir de lo descubierto.
- La colección se agota tras `maxPlannerRuns` (10 por defecto) o al superar un umbral de errores.
- Cada expansión se persiste como artefacto y como registro en el grafo, así que también sobrevive a una reanudación.

**Qué tiene omp hoy**
`packages/coding-agent/src/task/workpool.ts` reparte una lista **finita** que entrega quien llama, con enrutamiento al menos cargado. No hay mecanismo para que un agente siga generando trabajo mientras explora.

**Por qué es un salto**
Elimina la necesidad de enumerar de antemano el alcance (lo que hoy hace el humano o el orquestador, con omisiones). Además, el agotamiento y el retroceso ya vienen integrados, así que la exploración no se descontrola.

**Propuesta para omp**
- Implementarlo como un tipo de nodo del motor del ítem 1: un nodo «colección» con `frontierTarget` y `maxPlannerRuns` que lanza un subagente planificador con salida estructurada (lista de nuevos ítems con dependencias).
- Como paso intermedio sin el motor completo: un modo de `workpool` alimentado por un planificador que reponga la cola cuando baje del umbral.
- Deduplicar los ítems propuestos frente a los ya procesados (por clave de recurso).

**Esfuerzo / riesgos**
L (M si se hace sobre `workpool` sin durabilidad). Riesgos: planificadores que generan trabajo redundante o infinito (mitigado con el tope de ejecuciones y la deduplicación) y el coste de las llamadas al planificador.

### 3. Bucle crítico estructurado con reapertura acotada de nodos

**Qué es**
Un agente revisor independiente emite un veredicto estructurado sobre el trabajo terminado. Si falla, reabre solo los nodos concretos que lo necesitan, con un límite de reaperturas.

**Cómo lo hace ZCode**
- `apps/zcode-cli/packages/core/src/workflow/expert/critic-loop.ts` (234 líneas), función `runFinalCriticLoop`.
- Pide un veredicto; si es negativo, analiza las `reopenProposals` (`nodeId` + motivo + severidad).
- Reabre solo esos nodos con `reopenWorkflowGraphNode`, con un máximo de `maxReopens: 2` por nodo (`critic-loop.ts:145`, comprobado en `workflow/lifecycle.ts:245-249`).
- Reinicia solo las fases de ejecución y crítica y vuelve a ejecutar, hasta `finalCritic.maxIterations` (3).

**Qué tiene omp hoy**
`packages/coding-agent/src/task/acceptance-checks.ts` es **determinista** (el fichero existe, no está vacío, es JSON válido, los tests pasaron según los recibos de las herramientas) y `task/completion-probe.ts` es una autoestimación del porcentaje completado. Ninguno es un crítico independiente capaz de ordenar retrabajo dirigido.

**Por qué es un salto**
Cierra el ciclo de calidad sin intervención humana y sin rehacer todo el trabajo. El tope de reaperturas impide bucles infinitos de corrección.

**Propuesta para omp**
- Añadir un paso «crítico» opcional al final de un lote de `task` o como fase del motor del ítem 1.
- Usar un subagente revisor (reaprovechando los agentes `reviewer` existentes) con un esquema de salida fijo: `verdict`, `reopen: [{taskId, reason, severity}]`.
- Volver a despachar solo esas tareas con su contexto y el motivo, con un contador por tarea.
- Ejecutar primero los `acceptance-checks` deterministas y dejar el crítico para lo que no se puede comprobar mecánicamente.

**Esfuerzo / riesgos**
M. Riesgos: críticos demasiado estrictos que consumen las reaperturas, y coste adicional por iteración.

### 4. DSL de workflows dinámicos: orquestación en TypeScript tipado y verificado

**Qué es**
El agente principal escribe un pequeño programa TypeScript de orquestación contra una fachada publicada (`ask<T>()`, creación de actores, lecturas del entorno). Ese programa se verifica antes de ejecutarse y se ejecuta en un entorno aislado con diario y reanudación.

**Cómo lo hace ZCode**
- Paquete `apps/zcode-cli/packages/dynamic-workflow/src/{analysis,compiler,engine,facade,lowering,schema,testing}`.
- **Verificación previa.** El script se comprueba contra una stdlib de TS embebida, sin acceder a disco. Después se analiza estáticamente (punto fijo de *taint* más recorrido temporal) en cuatro proyecciones de grafo: sitio, causalidad, flujo de control y traspaso. Así detecta antes de ejecutar el mal uso de la fachada, nombres de actor erróneos y errores de tipo de artefacto.
- **Esquemas.** Los genéricos de `ask<T>()` se convierten en JSON Schema, con restricciones extraídas del JSDoc, para la E/S estructurada de los subagentes.
- **Ejecución aislada.** Corre en un sandbox `vm` en un proceso hijo sobre NDJSON, con prohibiciones deterministas.
- **Diario y reanudación.** Un diario SQLite permite reanudar, también tras agotar la cuota: `apps/zcode-cli/packages/bootstrap/src/app/dynamic-workflow-quota-resume.ts` y la familia `apps/zcode-cli/packages/bootstrap/src/app/dynamic-workflow-run-*.ts` (28 ficheros, entre ellos `-journal`, `-reconcile`, `-replay`, `-holes`, `-fill` e `-introspection`), con piezas complementarias en `apps/zcode-cli/packages/core/src/runtime/methods/dynamic-workflow-run-*.ts` y los puertos de `apps/zcode-cli/packages/contracts/src/interfaces/dynamic-workflow-run*.port.ts`.

**Qué tiene omp hoy**
Subagentes guiados en lenguaje natural (`packages/coding-agent/src/task/structured-subagent.ts`, `task/executor.ts`) que se coordinan mediante un tablero mutable compartido (`task/team-board.ts`). No hay verificación estática, ni superficie de script tipada, ni diario de reproducción determinista.

**Por qué es un salto**
La orquestación compleja falla sobre todo porque los subagentes malinterpretan instrucciones informales o porque el estado se pierde entre reintentos. Un script tipado y analizado convierte esos fallos en errores detectados antes de ejecutar, y el diario hace reproducibles los reintentos.

**Propuesta para omp**
- Llegar a él **después** del ítem 1, que aporta persistencia y planificador.
- Empezar por una fachada mínima (`ask<T>(agent, prompt)`, `parallel`, `artifact.read/write`), generando el JSON Schema desde los tipos con las herramientas de esquema que ya usa el repo.
- Ejecutar en un proceso hijo (omp ya aísla `eval` en su propio proceso) con un diario por llamada a `ask` para reproducir.
- Dejar el análisis de *taint* para una segunda iteración.

**Esfuerzo / riesgos**
XL. Riesgos: superficie de seguridad del sandbox, coste de mantener un compilador o analizador propio, y la curva de aprendizaje del modelo para escribir buenos scripts (requiere ejemplos en el prompt).

### 5. Clasificador semántico (AST/argv) de comandos `bash` de solo lectura

**Qué es**
Un analizador que descompone un comando de shell en invocaciones y argumentos y decide, subcomando a subcomando y opción a opción, si es demostrablemente de solo lectura. Así se aprueban sin fricción `git status`, `git log`, `ls`, etc., y lo ambiguo sigue pasando por la aprobación normal.

**Cómo lo hace ZCode**
- `apps/zcode-cli/packages/core/src/tool/handlers/bash-command-parser.ts` más unos 20 ficheros `bash-readonly-policy-*.ts`:
  - `bash-readonly-policy-argv-git.ts`: tabla de subcomandos `git` ordenada por especificidad y lista negra de opciones globales peligrosas.
  - `bash-readonly-policy-flags-*.ts`: detección de escritura a nivel de opción, como `isSedInPlaceOption` o `isFindWriteOption`.
  - `bash-readonly-policy-multiword-gh.ts`: subcomandos de `gh`.
- También comprueba la seguridad de redirecciones y asignaciones de entorno, y las rutas UNC en Windows.

**Qué tiene omp hoy**
- Verificado: `packages/coding-agent/src/tools/bash.ts:515-599` solo aplica las reglas de patrón configuradas por el usuario (`BashApprovalPatternRule[]`) y la lista negra `CRITICAL_BASH_PATTERNS`. Todo lo que no coincide pasa a `"exec"`, el nivel de aprobación completo.
- No hay clasificador de solo lectura incorporado; el único análogo es `isReadOnlyComputerCall` en la herramienta `computer`.

**Por qué es un salto**
Reduce mucho la fatiga de aprobaciones sin ampliar el radio de impacto. Además, desincentiva las reglas regex demasiado amplias que los usuarios escriben para no ver más avisos, que son más peligrosas que una tabla por subcomando.

**Propuesta para omp**
- Añadir una vía rápida de nivel `read` **antes** de las reglas de patrón y de `CRITICAL_BASH_PATTERNS` en la función `approval` de `bash.ts`.
- Parsear con el analizador de shell que ya use omp (si no existe ninguno, uno mínimo para tuberías, `&&`, `;`, redirecciones y asignaciones).
- Clasificar con tablas declarativas para `git`, `gh`, `docker`, `kubectl` y Unix común (`ls`, `cat`, `head`, `find` sin `-exec`/`-delete`, `sed` sin `-i`).
- Todo lo compuesto, dinámico (`$(...)`, `eval`) o con redirección de escritura vuelve a la vía `exec`.
- Tests de tabla con casos adversariales.

**Esfuerzo / riesgos**
M. Riesgo principal: un falso «solo lectura» equivale a una aprobación indebida, así que el clasificador debe ser conservador (lista blanca, nunca lista negra) y tener tests exhaustivos.

### 6. Sugerencia de reglas persistentes con alcance mínimo seguro

**Qué es**
Cuando el usuario aprueba un comando una vez, el sistema propone guardar la regla **mínima** reutilizable (`git log:*`) en lugar del comando literal o de una regla demasiado amplia (`git:*`). Para comandos raíz de alto riesgo se niega a acotar.

**Cómo lo hace ZCode**
- `apps/zcode-cli/packages/core/src/tool/handlers/bash-command-permission-policy.ts` usa un registro del árbol de comandos de cientos de CLIs, derivado de Fig: `apps/zcode-cli/packages/core/src/tool/handlers/generated/bash-command-registry.ts`. Cubre `aws`, `az`, `docker`, `kubectl` y `gcloud`, con ajustes explícitos de profundidad por subárbol.
- Para `HIGH_RISK_ROOT_COMMANDS` (`sudo`, `rm`, shells…) solo ofrece una regla de comando exacto.

**Qué tiene omp hoy**
Reglas persistentes por patrón o comando configurado, sin ninguna ayuda para elegir un alcance seguro (`packages/coding-agent/src/tools/bash.ts`).

**Por qué es un salto**
En sesiones largas reduce las aprobaciones repetidas sin ampliar lo que se aprueba automáticamente. Complementa al ítem 5: uno cubre lo que es de solo lectura y el otro lo aprobado explícitamente.

**Propuesta para omp**
- En el flujo de aprobación de `bash`, al aprobar, calcular la profundidad de subcomando significativa con un registro (empezar por una tabla pequeña escrita a mano para `git`, `gh`, `docker`, `kubectl`, `npm`/`bun`, `cargo`; ampliarla después).
- Ofrecer como opciones «este comando», «`<raíz> <subcomando>:*`» y nunca la raíz sola.
- Lista explícita de raíces de alto riesgo que solo admiten coincidencia exacta.

**Esfuerzo / riesgos**
M. Riesgos: mantener el registro y que algún subcomando aparentemente inocuo tenga variantes de escritura (mitigar combinándolo con las opciones peligrosas del ítem 5).

### 7. Control de confianza del proyecto/workspace

**Qué es**
Antes de ejecutar la automatización que aporta un repositorio abierto (hooks, extensiones, servidores MCP, configuración), el usuario debe confiar en ella. La confianza va ligada al contenido: si cambia, hay que revisarla de nuevo.

**Cómo lo hace ZCode**
- **Coordinador y evaluación.** `apps/zcode-cli/packages/core/src/hooks/workspace-hook-trust-coordinator.ts`, `workspace-hook-trust-evaluation.ts` y `workspace-hook-trust-records.ts`.
- **Registro de confianza.** Uno por *digest* de la declaración de hooks, clave `(workspaceIdentity, bundleDigest)`.
- **Operaciones.** `requestReview`/`respond`/`toggle`/`revoke`/`revokeCurrent` y una puerta de admisión mientras haya revisión pendiente (`apps/zcode-cli/packages/bootstrap/src/app/workspace-hook-trust.ts`).
- **Política.** `WorkspaceHookPolicy` (`user_decides`/`deny`…) con un proveedor enchufable.
- **Contador de revisión de seguridad.** `WorkspaceHookSecurityRevision`, monótono, permite a los despachos en curso detectar un cambio de confianza antes de cada hook pendiente.
- **Contenido nuevo, revisión nueva.** Si cambia el *digest* hay que volver a confiar: una actualización del script de un plugin no hereda la confianza anterior.

**Qué tiene omp hoy**
- Verificado, **ningún control**: `packages/coding-agent/src/extensibility/extensions/types.ts:659-665,728-734` dice literalmente «OMP performs no project-trust gating», y `extensions/runner.ts:1392` define `isProjectTrusted: () => true`.
- `.omp/extensions`, `.omp/config.yml`, hooks, skills y configuraciones MCP del proyecto se cargan sin preguntar.
- En plugins, `InstalledPlugin.enabled` (`extensibility/plugins/types.ts`) es un booleano plano sin reverificación por hash.
- El propio ecosistema tiene precedente: según el comentario de documentación de omp en `packages/coding-agent/src/extensibility/extensions/types.ts:722-726`, el upstream `@earendil-works/pi-coding-agent` (>= 0.79) pregunta al usuario una vez por directorio antes de cargar entradas locales del proyecto.

**Por qué es un salto**
Es la diferencia de seguridad más importante encontrada: clonar y abrir un repositorio hostil puede ejecutar código arbitrario al iniciar la sesión, y una actualización comprometida de un plugin cambia en silencio lo que ejecuta un hook ya habilitado.

**Propuesta para omp**
- Primera versión ligera:
  - confirmación única por directorio, con un listado de lo que se va a cargar (extensiones, hooks, MCP, config);
  - registro persistente en el directorio del usuario con clave `(ruta canónica, digest del conjunto)`;
  - nueva revisión cuando cambie el digest;
  - `omp trust list|revoke`.
- Implementar `isProjectTrusted()` de verdad en `extensions/runner.ts`.
- En modos sin interfaz (RPC/ACP/print), denegar por defecto con un flag explícito para confiar.
- Segunda fase: digest por plugin en `InstalledPlugin` y contador de revisión consultado antes de cada hook (enlaza con el ítem 8).

**Esfuerzo / riesgos**
M. Riesgos: romper flujos existentes que dan por hecha la carga automática (necesita migración y un flag de confianza global para CI) y molestar al usuario con revisiones demasiado frecuentes si el digest incluye ficheros volátiles.

### 8. Envoltorio de ejecución de hooks: matcher, admisión por despacho, fallo cerrado y ciclo asíncrono

**Qué es**
Dar a los hooks un marco de seguridad: a qué eventos aplican, comprobar en cada disparo que siguen siendo admisibles, que un hook de guarda que falla **deniegue** en lugar de dejar pasar, y que los hooks asíncronos tengan su propio ciclo de vida.

**Cómo lo hace ZCode**
`apps/zcode-cli/packages/core/src/hooks/runner.ts` (`InMemoryHookRunner`) y `workspace-hook-runtime-admission.ts`:
- **Matcher y admisión.** `matcher` por evento y una comprobación de admisión que no se cachea y se reevalúa en cada despacho; una revocación en mitad de un lote detiene los hooks siguientes del mismo evento.
- **Fallo cerrado.** `onError: "deny"`, con la justificación documentada: una guarda que falla y se ignora equivale a no tener guarda.
- **Hooks asíncronos.** `hook.async`: ciclo de vida independiente, informado por separado del turno bloqueante.

**Qué tiene omp hoy**
`packages/coding-agent/src/extensibility/hooks/runner.ts` (`HookRunner`) ejecuta *handlers* JS en proceso, siempre y con confianza implícita. Un handler que falla queda a merced del `try/catch` genérico de `emit()`, que no está pensado para fallar en cerrado. No hay matcher por hook, ni admisión, ni modelo asíncrono.

**Por qué es un salto**
Los hooks de guarda solo sirven si fallan en cerrado. Sin eso, un error en la guarda equivale a desactivarla, que es justo cuando más falta hace.

**Propuesta para omp**
- Añadir a la declaración de hook `matcher` (por herramienta o evento) y `onError: "allow" | "deny"`, con `deny` por defecto en eventos de pre-ejecución de herramienta.
- En `HookRunner.emit`, reevaluar la admisión (la confianza del ítem 7) antes de cada hook.
- Marcar los hooks `async` para que no bloqueen el turno y su resultado se registre aparte.

**Esfuerzo / riesgos**
M. Riesgo: cambiar el comportamiento ante errores de hooks existentes; hay que introducir `onError` explícito y comunicarlo.

### 9. Recuperación selectiva de memoria por consulta

**Qué es**
En lugar de inyectar siempre el mismo resumen de memoria, un modelo barato elige en cada turno qué ficheros de memoria son relevantes para la pregunta actual, y solo se inyecta su contenido.

**Cómo lo hace ZCode**
- `apps/zcode-cli/packages/core/src/memory/recall/manifest.ts` construye un manifiesto ligero (nombre de fichero más `description` del frontmatter, sin leer el contenido).
- `memory/recall/selector.ts` (191 líneas) manda el manifiesto y la consulta a un modelo auxiliar con un esquema JSON (`selected_memories`, **hasta 5**; el prompt pide incluir solo las que sea seguro que ayudarán).
- Una caché persistente (`selectorMessages`) evita volver a ofrecer en cada turno las memorias ya presentadas.
- `memory/recall/content.ts` lee solo las seleccionadas, con un tope de **200 líneas / 4096 bytes** por fichero (`MEMORY_CONTENT_LINE_LIMIT`, `MEMORY_CONTENT_BYTE_LIMIT`).

**Qué tiene omp hoy**
- Verificado: `packages/coding-agent/src/memories/index.ts` inyecta en cada turno **un** `memory_summary.md` (más `learned.md`), recortado por un presupuesto plano `cfgMemoriesSummaryInjectionTokenLimit` (líneas 209, 242 y 1382).
- Los backends mnemopi y hindsight sí recuperan por consulta (embeddings), pero son opcionales, están desactivados por defecto y necesitan más infraestructura.

**Por qué es un salto**
A medida que crece el resumen, o bien se inyecta contenido irrelevante en cada turno (tokens y atención desperdiciados) o se trunca por presupuesto, que es justo lo que pierde los hechos más específicos. La selección por relevancia mejora a la vez el coste y la calidad.

**Propuesta para omp**
- Estructurar la salida de la consolidación local en ficheros por tema con frontmatter `description`, conservando `memory_summary.md` como índice corto.
- Antes de cada turno de usuario, una llamada al rol de modelo barato con manifiesto y consulta, esquema `{selected: string[] (<=5)}` y caché persistente por sesión.
- Inyectar solo lo seleccionado, con topes por fichero.
- Si el selector falla, volver al comportamiento actual de forma explícita y registrada, no silenciosa.
- Dejar que la selección quede fuera del prefijo estable para no invalidar la caché (`packages/agent/src/append-only-context.ts`).

**Esfuerzo / riesgos**
M. Riesgos: latencia y coste de una llamada extra por turno (mitigable con caché y saltándola en continuaciones sin texto nuevo del usuario) y regresión si la selección omite algo importante.

### 10. Rewind del workspace (sistema de ficheros) con alcances Workspace/Conversation/Both

**Qué es**
Poder volver a un punto anterior y que los **ficheros en disco** también vuelvan a ese estado, no solo la conversación, con avisos distintos para el modelo según lo que se haya restaurado.

**Cómo lo hace ZCode**
- `apps/zcode-cli/packages/core/src/runtime/helpers/rewind.ts`.
- `getFileMutationCheckpointCandidate` captura el contenido antes y después, más un parche de diff estructurado, como `WorkspaceCheckpointArtifact` ligado a la llamada de herramienta.
- `selectCheckpointForRewind`/`selectCheckpointsForMessages` resuelven por `RewindScope` (`Workspace`, `Conversation`, `Both`).
- Avisos diferenciados: `formatWorkspaceRewindNoticeBody` (ficheros restaurados), `formatWorkspaceForkNoticeBody` y `formatWorkspaceForkAtMessageNoticeBody` (bifurcación que restaura el workspace al punto de corte), además del caso «conversación rebobinada, workspace intacto».

**Qué tiene omp hoy**
- Verificado: el `summary` de `packages/coding-agent/src/tools/checkpoint.ts:57` dice «git-based checkpoint», pero `execute()` solo registra estado (`{goal, startedAt}`).
- `rewind` se limita a `sessionManager.branchWithSummary(...)`, una rama de la conversación (`session/agent-session.ts`).
- No hay deshacer a nivel de fichero en ningún sitio, y la descripción de la herramienta promete algo que no hace.

**Por qué es un salto**
Tras una sesión de edición fallida, hoy el usuario tiene que hacer `git diff`/`git checkout` a mano y arriesga cambios propios no relacionados. Un rewind real da seguridad para experimentar y hace verdadera la descripción actual de la herramienta.

**Propuesta para omp**
- Capturar antes y después por fichero en las herramientas que mutan (`edit`, `write`, `ast_edit` y, en la medida de lo posible, `bash` mediante una instantánea de los ficheros tocados según el árbol de git), guardando blobs en el almacén de la sesión.
- Ligarlo al `checkpoint` existente y añadir `scope: "conversation" | "workspace" | "both"` a `rewind` y a `/fork`.
- Al restaurar, detectar cambios del usuario posteriores (hash actual distinto del «después» registrado) y no pisarlos sin confirmación.
- Emitir un aviso distinto al modelo por cada alcance.
- Corregir el `summary` de `checkpoint.ts` mientras tanto.

**Esfuerzo / riesgos**
L. Riesgos: los cambios hechos vía `bash` son difíciles de capturar con exactitud, conflictos con ediciones concurrentes del usuario y tamaño del almacén en ficheros grandes o binarios.

### 11. Canal de escalado bloqueante subagente → padre, con presupuesto

**Qué es**
Una herramienta con la que un subagente atascado hace **una pregunta concreta al agente padre** (no al usuario) y espera la respuesta, con un número limitado de usos.

**Cómo lo hace ZCode**
- `apps/zcode-cli/packages/core/src/tool/handlers/escalate.ts` (171 líneas).
- Máximo de 3 escalados por `ask`; el cuarto responde que el presupuesto se agotó y que continúe con su mejor criterio.
- Sin timeout, a propósito: un timeout reintroduciría el atajo especulativo que la herramienta quiere evitar.
- Respuesta limitada a `MAX_ESCALATE_MODEL_BYTES = 16_000`.
- La descripción está escrita para imponer disciplina: último recurso, no usarlo por curiosidad, para informar de progreso ni para confirmar algo verificable por uno mismo. Advierte de que la llamada bloquea y puede tardar.
- Es distinto del camino de rechazo de `submit_result` (un fallo corregible que se reintenta).

**Qué tiene omp hoy**
No existe en `packages/coding-agent/src/task/` ni en `tools/` (verificado). Los pares pueden mensajearse vía `write agent://<id>`, pero es asíncrono y sin presupuesto: un subagente atascado adivina, falla o deja el problema en su salida final.

**Por qué es un salto**
El padre tiene contexto que el subagente no tiene por diseño. Una pregunta dirigida a tiempo evita trabajo perdido o conclusiones inventadas, y el presupuesto evita abusos.

**Propuesta para omp**
- Herramienta `escalate` disponible solo en subagentes.
- Envía al padre un mensaje marcado como bloqueante que aparece como aviso en su siguiente límite de turno.
- El subagente queda aparcado (se puede reutilizar el mecanismo de espera de mensajes de `tools/wait.ts`) hasta que el padre responda con una herramienta o mensaje dirigido.
- Contador por tarea (3) persistido en `DelegationLedger` para que sobreviva a la compactación.
- Copiar el tono disciplinario de la descripción.

**Esfuerzo / riesgos**
M. Riesgos: interbloqueos si el padre a su vez espera al hijo (detectarlo y responder automáticamente «decide tú») y padres que no atienden el aviso.

### 12. Arnés de trayectorias de prompt: snapshots y diff byte a byte de las peticiones

**Qué es**
Una herramienta de test que ejecuta casos en un entorno aislado y guarda **los bytes exactos** que se envían al modelo. Así un cambio en plantillas de prompt muestra un diff concreto, incluidos los efectos sobre la estabilidad de la caché de prompts.

**Cómo lo hace ZCode**
- `apps/zcode-cli/tools/prompt-trajectory`.
- Ejecuta cada caso con *home* y almacenamiento temporales (no se filtran skills, plugins, `AGENTS.md` ni la BD de sesiones del usuario) y registra un proveedor `Registry` falso para que las capacidades vengan de *fixtures*.
- Hace de proxy de la petición real a través de un servidor local y graba los deltas en un único JSONL como fuente de verdad.
- Deriva snapshots canónicos con forma OpenAI y Anthropic.
- El modo `model-io` convierte un log real de producción `model-io-*.jsonl` en una trayectoria reutilizable.
- El diff ignora **solo** la deriva de `cache_control` y el ruido del recordatorio del catálogo de ToolSearch.

**Qué tiene omp hoy**
Nada equivalente. `packages/coding-agent/src/eval/` es el sandbox de la herramienta `eval`, otra cosa. Y la superficie de prompts es grande y cambia mucho (más de 100 plantillas en `packages/coding-agent/src/prompts/`).

**Por qué es un salto**
Detecta invalidaciones involuntarias de la caché de prompts (coste y latencia) y regresiones de redacción u orden que los tests unitarios no ven. Es la red de seguridad de todo cambio de prompt.

**Propuesta para omp**
- Un script de test (p. ej. bajo `scripts/` o un paquete de tests) que arranque omp en modo RPC con `HOME`/directorio de agente temporales y un proveedor falso.
- Grabar el cuerpo serializado de cada petición y compararlo con snapshots versionados por caso, normalizando solo los campos volátiles (marcas de caché, fechas, IDs).
- Añadir un modo que importe logs reales.
- Ejecutarlo en CI y exigir actualización explícita de snapshots.

**Esfuerzo / riesgos**
L. Riesgos: snapshots frágiles si la normalización es pobre, y mantener el proveedor falso alineado con las capacidades reales.

### 13. Arnés de regresión contra proveedores reales

**Qué es**
Una batería de casos contra los endpoints reales de los proveedores configurados, con resultados guardados y redactados, para detectar cambios de contrato en la API o de comportamiento del modelo.

**Cómo lo hace ZCode**
- `apps/zcode-cli/tools/provider-regression`.
- Lee una configuración de proveedor y un manifiesto con validación de esquema, y ejecuta los casos aplicables con topes por nivel (proveedor, modelo y caso).
- Reutiliza el código de producción (App, sesión, herramientas, adaptador de modelo real).
- Persiste snapshots inmutables y redactados de forma serial: el primer plan y cada inicio y fin se escriben de forma durable, y si falla una escritura se detienen las peticiones nuevas.
- El generador de informes HTML solo lee resultados, sin credenciales ni red.

**Qué tiene omp hoy**
Nada equivalente para `packages/ai` y la resolución de modelos (`config/model-registry.ts`, `config/model-resolver.ts`).

**Por qué es un salto**
omp admite muchos proveedores y protocolos (búsqueda nativa de herramientas, herramientas de servidor, caché). Las roturas de contrato se descubren hoy en producción; este arnés las detecta antes y de forma sistemática.

**Propuesta para omp**
- Manifiesto de casos (texto, herramientas, *streaming*, razonamiento, caché, herramientas de servidor) por capacidad declarada en el registro de modelos.
- Ejecución manual o programada con topes de coste.
- Snapshots redactados con `secrets/obfuscator.ts`.
- Informe que compare con la ejecución anterior.
- Complementa al ítem 12: uno verifica lo que enviamos y el otro lo que responden.

**Esfuerzo / riesgos**
L. Riesgos: coste de las llamadas reales, no determinismo de los modelos (comparar estructura y contrato, no el texto exacto) y gestión segura de credenciales.

### 14. Endurecimiento de `<system-reminder>`: escapado de contenido no confiable y registro central de fuentes

**Qué es**
Neutralizar cualquier etiqueta `<system-reminder>` o `</system-reminder>` literal dentro de contenido no confiable antes de envolverlo, para que nadie pueda cerrar el envoltorio y colar texto como si fuera del sistema. Además, centralizar en un registro todas las fuentes de recordatorios.

**Cómo lo hace ZCode**
- `apps/zcode-cli/packages/core/src/system-reminder/source.ts` es un registro único (`SYSTEM_REMINDER_PERSISTED_SOURCES` / `_PER_REQUEST_SOURCES`) con `channel` (`current_turn`/`tool_result`/`history_continuity`/`mid_turn_event`/`real_user`), `lifecycle`, `isMeta` y reglas de orden.
- `wrapSystemReminderForSource`/`sanitizeSystemReminderBody` pasan todo cuerpo por `escapeNestedSystemReminderTags` antes de envolverlo.

**Qué tiene omp hoy**
- Verificado: `packages/coding-agent/src/prompts/system/dir-context-notice.md` hace `<system-reminder>{{body}}</system-reminder>` con el cuerpo crudo de `AGENTS.md`, renderizado en `session/dir-context-coordinator.ts:173`.
- Según la investigación, `ttsr-tool-reminder.md`/`ttsr-warning.md` interpolan `{{content}}` (texto de reglas) del mismo modo, desde `session/ttsr-coordinator.ts`.
- Handlebars no escapa por defecto (`packages/utils/src/prompt.ts`); existe un `escapeXml` opcional que estas plantillas no usan.
- Hay más de 24 plantillas de recordatorio independientes, cada una renderizada en su punto de llamada.

**Por qué es un salto**
Un `AGENTS.md` de un repositorio hostil que contenga `</system-reminder>` escapa del envoltorio y obtiene autoridad de sistema. Es una inyección de prompt barata de explotar y barata de cerrar.

**Propuesta para omp**
- Fase 1 (S): función `escapeSystemReminderTags` en `packages/utils` aplicada en el límite de render de toda plantilla que interpole contenido de ficheros, reglas o adjuntos (`dir-context-coordinator.ts`, `ttsr-coordinator.ts` y cualquier otra que se encuentre buscando `{{body}}`/`{{content}}` dentro de `<system-reminder>`), más un test con un `AGENTS.md` malicioso.
- Fase 2 (M): un mapa `fuente → {lifecycle, persisted, channel}` que documente el orden en reanudación y compactación y que sea el único punto donde se envuelve.

**Esfuerzo / riesgos**
S para el escapado, M para el registro. Riesgo bajo: alterar la visualización de documentación que hable legítimamente de esas etiquetas (aceptable).

### 15. `turnControl.stopTurnAfterResult`: una herramienta puede cerrar el turno con una única respuesta de texto

**Qué es**
Un campo en el resultado de una herramienta que dice al bucle «después de este resultado no hagas más llamadas: deja que el modelo responda una vez en texto y termina», con el motivo y telemetría.

**Cómo lo hace ZCode**
- `apps/zcode-cli/packages/core/src/runtime/methods/turn-tools.ts:269`: tras liquidar el lote de herramientas, si algún resultado trae `turnControl?.stopTurnAfterResult === true`, persiste el fin del paso y convierte el turno en **una sola continuación de solo texto**.
- Telemetría: `event: "automation.create_limit.text_only_continuation"`.
- Corrige un fallo documentado: un límite de cuota devuelto como error normal hacía que el modelo entrara en bucle List/Delete/Create e incluso intentara rodear el límite con `bash`.
- Se gestiona de forma genérica en el camino de liquidación, no como caso especial de una herramienta.

**Qué tiene omp hoy**
`AgentToolResult` (`packages/agent/src/types.ts`) expone `content`, `details`, `isError`, `providerMetadata` y `useless`. Lo más parecido es `AgentBeforeModelCall`/`AgentPreModelCallStop`, una puerta del host previa a la siguiente petición: puede impedir continuar, pero no permite una respuesta de texto final ni que una herramienta lo active con un motivo.

**Por qué es un salto**
Toda herramienta con un límite duro (cupos de subagentes, cuotas de trabajos en segundo plano, APIs con límite de tasa) tiene hoy dos malas opciones: un error normal (el modelo reintenta en bucle) o un caso especial en el bucle. Esto lo resuelve de forma genérica y el usuario recibe una respuesta coherente.

**Propuesta para omp**
- Añadir `turnControl?: { stopTurnAfterResult: true; reason: string }` a `AgentToolResult`.
- En `packages/agent/src/agent-loop.ts`, en la liquidación del lote, si algún resultado lo trae, solicitar una completación final sin herramientas (reutilizando el camino de cuando no hay más llamadas) y registrar el motivo en telemetría y en la interfaz.
- Usarlo primero en los límites de spawn de `task` y de trabajos asíncronos.

**Esfuerzo / riesgos**
S. Riesgo: que algunos proveedores no admitan cómodamente forzar «sin herramientas» (alternativa: no enviar la lista de herramientas en esa petición, aceptando el impacto en la caché).

### 16. Redacción de la telemetría antes de exportar a OTLP

**Qué es**
Pasar todo mensaje de error, traza o atributo por un saneador que elimine secretos antes de enviarlo al colector OpenTelemetry.

**Cómo lo hace ZCode**
`apps/zcode-cli/packages/telemetry/src/error-sanitizer.ts` se aplica a cada mensaje exportado, y `compatibility-adapters.ts` proyecta los mismos datos a varias formas de la semconv GenAI de OTel (esa parte está en el Interesante 13).

**Qué tiene omp hoy**
Verificado: `packages/coding-agent/src/telemetry-export-otlp.ts` y `telemetry-export.ts` no tienen ninguna referencia a saneado, redacción o secretos. Sin embargo, omp ya tiene `packages/coding-agent/src/secrets/obfuscator.ts` (maduro) y `session/session-anonymizer.ts` para exportar sesiones.

**Por qué es un salto**
Con OTLP activado (`OTEL_*`), los mensajes de error, las trazas y las claves de API incrustadas en cuerpos de error del proveedor llegan sin redactar al colector. Es una fuga de credenciales con un arreglo de pocas líneas.

**Propuesta para omp**
- Pasar todos los atributos de tipo cadena y los mensajes de excepción por `secrets/obfuscator.ts` en un único punto de `telemetry-export-otlp.ts`, antes de crear spans o métricas.
- Truncar las trazas a una longitud máxima.
- Test con una clave falsa en el cuerpo de un error de proveedor.

**Esfuerzo / riesgos**
S. Riesgo: coste de CPU del ofuscador en atributos grandes (aplicar truncado previo).

### 17. Servidor remoto persistente, versionado y reconectable

**Qué es**
Ejecutar el agente como **demonio de larga vida** en una máquina remota (SSH/WSL/Docker), con identidad estable y reconexión automática, de forma que una tarea sobreviva a la suspensión del portátil o a cortes de red.

**Cómo lo hace ZCode**
`docs/architecture/r3-source-server-remote-architecture.md` (arquitectura R3; registros de pruebas en `docs/archive/remote-r3/`):
- un único modelo para SSH, WSL y Docker: instalar un demonio servidor, no un proceso stdio desechable;
- **identidad estable** `sourceServerId = installationId`, que sobrevive a cambios de IP, host o puerto y a desinstalar conservando los datos;
- **manifiesto de compatibilidad** (`schemaVersion/productVersion/minCompatibleVersion`), de modo que solo se pide actualizar al lado más antiguo;
- **token de entrada ligado al usuario del SO** (fichero `run/ingress-token` legible solo por un transporte que ya tiene los permisos de ese usuario), no a la mera alcanzabilidad de red;
- **reconexión**: con el cliente en línea, reintentos a 2, 4 y 8 s (tres veces); sin conexión, sondeo silencioso cada 2 minutos;
- resolución de alias de ruta del workspace a una clave canónica, para que los datos sobrevivan a migraciones de versión o de ruta.

**Qué tiene omp hoy**
`packages/coding-agent/src/ssh/connection-manager.ts` y `discovery/ssh.ts` usan SSH como herramienta que ejecuta un comando cada vez (ControlMaster, sondeo del host). No existe el concepto de agente remoto persistente al que volver a conectarse. Los modos headless (`modes/rpc/rpc-mode.ts`, ACP, `modes/print-mode.ts`) son la base natural.

**Por qué es un salto**
Las ejecuciones autónomas largas en una máquina remota potente o siempre encendida son un caso central para omp. Hoy no sobreviven a la suspensión del portátil ni a cortes de SSH.

**Propuesta para omp**
- Un `omp serve` como demonio sobre el protocolo RPC existente, con identidad por instalación, manifiesto de versión y token en un fichero legible solo por el usuario.
- Un cliente fino (TUI/VS Code) que se reconecta con la política 2/4/8 s más sondeo cada 2 minutos y reproduce eventos desde el último confirmado.
- Instalación remota vía la maquinaria SSH existente.
- Combina bien con el motor durable del ítem 1.

**Esfuerzo / riesgos**
XL. Riesgos: superficie de red y autenticación, compatibilidad entre versiones cliente/servidor y reproducción de eventos sin pérdidas.

---

## Interesantes

### 1. Aviso de antigüedad en memorias recuperadas
- **Qué es:** advertir al modelo, por cada memoria y según su edad real, de que es una observación puntual que puede estar desfasada.
- **ZCode:** `memoryHeader()` en `apps/zcode-cli/packages/core/src/memory/recall/content.ts` calcula `daysOld` a partir de `mtimeMs` y, si supera un día, antepone: «las memorias son observaciones puntuales, no estado vivo; verifica contra el código actual antes de afirmarlo».
- **omp hoy:** `packages/coding-agent/src/mnemopi/state.ts` (`formatScopedRecallWithIds`) solo añade una fecha; el `memory_summary.md` local pierde las marcas temporales por hecho tras la consolidación.
- **Propuesta:** añadir el aviso en los formateadores de mnemopi y hindsight, conservar marcas por sección en la consolidación local e incluirlo en el selector del MUST 9.

### 2. Consolidación de memoria contrastada con `AGENTS.md`, sin editarlo nunca en silencio
- **Qué es:** al consolidar, comparar las memorias con las instrucciones versionadas del proyecto y decidir caso a caso.
- **ZCode:** la fase 4 del prompt de `apps/zcode-cli/packages/core/src/memory/dream.ts` aplica tres casos: (a) memoria desfasada → se borra o reescribe, gana el fichero; (b) el fichero parece desfasado → **nunca se edita en silencio**, se anota la memoria y se señala al usuario en el resumen; (c) sin conflicto → se dejan ambos.
- **omp hoy:** `packages/coding-agent/src/prompts/memories/consolidation.md` solo recibe `{{raw_memories}}`/`{{rollout_summaries}}` y una consigna genérica («el estado actual del repo gana»).
- **Propuesta:** pasar el `AGENTS.md` resuelto a la fase 2 y replicar los tres casos, mostrando el caso (b) al usuario.

### 3. Regla contra la sobrecoincidencia en memorias de perfil o proyecto
- **Qué es:** no recuperar una memoria de perfil solo porque comparte una palabra con la pregunta.
- **ZCode:** el prompt de `memory/recall/selector.ts` pide ser especialmente conservador con las memorias `[user]`/`[project]`: un perfil que diga «trabaja en rendimiento de BD» no es relevante para cualquier pregunta que contenga «rendimiento».
- **omp hoy:** `packages/coding-agent/src/prompts/system/mnemopi-instructions.md` solo indica tratarlas como contexto de fondo. La recuperación por embeddings es incluso más propensa a este fallo.
- **Propuesta:** añadir esa instrucción al marco de recuperación de mnemopi y hindsight y al selector del MUST 9.

### 4. Filtro de elegibilidad sin coste antes de extraer memoria
- **Qué es:** saltarse la llamada al modelo de extracción cuando una ventana de la conversación no puede contener nada que guardar.
- **ZCode:** `evaluateMemoryExtraction` (`apps/zcode-cli/packages/core/src/memory/extraction.ts`) no extrae si ya hubo una escritura directa de memoria (`containsDirectMemoryWrite`) o si ningún mensaje real del usuario tiene al menos 3 palabras (`containsEligibleUserProse`).
- **omp hoy:** `runPhase1`/`claimStage1Jobs` en `memories/index.ts` filtran solo por inactividad y edad; «nada que guardar» es una respuesta del modelo (`no_output`), no un descarte previo.
- **Propuesta:** comprobación de recuento de palabras y de mensajes sintéticos antes de programar el trabajo de fase 1.

### 5. Aviso de compactación: el resumen se escribió sin ver la cola literal
- **Qué es:** avisar al modelo de que los mensajes conservados literalmente tras el resumen pueden ser posteriores a lo que este cuenta.
- **ZCode:** `PRESERVED_MESSAGES_NOTE` en `apps/zcode-cli/packages/core/src/compact/prompt.ts:140`, añadido cuando se conserva cola: «el resumen se escribió sin verlos, así que algo que dice que no ha ocurrido puede haber ocurrido ya en ellos».
- **omp hoy:** verificado que no existe en `packages/agent/src` ni en los prompts de compactación de coding-agent.
- **Propuesta:** añadir el aviso al mensaje de resumen en `packages/agent/src/compaction/` cuando haya mensajes conservados tras el corte.

### 6. Guardia de no-progreso: resultados sin cambios e hitos de volumen
- **Qué es:** detectar que el agente no avanza aunque varíe las llamadas, y avisarle con creciente insistencia.
- **ZCode:** `apps/zcode-cli/packages/node-repl-host/src/no-progress-guard.ts` (96 líneas) guarda por turno el hash de la última llamada y de su resultado:
  - misma llamada: primer aviso a las 5, después con crecimiento ×3;
  - resultado sin cambios pese a llamadas distintas: primer aviso a las 10, después ×3;
  - volumen de llamadas: hitos 30/80/200 y luego cada 200.
- **omp hoy:** ya tiene `ToolCallLoopGuard` (`packages/ai/src/utils/tool-call-loop-guard.ts`) para llamadas **idénticas** consecutivas entre turnos, reutilizado en `advisor/loop-guard.ts`, con escalado a abortar. Solo faltan los dos ejes nuevos.
- **Propuesta:** ampliar `ToolCallLoopGuard` con el hash del resultado y los hitos de volumen, reutilizando su escalado. Es un ítem incremental.

### 7. Plazo pausable de herramientas mientras se espera la admisión del proveedor
- **Qué es:** que el timeout de una herramienta no corra mientras sus llamadas internas al modelo esperan turno por limitación de tasa.
- **ZCode:** `ToolDeadline` en `apps/zcode-cli/packages/core/src/tool/executor/timeout.ts` (229 líneas) usa `pause()`/`pauseDepth`/`queuedTotalMs` y escucha `model_request_queued`/`model_request_admitted` por `toolCallId`. Corrige timeouts espurios de WebSearch/WebFetch bajo limitación global, que provocaban reintentos y más carga (observado 7 veces en una sola investigación).
- **omp hoy:** `packages/coding-agent/src/tools/tool-timeouts.ts` usa valores planos por herramienta (`TOOL_TIMEOUTS`, `clampTimeout`).
- **Propuesta:** un reloj pausable para las herramientas que hacen llamadas anidadas al modelo, enganchado a los eventos de cola del limitador.

### 8. Herramientas de control de sesiones para agentes
- **Qué es:** que un agente coordinador pueda listar, leer, crear, bifurcar, mensajear, esperar, interrumpir y renombrar sesiones como herramientas normales.
- **ZCode:** `apps/zcode-cli/packages/core/src/tool/session-control/` (`ListSessions/ReadSession/CreateSession/ForkSession/SendToSession/WaitSessions/InterruptSession/RenameSession`) con permisos `session_control.<method>`; las de solo lectura no necesitan aprobación.
- **omp hoy:** capacidades equivalentes solo vía ACP (`modes/acp/acp-agent.ts`); `tools/wait.ts` espera únicamente trabajos o mensajes propios.
- **Propuesta:** exponer un subconjunto (List/Read/Wait sin aprobación; Create/Fork/Send/Interrupt con aprobación) como dispositivo `xd://`, útil para el motor del MUST 1.

### 9. Propagación de contexto de traza y diario de actividad en árboles de subagentes
- **Qué es:** un árbol de trazas y un registro persistente que correlacionan todas las sesiones de una tarea con muchos agentes.
- **ZCode:** `createChildTraceContext` en `workflow/expert/phase-runner.ts`, `workflow/scheduler/node-runner.ts` y `collection-planner.ts`. Cada sesión hija se registra como `activity` (`sessionId`, `traceId`, `turnId`, modelo, rutas de artefactos de entrada y salida).
- **omp hoy:** `traceId` solo aparece en el transporte MCP (`mcp/errors.ts`, `transports/http.ts`).
- **Propuesta:** propagar `traceId`/`parentSpanId` al lanzar en `task/executor.ts`, registrarlo en `DelegationLedger` y exportarlo por OTLP.

### 10. `WorkflowDefinition` declarativa como dato
- **Qué es:** describir la forma de una tarea larga (fases, comportamiento por fase, parámetros) como un objeto validado, no repartida entre prompts.
- **ZCode:** `apps/zcode-cli/packages/core/src/workflow/definition.ts`: `phaseOrder` (`clarify`…), tipos de fase `agent | scheduled_graph | critic | complete` y estrategia (`clarify.maxRounds`, `executor.frontierTarget`, `finalCritic.maxIterations`), validados con `WorkflowDefinitionSchema`.
- **omp hoy:** la estructura de las tareas largas está implícita en prompts como `prompts/tools/task.md`.
- **Propuesta:** definir el motor del MUST 1 a partir de esta definición desde el principio, para poder ajustar parámetros sin tocar prompts.

### 11. `ContextSection[]` con `source`/`cacheHint`/`injectionTarget` (auditoría, no es un hueco probado)
- **Qué es:** etiquetar cada trozo del contexto con su origen y su estabilidad para la caché, y mandar los datos volátiles a un canal aparte.
- **ZCode:** `apps/zcode-cli/packages/core/src/context/builder.ts` arma tres mensajes de sistema (prefijo sin caché, cuerpo estable con `ephemeral`, bloque dinámico) y envía entorno, identidad del modelo, fecha y listado de skills a un canal `meta_user`.
- **omp hoy:** `packages/coding-agent/src/system-prompt.ts` devuelve `string[]` sin etiquetas. Sin embargo, `packages/agent/src/append-only-context.ts` (`StablePrefix` con huella más `AppendOnlyLog` por *digest*) es **más fino** que el esquema de tres bloques de ZCode.
- **Incertidumbre:** no está demostrado que exista un hueco.
- **Propuesta:** auditar dónde caen en el prompt de sistema de omp la fecha, el entorno, el modelo y las skills, y si invalidan el prefijo estable; actuar solo si se confirma.

### 12. Telemetría de TTFT por etapas con IDs de correlación entre procesos
- **Qué es:** desglosar el tiempo hasta el primer token por etapas para localizar dónde se pierde la latencia.
- **ZCode:** `docs/monitoring/ttft-stage-telemetry.md`:
  - etapas `start → … → admitted → execution-queue wait → {context, hooks, persistence, compaction, mcp, request_assembly} → model-slot queued/admitted → fetch_started → response_headers → first_provider_event → first_content → …`;
  - correlación por `observationId/commandId/requestId/attempt`, para que los reintentos no reinicien el reloj;
  - P50/P95 por etapa, sin restar percentiles de métricas distintas;
  - cola asíncrona acotada y almacenamiento solo local.
- **omp hoy:** `telemetry-export-otlp.ts` tiene histogramas por ejecución, chat y herramienta, sin desglose dentro del turno.
- **Propuesta:** spans locales por turno con un ID único en las etapas equivalentes de omp (contexto, hooks, compactación, montaje de la petición, TTFB).

### 13. Spans OTel vivos y proyecciones a la semconv GenAI
- **Qué es:** actualizar los spans en tiempo real a partir de eventos del transporte y exportarlos en varios dialectos de la semconv GenAI.
- **ZCode:** escritores de spans por responsabilidad (turno, paso, llamada al modelo, intento, herramienta, comando, compactación, operación separada), `ModelApiTelemetryStatusSink` y `apps/zcode-cli/packages/telemetry/src/compatibility-adapters.ts`.
- **omp hoy:** métricas agregadas en `telemetry-export-otlp.ts`.
- **Propuesta:** tras el MUST 16, añadir spans por llamada al modelo y por herramienta con atributos `gen_ai.*`.

### 14. Bots de chat como front-end bidireccional
- **Qué es:** manejar tareas desde Telegram, Feishu/Lark o Slack: crear y continuar tareas, aprobar permisos y recibir resultados en el móvil.
- **ZCode:** `packages/services/src/bots/` (más `docs/bots.md`):
  - comandos `/model` `/mode` `/think` `/stop`;
  - las elicitaciones se traducen a primitivas nativas: botones inline de Telegram, tarjetas interactivas de Feishu que se actualizan en el sitio, texto numerado en Weixin;
  - el **destino de entrega se inyecta como metadato de confianza**, nunca como argumento visible para el modelo, de modo que una inyección no puede redirigir una automatización;
  - **recuperación de tareas borradas**: antes de reutilizar una tarea consulta las lápidas y, si fue borrada, crea una sustituta.
- **omp hoy:** solo `blob-broker/uploaders-discord.ts` (subida puntual por webhook).
- **Propuesta:** versión mínima con un canal (Telegram por *polling*) sobre el modo RPC: iniciar, parar y consultar estado, y pasar las aprobaciones a botones. Copiar el patrón de metadato de confianza.

### 15. Enumeración exhaustiva del espacio de estados de las máquinas de estado de sesión
- **Qué es:** recorrer todas las combinaciones de estado y acción para encontrar transiciones sin comportamiento definido y exportar casos E2E.
- **ZCode:** `packages/formal-proof/src/{model.ts,main.ts}`. **No es TLA+**, aunque el documento de arquitectura diga lo contrario: es un enumerador combinatorio propio sobre `ProductContext` (`runPhase × queueState × compactMemory × goalState × selectedTurn × forked`) con reglas de guarda `allow/reject/enqueue/choice/system/undefined`. Explora N rondas, construye un DAG de estados y clasifica las hojas en `accepted/undefined/invalid/ignored/bug`.
- **omp hoy:** `compress/`, `goals/runtime.ts`, `plan-mode/` y `session/turn-recovery.ts` se prueban con casos elegidos a mano.
- **Propuesta:** un script que enumere `{runPhase, queueState, compactState, goalState}` contra las funciones de guarda **reales** (sin reimplementarlas) y señale las combinaciones indefinidas.

### 16. Cola en segundo plano consciente de la capacidad, con continuación automática
- **Qué es:** encolar trabajo en lote que espera una señal de capacidad del proveedor y continúa la misma tarea lógica tras un corte por cuota o contexto.
- **ZCode:** `docs/off-peak-task/` y `apps/zcode-cli/packages/core/src/runtime/off-peak/`: tickets FIFO `take_number → queued/ready/active/expired/settled`, continuación con un prompt fijo tras 400/3102 y espera por capacidad (429/3105 + `Retry-After`) sin consumir el presupuesto normal de reintentos. El mecanismo concreto depende de la facturación de Z.ai; lo portable es el patrón.
- **omp hoy:** `config/service-tier.ts` (flex/priority) y `async/job-manager.ts`, sin admisión por capacidad.
- **Propuesta:** tratar «ejecutar cuando haya capacidad» como dimensión de planificación en el motor del MUST 1 o en los trabajos asíncronos.

### 17. Subagente juez visual con veredicto JSON por página
- **Qué es:** un revisor dedicado que es la única puerta de aceptación de una salida visual generada.
- **ZCode:** `apps/zcode-cli/packages/presentations-plugin/agents/visual-judge.md` (hay copia en pdf-plugin). Se lanza por cada página renderizada, tiene prohibido re-renderizar o reparar y emite una línea JSON por página: `{"page":N,"verdict":"pass"|"fail","issues":[...]}`, con categorías `Spec|Visual|Design|Unverified`. Sustituye a la autoevaluación del agente.
- **omp hoy:** verificación ad hoc del propio agente (`prompts/tools/computer.md:56`).
- **Propuesta:** un agente incluido `visual-judge` con esquema de salida estricto, útil con capturas de navegador o de la extensión de VS Code.

### 18. Automatización de simuladores iOS/Android
- **Qué es:** un bucle de compilar, instalar, capturar pantalla, interactuar y leer logs en simuladores móviles.
- **ZCode:** `apps/zcode-cli/packages/ios-simulator-plugin/` (`src/providers/{sim,ui,build,screenshot,logs,project,preflight}.ts`, servidor MCP en `src/mcp/server.ts`, plantilla SwiftUI) y `apps/zcode-cli/packages/android-emulator-plugin/`.
- **omp hoy:** nada (solo coincidencias incidentales de `adb`/`ios` en el código).
- **Propuesta:** plugin o servidor MCP opcional que envuelva `xcrun simctl`/`adb`, con capturas como imagen.

### 19. Visor de documentos de oficina renderizados con anclas
- **Qué es:** ver pptx, docx, xlsx y pdf con su maquetación real y referenciar una celda, diapositiva o página concreta.
- **ZCode:** `apps/zcode-cli/packages/office-runtime/` (visores `ui/viewers/{XlsxView,DocxView,PdfView,PptxView}.tsx`, fuentes CJK y sintaxis de anclas descrita en `src/CONTRACT.md`).
- **omp hoy:** `read` solo extrae texto plano de los documentos.
- **Propuesta:** rasterizar páginas o diapositivas a imagen bajo demanda en `read` (selector `:img` por página) como base del Interesante 17.

### 20. Biblioteca incluida de skills de diseño y documentos
- **Qué es:** contenido curado de serie: sistemas de diseño de referencia y skills de maquetación con scripts.
- **ZCode:** `apps/zcode-cli/packages/design-plugin/skills/design/design-resources/` (decenas de `DESIGN.md`: stripe, vercel, notion, linear…) y `pdf-plugin/skills/pdf/typesetting/` con `scripts/design_engine.py`.
- **omp hoy:** `docs/skills/` documenta el mecanismo; no se incluye contenido. Es un hueco de contenido, no de motor.
- **Propuesta:** publicarlo como paquete del marketplace de skills existente, no en el núcleo.

### 21. Skill-creator interactivo y metaskill `using-superpowers`
- **Qué es:** un asistente que guía al usuario para crear una skill desde cero, y una metaskill que obliga a consultar las skills antes de actuar.
- **ZCode:** `apps/zcode-cli/packages/skill-creator-plugin/`: captura la intención, redacta, prueba con 2-3 prompts de test realistas, revisa e itera, y enseña la divulgación progresiva (metadatos siempre cargados, `SKILL.md` de unas 500 líneas como máximo cuando se activa, `references/`/`scripts/`/`assets/` bajo demanda). `apps/zcode-cli/packages/superpowers-plugin/` aplica la prioridad usuario > skill > defecto y una tabla de excusas que delatan que el agente está evitando la skill.
- **omp hoy:** `packages/coding-agent/src/skill-curation/` solo refina a posteriori skills ya usadas; no existe `docs/skills/authoring-skills.md`.
- **Propuesta:** incluir una skill `skill-creator` y esa guía; mejora la materia prima de la curación automática.

### 22. Convención `CONTRACT.md` + `contract.ts` + `contract.example.ts`
- **Qué es:** en cada frontera de módulo, un contrato con tipos, prosa de invariantes, un ejemplo ejecutable y su test.
- **ZCode:** generalizado; por ejemplo `apps/zcode-cli/packages/core/src/tool/session-control/{CONTRACT.md,contract.ts,contract.example.ts,contract.test.ts,module.ts}`.
- **omp hoy:** documentación repartida entre `docs/` y comentarios.
- **Propuesta:** adoptarlo para módulos nuevos o refactorizados de `packages/coding-agent/src` (empezando por el motor del MUST 1).

### 23. Lecciones del postmortem de deuda de arquitectura de ZCode
- **Qué es:** usar como autoauditoría los fallos documentados de ZCode.
- **ZCode:** un documento interno de análisis de arquitectura en `docs/` cuantifica, en 90 días:
  - el 55 % de los commits fueron `fix`, con ficheros recorregidos 50-90 veces;
  - estado duplicado en más de 6 fuentes;
  - máquinas de estado implícitas en `switch` gigantes;
  - unos 720 `catch` que avisan y devuelven un valor por defecto;
  - puertas de CI desactivadas en silencio.
- **omp hoy:** superficies grandes con estado (`session/agent-session.ts`, `session/turn-recovery.ts`, `session/session-maintenance.ts`) sin una auditoría equivalente.
- **Propuesta:** buscar en esos ficheros valores duplicados, `catch` que devuelven un valor por defecto y comprobar que `bun run test`/`lint`/`check` bloquean el merge.

### 24. Disciplina de escritor único en metadatos de tareas (auditoría)
- **Qué es:** un solo dueño por dato, con «huérfano» distinto de «borrado» y protección por generación frente a escrituras tardías.
- **ZCode:** `packages/services/src/task-facts/{CONTRACT.md,contract.ts}`: lotes de 256 filas, filas huérfanas que se conservan y se marcan (nunca se borran en silencio), comprobación de generación tras cada `await` y reparación acotada a tipos derivados en lotes de 64.
- **omp hoy:** sin auditar (`registry/agent-registry.ts`, `registry/persisted-agents.ts`, `task/index.ts`). **No está confirmado como hueco.**
- **Propuesta:** revisar esos índices frente a las carreras de colaboración y multicliente.

### 25. «invalidated/unknown» como resultado de primera clase y separación por clase de llamante (auditoría)
- **Qué es:** cuando un búfer de observación se desborda, responder «no lo sé» en lugar de dar un estado falso; y distinguir llamantes ligados a una sesión de los de infraestructura.
- **ZCode:** `packages/services/src/app-control/CONTRACT.md`: búfer de 8 MiB / 64 estados que, al desbordarse, devuelve `invalidated`/`unknown`; los llamantes de sesión revalidan la sesión raíz en cada llamada y los de infraestructura comprueban generación y *fence*.
- **omp hoy:** `collab/protocol.ts` es comparable en seguridad, pero no está auditado este caso. **No está confirmado como hueco.**
- **Propuesta:** revisar `collab/host.ts`/`guest.ts` en busca de estados falsos (obsoletos o completos) con backlogs grandes.

---

## Dónde omp ya supera a ZCode (no portar)

- **Ejecución especulativa de herramientas** durante el *streaming*, con grafo de dependencias y huellas de efecto: `packages/agent/src/speculative-execution.ts`. El `StreamingToolCallAssembler` de ZCode solo normaliza eventos.
- ***Steering* en vivo** dentro de una respuesta en curso: `packages/agent/src/live-steering.ts`. ZCode solo inyecta entre pasos.
- **Clasificación de errores de proveedor dentro del cuerpo** (tablas de reintentable o no, 429 opaco que indica rotar credencial): `packages/ai/src/error/body-error.ts`.
- **Guardia de bucles entre turnos**: `packages/ai/src/utils/tool-call-loop-guard.ts` y `coding-agent/src/advisor/loop-guard.ts`. ZCode solo detecta anomalías dentro de un lote; lo que sí aporta es el Interesante 6.
- **Contexto *append-only* para la caché de prompts**: `packages/agent/src/append-only-context.ts`, más fino que los tres bloques de ZCode.
- **Poda mecánica en la compactación y anclas de fidelidad**: `packages/agent/src/compaction/pruning.ts`, `shake.ts` y `fidelity.ts`.
- **Carga diferida de herramientas**: búsqueda nativa de Anthropic (`defer_loading`) y de OpenAI (`tool_search_call`) en `packages/ai/src/providers/`, más los dispositivos `xd://` de `packages/coding-agent/src/tools/xdev.ts`.
- **MCP con OAuth y Smithery**: `packages/coding-agent/src/mcp/{oauth-discovery,oauth-flow,smithery-registry,tool-bridge,tool-cache}.ts`.
- **Compatibilidad con plugins y skills de Claude y terceros**: `packages/coding-agent/src/discovery/{claude-plugins,agent-plugins,agent-plugin-format}.ts` y `extensibility/skills.ts`.
- **Maquinaria de subagentes**: lanzamiento especulativo (`task/speculative-launch.ts`), `WorkPool` (`task/workpool.ts`), `TeamTaskBoard` (`task/team-board.ts`), `DelegationLedger` (`task/delegation-ledger.ts`), comprobaciones de aceptación (`task/acceptance-checks.ts`), aislamiento en *worktrees* (`task/isolation-runner.ts`) y reanudación individual de subagentes (`task/persisted-revive.ts`).
- **Búsqueda nativa en Rust** frente a los binarios `rg`/`ugrep`/`bfs` que incluye ZCode.
- **Automatización de navegador y escritorio**: herramientas `browser` y `computer`.
- **Modos headless, RPC y ACP**: `modes/print-mode.ts`, `modes/rpc/rpc-mode.ts`, `modes/acp/`.
- **Reintentos y backoff**: equivalentes o mejores en `packages/ai`.

---

## Hoja de ruta sugerida

**Ola 1: quick wins (días)**
- Seguridad barata: escapado de `<system-reminder>` (14, fase 1), redacción de OTLP (16), primera versión del control de confianza por directorio (7).
- Bucle: `turnControl.stopTurnAfterResult` (15).
- Memoria y compactación, solo prompts y heurísticas: avisos de antigüedad y contra la sobrecoincidencia (I1, I3), consolidación con `AGENTS.md` (I2), filtro de elegibilidad (I4), aviso de cola literal (I5).
- Ampliar `ToolCallLoopGuard` (I6) y corregir el `summary` engañoso de `checkpoint.ts` (antesala del 10).
- Auditorías sin código: I11, I23, I24, I25.

**Ola 2: mejoras medianas (semanas)**
- Permisos: clasificador de solo lectura (5), reglas acotadas (6), envoltorio de hooks (8) y digest por plugin (segunda fase del 7).
- Contexto y sesión: memoria selectiva (9), rewind del workspace (10), registro central de recordatorios (14, fase 2).
- Subagentes: canal de escalado (11), bucle crítico sobre `task` (3), control de sesiones (I8), trazas (I9), plazo pausable (I7).
- Evaluación: arnés de trayectorias de prompt (12) y después regresión de proveedores (13).
- Observabilidad: TTFT por etapas y spans GenAI (I12, I13).
- Ecosistema: skill-creator (I21), juez visual (I17), convención de contratos (I22) y enumeración del espacio de estados (I15).

**Ola 3: apuestas grandes (meses)**
- Motor de workflows durable (1) con definición declarativa (I10), colecciones explorables (2) y el crítico integrado como fase (3).
- Sobre ese motor: el DSL tipado (4) y la cola consciente de la capacidad (I16).
- Plataforma: servidor remoto persistente (17) y bots de chat (I14) sobre el modo RPC.
- Herramientas de dominio, según demanda: simuladores móviles (I18), visor de documentos (I19), biblioteca de diseño (I20).
