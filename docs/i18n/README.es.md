# LIM

**Less is more.** Plugins pequeños para Claude Code. Cada plugin hace un solo trabajo y muestra las mediciones que lo respaldan.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Este documento es una traducción del [README en inglés](../../README.md) en su versión del 2026-10-19. Si los dos documentos son diferentes, el README en inglés es el correcto.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | Español | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | [Bahasa Indonesia](README.id.md)

## Por qué LIM

Los harnesses de agentes grandes cargan muchas instrucciones en cada sesión y ejecutan hooks en muchos comandos. LIM mantiene cada plugin pequeño, opcional y medido.

- **Un plugin, un trabajo.** Instala solo lo que necesitas. review-loop agrega unos 188 tokens a una sesión, según `claude plugin details`.
- **Primero las comprobaciones, después las opiniones.** Tus tests, tus tipos y tu lint se ejecutan antes de cualquier revisión del modelo.
- **Los hooks son opt-in.** Un hook no hace nada hasta que lo activas en un repositorio.
- **Preguntar antes de instalar.** Si un plugin necesita algo, primero se explica: qué es, qué mejora, dónde se guarda y cómo eliminarlo.
- **Mostrar los números.** Cada plugin incluye lo que se midió y lo que esa medición no cubre.

## Plugins

| Plugin | Estado | Un trabajo |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.3.0 | Revisa tus cambios antes del commit, corrige los hallazgos P1 y P2, vuelve a revisar y te entrega el resto. |

## Inicio rápido

Necesitas Claude Code, git y Node.js 18 o una versión posterior.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Si Claude Code lo pide, reinícialo. Después, en un repositorio git con cambios sin commit, ejecuta:

```
/review-loop:review-loop
```

Agregar el marketplace solo registra el catálogo. Cada plugin se instala por separado, así que solo obtienes los plugins que eliges.

## review-loop

Antes de tu commit, review-loop ejecuta un ciclo corto y se detiene sin tu intervención.

1. **Comprobaciones.** review-loop ejecuta los scripts `typecheck`, `lint` y `test` de tu `package.json`. Si una comprobación falla, o si tu `package.json` no es JSON válido, el resultado es un hallazgo P1. Si una comprobación supera su límite de tiempo, review-loop la informa como "no verificada" y no como fallida.
2. **Revisión nueva.** Un agente revisor separado recibe el diff y un resumen de una línea de lo que querías. El revisor no recibe el razonamiento de Claude sobre el cambio. El revisor puede leer el código cercano para entender el contexto. El revisor etiqueta los hallazgos de P1 a P5. P1 y P2 necesitan evidencia: la línea exacta, un escenario de fallo y la razón por la que nada en el código ya lo impide. Si una afirmación no tiene evidencia, review-loop te la muestra como no verificada.
3. **Corrección.** Claude dice qué va a corregir y después corrige P1 y P2. Si una corrección necesita una decisión de diseño (más de una forma de corregir, un cambio de comportamiento visible, eliminar una funcionalidad, cambiar tests), tú eliges primero. Para ver cada P2 (o cada P1 y P2) antes de cualquier cambio, pide a Claude que te los confirme primero.
4. **Nueva revisión.** Un revisor nuevo comprueba solo las correcciones y los hallazgos que siguen abiertos. El ciclo tiene un máximo de 3 rondas.
5. **Detención.** Un script, no el modelo, decide cuándo detener el ciclo. El ciclo se detiene en estos casos: no quedan P1 ni P2, se alcanza el límite de rondas, un hallazgo sigue abierto después de dos correcciones, un hallazgo resuelto vuelve a aparecer, P1 + P2 deja de disminuir, o una corrección debilita los tests o las comprobaciones.
6. **Decisión.** Tú decides el resto una sola vez: todos los P3 a P5, y cada P1 o P2 que sigue abierto, no está verificado o trata de un archivo fuera del diff revisado. Para cada hallazgo eliges: dejarlo como está, corregirlo solo esta vez o convertirlo en una regla.
7. **Commit.** Claude pregunta antes del commit, a menos que hayas elegido "dejar de preguntar en este repositorio". Claude nunca hace push. Si activas el commit gate, un hook convierte esto en una regla: los commits de Claude quedan bloqueados hasta que se aprueba una revisión.

### Commit gate

El commit gate es un hook. Este hook está desactivado hasta que lo activas en un repositorio. Al final de una revisión, Claude pregunta una vez si quieres activarlo. Con el gate activado, el gate comprueba primero cada `git commit` que Claude ejecuta:

| Situación | Qué hace el gate |
|---|---|
| No hay revisión, o cambiaron archivos que la revisión no cubrió | Bloquea el commit y le indica a Claude que ejecute la revisión |
| Un ciclo de revisión está en curso, o todavía hay decisiones pendientes | Bloquea el commit |
| La revisión se aprobó | Te pregunta antes del commit, o permite el commit si delegaste los commits en este repositorio |
| Después de la revisión, solo cambiaron archivos revisados | Te pregunta |
| `git push` o un force push | Siempre pregunta, incluso con delegación |
| Un commit con `--no-verify` | Pregunta, incluso con delegación, y sigue bloqueando un commit sin una revisión aprobada |
| Un commit en una carpeta que el gate no puede leer, como `cd "$(...)"` o una ruta que no existe | Pregunta, incluso con delegación, si el gate está activado en el repositorio donde iniciaste Claude Code |

Para hacer un commit una sola vez sin revisión, pide a Claude que omita la revisión esta vez. La configuración del gate y la delegación de commits se aplican a todo el repositorio, incluidos sus worktrees vinculados. Cada worktree tiene su propia revisión.

Cada ronda termina con un informe:

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### Severidad

