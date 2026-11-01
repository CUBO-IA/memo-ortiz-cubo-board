// Validación en código de lo que devuelve el agente. El modelo propone;
// esto decide qué entra al tablero. Todo lo que no cumple se descarta o se
// limpia, y se anota el motivo.
const TIPOS = new Set(["resumen", "explicacion", "glosario", "tarea", "conexion", "alerta", "repaso"]);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ENLACE = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;

const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const normalizar = (s) => String(s).toLowerCase().replace(/[\s_-]/g, "");

export function fechaValida(f) {
  if (!FECHA.test(f ?? "")) return false;
  const d = new Date(`${f}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== f) return false;
  const hoy = Date.now();
  return d.getTime() > hoy - 366 * 864e5 && d.getTime() < hoy + 2 * 366 * 864e5;
}

export function validarSalida(salida, { idsValidos, secretos = [] }) {
  const descartes = [];
  if (!salida || typeof salida !== "object" || !Array.isArray(salida.tarjetas)) {
    return { tarjetas: [], razon: "sin salida válida", descartes: ["la salida no es un JSON con tarjetas"] };
  }
  const secretosNorm = secretos.filter((s) => s.length > 6).map(normalizar);
  const contieneSecreto = (s) => { const n = normalizar(s); return secretosNorm.some((sec) => n.includes(sec)); };
  // Enlaces y correos no entran a las tarjetas: es el vector que le queda a un apunte malicioso.
  let enlacesQuitados = 0;
  const sinEnlaces = (s) => s.replace(ENLACE, () => { enlacesQuitados++; return "[enlace quitado]"; });

  const tarjetas = [];
  for (const [i, t] of salida.tarjetas.entries()) {
    if (!t || !TIPOS.has(t.tipo)) { descartes.push(`tarjeta ${i}: tipo desconocido`); continue; }
    const limpia = { tipo: t.tipo, texto: sinEnlaces(texto(t.texto, 2000)) };
    limpia.fuentes = (Array.isArray(t.fuentes) ? t.fuentes : []).filter((id) => idsValidos.has(id));

    if ((t.tipo === "explicacion" || t.tipo === "repaso") && Array.isArray(t.puntos)) {
      limpia.puntos = t.puntos.map((p) => sinEnlaces(texto(p, 400))).filter(Boolean).slice(0, 12);
    }
    if (t.tipo === "glosario") {
      limpia.terminos = (Array.isArray(t.terminos) ? t.terminos : [])
        .map((x) => ({ termino: sinEnlaces(texto(x?.termino, 80)), definicion: sinEnlaces(texto(x?.definicion, 400)) }))
        .filter((x) => x.termino && x.definicion).slice(0, 20);
      if (limpia.terminos.length === 0) { descartes.push(`tarjeta ${i}: glosario vacío`); continue; }
    }
    if (t.tipo === "tarea") {
      limpia.fecha = fechaValida(t.fecha) ? t.fecha : "";
      if (t.fecha && !limpia.fecha) descartes.push(`tarjeta ${i}: fecha inválida (${String(t.fecha).slice(0, 20)}), se dejó vacía`);
    }
    if (!limpia.texto && !limpia.terminos?.length) { descartes.push(`tarjeta ${i}: sin texto`); continue; }

    const todo = JSON.stringify(limpia);
    if (contieneSecreto(todo)) { descartes.push(`tarjeta ${i}: contenía un valor de configuración`); continue; }
    if (/<\s*script|javascript:|data:text\/html/i.test(todo)) { descartes.push(`tarjeta ${i}: contenía código`); continue; }
    tarjetas.push(limpia);
    if (tarjetas.length >= 8) break;
  }
  if (enlacesQuitados) descartes.push(`${enlacesQuitados} enlace(s) o correo(s) quitados del texto`);

  let razon = sinEnlaces(texto(salida.razon, 500)) || "sin razón";
  if (contieneSecreto(razon)) razon = "[la razón contenía un valor de configuración y se descartó]";
  return { tarjetas, razon, descartes };
}
