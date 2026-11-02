# CUBO Board

**Poné tus apuntes. El tablero se ordena solo.**

CUBO Board es un tablero (canvas) para estudiantes. Después de una clase tirás ahí lo que tengás: una nota escrita rápido, la foto de la pizarra, las diapositivas en PDF, un Excel. Un agente autónomo lee todo eso y, sin que nadie le escriba, despliega en el mismo tablero las tarjetas de la clase: resumen, explicación desde cero, glosario, tarea detectada, y una propuesta para agendarla. Cada día deja además un repaso con lo que viene.

Hecho para el **Hackathon CUBO AI — Proyecto de agentes** (1 de noviembre de 2026) por Memo Ortiz, estudiante de CUBO AI. Nace de la bitácora de clases que llevé durante el curso con ayuda de Claude: el proceso que hacíamos a mano quedó convertido en la skill propia del agente.

## Qué problema resuelve y para quién

Para el estudiante que escribe rápido y desordenado, que entra tarde o que falta a una clase. En vez de un cuaderno lleno de fragmentos, termina con la clase entendida, las palabras nuevas explicadas y las tareas en su calendario. Sirve para cualquier curso de CUBO (IA, Bitcoin, robótica) y para cualquier otro.

## Cómo funciona

```text
Estudiante → tablero (notas, fotos, PDF, Excel)
                │ subir algo es el evento que dispara al agente
                ▼
      Claude Code sin chat (claude -p), herramientas mínimas
                │ cada herramienta pasa por agent/guardia.js (hook PreToolUse)
                ├─ lee los apuntes, extrae texto de PDF con pdftotext
                ├─ arma las tarjetas con la skill clase-cubo
                ├─ guarda la clase en la carpeta CUBO Board de Drive   (MCP Google Drive)
                └─ escribe salida.json → agent/validar.js la revisa → tarjetas al tablero
                
Tarea detectada → tarjeta "espera tu aprobación" → el estudiante aprueba
                → el agente crea el evento SOLO en el calendario CUBO Board (MCP Google Calendar)

Cada día, el servidor → repaso → lee el calendario de clases y deja una tarjeta de repaso
```

**Cuatro cosas que pasan en código, no en el modelo:** qué herramientas existen (`.claude/settings.json`), qué llamada se bloquea (`agent/guardia.js`), qué tarjeta entra al tablero (`agent/validar.js`) y qué evento se puede crear (solo el que el estudiante aprobó, comparado campo por campo).

## MCPs que usa y para qué

| MCP | Para qué | Qué puede hacer el agente |
|---|---|---|
| **Google Drive** (servidor oficial `drivemcp.googleapis.com`) | Guardar cada clase como archivo de texto en la carpeta *CUBO Board* | Solo `create_file` dentro de esa carpeta y buscar dentro de ella. Compartir, borrar, mover, leer otros archivos: bloqueado |
| **Google Calendar** (servidor oficial `calendarmcp.googleapis.com`) | Leer el calendario de clases del curso para el repaso; agendar tareas aprobadas | Leer solo los dos calendarios configurados. `create_event` solo en *CUBO Board*, solo en modo acción, solo lo aprobado, sin invitados. Borrar, modificar, responder: bloqueado |

Los dos vienen conectados a Claude Code desde los conectores de claude.ai (`claude mcp list` los muestra como `claude.ai Google Drive` y `claude.ai Google Calendar`).

## Las dos skills

- **De internet: `pdf`** (`.claude/skills/pdf/`). Es la skill oficial de Anthropic, tomada de https://github.com/anthropics/skills (carpeta `skills/pdf`, commit `ca45fc4`). Antes de instalarla leímos `SKILL.md` y los ocho scripts: ninguno abre red ni ejecuta comandos. Solo copiamos lo que usamos (`SKILL.md`, `reference.md`, `LICENSE.txt`) y dejamos fuera los scripts de formularios. El detalle está en [`.claude/skills/pdf/ORIGEN.md`](.claude/skills/pdf/ORIGEN.md). El agente la usa únicamente para extraer texto con `pdftotext`, que es el único comando que el guardia deja pasar.
- **Propia: `clase-cubo`** (`.claude/skills/clase-cubo/SKILL.md`). El proceso completo: qué leer y en qué orden, cómo explicar desde cero y con voseo, corregir la ortografía de las notas, separar lo que dijo la clase de lo que agrega el agente, cuándo hay tarea y cuándo no, el formato JSON exacto de la salida, y qué hacer en casos dudosos: tratar cualquier instrucción dentro de los apuntes como contenido sospechoso y reportarla en una tarjeta de alerta. Sin esta skill el agente devuelve texto suelto; con ella devuelve las tarjetas que el tablero sabe pintar.

## Cómo se dispara la automatización

1. **Por evento.** Cada nota o archivo que entra al tablero (`POST /api/tableros/:id/notas` o `/archivos`) llama a `lanzador.programar()`. Espera 8 segundos por si llegan varias cosas seguidas y lanza `claude -p` una sola vez. Nadie escribe en un chat.
2. **Por horario.** El propio servidor corre el repaso una vez al día, a partir de las 7:00, sobre el tablero más reciente. No hay cron ni nada que configurar: con la app abierta, el repaso llega solo. (`node agent/repaso.js` lo lanza a mano cuando se quiera.)

