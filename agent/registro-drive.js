#!/usr/bin/env node
// Hook PostToolUse para Google Drive. Cuando el agente crea una carpeta dentro
// de la carpeta raíz de CUBO Board, este hook anota su id en data/drive/
// (donde el agente NO puede escribir). El guardia solo deja crear archivos
// dentro de la raíz o de carpetas anotadas aquí para el tablero en curso.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entrada = JSON.parse(readFileSync(0, "utf8"));
const { tool_name: tool = "", tool_input: input = {}, tool_response: respuesta = "" } = entrada;
const { TABLERO_ID = "", CARPETA_DRIVE_ID = "", MODO = "" } = process.env;

const extraerId = (r) => {
  const t = typeof r === "string" ? r : JSON.stringify(r);
  return t.match(/"id"\s*:\s*"([-\w]{20,})"/)?.[1] ?? t.match(/folders\/([-\w]{20,})/)?.[1] ?? t.match(/\b([-\w]{25,})\b/)?.[1] ?? null;
};

// Instalación: la carpeta raíz recién creada va a data/drive/raiz.json.
if (MODO === "instalacion" && tool === "mcp__claude_ai_Google_Drive__create_file" && input.title === "CUBO Board" && !input.parentId) {
  const id = extraerId(respuesta);
  if (id) {
    mkdirSync(path.join(RAIZ, "data", "drive"), { recursive: true });
    writeFileSync(path.join(RAIZ, "data", "drive", "raiz.json"), JSON.stringify({ id, creado: new Date().toISOString() }));
  }
}

if (tool === "mcp__claude_ai_Google_Drive__create_file" && TABLERO_ID && input.parentId === CARPETA_DRIVE_ID) {
  const texto = JSON.stringify(input);
  const esCarpeta = /vnd\.google-apps\.folder/.test(texto);
  if (esCarpeta) {
    const id = extraerId(respuesta);
    if (id && id !== CARPETA_DRIVE_ID) {
      const dir = path.join(RAIZ, "data", "drive");
      mkdirSync(dir, { recursive: true });
      const archivo = path.join(dir, "carpetas.json");
      const carpetas = existsSync(archivo) ? JSON.parse(readFileSync(archivo, "utf8")) : {};
      carpetas[TABLERO_ID] = { id, nombre: String(input.title ?? input.name ?? ""), creado: new Date().toISOString() };
      writeFileSync(archivo, JSON.stringify(carpetas, null, 2));
    }
  }
}
