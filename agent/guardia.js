#!/usr/bin/env node
// Guardia: hook PreToolUse. Claude Code lo ejecuta ANTES de cada herramienta
// que el agente quiere usar. Decide en código, sin modelo, comparando campos
// exactos: lo que no cumple una regla se bloquea (exit 2) y el motivo vuelve
// al agente. Todo queda en logs/acciones.jsonl, haya pasado o no.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrada = JSON.parse(readFileSync(0, "utf8"));
const { tool_name: tool = "", tool_input: input = {}, session_id: sesion = "" } = entrada;
const {
  MODO = "analisis", ACCION_ID = "", TABLERO_ID = "",
  CALENDARIO_ID = "", CALENDARIO_CLASES_ID = "", CARPETA_DRIVE_ID = "",
} = process.env;

const dentroDe = (ruta, carpeta) => {
  if (typeof ruta !== "string" || !ruta) return false;
  const abs = path.resolve(RAIZ, ruta);
  return abs === carpeta || abs.startsWith(carpeta + path.sep);
};
const limpio = (s) => String(s ?? "").replace(/[^\w-]/g, "");
const DATOS = path.join(RAIZ, "data");
const ARCHIVOS = path.join(DATOS, "archivos");
const TRABAJO = path.join(DATOS, "trabajo");
const MI_TRABAJO = path.join(TRABAJO, limpio(TABLERO_ID));
const SKILLS = path.join(RAIZ, ".claude", "skills");
const SKILLS_PERMITIDAS = ["clase-cubo", "pdf"];

