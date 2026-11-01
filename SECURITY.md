# SECURITY.md — Auditoría de CUBO Board

Fecha: 1 de noviembre de 2026. Alcance: todo el repositorio. Auditor: Memo Ortiz con Claude Code (una sesión construyó; otra sesión independiente, sin haber visto el código antes, lo revisó).

## Herramientas usadas

| Qué | Herramienta | Resultado |
|---|---|---|
| Dependencias | `npm audit` | 0 vulnerabilidades (express 5.3, multer 2.5) |
| Secretos en el código y en el historial | `git log -p --all` con patrones de llaves (`api_key`, `token`, `sk-`, `AKIA`, `ghp_`, `BEGIN PRIVATE KEY`), `git ls-files` | Ninguna llave. El proyecto no tiene ninguna: Claude Code usa la sesión del usuario. `.env` solo lleva IDs de calendario y carpeta, y nunca entró al historial |
| Análisis del código | Revisión independiente con Claude (subagente `general-purpose`, solo lectura), con la lógica del guardia reproducida aparte para buscar *bypasses*. `/security-review` de Claude Code queda para correrlo contra el repositorio remoto | 2 hallazgos altos, 4 medios, 5 bajos: todos corregidos (abajo) |
| Prompt injection | 3 ataques reales en `tests/injection/`, corridos contra el agente vivo | 7 de 7 chequeos; ver `tests/injection/resultado.md` |
| Permisos | Revisión de `.claude/settings.json` y `agent/guardia.js` herramienta por herramienta | Tabla abajo |

## Qué encontró la revisión y cómo se corrigió

| Severidad | Hallazgo | Corrección |
|---|---|---|
| Alta | Los chequeos de Drive eran por "contiene el texto": un apunte podía lograr que el archivo de la clase se creara en una carpeta ajena con tal de mencionar el ID de CUBO Board en el contenido, y `search_files` dejaba leer fragmentos de todo el Drive | `create_file` exige `parentId` **igual** al ID de la carpeta. `search_files` quedó en la lista `deny`. El agente recibe el ID en el pedido y no busca nada |
| Alta | El agente podía escribir en `data/trabajo/aprobadas/` y reemplazar la acción aprobada; el calendario se comparaba por "contiene" | Las aprobaciones viven en `data/aprobadas/`, fuera de la carpeta escribible. El agente solo escribe en `data/trabajo/<id-del-tablero-en-curso>/`. `create_event` exige `calendarId`, `summary` y fecha **iguales** a lo aprobado, y rechaza cualquier campo de invitados. El archivo aprobado se borra al terminar |
| Media | Lectura de cualquier calendario con tal de mencionar un ID permitido | `list_events`, `search_events` y `get_event` exigen `calendarId` exacto de uno de los dos calendarios configurados |
| Media | Sin protección CSRF: otra página abierta en el navegador podía subir archivos al tablero | La API solo acepta `Host` y `Origin` propios y, para todo lo que no sea GET, un encabezado `X-CUBO-Board` que un formulario ajeno no puede mandar sin *preflight* |
| Media | Texto derivado de los apuntes (título de la tarea) se interpolaba dentro del pedido al agente | El pedido de la acción se escribe en un archivo de datos (`pedido-<id>.json`) y el agente lo lee; el nombre del tablero y el curso van dentro de `entrada.json`, no en el texto |
| Media | El validador no filtraba enlaces ni correos (el vector que le queda a un apunte malicioso), ni la `razon`; comparaba secretos sin normalizar; aceptaba fechas imposibles | Enlaces y correos se reemplazan por `[enlace quitado]`; la razón pasa por los mismos filtros; los valores de configuración se comparan en minúsculas y sin espacios; las fechas se validan con `Date` y un rango de un año atrás a dos adelante |
| Baja | `Glob`/`Grep` podían listar nombres fuera del proyecto con un patrón absoluto | Patrones absolutos, con `..` o `~` bloqueados |
| Baja | El agente podía cargar cualquier skill instalada en la cuenta | Solo `clase-cubo` y `pdf` |
| Baja | Archivos servidos con el tipo que declaró el navegador | Firma real (*magic bytes*) de PNG, JPG, WebP, PDF y XLSX verificada tras subir; `X-Content-Type-Options: nosniff`; descarga forzada para lo que no es imagen |
| Baja | Corridas concurrentes sobre el mismo tablero; una promesa sin `catch` podía tumbar el servidor | Si llegan apuntes mientras el agente trabaja, se vuelve a lanzar al terminar; todas las promesas con `catch` |
| Baja | El registro del guardia (`logs/acciones.jsonl`) entró al historial de git en los primeros commits, con IDs de calendario y carpeta | Historial reescrito antes de publicar; `logs/` y `data/` ignorados. Verificado con `git log --all` |

