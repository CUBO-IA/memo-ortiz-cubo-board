// Repaso automático. Lo lanza un cron una vez al día (ver README). Mira qué
// clase viene en el calendario de CUBO Board y qué tareas siguen pendientes,
// y deja una tarjeta de repaso en el tablero más reciente. Nadie le escribe.
//
//   node agent/repaso.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearAlmacen } from "../server/almacen.js";
import { crearLanzador } from "./lanzador.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const almacen = crearAlmacen({ ruta: path.join(RAIZ, "data") });
const lanzador = crearLanzador({ raiz: RAIZ, almacen });

const tableros = await almacen.listar();
if (tableros.length === 0) { console.log("No hay tableros todavía."); process.exit(0); }
const ultimo = tableros.at(-1);
const resultado = await lanzador.repasar(ultimo.id);
console.log(resultado);