La escala se basa en la regla Pn pública de Banksalad.

| Nivel | Significado | Comportamiento del ciclo |
|---|---|---|
| P1 | Corrección obligatoria: una comprobación que falla, pérdida de datos, un fallo de seguridad, un crash, o la funcionalidad pedida no funciona | Se corrige solo si tiene evidencia |
| P2 | Corrección necesaria: un bug que una entrada específica reproduce, un requisito que falta, una regla del proyecto que no se cumple | Se corrige solo si tiene evidencia |
| P3 | Corrección útil: mantenibilidad, un nombre que confunde, un test que falta en un camino secundario | Tú decides |
| P4 | Opcional: una preferencia de estructura en la que las personas no están de acuerdo | Tú decides |
| P5 | Trivial: una errata o el formato | Tú decides |

Un P1 o P2 sobre un archivo que no está en el diff que revisó la ronda no se corrige en el ciclo. Llega a ti al final, marcado como fuera del diff revisado, y conserva su severidad.

### Mediciones

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) enumera 78 comportamientos en seis ejes: `do`, `tell`, `ask`, `silence`, `stop` y `evidence`. Los tests unitarios en CI cubren 76 de estos comportamientos, incluidas ejecuciones contra repositorios git temporales reales y el hook de commit gate. Los otros 2 necesitan una ejecución del modelo y están planificados para `claude plugin eval`: preguntar una sola vez sobre P3 a P5 y mostrar el informe antes de cualquier pregunta.

review-loop revisa los pull requests del propio LIM. [#8](https://github.com/lee-eojin/lim/pull/8) muestra dos ciclos en su primera versión. Uno de estos ciclos se detuvo por un falso positivo en la comprobación de debilitamiento de tests de review-loop. Después, ese falso positivo se corrigió.

### Datos

El estado, los diffs, los logs de las comprobaciones y un registro de decisiones se guardan en `.git/lim/review-loop/` dentro de tu repositorio. review-loop no escribe nada en tu working tree. Para reiniciar, elimina esa carpeta.

review-loop no hace llamadas de red propias. Claude y el revisor leen el diff, los hallazgos y la salida de las comprobaciones como cualquier otro archivo de tu sesión. Por eso ese contenido llega al proveedor del modelo de la misma forma que el resto de tu sesión de Claude Code.

### Límites

- review-loop detecta las comprobaciones solo a partir de los scripts de `package.json`.
- Cada comprobación tiene un máximo de 5 minutos, y todas las comprobaciones juntas tienen un máximo de 9 minutos. Para cambiar el límite de cada comprobación, define `LIM_CHECK_TIMEOUT_MS`.
- Sin el commit gate, preguntar antes de un commit es una instrucción para Claude, no una garantía.
- El commit gate solo comprueba los comandos que Claude ejecuta con su herramienta Bash. Los commits que escribes en tu propia terminal no se comprueban. Los alias de git como `git ci` no se reconocen.
- Si inicias Claude Code en una carpeta que no es un repositorio, el gate no puede comprobar un commit cuyo repositorio no puede identificar, por ejemplo después de `cd "$(...)"`.
- review-loop revisa todo lo que `git add -A` incluiría, no un conjunto de cambios en stage que eliges a mano.

## Preguntas frecuentes

**¿review-loop se inicia sin que yo lo ejecute?**
No siempre. Claude inicia una skill solo cuando decide que la descripción de la skill corresponde a la conversación. Si le pides a Claude que revise o que haga un commit, Claude puede iniciar review-loop, pero esto no está garantizado. El comando `/review-loop:review-loop` siempre lo inicia. Si activas el commit gate, un commit sin revisión queda bloqueado. Entonces Claude recibe la indicación de ejecutar review-loop primero.

**¿Hace push o merge?**
Nunca. review-loop pregunta antes de cada commit, a menos que elijas "dejar de preguntar en este repositorio". Para desactivar esa opción otra vez, pide a Claude que desactive la delegación de commits de review-loop.

**¿Entra en conflicto con mis otros plugins?**
review-loop agrega una skill, un agente y un hook. El hook lee los comandos de Bash y solo actúa sobre `git commit` y `git push`. El hook no hace nada si no activaste el commit gate en ese repositorio. Sus nombres empiezan con `review-loop:`, así que no pueden coincidir con los nombres de otros plugins. Si lo pides con palabras normales, Claude puede elegir otra skill de revisión. El comando siempre inicia review-loop.

**¿Qué pasa si una sesión termina en medio de un ciclo?**
Ejecuta el comando otra vez. review-loop te ofrece continuar desde la ronda y el paso donde se detuvo, o empezar de nuevo.

**¿Cómo lo desinstalo?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Después, elimina `.git/lim/review-loop/` en cada repositorio donde ejecutaste review-loop.

## Cómo se construye LIM

- **Primero los issues.** Cada cambio empieza con un issue y llega a través de un pull request. Un maintainer integra el pull request con squash merge.
- **Versiones por plugin.** Cada plugin sigue Semantic Versioning, tiene su propio `CHANGELOG.md` y usa tags con el formato `<plugin>--v<version>`. Las versiones minor y major tienen un GitHub Release.
- **Pequeño por diseño.** Un plugin tiene una skill de entrada, un `SKILL.md` de menos de 250 líneas y solo hooks opt-in.

## Hoja de ruta

- review-loop: convertir los hallazgos que marcaste como «convertirlo en una regla» en borradores de reglas de lint y tests
- Evals a nivel de modelo con `claude plugin eval` para los comportamientos que los tests unitarios no pueden cubrir

## Contribuir

Los issues y los pull requests son bienvenidos. Empieza por [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Licencia

MIT. Consulta [LICENSE](../../LICENSE).
