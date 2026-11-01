// CUBO Board: servidor local. Sirve el canvas, guarda tableros y archivos,
// y dispara al agente cada vez que el estudiante sube algo.
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crearAlmacen } from "./almacen.js";
import { crearLanzador } from "../agent/lanzador.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATOS = path.join(RAIZ, "data");
const ARCHIVOS = path.join(DATOS, "archivos");
const PUERTO = Number(process.env.PORT) || 8790;

// Solo los tipos que el agente sabe leer. Nada ejecutable.
const TIPOS = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
  "application/pdf": ".pdf", "text/plain": ".txt", "text/markdown": ".md",
  "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

const almacen = crearAlmacen({ ruta: DATOS });
const lanzador = crearLanzador({ raiz: RAIZ, almacen });

const subir = multer({
  storage: multer.diskStorage({
    destination: ARCHIVOS,
    // Nombre seguro: nunca el que manda el navegador.
    filename: (_req, f, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${TIPOS[f.mimetype]}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, f, cb) => cb(TIPOS[f.mimetype] ? null : new Error("Tipo de archivo no permitido"), !!TIPOS[f.mimetype]),
});

const app = express();
app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(RAIZ, "web")));
app.use("/archivos", express.static(ARCHIVOS));

app.get("/api/tableros", async (_req, res) => res.json(await almacen.listar()));

app.post("/api/tableros", async (req, res) => {
  const { nombre, curso, fecha } = req.body ?? {};
  if (!nombre?.trim()) return res.status(400).json({ error: "El tablero necesita un nombre" });
  res.status(201).json(await almacen.crearTablero({ nombre, curso, fecha }));
});

app.get("/api/tableros/:id", async (req, res) => {
  const tablero = await almacen.obtener(req.params.id);
  if (!tablero) return res.status(404).json({ error: "Tablero no encontrado" });
  res.json({ ...tablero, agente: lanzador.estado(req.params.id) });
});

// Una nota escrita por el estudiante. Es un evento: dispara al agente.
app.post("/api/tableros/:id/notas", async (req, res) => {
  const texto = String(req.body?.texto ?? "").trim().slice(0, 5000);
  if (!texto) return res.status(400).json({ error: "La nota está vacía" });
  const tarjeta = await almacen.agregarTarjeta(req.params.id, {
    origen: "estudiante", tipo: "nota", texto, x: req.body.x, y: req.body.y,
  });
  if (!tarjeta) return res.status(404).json({ error: "Tablero no encontrado" });
  lanzador.programar(req.params.id);
  res.status(201).json(tarjeta);
});

// Archivos subidos (fotos, PDF, Excel, texto). También disparan al agente.
app.post("/api/tableros/:id/archivos", (req, res) => {
  subir.array("archivos")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const tarjetas = [];
    for (const f of req.files ?? []) {
      tarjetas.push(await almacen.agregarTarjeta(req.params.id, {
        origen: "estudiante", tipo: "archivo",
        archivo: f.filename, nombreOriginal: f.originalname.slice(0, 120), mime: f.mimetype,
      }));
    }
    if (tarjetas.some((t) => !t)) return res.status(404).json({ error: "Tablero no encontrado" });
    lanzador.programar(req.params.id);
    res.status(201).json(tarjetas);
  });
});

app.patch("/api/tableros/:id/tarjetas/:tid", async (req, res) => {
  const { x, y, aprobada } = req.body ?? {};
  let tarjeta;
  if (aprobada === true) tarjeta = await lanzador.aprobar(req.params.id, req.params.tid);
  else tarjeta = await almacen.moverTarjeta(req.params.id, req.params.tid, { x, y });
  if (!tarjeta) return res.status(404).json({ error: "Tarjeta no encontrada" });
  res.json(tarjeta);
});

// Borrar lo decide siempre el estudiante desde el canvas, nunca el agente.
app.delete("/api/tableros/:id/tarjetas/:tid", async (req, res) => {
  const ok = await almacen.borrarTarjeta(req.params.id, req.params.tid);
  res.status(ok ? 204 : 404).end();
});

app.listen(PUERTO, "127.0.0.1", () => {
  console.log(`CUBO Board en http://127.0.0.1:${PUERTO}`);
});