function decidir() {
  // Lectura local: solo los apuntes subidos, la carpeta de trabajo y las dos skills.
  if (tool === "Read" || tool === "Glob" || tool === "Grep") {
    const ruta = input.file_path ?? input.path ?? "";
    const patron = String(input.pattern ?? input.glob ?? "");
    if (/(^|\/)\.env/.test(ruta + patron)) return "Está prohibido leer archivos .env";
    if (patron.startsWith("/") || patron.includes("..") || patron.startsWith("~")) return "El patrón de búsqueda tiene que ser relativo y sin '..'";
    if (tool === "Read" && !ruta) return "Read necesita una ruta";
    const base = ruta || DATOS;
    if (dentroDe(base, ARCHIVOS) || dentroDe(base, TRABAJO) || dentroDe(base, SKILLS)) return null;
    return `Solo podés leer dentro de data/archivos, data/trabajo y .claude/skills. Pediste: ${base}`;
  }

  // Escritura local: únicamente la carpeta de trabajo DE ESTE tablero.
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    if (tool !== "Write") return "Solo podés crear archivos nuevos con Write";
    if (!TABLERO_ID) return "No hay tablero en curso; no se puede escribir";
    if (dentroDe(input.file_path, MI_TRABAJO)) return null;
    return `Solo podés escribir dentro de data/trabajo/${limpio(TABLERO_ID)}`;
  }

  // Shell: solo pdftotext sobre archivos subidos, sin encadenar nada.
  if (tool === "Bash") {
    const cmd = String(input.command ?? "").trim();
    if (/[;&|<>`$\\\n]/.test(cmd)) return "No se permiten comandos encadenados, redirecciones ni variables";
    const partes = cmd.split(/\s+/);
    if (partes[0] !== "pdftotext") return "El único comando permitido es pdftotext";
    const rutas = partes.slice(1).filter((p) => !p.startsWith("-"));
    if (rutas.length === 0 || rutas.length > 2) return "pdftotext necesita el PDF de entrada y, opcionalmente, un .txt de salida";
    if (!dentroDe(rutas[0], ARCHIVOS) || !rutas[0].endsWith(".pdf")) return "El PDF tiene que estar en data/archivos";
    if (rutas[1] && rutas[1] !== "-" && !(dentroDe(rutas[1], MI_TRABAJO) && rutas[1].endsWith(".txt"))) return "La salida tiene que ser un .txt en la carpeta de trabajo del tablero";
    return null;
  }

  if (tool === "Skill") return SKILLS_PERMITIDAS.includes(String(input.skill)) ? null : `Solo podés usar las skills ${SKILLS_PERMITIDAS.join(" y ")}`;
  if (tool === "TodoWrite" || tool === "ToolSearch") return null;

  // Google Calendar: campos exactos, nunca "contiene".
  if (tool.startsWith("mcp__claude_ai_Google_Calendar__")) {
    const accion = tool.split("__").pop();
    if (accion === "list_calendars") return null;
    if (["list_events", "search_events", "get_event"].includes(accion)) {
      const permitidos = [CALENDARIO_ID, CALENDARIO_CLASES_ID].filter(Boolean);
      if (permitidos.includes(input.calendarId)) return null;
      return "Solo podés consultar el calendario de CUBO Board y el calendario de clases (calendarId exacto)";
    }
    if (accion !== "create_event") return `Acción de calendario no permitida: ${accion}. El agente solo crea eventos.`;
    if (MODO !== "accion") return "Crear un evento requiere la aprobación del estudiante. Proponelo en una tarjeta de aprobación.";
    if (!CALENDARIO_ID) return "No hay calendario de CUBO Board configurado";
    if (input.calendarId !== CALENDARIO_ID) return "Solo podés crear eventos en el calendario de CUBO Board (calendarId exacto)";
    if ("attendees" in input || "guests" in input || "invitados" in input) return "No podés invitar a nadie a un evento";
    const aprobada = cargarAprobada();
    if (!aprobada?.titulo || !aprobada?.fecha) return "No hay ninguna acción aprobada pendiente";
    if (input.summary !== aprobada.titulo) return "El título del evento no es exactamente el que aprobó el estudiante";
    const inicio = String(input.startTime ?? input.start?.date ?? input.start ?? "");
    if (!inicio.startsWith(aprobada.fecha)) return "La fecha del evento no es la que aprobó el estudiante";
    return null;
  }

  // Google Drive: solo crear dentro de la carpeta exacta. Sin búsquedas.
  if (tool.startsWith("mcp__claude_ai_Google_Drive__")) {
    const accion = tool.split("__").pop();
    if (accion === "get_file_metadata") return CARPETA_DRIVE_ID && input.fileId === CARPETA_DRIVE_ID ? null : "Solo podés consultar la carpeta de CUBO Board";
    if (accion !== "create_file") return `Acción de Drive no permitida: ${accion}. El agente solo crea archivos en la carpeta de CUBO Board.`;
    if (!CARPETA_DRIVE_ID) return "No hay carpeta de Drive de CUBO Board configurada";
    const esCarpeta = /vnd\.google-apps\.folder/.test(JSON.stringify(input));
    if (esCarpeta) return input.parentId === CARPETA_DRIVE_ID ? null : "Solo podés crear carpetas directamente dentro de la carpeta de CUBO Board";
    const carpetaTablero = carpetaDelTablero();
    if (input.parentId === CARPETA_DRIVE_ID || (carpetaTablero && input.parentId === carpetaTablero)) return null;
    return "Solo podés crear archivos dentro de la carpeta de CUBO Board o de la carpeta de este tablero";
  }

  return `Herramienta no permitida para este agente: ${tool}`;
}

// La carpeta de Drive de cada tablero la anota el hook registro-drive.js en
// data/drive/, fuera de lo que el agente puede escribir.
function carpetaDelTablero() {
  const archivo = path.join(DATOS, "drive", "carpetas.json");
  if (!TABLERO_ID || !existsSync(archivo)) return null;
  try { return JSON.parse(readFileSync(archivo, "utf8"))[TABLERO_ID]?.id ?? null; } catch { return null; }
}

// Las aprobaciones viven FUERA de la carpeta donde el agente puede escribir.
function cargarAprobada() {
  const archivo = path.join(DATOS, "aprobadas", `${limpio(ACCION_ID)}.json`);
  if (!ACCION_ID || !existsSync(archivo)) return null;
  try { return JSON.parse(readFileSync(archivo, "utf8")); } catch { return null; }
}

const motivo = decidir();
mkdirSync(path.join(RAIZ, "logs"), { recursive: true });
appendFileSync(path.join(RAIZ, "logs", "acciones.jsonl"), JSON.stringify({
  hora: new Date().toISOString(), sesion, modo: MODO, tablero: TABLERO_ID, tool,
  input: JSON.stringify(input).slice(0, 400),
  decision: motivo ? "bloqueada" : "permitida", motivo,
}) + "\n");

if (motivo) {
  process.stderr.write(`Bloqueado por el guardia de CUBO Board: ${motivo}\n`);
  process.exit(2);
}
