#!/usr/bin/env node
// Guardia: hook PreToolUse. Claude Code lo ejecuta ANTES de cada herramienta
// que el agente quiere usar. Decide en código, sin modelo: lo que no cumple
// una regla se bloquea (exit 2) y el motivo vuelve al agente. Todo queda en
// logs/acciones.jsonl, haya pasado o no.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrada = JSON.parse(readFileSync(0, "utf8"));
const { tool_name: tool = "", tool_input: input = {}, session_id: sesion = "" } = entrada;
const { MODO = "analisis", ACCION_ID = "", CALENDARIO_ID = "", CALENDARIO_CLASES_ID = "", CARPETA_DRIVE_ID = "" } = process.env;

const dentroDe = (ruta, carpeta) => {
  const abs = path.resolve(RAIZ, String(ruta ?? ""));
  return abs === carpeta || abs.startsWith(carpeta + path.sep);
};
const DATOS = path.join(RAIZ, "data");
const ARCHIVOS = path.join(DATOS, "archivos");
const TRABAJO = path.join(DATOS, "trabajo");
const SKILLS = path.join(RAIZ, ".claude", "skills");

function decidir() {
  // Lectura local: solo los archivos subidos, la carpeta de trabajo y las skills.
  if (tool === "Read" || tool === "Glob" || tool === "Grep") {
    const ruta = input.file_path ?? input.path ?? RAIZ;
    if (/(^|\/)\.env/.test(String(ruta))) return "Está prohibido leer archivos .env";
    if (dentroDe(ruta, ARCHIVOS) || dentroDe(ruta, TRABAJO) || dentroDe(ruta, SKILLS)) return null;
    return `Solo podés leer dentro de data/archivos, data/trabajo y .claude/skills. Pediste: ${ruta}`;
  }

  // Escritura local: únicamente la carpeta de trabajo del tablero.
  if (tool === "Write" || tool === "Edit" || tool === "MultiEdit" || tool === "NotebookEdit") {
    if (tool === "Write" && dentroDe(input.file_path, TRABAJO)) return null;
    return "Solo podés escribir archivos nuevos dentro de data/trabajo";
  }

  // Shell: solo pdftotext sobre archivos subidos, sin encadenar nada.
  if (tool === "Bash") {
    const cmd = String(input.command ?? "").trim();
    if (/[;&|<>`$\\]/.test(cmd)) return "No se permiten comandos encadenados, redirecciones ni variables";
    const partes = cmd.split(/\s+/);
    if (partes[0] !== "pdftotext") return "El único comando permitido es pdftotext";
    const rutas = partes.slice(1).filter((p) => !p.startsWith("-"));
    if (rutas.length === 0 || rutas.length > 2) return "pdftotext necesita el PDF de entrada y, opcionalmente, un .txt de salida";
    if (!dentroDe(rutas[0], ARCHIVOS) || !rutas[0].endsWith(".pdf")) return "El PDF tiene que estar en data/archivos";
    if (rutas[1] && rutas[1] !== "-" && !(dentroDe(rutas[1], TRABAJO) && rutas[1].endsWith(".txt"))) return "La salida tiene que ser un .txt en data/trabajo";
    return null;
  }

  if (tool === "Skill" || tool === "TodoWrite" || tool === "ToolSearch") return null;

  // Google Calendar
  if (tool.startsWith("mcp__claude_ai_Google_Calendar__")) {
    const accion = tool.split("__").pop();
    if (accion === "list_calendars") return null;
    if (["list_events", "search_events", "get_event"].includes(accion)) {
      // Lectura solo del calendario de CUBO Board y del de clases, nunca de los demás de la cuenta.
      const texto = JSON.stringify(input);
      const permitidos = [CALENDARIO_ID, CALENDARIO_CLASES_ID].filter(Boolean);
      if (permitidos.some((id) => texto.includes(id))) return null;
      return "Solo podés consultar el calendario de CUBO Board y el calendario de clases";
    }
    if (accion !== "create_event") return `Acción de calendario no permitida: ${accion}. El agente solo crea eventos.`;
    if (MODO !== "accion") return "Crear un evento requiere la aprobación del estudiante. Proponelo en una tarjeta de aprobación.";
    if (!CALENDARIO_ID) return "No hay calendario de CUBO Board configurado";
    const texto = JSON.stringify(input);
    if (!texto.includes(CALENDARIO_ID)) return "Solo podés crear eventos en el calendario de CUBO Board";
    if (/attendee|invitad|asistente/i.test(texto)) return "No podés invitar a nadie a un evento";
    const aprobada = cargarAprobada();
    if (!aprobada) return "No hay ninguna acción aprobada pendiente";
    for (const campo of [aprobada.titulo, aprobada.fecha]) {
      if (!texto.includes(campo)) return `El evento no coincide con lo que aprobó el estudiante (falta: ${campo})`;
    }
    return null;
  }

  // Google Drive
  if (tool.startsWith("mcp__claude_ai_Google_Drive__")) {
    const accion = tool.split("__").pop();
    if (["search_files", "get_file_metadata"].includes(accion)) {
      // Lectura solo de la carpeta de CUBO Board, nunca del resto del Drive.
      const texto = JSON.stringify(input);
      if ((CARPETA_DRIVE_ID && texto.includes(CARPETA_DRIVE_ID)) || /CUBO Board/i.test(texto)) return null;
      return "Solo podés buscar dentro de la carpeta de CUBO Board";
    }
    if (accion !== "create_file") return `Acción de Drive no permitida: ${accion}. El agente solo crea archivos.`;
    if (!CARPETA_DRIVE_ID) return "No hay carpeta de Drive de CUBO Board configurada";
    if (!JSON.stringify(input).includes(CARPETA_DRIVE_ID)) return "Solo podés crear archivos dentro de la carpeta de CUBO Board";
    return null;
  }

  return `Herramienta no permitida para este agente: ${tool}`;
}

function cargarAprobada() {
  const archivo = path.join(TRABAJO, "aprobadas", `${ACCION_ID.replace(/[^\w-]/g, "")}.json`);
  if (!ACCION_ID || !existsSync(archivo)) return null;
  try { return JSON.parse(readFileSync(archivo, "utf8")); } catch { return null; }
}

const motivo = decidir();
mkdirSync(path.join(RAIZ, "logs"), { recursive: true });
appendFileSync(path.join(RAIZ, "logs", "acciones.jsonl"), JSON.stringify({
  hora: new Date().toISOString(), sesion, modo: MODO, tool,
  input: JSON.stringify(input).slice(0, 400),
  decision: motivo ? "bloqueada" : "permitida", motivo,
}) + "\n");

if (motivo) {
  process.stderr.write(`Bloqueado por el guardia de CUBO Board: ${motivo}\n`);
  process.exit(2);
}
