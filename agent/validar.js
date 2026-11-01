// Validación en código de lo que devuelve el agente. El modelo propone;
// esto decide qué entra al tablero. Todo lo que no cumple se descarta y se
// anota el motivo.
const TIPOS = new Set(["resumen", "explicacion", "glosario", "tarea", "conexion", "alerta", "repaso"]);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function validarSalida(salida, { idsValidos, secretos = [] }) {
  const descartes = [];
  if (!salida || typeof salida !== "object" || !Array.isArray(salida.tarjetas)) {
    return { tarjetas: [], razon: "sin salida válida", descartes: ["la salida no es un JSON con tarjetas"] };
  }
  const contieneSecreto = (s) => secretos.some((sec) => s.includes(sec));
  const tarjetas = [];
  for (const [i, t] of salida.tarjetas.entries()) {
    if (!t || !TIPOS.has(t.tipo)) { descartes.push(`tarjeta ${i}: tipo desconocido`); continue; }
    const limpia = { tipo: t.tipo, texto: texto(t.texto, 2000) };
    limpia.fuentes = (Array.isArray(t.fuentes) ? t.fuentes : []).filter((id) => idsValidos.has(id));

    if ((t.tipo === "explicacion" || t.tipo === "repaso") && Array.isArray(t.puntos)) {
      limpia.puntos = t.puntos.map((p) => texto(p, 400)).filter(Boolean).slice(0, 12);
    }
    if (t.tipo === "glosario") {
      limpia.terminos = (Array.isArray(t.terminos) ? t.terminos : [])
        .map((x) => ({ termino: texto(x?.termino, 80), definicion: texto(x?.definicion, 400) }))
        .filter((x) => x.termino && x.definicion).slice(0, 20);
      if (limpia.terminos.length === 0) { descartes.push(`tarjeta ${i}: glosario vacío`); continue; }
    }
    if (t.tipo === "tarea") {
      limpia.fecha = FECHA.test(t.fecha ?? "") ? t.fecha : "";
    }
    if (!limpia.texto && !limpia.terminos?.length) { descartes.push(`tarjeta ${i}: sin texto`); continue; }

    const todo = JSON.stringify(limpia);
    if (contieneSecreto(todo)) { descartes.push(`tarjeta ${i}: contenía un valor de configuración`); continue; }
    if (/<\s*script|javascript:/i.test(todo)) { descartes.push(`tarjeta ${i}: contenía código`); continue; }
    tarjetas.push(limpia);
    if (tarjetas.length >= 8) break;
  }
  return { tarjetas, razon: texto(salida.razon, 500) || "sin razón", descartes };
}
