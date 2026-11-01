// Lanzador del agente. Por ahora solo registra el evento; en la fase 3 va a
// ejecutar `claude -p` con la skill y las tools permitidas.
export function crearLanzador({ raiz, almacen }) {
  const estados = new Map(); // tableroId -> "pendiente" | "trabajando" | "listo"
  const temporizadores = new Map();

  return {
    estado(tableroId) {
      return estados.get(tableroId) ?? "listo";
    },

    // Espera unos segundos por si el estudiante sube varias cosas seguidas,
    // y después lanza al agente una sola vez.
    programar(tableroId) {
      estados.set(tableroId, "pendiente");
      clearTimeout(temporizadores.get(tableroId));
      temporizadores.set(tableroId, setTimeout(() => this.ejecutar(tableroId), 8000));
    },

    async ejecutar(tableroId) {
      estados.set(tableroId, "trabajando");
      console.log(`[agente] tablero ${tableroId}: todavía no implementado (fase 3)`);
      estados.set(tableroId, "listo");
    },

    async aprobar(tableroId, tarjetaId) {
      return almacen.actualizarTarjeta(tableroId, tarjetaId, { estado: "aprobada" });
    },
  };
}