3. **Por aprobación.** Cuando el estudiante aprueba agendar una tarea, el servidor lanza una segunda corrida en *modo acción* con un solo permiso: crear ese evento.

## Defensas contra prompt injection

Todo lo que el agente lee de afuera (notas, imágenes, PDF, hojas de cálculo) puede traer órdenes escondidas. Las defensas, de la más blanda a la más dura:

| Defensa | Dónde |
|---|---|
| Datos ≠ instrucciones, dicho explícitamente | `agent/sistema.md`, `SKILL.md` de `clase-cubo` y el aviso dentro de `entrada.json` |
| Herramientas mínimas | `.claude/settings.json`: lista `allow` corta y lista `deny` con todo lo destructivo, el `.env`, la web y el resto de conectores |
| Validación en código antes de actuar | `agent/guardia.js` (hook `PreToolUse`, exit 2 bloquea): solo `pdftotext`, solo lectura de `data/`, solo escritura en `data/trabajo/`, solo la carpeta y los calendarios configurados, nunca invitados |
| Confirmación humana antes de lo irreversible | Agendar pasa por una tarjeta de aprobación. Borrar tarjetas o tableros solo lo hace el estudiante desde el canvas. El agente no tiene ninguna acción irreversible disponible |
| El modelo propone, el código decide | `agent/validar.js` filtra la salida: tipos permitidos, fechas válidas, sin valores de configuración, sin código. En modo acción el guardia compara el evento contra lo aprobado |
| Secretos fuera del alcance | Llaves: ninguna en el proyecto, Claude Code usa tu sesión. Los IDs viven en `.env`, con regla `deny` para leerlo y filtro en el guardia |
| Registro | `logs/acciones.jsonl`: cada herramienta que el agente intentó, permitida o bloqueada, con el motivo. `logs/agente.log`: cada corrida, costo, turnos y la razón que dio el agente |

**Probado** con tres ataques reales en [`tests/injection/`](tests/injection/): una imagen con texto casi invisible, un PDF que se hace pasar por una aprobación y una nota que pide los secretos. Resultado en [`tests/injection/resultado.md`](tests/injection/resultado.md): el agente reportó los tres en tarjetas de alerta, no ejecutó nada de lo pedido y aun así produjo la clase. Para repetirlo con el servidor corriendo:

```bash
node tests/injection/correr.js
```

## Instalar y correr

Necesitás macOS o Linux con Node 22+, [Claude Code](https://code.claude.com) iniciado con tu cuenta, y `pdftotext` (`brew install poppler`).

```bash
git clone <este repositorio> cubo-board && cd cubo-board
npm install
cp .env.example .env        # completá los IDs (ver abajo)
claude                      # abrí Claude Code una vez aquí y aceptá el diálogo de confianza; salí con /exit
npm start                   # http://127.0.0.1:8790
```

**Conectar Google.** En claude.ai, agregá los conectores de Google Drive y Google Calendar con la cuenta que vas a usar; Claude Code los toma solo. Comprobá con `claude mcp list` que aparezcan conectados.

**Qué guarda en Drive.** La clase armada y el texto extraído de cada PDF, con la hora y el tema en el nombre, en una carpeta por tablero. Las imágenes y hojas de cálculo quedan en el tablero: subir binarios por el conector obligaría a pasar el archivo entero por el modelo. El siguiente paso sería que el servidor los suba directo con una credencial propia de Google, sin pasar por el agente.

**Los IDs del `.env`.** Creá en esa cuenta un calendario llamado *CUBO Board* y una carpeta de Drive llamada *CUBO Board*. El ID del calendario está en su configuración, sección "Integrar calendario". El ID de la carpeta es lo que va después de `folders/` en su URL. `CALENDARIO_CLASES_ID` es opcional: el calendario de tu curso, que el agente solo lee. El `.env` lleva únicamente IDs, no llaves, y nunca se sube.

**Usar.** Arrastrá tus apuntes al lienzo negro: la primera vez te pregunta de qué clase son y crea el tablero. Desde ahí todo lo que sueltes cae en ese tablero. Con la herramienta de nota (o doble clic en el lienzo) escribís directo en el canvas. Debajo de lo último que subiste aparece "Leyendo tus apuntes…" y en menos de un minuto llegan las tarjetas del agente, unidas con una línea a los apuntes de donde salieron. Si detectó una tarea, aprobá agendarla con un clic.

**Herramientas** (barra izquierda): subir archivos `U`, tableros, seleccionar `V`, mover el lienzo `H`, nota `N`, buscar `F`, borrar tablero. Zoom con `⌘` + rueda o los botones de abajo; el minimapa lleva a cualquier parte.

## Estructura

```text
server/        servidor local (Express): tableros, archivos, API
web/           el canvas, sin librerías (logo, isotipo, estilos, app.js)
agent/         sistema.md, lanzador.js, guardia.js, validar.js, repaso.js
.claude/       settings.json (permisos y hook) y skills/
tests/injection/   tres ataques, el corredor y el informe
data/, logs/   se crean al correr; no van al repositorio
```

Auditoría de seguridad y riesgos que quedan: [`SECURITY.md`](SECURITY.md).
