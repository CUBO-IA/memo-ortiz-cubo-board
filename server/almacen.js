// Almacén de tableros: un archivo JSON en disco, sin base de datos.
// Cada tablero es una clase; cada tarjeta es algo que puso el estudiante o el agente.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export function crearAlmacen({ ruta }) {
  const archivo = path.join(ruta, "tableros.json");
  let tableros = null;

  async function cargar() {
    if (tableros) return tableros;
    await mkdir(ruta, { recursive: true });
    try {
      tableros = JSON.parse(await readFile(archivo, "utf8"));
    } catch {
      tableros = [];
    }
    return tableros;
  }

  async function guardar() {
    await writeFile(archivo, JSON.stringify(tableros, null, 2));
  }

  return {
    async listar() {
      const lista = await cargar();
      return lista.map(({ id, nombre, curso, fecha, tarjetas }) => ({
        id, nombre, curso, fecha, tarjetas: tarjetas.length,
      }));
    },

    async obtener(id) {
      const lista = await cargar();
      return lista.find((t) => t.id === id) ?? null;
    },

    async crearTablero({ nombre, curso, fecha }) {
      const lista = await cargar();
      const tablero = {
        id: randomUUID(),
        nombre: String(nombre).trim().slice(0, 120),
        curso: String(curso ?? "").trim().slice(0, 80),
        fecha: fecha || new Date().toISOString().slice(0, 10),
        creado: new Date().toISOString(),
        tarjetas: [],
      };
      lista.push(tablero);
      await guardar();
      return tablero;
    },

    // origen: "estudiante" | "agente". tipo: "nota" | "archivo" | "resumen" | ...
    async agregarTarjeta(tableroId, tarjeta) {
      const tablero = await this.obtener(tableroId);
      if (!tablero) return null;
      const nueva = {
        id: randomUUID(),
        creado: new Date().toISOString(),
        x: 40, y: 40,
        ...tarjeta,
      };
      tablero.tarjetas.push(nueva);
      await guardar();
      return nueva;
    },

    async moverTarjeta(tableroId, tarjetaId, { x, y }) {
      const tablero = await this.obtener(tableroId);
      const tarjeta = tablero?.tarjetas.find((t) => t.id === tarjetaId);
      if (!tarjeta) return null;
      tarjeta.x = Math.round(Number(x)) || 0;
      tarjeta.y = Math.round(Number(y)) || 0;
      await guardar();
      return tarjeta;
    },

    async actualizarTarjeta(tableroId, tarjetaId, cambios) {
      const tablero = await this.obtener(tableroId);
      const tarjeta = tablero?.tarjetas.find((t) => t.id === tarjetaId);
      if (!tarjeta) return null;
      Object.assign(tarjeta, cambios);
      await guardar();
      return tarjeta;
    },

    async actualizarTablero(tableroId, cambios) {
      const tablero = await this.obtener(tableroId);
      if (!tablero) return null;
      Object.assign(tablero, cambios);
      await guardar();
      return tablero;
    },

    async borrarTarjeta(tableroId, tarjetaId) {
      const tablero = await this.obtener(tableroId);
      if (!tablero) return false;
      const antes = tablero.tarjetas.length;
      tablero.tarjetas = tablero.tarjetas.filter((t) => t.id !== tarjetaId);
      await guardar();
      return tablero.tarjetas.length < antes;
    },
  };
}
