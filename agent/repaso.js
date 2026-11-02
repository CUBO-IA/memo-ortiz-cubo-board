// Repaso a mano. El servidor ya lo corre solo una vez al día (server/index.js);
// este script sirve para lanzarlo cuando uno quiera o desde un cron propio.
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