## Permisos: qué puede hacer cada herramienta y cada MCP

| Herramienta | Permitido | Bloqueado |
|---|---|---|
| `Read`, `Glob`, `Grep` | `data/archivos/`, `data/trabajo/`, `.claude/skills/` | Todo lo demás; cualquier `.env`; patrones absolutos |
| `Write` | Solo `data/trabajo/<tablero en curso>/` | Cualquier otra ruta; `Edit`, `MultiEdit`, `NotebookEdit` |
| `Bash` | `pdftotext [opciones] data/archivos/x.pdf [- | data/trabajo/<tablero>/x.txt]` | Cualquier otro comando; `; & | < > \` $ \\` |
| `Skill` | `clase-cubo`, `pdf` | Las demás skills de la cuenta |
| Google Drive | `create_file` con `parentId` = carpeta CUBO Board; `get_file_metadata` de esa carpeta | Buscar, leer, descargar, compartir, mover, borrar, listar recientes |
| Google Calendar | Leer los dos calendarios configurados (ID exacto); `create_event` solo en modo acción, solo en CUBO Board, solo el evento aprobado, sin invitados | Borrar, modificar, responder, sugerir horarios; cualquier otro calendario |
| Otros conectores (Gmail, Docs, Dropbox, Linear) | — | Todo, en `deny` |
| `WebFetch`, `WebSearch`, `Agent` | — | Todo |

Las reglas de `settings.json` las aplica Claude Code; el guardia (`agent/guardia.js`) las vuelve a verificar campo por campo y registra cada intento. Si el guardia falla o se cae, la acción se bloquea (`onFailure: block`).

## Riesgos que quedan

- **El contenido de las tarjetas sigue siendo texto del modelo.** Un apunte malicioso no puede hacer que el agente actúe, pero sí puede influir en lo que dice una tarjeta. El validador quita enlaces y correos y la skill exige reportar lo sospechoso en una tarjeta de alerta, pero el estudiante debe leer con criterio, igual que con cualquier resumen.
- **El agente corre con la sesión de Claude Code del usuario.** Los permisos del proyecto limitan qué herramientas existen en cada corrida, pero la identidad es la del usuario. Para producción con varios estudiantes haría falta una cuenta de servicio por estudiante y el servidor fuera de la máquina personal.
- **Servidor local sin autenticación.** Está atado a `127.0.0.1` con protección CSRF, así que solo lo usa quien está en esa máquina. Para usarlo en red habría que agregar sesiones.
- **Los logs guardan los primeros 400 caracteres de cada llamada**, incluidos los IDs de calendario y carpeta y fragmentos de la clase. No son secretos, pero `logs/` no debe compartirse al reportar problemas.
- **Dependencia de servicios externos.** Si Google o Claude no responden, la corrida falla y el tablero recibe una tarjeta de alerta; no hay reintentos automáticos.
- **La cuenta de Google usada es personal**, aislada en un calendario y una carpeta propios del proyecto. Los hooks impiden en código que el agente toque algo más de esa cuenta.
