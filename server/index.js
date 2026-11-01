// CUBO Board: servidor local. Sirve el canvas, guarda tableros y archivos,
// y dispara al agente cada vez que el estudiante sube algo.
import express from "express";
import multer from "multer";
import path from "node:path";
import { open, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { crearAlmacen } from "./almacen.js";
import { crearLanzador } from "../agent/lanzador.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATOS = path.join(RAIZ, "data");
const ARCHIVOS = path.join(DATOS, "archivos");
const PUERTO = Number(process.env.PORT) || 8790;
const HOSTS = new Set([`127.0.0.1:${PUERTO}`, `localhost:${PUERTO}`]);

// Solo los tipos que el agente sabe leer. Nada ejecutable.
const TIPOS = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
  "application/pdf": ".pdf", "text/plain": ".txt", "text/markdown": ".md",
  "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};
// Firmas reales de los binarios: el tipo que declara el navegador no se confía.
const FIRMAS = {
  ".png": [[0x89, 0x50, 0x4e, 0x47]], ".jpg": [[0xff, 0xd8, 0xff]],
  ".webp": [[0x52, 0x49, 0x46, 0x46]], ".pdf": [[0x25, 0x50, 0x44, 0x46]], ".xlsx": [[0x50, 0x4b, 0x03, 0x04]],
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

async function firmaValida(ruta) {
  const ext = path.extname(ruta);
  if (!FIRMAS[ext]) return true; // texto plano: no hay firma
  const fh = await open(ruta, "r");
  try {
    const { buffer } = await fh.read(Buffer.alloc(4), 0, 4, 0);
    return FIRMAS[ext].some((firma) => firma.every((b, i) => buffer[i] === b));
  } finally { await fh.close(); }
}

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  next();
});

// La API solo acepta peticiones de la propia página: mismo host, mismo origen
// y un encabezado que un formulario ajeno no puede mandar sin preflight.
app.use("/api", (req, res, next) => {
  if (!HOSTS.has(req.headers.host ?? "")) return res.status(403).json({ error: "Host no permitido" });
  const origen = req.headers.origin;
  if (origen && !HOSTS.has(origen.replace(/^https?:\/\//, ""))) return res.status(403).json({ error: "Origen no permitido" });
  if (req.method !== "GET" && req.headers["x-cubo-board"] !== "1") return res.status(403).json({ error: "Petición no permitida" });
  next();
});

app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(RAIZ, "web")));
app.use("/archivos", express.static(ARCHIVOS, {
  setHeaders: (res, ruta) => {
    if (!/\.(png|jpg|webp)$/.test(ruta)) res.set("Content-Disposition", "attachment");
  },
}));

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

// Borrar un tablero lo decide el estudiante desde el canvas, con confirmación.
app.delete("/api/tableros/:id", async (req, res) => {
  const ok = await almacen.borrarTablero(req.params.id);
  res.status(ok ? 204 : 404).end();
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
    const tablero = await almacen.obtener(req.params.id);
    if (!tablero) {
      await Promise.all((req.files ?? []).map((f) => unlink(f.path).catch(() => {})));
      return res.status(404).json({ error: "Tablero no encontrado" });
    }
    const tarjetas = [];
    for (const [i, f] of (req.files ?? []).entries()) {
      if (!(await firmaValida(f.path))) { await unlink(f.path).catch(() => {}); continue; }
      const x = req.body?.x !== undefined ? Number(req.body.x) + i * 30 : undefined;
      const y = req.body?.y !== undefined ? Number(req.body.y) + i * 30 : undefined;
      tarjetas.push(await almacen.agregarTarjeta(req.params.id, {
        origen: "estudiante", tipo: "archivo", x, y,
        archivo: f.filename, nombreOriginal: f.originalname.slice(0, 120), mime: f.mimetype,
      }));
    }
    if (tarjetas.length === 0) return res.status(400).json({ error: "El contenido del archivo no coincide con su tipo" });
    lanzador.programar(req.params.id);
    res.status(201).json(tarjetas);
  });
});

// Mover una tarjeta, editar el texto de una nota propia, o aprobar una acción.
app.patch("/api/tableros/:id/tarjetas/:tid", async (req, res) => {
  const { x, y, texto, aprobada } = req.body ?? {};
  let tarjeta;
  if (aprobada === true) tarjeta = await lanzador.aprobar(req.params.id, req.params.tid);
  else if (typeof texto === "string") {
    const tablero = await almacen.obtener(req.params.id);
    const actual = tablero?.tarjetas.find((t) => t.id === req.params.tid);
    if (!actual || actual.origen !== "estudiante" || actual.tipo !== "nota") return res.status(400).json({ error: "Solo se editan notas propias" });
    const limpio = texto.trim().slice(0, 5000);
    if (!limpio) return res.status(400).json({ error: "La nota está vacía" });
    // Una nota editada vuelve a ser apunte nuevo para el agente.
    const procesadas = (tablero.procesadas ?? []).filter((id) => id !== actual.id);
    await almacen.actualizarTablero(req.params.id, { procesadas });
    tarjeta = await almacen.actualizarTarjeta(req.params.id, req.params.tid, { texto: limpio });
    lanzador.programar(req.params.id);
  } else tarjeta = await almacen.moverTarjeta(req.params.id, req.params.tid, { x, y });
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
