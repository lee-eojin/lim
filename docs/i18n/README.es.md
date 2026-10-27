# LIM

**Less is more.** Plugins pequeños para Claude Code. Cada plugin hace un solo trabajo y muestra las mediciones que lo respaldan.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![verify](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=verify--*&sort=semver&label=verify)](../../plugins/verify/CHANGELOG.md)
[![clear-explain](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=clear-explain--*&sort=semver&label=clear-explain)](../../plugins/clear-explain/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Este documento es una traducción del [README en inglés](../../README.md) en su versión del 2026-10-24. Si los dos documentos son diferentes, el README en inglés es el correcto.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | Español | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

Los agentes de programación escriben código rápido. Se les da mucho peor darse cuenta de lo que hicieron mal. El agente que escribió un cambio es su revisor más débil, porque lee el cambio a través de su propio razonamiento y se da la razón a sí mismo. Así, el trabajo acaba en un commit sin revisión, o con una revisión hecha desde el mismo contexto que lo escribió.

**LIM es mi respuesta: plugins pequeños que hacen un solo trabajo cada uno, con los números que los respaldan.** review-loop es el centro, y verify y clear-explain trabajan a su lado.

**review-loop hace que "listo para el commit" signifique revisado.** Primero se ejecutan tus propios tests, tipos y lint, en proyectos de Node.js, Python, Go, Rust, Java (Gradle o Maven), .NET, Ruby y Makefile, incluidos hasta 4 proyectos de subcarpeta que toque un cambio por ronda. Después, un revisor con un contexto nuevo, que nunca ve el razonamiento de Claude, etiqueta los hallazgos de P1 a P5 y tiene que mostrar evidencia de los graves. Claude corrige P1 y P2, un revisor nuevo comprueba las correcciones y un script, no el modelo, decide cuándo detenerse. Tú decides el resto una sola vez, al final.

**Prueba ejecutando la funcionalidad.** Con [verify](../../plugins/verify), un hallazgo queda reproducido cuando una comprobación que ejecuta la funcionalidad falla en el código revisado, y su corrección solo cuenta cuando esa misma comprobación vuelve a pasar.

**Los comentarios que repites se convierten en reglas.** Cuando marcas un hallazgo como "convertirlo en una regla", Claude redacta una regla de lint o un test, y review-loop lo ejecuta contra el código de antes de la corrección para demostrar que detecta el error. La corrección de un bug recibe un test de regresión de la misma forma.

**Pequeño a propósito.** review-loop agrega unos 275 tokens a una sesión. Su hook no hace nada hasta que lo activas en un repositorio. No se instala nada sin decirte qué es y cómo eliminarlo.

Haz un fork, cámbialo, hazlo tuyo. Los issues y los pull requests son bienvenidos.

## Plugins

| Plugin | Estado | Un trabajo |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.11.2 | Revisa tus cambios antes del commit, corrige los hallazgos P1 y P2, vuelve a revisar y te entrega el resto. |
| [clear-explain](../../plugins/clear-explain) | 0.1.3 | Explica conceptos, código y errores con la respuesta primero, un solo significado por palabra y los términos técnicos con su nombre oficial en inglés. |
| [verify](../../plugins/verify) | 0.4.0 | Demuestra que tus funcionalidades funcionan ejecutándolas y guarda los comandos y la salida como evidencia. |

## Instalación

Necesitas Claude Code, git y Node.js 18 o una versión posterior.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Si Claude Code lo pide, reinícialo. Agregar el marketplace solo registra el catálogo. Cada plugin se instala por separado, así que solo obtienes lo que eliges.

## Primeros pasos

Dos pasos:

1. Instala review-loop como se indica arriba.
2. En un repositorio git con cambios sin commit, escribe:

```
/review-loop:review-loop
```

Eso es todo. review-loop ejecuta tus comprobaciones, revisa el cambio, corrige lo que hay que corregir y te pregunta por el resto. Al final pregunta una vez si quieres activar el commit gate en este repositorio, y después si quieres hacer el commit.

¿Es tu primera vez? La [guía](../../docs/guide/README.md), en inglés, recorre una primera revisión, cómo decidir, el commit gate, el costo y los errores comunes, con salida real.

## Uso

### Basta con `/review-loop:review-loop`

Escríbelo cada vez que vayas a hacer un commit. Después del comando puedes añadir lo que quieras con tus propias palabras:

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

Claude también puede iniciar review-loop por su cuenta cuando le pides que revise o que haga un commit, pero solo cuando decide que la skill encaja. El comando siempre lo inicia.

### Cómo es una ronda

Cada ronda termina con un informe. Claude lo muestra antes que cualquier otra cosa:

```
Review round 2 of 3 (reviewer: session model)
Checks: test (npm run test) passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal (fixed, inferred: the re-review read the fix)
  test: src/coupon.test.js (before the fix: caught, after: passed)

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

Aquí la ronda 1 encontró un P1. Claude lo corrigió y escribió un test de regresión, y review-loop mostró que el test falla en el código de antes de la corrección. La ronda 2 confirmó la corrección, así que el ciclo se detuvo. Queda un P3 para ti.

### Ejemplos

<details>
<summary>Todos los prompts</summary>

```
review before commit:   /review-loop:review-loop
with intent:            /review-loop:review-loop I moved the retry logic into the client. Check it
                        before I commit.
confirm P2 first:       /review-loop:review-loop confirm every P2 with me before you fix anything.
confirm P1 and P2:      /review-loop:review-loop confirm every P1 and P2 with me before you fix anything.
stop confirming:        /review-loop:review-loop stop confirming findings with me before fixes.
continue a loop:        /review-loop:review-loop
                        (in a new session it offers to continue where the last loop stopped)
turn on the gate:       /review-loop:review-loop turn on the commit gate in this repo.
turn off the gate:      /review-loop:review-loop turn off the commit gate in this repo.
skip once:              /review-loop:review-loop commit this without a review, just this once.
delegate commits:       /review-loop:review-loop stop asking before commits in this repo.
take it back:           /review-loop:review-loop turn off commit delegation.
run unattended:         /review-loop:review-loop run unattended. I will read the summary in the morning.
reviewer model:         /review-loop:review-loop run the reviewer on sonnet in this repo.
```

</details>

## Cómo funciona una revisión

Antes de tu commit, review-loop ejecuta un ciclo corto y se detiene por sí solo.

1. **Comprobaciones.** review-loop ejecuta las comprobaciones `typecheck`, `lint` y `test` que declara tu proyecto: scripts de `package.json`, targets de un Makefile o los valores predeterminados para Go (`go.mod`), Rust (`Cargo.toml`), las herramientas de Python que configures, Gradle, Maven, .NET y las herramientas de Ruby que uses. Una comprobación que falla, o un `package.json` que no es JSON válido, se convierte en un hallazgo P1. Una comprobación que supera su límite de tiempo, o cuyo programa no está instalado, se informa como "no verificada" y no como fallida.
2. **Revisión nueva.** Un agente revisor separado recibe el diff y un resumen de una línea de lo que querías, pero no el razonamiento de Claude sobre el cambio. Puede leer el código de alrededor para entender el contexto. Etiqueta los hallazgos de P1 a P5. P1 y P2 necesitan evidencia: la línea exacta, un escenario de fallo y la razón por la que nada lo impide ya. Cada hallazgo se etiqueta como measured (medido), inferred (deducido) o guessed (supuesto). Un P1 o P2 sin evidencia, o uno guessed, se te muestra como no verificado en lugar de corregirse.
3. **Corrección.** Claude dice qué va a corregir y después corrige P1 y P2. Si una corrección necesita una decisión de diseño (más de una forma de corregir, un cambio de comportamiento visible, eliminar una funcionalidad, cambiar tests), tú eliges primero. Si tu proyecto tiene un script de test, Claude escribe un test de regresión a partir del escenario de fallo de cada P1 o P2 que corrige, y review-loop muestra que el test falla en el código de antes de la corrección.
4. **Nueva revisión.** Un revisor nuevo comprueba solo las correcciones y los hallazgos que siguen abiertos. Hasta 3 rondas.
5. **Detención.** Un script, no el modelo, decide cuándo detenerse: no quedan P1 ni P2, se alcanza el límite de rondas, un hallazgo sobrevive a dos correcciones, un hallazgo resuelto vuelve a aparecer, P1 + P2 deja de disminuir, o una corrección debilita los tests o las comprobaciones.
6. **Decisión.** Tú decides el resto una sola vez: todos los P3 a P5, más cualquier P1 o P2 que siga abierto, que no se haya podido verificar o que trate de un archivo fuera del diff revisado. Para cada uno eliges: dejarlo como está, corregirlo solo esta vez o convertirlo en una regla. Un hallazgo que dejas como está no se vuelve a preguntar en una revisión posterior hasta que cambia la línea citada, y el informe lo cuenta en su lugar. Si revisiones anteriores en este repositorio señalaron uno de los cuatro tipos que busca el revisor (como una guarda especulativa) 3 veces o más, Claude lo dice y recomienda convertirlo en una regla en la capa más fuerte que encaje: un cambio de tipos o de arquitectura, después una regla de lint, después un test.
7. **Commit.** Claude pregunta antes del commit, a menos que hayas elegido "dejar de preguntar en este repositorio". Nunca hace push. Si activas el commit gate, un hook convierte esto en una regla: los commits de Claude quedan bloqueados hasta que se aprueba una revisión.

Cuando Claude dice que algo está corregido, dice cómo lo sabe: una comprobación que ahora pasa es measured, y su lectura del código nuevo es inferred. Cuando cuestionas un hallazgo, Claude vuelve a comprobar la afirmación antes de darte la razón y te dice qué comprobó.

### Qué busca el revisor

El revisor busca bugs, requisitos que faltan, reglas del proyecto que no se cumplen y cualquier otra cosa que impida que el cambio logre lo que dijiste que querías. No discute lo que querías. También busca cuatro tipos de código que los agentes añaden cuando no conocen la causa de un problema, porque el siguiente agente los copia:

<details>
<summary>Los cuatro tipos</summary>

| Tipo | Qué es | Severidad |
|---|---|---|
| Guarda especulativa | Una comprobación, un try/catch, un fallback o un valor por defecto para un estado que nada demuestra que pueda ocurrir | P2 cuando oculta un fallo, si no P3 |
| Comentario de historial | Un comentario sobre quién pidió qué, por qué cambió una versión anterior, o una instrucción para agentes | P4 |
| Marca de atajo | Un comentario TODO, HACK, "temporary" o "for now" sin enlace a un issue | P3 |
| Segunda forma | Un helper, un patrón o una dependencia para una tarea que el código base ya hace de otra forma | P3 |

Una guarda es correcta donde un estado legítimo entra en el código: una entrada del usuario, una lectura de red o de archivo, o un valor que una API documenta como posiblemente ausente. Una segunda comprobación más adentro, para un estado ya gestionado, sigue siendo especulativa. Un fixture en [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) contiene uno de cada tipo y comprueba que el revisor los señala.

</details>

### Severidad

Basada en la regla Pn pública de Banksalad.

| Nivel | Significado | Comportamiento del ciclo |
|---|---|---|
| P1 | Corrección obligatoria: una comprobación que falla, pérdida de datos, un fallo de seguridad, un crash, o la funcionalidad pedida no funciona | Se corrige si tiene evidencia |
| P2 | Corrección necesaria: un bug que una entrada específica reproduce, un requisito que falta, una regla del proyecto que no se cumple | Se corrige si tiene evidencia |
| P3 | Corrección útil: mantenibilidad, un nombre que confunde, un test que falta en un camino secundario | Tú decides |
| P4 | Opcional: una preferencia de estructura en la que las personas no están de acuerdo | Tú decides |
| P5 | Trivial: una errata o el formato | Tú decides |

Un P1 o P2 sobre un archivo que no está en el diff que revisó la ronda no se corrige en el ciclo. Llega a ti al final, marcado como fuera del diff revisado, y conserva su severidad.

### Reglas y tests de regresión

Un comentario que un revisor tiene que repetir es una regla que falta. review-loop lleva la cuenta: cada revisión registra el tipo de cada hallazgo en un archivo que comparten todos los worktrees del repositorio, y un hallazgo de uno de los cuatro tipos de arriba cuyo tipo ya señalaron revisiones anteriores 3 veces o más se marca como repetido. Las etiquetas amplias como correctness se registran, pero nunca cuentan como repetición. Cuando eliges "convertirlo en una regla" para un hallazgo, Claude busca primero una regla existente en tu configuración de lint o en tus tests que debería haberlo detectado. Después elige la primera forma que funcione: activar una regla de lint existente, escribir una regla personalizada para el linter que ya usas o escribir un test. El borrador nunca va en el archivo del que trata el hallazgo.

Después, review-loop demuestra el borrador. Escribe el código de antes de la corrección en una carpeta temporal y ejecuta allí tus comprobaciones, con y sin el borrador:

| Resultado | Significado |
|---|---|
| `caught` | Una comprobación falla solo con el borrador. La regla detecta el error. |
| `missed` | Todas las comprobaciones pasan con el borrador. Claude lo revisa una vez. |
| `unproven` | Una comprobación superó su límite de tiempo, o también falla sin el borrador. Claude te dice cuál de los dos casos es. |

Una regla necesita una comprobación que la ejecute. Sin un script `typecheck`, `lint` o `test`, la elección se registra como "corregirlo solo esta vez" y Claude te explica por qué. Un borrador demostrado entra en el mismo commit que la corrección, y el mensaje del commit lo menciona.

Cada P1 o P2 que Claude corrige recibe un test de regresión de la misma forma, sin preguntar, cuando tu proyecto tiene un script de test. Para un test de regresión, solo la comprobación de test cuenta como prueba: si con él solo falla el lint, el test no detectó el bug. Una corrección sin test explica el motivo en el informe.

### Commit gate

El commit gate es un hook que está desactivado hasta que lo activas en un repositorio. Al final de una revisión, Claude pregunta una vez si quieres activarlo. Con el gate activado, cada `git commit` que Claude ejecuta se comprueba primero.

<details>
<summary>Qué hace el gate</summary>

| Situación | Qué hace el gate |
|---|---|
| No hay revisión, o cambiaron archivos que la revisión no cubrió | Bloquea el commit y le indica a Claude que ejecute la revisión |
| Un ciclo de revisión está en curso, o todavía hay decisiones pendientes | Bloquea el commit |
| La revisión se aprobó | Te pregunta antes del commit, o permite el commit si delegaste los commits en este repositorio |
| Después de la revisión, solo cambiaron archivos revisados o borradores de reglas y tests de regresión que `loop rule` comprobó | Te pregunta |
| `git push` o un force push | Siempre pregunta, incluso con delegación |
| Un commit con `--no-verify` | Pregunta, incluso con delegación, y sigue bloqueando un commit sin una revisión aprobada |
| Un commit en una carpeta que el gate no puede leer, como `cd "$(...)"` o una ruta que no existe | Te pregunta, incluso con delegación, si el gate está activado en el repositorio donde iniciaste Claude Code |

Para hacer un commit una sola vez sin revisión, pide a Claude que omita la revisión esta vez. La configuración del gate y la delegación de commits se aplican a todo el repositorio, incluidos sus worktrees vinculados. Cada worktree tiene su propia revisión.

</details>

### Configuración

Los cinco primeros ajustes se aplican a un repositorio. Para cambiar uno, escribe la petición después de `/review-loop:review-loop`, así Claude tiene cargados los comandos de la skill. El límite de tiempo de las comprobaciones es una variable de entorno, así que se aplica donde la definas, y el total de 9 minutos es fijo.

| Ajuste | Valor por defecto | Qué escribir |
|---|---|---|
| Confirmar antes de corregir | Desactivado | "confirma conmigo cada P2" o "confirma conmigo cada P1 y P2" |
| Commit gate | Se pregunta una vez al final de la primera revisión | "activa (o desactiva) el commit gate" |
| Delegación de commits | Pregunta antes de cada commit | "deja de preguntar antes de los commits en este repositorio" |
| Sin supervisión | Desactivado | "ejecuta sin supervisión" para una ejecución, o "activa (o desactiva) el modo sin supervisión en este repositorio". Claude no pregunta nada, deja para después lo que te necesita y termina con un resumen de lo que hizo y de lo que te espera |
| Modelo del revisor | El modelo de tu sesión | "ejecuta el revisor con sonnet en este repositorio" (u opus, haiku, fable), o "ejecuta el revisor con el modelo de la sesión". En Mediciones verás lo que encontró y lo que costó cada modelo |
| Límite de tiempo de las comprobaciones | 5 minutos por comprobación, 9 minutos en total | Define `LIM_CHECK_TIMEOUT_MS` para cambiar el límite de cada comprobación |

## Mediciones

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) enumera 216 comportamientos en seis ejes: `do`, `tell`, `ask`, `silence`, `stop` y `evidence`. Los tests unitarios en CI cubren 205 de estos comportamientos, incluidas ejecuciones contra repositorios git temporales reales y el hook de commit gate. Los otros 11 necesitan una ejecución del modelo: preguntar una sola vez sobre P3 a P5, mostrar el informe antes de cualquier pregunta, mantener cada paso en la lista de tareas con un motivo para cada paso omitido, escribir un test de regresión para cada P1 o P2 corregido, etiquetar cada hallazgo como measured, inferred o guessed, decir cómo se sabe que una corrección funciona, volver a comprobar un hallazgo que cuestionas, recomendar una regla para un tipo de hallazgo que se repite, no preguntar nada en una ejecución sin supervisión, iniciar el revisor con el modelo que elegiste e informar del código añadido sin una causa conocida. El último tiene un fixture en [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/), y los dos primeros tienen una ejecución manual en [`evals/review-loop/manual-behaviors.md`](../../evals/review-loop/manual-behaviors.md).

Un benchmark de detección le da al revisor cambios en repositorios temporales cuyos nombres no indican que son una prueba. [`evals/review-loop/detection/`](../../evals/review-loop/detection/) tiene 12 cambios con un bug sembrado en cada uno y 6 cambios limpios. [`evals/review-loop/detection-hard/`](../../evals/review-loop/detection-hard/) tiene 10 bugs más difíciles, como uno que solo se ve en un archivo que el diff no toca, uno que solo se ve siguiendo cuatro archivos, uno dentro de un diff de 183 líneas, una condición de carrera entre dos búsquedas, un buffer que se vacía antes de que una escritura asíncrona lo lea y un lock que no se libera en una ruta de error, además de 6 cambios limpios que parecen sospechosos. Resultados con 3 ejecuciones por caso, del 2026-10-25 para el conjunto normal y del 2026-10-26 para el conjunto difícil:

| Modelo del revisor | Conjunto normal: bugs encontrados como P1 o P2 | Conjunto normal: P1 o P2 falsos en cambios limpios | Conjunto difícil: bugs encontrados como P1 o P2 | Conjunto difícil: P1 o P2 falsos en cambios limpios | Costo del conjunto difícil (48 ejecuciones) |
|---|---|---|---|---|---|
| claude-opus-5-5 | 36 de 36 | 0 de 18 | 30 de 30 | 0 de 18 | 3,11 USD |
| claude-sonnet-5-5 | no ejecutado | no ejecutado | 29 de 30 | 0 de 18 | 1,14 USD |
| claude-haiku-5-5 | no ejecutado | no ejecutado | 30 de 30 | 3 de 18 | 0,09 USD, según informa Claude Code |

Por defecto, el revisor usa el modelo de tu sesión. Opus encontró todos los bugs sembrados en ambos conjuntos, así que el benchmark todavía no puede mostrar en su caso una caída en los bugs encontrados. Para ver si llega a mostrar un `reviewer.md` peor, Opus también ejecutó el conjunto difícil con un `reviewer.md` reducido a su formato de salida: siguió encontrando 30 de 30, dio 1 P2 falso en 18 ejecuciones limpias y planteó 83 hallazgos de P3 a P5 donde el revisor completo planteó 55. En Opus, encontrar estos bugs depende más del modelo que de las instrucciones, y un `reviewer.md` peor se nota como falsas alarmas y ruido. El único fallo de Sonnet no devolvió ningún hallazgo para el buffer que se vacía antes de una escritura asíncrona. Las 3 falsas alarmas de Haiku fueron todas en un mismo caso limpio, que también dio 1 P2 falso en 9 ejecuciones de Opus con el revisor completo a lo largo de dos días. Un hallazgo cuenta cuando nombra el bug sembrado en una línea cambiada o, para un bug que solo se ve en otro archivo, en una línea marcada de ese archivo. Después de las primeras ejecuciones se añadieron palabras clave en cuatro casos en los que un revisor nombró el bug sembrado con palabras que la puntuación no aceptaba, y todas las ejecuciones guardadas se puntuaron de nuevo con ellas. Vuelve a ejecutarlo con `node evals/review-loop/run-detection.mjs --runs 3` y añade `--cases evals/review-loop/detection-hard` para el conjunto difícil.

La tabla de arriba es la base del modelo por defecto del revisor. En el conjunto difícil, Opus encontró 30 de 30 sin P1 o P2 falsos, Sonnet encontró 29 de 30 sin ninguno por cerca del 37% del costo de Opus, y Haiku encontró 30 de 30 con 3 P1 o P2 falsos en 18 ejecuciones limpias. Por eso el valor por defecto sigue siendo el modelo de la sesión, y Sonnet es la opción más barata cuando quieres que el revisor use un modelo distinto del que escribió el cambio.

[`evals/review-loop/detection-languages/`](../../evals/review-loop/detection-languages/) tiene 6 bugs sembrados en Python, Rust y Go y 2 cambios limpios. Con 3 ejecuciones por caso, Opus y Sonnet encontraron 18 de 18 y Haiku 16 de 18, sin ningún P1 o P2 falso en 6 ejecuciones limpias para ninguno de ellos; el [review-loop README](../../plugins/review-loop/README.md#measured-behavior) tiene los detalles.

<details>
<summary>Costo</summary>

`claude plugin details` estima así el costo de review-loop:

| Parte | Siempre activo, en cada sesión | Cada vez que se ejecuta |
|---|---|---|
| skill review-loop | unos 210 tokens | unos 6000 tokens |
| agente revisor | unos 60 tokens | unos 1800 tokens, más el diff y el código que lee |

El costo de la skill se paga una vez por ejecución. El del revisor se paga una vez por ronda, y un ciclo tiene como máximo 3 rondas. El modelo del revisor cambia ese costo; la tabla del benchmark de arriba lo muestra para cada modelo. Tus comprobaciones se ejecutan en tu máquina y no cuestan tokens.

</details>

review-loop revisa los pull requests del propio LIM. [#8](https://github.com/lee-eojin/lim/pull/8) muestra dos ciclos en su primera versión, incluida una detención causada por un falso positivo en su propia comprobación de debilitamiento de tests, que después se corrigió. Los pull requests recientes, como [#46](https://github.com/lee-eojin/lim/pull/46), muestran el informe de review-loop y la decisión tomada para cada hallazgo.

## Por qué funciona así

<details>
<summary>¿Por qué un revisor nuevo?</summary>

El agente que escribió un cambio sabe por qué está ahí cada línea, así que lee el cambio como correcto. Un revisor que solo recibe el diff y una línea de intención tiene que encontrar el motivo en el código. Si el motivo no está ahí, eso es un hallazgo. Cada ronda inicia un revisor nuevo, así que un revisor nunca califica su propio veredicto anterior.

</details>

<details>
<summary>¿Por qué un script decide cuándo detenerse?</summary>

Un modelo al que se le pregunta "¿ya está terminado?" tiende a decir que sí. El script de review-loop, en cambio, cuenta: se detiene cuando no queda ningún P1 ni P2, tras 3 rondas, cuando un hallazgo sobrevive a dos correcciones, cuando un hallazgo resuelto vuelve, cuando P1 + P2 deja de bajar o cuando una corrección debilita un test. Detenerse con hallazgos abiertos es un resultado normal, y Claude lo dice.

</details>

<details>
<summary>¿Por qué P1 y P2 necesitan evidencia?</summary>

En un informe, una afirmación hecha con seguridad y una afirmación demostrada se ven iguales. Un P1 o P2 debe citar la línea exacta, dar una entrada que produzca un resultado incorrecto y decir por qué nada lo impide ya. Si le falta alguna de las tres cosas, o si el revisor lo etiqueta como guessed, se muestra como no verificado y Claude no cambia código por él.

</details>

<details>
<summary>¿Por qué el commit gate es opt-in?</summary>

Un hook que bloquea commits cambia tu forma de trabajar, así que debe ser tu elección en cada repositorio. Sin el gate, "preguntar antes del commit" es una instrucción que Claude sigue. Con él, el hook bloquea un `git commit` que Claude ejecuta sin una revisión aprobada. No lo ve todo: [Límites](#límites) enumera lo que se le escapa, como los commits que escribes en tu propia terminal.

</details>

<details>
<summary>¿Por qué nunca hace push?</summary>

Un commit es local y fácil de deshacer. Un push no. review-loop se detiene en el commit, y el gate pregunta antes de cada push incluso cuando delegaste los commits.

</details>

## Datos

El estado, los diffs, los logs de las comprobaciones y un registro de decisiones se guardan en `.git/lim/review-loop/` dentro de tu repositorio. Claude escribe cada revisión por un momento en `.lim-review/` dentro de tu working tree; git ignora esa carpeta mediante `.git/info/exclude`, y review-loop elimina el archivo después de leerlo. Para comprobar una regla, review-loop escribe el código de antes de la corrección en una carpeta temporal fuera de tu repositorio y después la elimina. Para reiniciar, elimina `.git/lim/review-loop/`.

review-loop no hace llamadas de red propias. Claude y el revisor leen el diff, los hallazgos y la salida de las comprobaciones como cualquier otro archivo de tu sesión. Por eso ese contenido llega al proveedor del modelo de la misma forma que el resto de tu sesión de Claude Code.

## Límites

- Las comprobaciones se detectan a partir de los scripts de `package.json`, luego de los targets de un Makefile, luego de Go, Rust, las herramientas de Python configuradas (pytest, ruff, mypy), Gradle, Maven, .NET y las herramientas de Ruby que usa el proyecto (rspec, rake test, rubocop), en la raíz del repositorio y en los proyectos de subcarpetas que toca un cambio, hasta 4 por ronda.
- Cada comprobación tiene un máximo de 5 minutos, y todas las comprobaciones juntas un máximo de 9 minutos.
- Sin el commit gate, preguntar antes de un commit es una instrucción para Claude, no una garantía.
- El commit gate solo comprueba los comandos que Claude ejecuta con su herramienta Bash. Los commits que escribes en tu propia terminal no se comprueban. Un commit a través de un alias de git como `git ci` se comprueba igual que `git commit`, un alias de shell (`!...`) que hace commit genera una pregunta porque el gate no puede ver dentro de él, y un alias definido en línea con `git -c alias.ci=commit` no se reconoce.
- Si inicias Claude Code en una carpeta que no es un repositorio, el gate no puede comprobar un commit cuyo repositorio no puede identificar, por ejemplo después de `cd "$(...)"`.
- review-loop revisa todo lo que `git add -A` incluiría, no un conjunto de cambios en stage que eliges a mano.
- Una regla o un test de regresión se comprueba en una copia temporal que tiene tus archivos rastreados por git y un enlace al `node_modules` de la raíz. Otros archivos ignorados, como `.env` o un `node_modules` anidado, no están ahí, así que una comprobación que los necesita lo informa como no demostrado o como detectado por una razón equivocada. Claude lee el fallo para saber cuál de los dos casos es.

## Preguntas frecuentes

**¿review-loop se inicia sin que yo lo ejecute?**
No siempre. Claude inicia una skill solo cuando decide que la descripción de la skill corresponde a la conversación. Si le pides a Claude que revise o que haga un commit, Claude puede iniciar review-loop, pero esto no está garantizado. El comando `/review-loop:review-loop` siempre lo inicia. Si activas el commit gate, un commit sin revisión queda bloqueado y Claude recibe la indicación de ejecutar review-loop primero.

**¿Hace push o merge?**
Nunca. review-loop pregunta antes de cada commit, a menos que elijas "dejar de preguntar en este repositorio". Para desactivar esa opción otra vez, pide a Claude que desactive la delegación de commits de review-loop.

**¿Entra en conflicto con mis otros plugins?**
review-loop agrega una skill, un agente y un hook. El hook lee los comandos de Bash, solo actúa sobre `git commit` y `git push`, y no hace nada si no activaste el commit gate en ese repositorio. Sus nombres empiezan con `review-loop:`, así que no pueden coincidir con los nombres de otros plugins. Si lo pides con palabras normales, Claude puede elegir otra skill de revisión. El comando siempre inicia review-loop.

**¿Qué pasa si una sesión termina en medio de un ciclo?**
Ejecuta el comando otra vez. review-loop te ofrece continuar desde la ronda y el paso donde se detuvo, o empezar de nuevo.

**¿Cómo lo desinstalo?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Después, elimina `.git/lim/review-loop/` en cada repositorio donde lo ejecutaste, y la línea `.lim-review/` de su `.git/info/exclude`.

## Hazlo tuyo

review-loop funciona con las comprobaciones que ya tienes. Cuanto mejores sean tus scripts `typecheck`, `lint` y `test`, mayor es la parte de la revisión que se mide en lugar de leerse.

- ¿Quieres ver los hallazgos graves antes de que cambie nada? Pide a Claude que confirme contigo cada P2, o cada P1 y P2.
- ¿Cansado de aprobar commits en un repositorio de confianza? Delega allí los commits. Con el commit gate activado, para los push sigue preguntando.
- ¿Te repiten siempre el mismo comentario? Elige "convertirlo en una regla", y la siguiente revisión empieza con ese error ya detectado por tu propio linter o tus tests.
- ¿Quieres un flujo distinto? Haz un fork del plugin. La skill es un solo `SKILL.md` de menos de 250 líneas, y la lógica del ciclo es un solo script, `plugins/review-loop/skills/review-loop/scripts/loop.mjs`.

## Cómo se construye LIM

- **Primero los issues.** Cada cambio empieza con un issue y llega a través de un pull request que un maintainer integra con squash merge.
- **Revisado por sí mismo.** Cada pull request ejecuta review-loop sobre su propio diff, y la descripción muestra el informe y una decisión para cada hallazgo.
- **Versiones por plugin.** Cada plugin sigue Semantic Versioning, tiene su propio `CHANGELOG.md` y usa tags con el formato `<plugin>--v<version>`. Las versiones minor y major tienen un GitHub Release.
- **Pequeño a propósito.** Un plugin tiene una skill de entrada, un `SKILL.md` de menos de 250 líneas y solo hooks opt-in.

## Hoja de ruta

- Evals a nivel de modelo con `claude plugin eval` para los comportamientos que los tests unitarios no pueden cubrir, y una comparación a ciegas de la calidad y el costo de la revisión

## Contribuir

Los issues y los pull requests son bienvenidos. Empieza por [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licencia

MIT. Consulta [LICENSE](../../LICENSE).
