// CUBO Board: el canvas. Sin librerías. Todo lo que viene del servidor se
// escribe como texto, nunca como HTML, para que nada subido pueda ejecutar
// código.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = async (ruta, opciones = {}) => {
  const r = await fetch(ruta, { ...opciones, headers: { "X-CUBO-Board": "1", ...(opciones.headers ?? {}) } });
  if (r.status === 204) return null;
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Algo falló");
  return d;
};
const json = (cuerpo) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });

const estado = {
  tableroId: null, tarjetas: new Map(), datos: new Map(), vista: { x: 0, y: 0, z: 1 },
  herramienta: "seleccionar", sondeo: null, agente: "listo", archivosPendientes: null, filtro: "",
};
const lienzo = $("#lienzo"), capa = $("#capa"), contTarjetas = $("#tarjetas"), conectores = $("#conectores");

// ---------- Tableros ----------
async function cargarTableros() {
  const lista = await api("/api/tableros");
  $("#listaTableros").replaceChildren(...lista.map((t) => {
    const li = document.createElement("li");
    const nombre = document.createElement("span"); nombre.textContent = t.nombre;
    const small = document.createElement("small"); small.textContent = t.tarjetas;
    li.append(nombre, small);
    li.classList.toggle("activo", t.id === estado.tableroId);
    li.onclick = () => { abrirTablero(t.id); $("#panelTableros").hidden = true; };
    return li;
  }));
  return lista;
}

async function abrirTablero(id) {
  estado.tableroId = id;
  const t = await api(`/api/tableros/${id}`);
  $("#tituloTablero").textContent = t.nombre;
  $("#metaTablero").textContent = [t.curso, t.fecha].filter(Boolean).join(" · ");
  contTarjetas.replaceChildren(); estado.tarjetas.clear(); estado.datos.clear();
  t.tarjetas.forEach((tj) => pintarTarjeta(tj));
  $("#vacio").hidden = true;
  estado.vista = { x: 0, y: 0, z: 1 }; aplicarVista(); ajustarVista();
  mostrarEstadoAgente(t.agente);
  cargarTableros();
  clearInterval(estado.sondeo);
  estado.sondeo = setInterval(refrescar, 4000);
  try { localStorage.setItem("cubo-board:ultimo", id); } catch { /* sin almacenamiento */ }
}

async function refrescar() {
  if (!estado.tableroId) return;
  let t;
  try { t = await api(`/api/tableros/${estado.tableroId}`); } catch { return; }
  const ids = new Set(t.tarjetas.map((tj) => tj.id));
  for (const [id, el] of estado.tarjetas) if (!ids.has(id)) { el.remove(); estado.tarjetas.delete(id); estado.datos.delete(id); }
  t.tarjetas.forEach((tj) => {
    const existente = estado.tarjetas.get(tj.id);
    if (!existente) pintarTarjeta(tj);
    else if (existente.dataset.estado !== (tj.estado ?? "")) pintarTarjeta(tj, existente);
  });
  mostrarEstadoAgente(t.agente);
  dibujarConectores(); dibujarMinimapa();
}

function mostrarEstadoAgente(agente) {
  estado.agente = agente;
  const el = $("#estadoAgente");
  const textos = { pendiente: "Esperando lo que sigas subiendo…", trabajando: "Leyendo tus apuntes…" };
  if (!textos[agente]) { el.hidden = true; return; }
  // Debajo de la última tarjeta que subió el estudiante.
  const propias = [...estado.datos.values()].filter((d) => d.origen === "estudiante");
  if (propias.length === 0) { el.hidden = true; return; }
  const ultima = propias.reduce((a, b) => (a.creado > b.creado ? a : b));
  const elUltima = estado.tarjetas.get(ultima.id);
  el.hidden = false;
  el.querySelector("span").textContent = textos[agente];
  el.style.left = `${ultima.x}px`; el.style.top = `${ultima.y + (elUltima?.offsetHeight ?? 100) + 10}px`;
}

// ---------- Tarjetas ----------
const TITULOS = {
  nota: "nota", archivo: "archivo", resumen: "resumen", explicacion: "explicación", glosario: "glosario",
  tarea: "tarea", repaso: "repaso", alerta: "contenido sospechoso", aprobacion: "espera tu aprobación", conexion: "conexión",
};

function pintarTarjeta(tj, el) {
  if (!el) {
    el = $("#tplTarjeta").content.firstElementChild.cloneNode(true);
    contTarjetas.append(el);
    hacerArrastrable(el, tj);
    el.querySelector(".cerrar").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("¿Borrar esta tarjeta?")) return;
      await api(`/api/tableros/${estado.tableroId}/tarjetas/${tj.id}`, { method: "DELETE" });
      el.remove(); estado.tarjetas.delete(tj.id); estado.datos.delete(tj.id);
      dibujarConectores(); dibujarMinimapa();
    };
    el.addEventListener("mouseenter", () => resaltarConectores(tj.id, true));
    el.addEventListener("mouseleave", () => resaltarConectores(tj.id, false));
    if (tj.origen === "estudiante" && tj.tipo === "nota") el.addEventListener("dblclick", () => editarNota(el, tj));
  }
  estado.tarjetas.set(tj.id, el); estado.datos.set(tj.id, tj);
  el.dataset.id = tj.id; el.dataset.origen = tj.origen; el.dataset.tipo = tj.tipo; el.dataset.estado = tj.estado ?? "";
  el.style.left = `${tj.x}px`; el.style.top = `${tj.y}px`;
  el.querySelector(".tarjeta-tipo").textContent = TITULOS[tj.tipo] ?? tj.tipo;

  const cuerpo = el.querySelector(".tarjeta-cuerpo");
  cuerpo.replaceChildren(); cuerpo.removeAttribute("contenteditable");
  if (tj.tipo === "archivo") {
    if (tj.mime?.startsWith("image/")) {
      const img = new Image(); img.src = `/archivos/${tj.archivo}`; img.alt = tj.nombreOriginal; img.onload = () => { dibujarConectores(); mostrarEstadoAgente(estado.agente); };
      cuerpo.append(img);
    } else {
      const a = document.createElement("a");
      a.className = "archivo"; a.href = `/archivos/${tj.archivo}`; a.target = "_blank"; a.rel = "noopener"; a.textContent = tj.nombreOriginal;
      cuerpo.append(a);
    }
  } else if (tj.tipo === "glosario" && Array.isArray(tj.terminos)) {
    const dl = document.createElement("dl");
    tj.terminos.forEach(({ termino, definicion }) => {
      const dt = document.createElement("dt"); dt.textContent = termino;
      const dd = document.createElement("dd"); dd.textContent = definicion;
      dl.append(dt, dd);
    });
    cuerpo.append(dl);
  } else if (Array.isArray(tj.puntos) && tj.puntos.length) {
    if (tj.texto) cuerpo.append(document.createTextNode(tj.texto));
    const ul = document.createElement("ul");
    tj.puntos.forEach((p) => { const li = document.createElement("li"); li.textContent = p; ul.append(li); });
    cuerpo.append(ul);
  } else {
    cuerpo.textContent = tj.texto ?? "";
  }

  const pie = el.querySelector(".tarjeta-pie");
  pie.replaceChildren(); pie.hidden = true;
  if (tj.tipo === "tarea" && tj.fecha) { pie.hidden = false; pie.textContent = `entrega ${tj.fecha}`; }
  if (tj.tipo === "aprobacion") {
    pie.hidden = false;
    const estados = { ejecutando: "agendando…", agendada: "agendada en tu calendario", fallo: "no se pudo agendar" };
    if (estados[tj.estado]) pie.textContent = estados[tj.estado];
    else {
      const b = document.createElement("button"); b.type = "button"; b.textContent = "Aprobar";
      b.onclick = async (e) => {
        e.stopPropagation();
        const actualizada = await api(`/api/tableros/${estado.tableroId}/tarjetas/${tj.id}`, { method: "PATCH", ...json({ aprobada: true }) });
        pintarTarjeta(actualizada, el);
      };
      pie.append(b);
    }
  }
  aplicarFiltro(el, tj);
  dibujarConectores(); dibujarMinimapa();
  return el;
}

// Nota nueva: una tarjeta vacía donde se escribe directo en el lienzo.
function crearNotaEn(x, y) {
  if (!estado.tableroId) return;
  const el = $("#tplTarjeta").content.firstElementChild.cloneNode(true);
  el.dataset.origen = "estudiante"; el.dataset.tipo = "nota"; el.classList.add("editando");
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  el.querySelector(".tarjeta-tipo").textContent = "nota";
  el.querySelector(".cerrar").onclick = () => el.remove();
  const cuerpo = el.querySelector(".tarjeta-cuerpo");
  cuerpo.contentEditable = "plaintext-only";
  cuerpo.addEventListener("keydown", (e) => { if (e.key === "Escape") cuerpo.blur(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) cuerpo.blur(); });
  cuerpo.addEventListener("blur", async () => {
    const texto = cuerpo.textContent.trim();
    el.remove();
    if (!texto) return;
    const tj = await api(`/api/tableros/${estado.tableroId}/notas`, { method: "POST", ...json({ texto, x, y }) });
    pintarTarjeta(tj); mostrarEstadoAgente("pendiente"); cargarTableros();
  });
  contTarjetas.append(el);
  cuerpo.focus();
  elegirHerramienta("seleccionar");
}

function editarNota(el, tj) {
  const cuerpo = el.querySelector(".tarjeta-cuerpo");
  if (cuerpo.isContentEditable) return;
  el.classList.add("editando"); cuerpo.contentEditable = "plaintext-only"; cuerpo.focus();
  const terminar = async () => {
    cuerpo.removeAttribute("contenteditable"); el.classList.remove("editando");
    const texto = cuerpo.textContent.trim();
    if (!texto || texto === tj.texto) { cuerpo.textContent = tj.texto; return; }
    const actualizada = await api(`/api/tableros/${estado.tableroId}/tarjetas/${tj.id}`, { method: "PATCH", ...json({ texto }) });
    pintarTarjeta(actualizada, el); mostrarEstadoAgente("pendiente");
  };
  cuerpo.addEventListener("blur", terminar, { once: true });
  cuerpo.addEventListener("keydown", (e) => { if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) cuerpo.blur(); });
}

function hacerArrastrable(el, tj) {
  el.addEventListener("pointerdown", (e) => {
    if (estado.herramienta !== "seleccionar" || e.button !== 0) return;
    if (e.target.closest("button, a, [contenteditable]")) return;
    e.stopPropagation();
    el.setPointerCapture(e.pointerId); el.classList.add("moviendo");
    const inicio = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
    let movio = false;
    const mover = (ev) => {
      movio = true;
      el.style.left = `${inicio.left + (ev.clientX - inicio.x) / estado.vista.z}px`;
      el.style.top = `${inicio.top + (ev.clientY - inicio.y) / estado.vista.z}px`;
      tj.x = el.offsetLeft; tj.y = el.offsetTop;
      dibujarConectores(); if (estado.agente !== "listo") mostrarEstadoAgente(estado.agente);
    };
    const soltar = async () => {
      el.classList.remove("moviendo");
      el.removeEventListener("pointermove", mover); el.removeEventListener("pointerup", soltar);
      dibujarMinimapa();
      if (movio) await api(`/api/tableros/${estado.tableroId}/tarjetas/${tj.id}`, { method: "PATCH", ...json({ x: tj.x, y: tj.y }) });
    };
    el.addEventListener("pointermove", mover); el.addEventListener("pointerup", soltar);
  });
}

// ---------- Conectores: de cada apunte a las tarjetas que salieron de él ----------
function dibujarConectores() {
  const paths = [];
  for (const tj of estado.datos.values()) {
    if (tj.origen !== "agente" || !Array.isArray(tj.fuentes)) continue;
    const destino = estado.tarjetas.get(tj.id);
    if (!destino) continue;
    for (const fid of tj.fuentes) {
      const origen = estado.tarjetas.get(fid);
      if (!origen) continue;
      const x1 = origen.offsetLeft + origen.offsetWidth, y1 = origen.offsetTop + Math.min(40, origen.offsetHeight / 2);
      const x2 = destino.offsetLeft, y2 = destino.offsetTop + 24;
      const dx = Math.max(40, (x2 - x1) / 2);
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
      p.dataset.de = fid; p.dataset.a = tj.id;
      paths.push(p);
    }
  }
  conectores.replaceChildren(...paths);
}
function resaltarConectores(id, activo) {
  $$("#conectores path").forEach((p) => { if (p.dataset.de === id || p.dataset.a === id) p.classList.toggle("activo", activo); });
}

// ---------- Vista: mover, acercar, ajustar, minimapa ----------
function aplicarVista() {
  const { x, y, z } = estado.vista;
  capa.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  $("#zoomValor").textContent = `${Math.round(z * 100)}%`;
  dibujarMinimapa();
}
function limites() {
  const els = [...estado.tarjetas.values()];
  if (els.length === 0) return null;
  const xs = els.map((e) => e.offsetLeft), ys = els.map((e) => e.offsetTop);
  const xe = els.map((e) => e.offsetLeft + e.offsetWidth), ye = els.map((e) => e.offsetTop + e.offsetHeight);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xe) - Math.min(...xs), h: Math.max(...ye) - Math.min(...ys) };
}
function ajustarVista() {
  const l = limites(); if (!l) return;
  const r = lienzo.getBoundingClientRect();
  const z = Math.min(1.2, Math.max(0.2, Math.min((r.width - 200) / l.w, (r.height - 160) / l.h)));
  estado.vista = { z, x: (r.width - l.w * z) / 2 - l.x * z + 40, y: (r.height - l.h * z) / 2 - l.y * z };
  aplicarVista();
}
function acercar(factor, cx, cy) {
  const r = lienzo.getBoundingClientRect();
  cx ??= r.width / 2; cy ??= r.height / 2;
  const z = Math.min(2.5, Math.max(0.15, estado.vista.z * factor));
  estado.vista.x = cx - (cx - estado.vista.x) * (z / estado.vista.z);
  estado.vista.y = cy - (cy - estado.vista.y) * (z / estado.vista.z);
  estado.vista.z = z; aplicarVista();
}
function dibujarMinimapa() {
  const c = $("#minimapa"), ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const l = limites(); if (!l) return;
  const r = lienzo.getBoundingClientRect();
  const vx = -estado.vista.x / estado.vista.z, vy = -estado.vista.y / estado.vista.z, vw = r.width / estado.vista.z, vh = r.height / estado.vista.z;
  const todo = { x: Math.min(l.x, vx), y: Math.min(l.y, vy), w: Math.max(l.x + l.w, vx + vw) - Math.min(l.x, vx), h: Math.max(l.y + l.h, vy + vh) - Math.min(l.y, vy) };
  const s = Math.min((c.width - 16) / todo.w, (c.height - 16) / todo.h);
  const ox = 8 + ((c.width - 16) - todo.w * s) / 2, oy = 8 + ((c.height - 16) - todo.h * s) / 2;
  for (const [id, el] of estado.tarjetas) {
    ctx.fillStyle = estado.datos.get(id)?.origen === "agente" ? "#4a4a4a" : "#777";
    ctx.fillRect(ox + (el.offsetLeft - todo.x) * s, oy + (el.offsetTop - todo.y) * s, Math.max(2, el.offsetWidth * s), Math.max(2, el.offsetHeight * s));
  }
  ctx.strokeStyle = "#555"; ctx.strokeRect(ox + (vx - todo.x) * s, oy + (vy - todo.y) * s, vw * s, vh * s);
  c.dataset.mapa = JSON.stringify({ s, ox, oy, tx: todo.x, ty: todo.y });
}
$("#minimapa").onclick = (e) => {
  const c = $("#minimapa"), m = JSON.parse(c.dataset.mapa ?? "null"); if (!m) return;
  const rc = c.getBoundingClientRect(), r = lienzo.getBoundingClientRect();
  const mx = (e.clientX - rc.left) * (c.width / rc.width), my = (e.clientY - rc.top) * (c.height / rc.height);
  const px = (mx - m.ox) / m.s + m.tx, py = (my - m.oy) / m.s + m.ty;
  estado.vista.x = r.width / 2 - px * estado.vista.z; estado.vista.y = r.height / 2 - py * estado.vista.z; aplicarVista();
};

lienzo.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const sobreTarjeta = e.target.closest(".tarjeta");
  if (estado.herramienta === "nota" && !sobreTarjeta) {
    const { x, y } = aLienzo(e.clientX, e.clientY); crearNotaEn(Math.round(x), Math.round(y)); return;
  }
  if (sobreTarjeta && estado.herramienta !== "mano") return;
  lienzo.classList.add("arrastrando");
  const inicio = { x: e.clientX - estado.vista.x, y: e.clientY - estado.vista.y };
  const mover = (ev) => { estado.vista.x = ev.clientX - inicio.x; estado.vista.y = ev.clientY - inicio.y; aplicarVista(); };
  const soltar = () => { lienzo.classList.remove("arrastrando"); window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
  window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar);
});
lienzo.addEventListener("dblclick", (e) => {
  if (e.target.closest(".tarjeta") || !estado.tableroId) return;
  const { x, y } = aLienzo(e.clientX, e.clientY); crearNotaEn(Math.round(x), Math.round(y));
});
lienzo.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { acercar(e.deltaY < 0 ? 1.08 : 0.92, e.clientX, e.clientY); return; }
  estado.vista.x -= e.deltaX; estado.vista.y -= e.deltaY; aplicarVista();
}, { passive: false });
function aLienzo(cx, cy) {
  const r = lienzo.getBoundingClientRect();
  return { x: (cx - r.left - estado.vista.x) / estado.vista.z, y: (cy - r.top - estado.vista.y) / estado.vista.z };
}
function centroLienzo() {
  const r = lienzo.getBoundingClientRect();
  const { x, y } = aLienzo(r.left + r.width / 2, r.top + r.height / 2);
  return { x: Math.round(x - 140 + (Math.random() * 80 - 40)), y: Math.round(y - 60 + (Math.random() * 80 - 40)) };
}
$("#zoomMas").onclick = () => acercar(1.2);
$("#zoomMenos").onclick = () => acercar(1 / 1.2);
$("#zoomAjustar").onclick = ajustarVista;
window.addEventListener("resize", dibujarMinimapa);

// ---------- Herramientas ----------
function elegirHerramienta(h) {
  estado.herramienta = h; lienzo.dataset.herramienta = h;
  $$(".herramientas [data-herramienta]").forEach((b) => b.classList.toggle("activa", b.dataset.herramienta === h));
}
$$(".herramientas [data-herramienta]").forEach((b) => (b.onclick = () => elegirHerramienta(b.dataset.herramienta)));
$$(".herramientas [data-accion]").forEach((b) => (b.onclick = () => acciones[b.dataset.accion]()));
const acciones = {
  subir: () => (estado.tableroId ? $("#archivos").click() : abrirPanel()),
  tableros: () => ($("#panelTableros").hidden ? abrirPanel() : ($("#panelTableros").hidden = true)),
  buscar: () => { const b = $("#buscador"); b.hidden = !b.hidden; if (!b.hidden) $("#textoBuscar").focus(); else { estado.filtro = ""; $("#textoBuscar").value = ""; aplicarFiltroATodas(); } },
  borrar: async () => {
    if (!estado.tableroId) return;
    if (!confirm(`¿Borrar el tablero "${$("#tituloTablero").textContent}" con todas sus tarjetas? No se puede deshacer.`)) return;
    await api(`/api/tableros/${estado.tableroId}`, { method: "DELETE" });
    estado.tableroId = null; clearInterval(estado.sondeo);
    contTarjetas.replaceChildren(); estado.tarjetas.clear(); estado.datos.clear(); dibujarConectores(); dibujarMinimapa();
    $("#tituloTablero").textContent = "CUBO Board"; $("#metaTablero").textContent = ""; $("#vacio").hidden = false; mostrarEstadoAgente("listo");
    cargarTableros();
  },
};
function abrirPanel() { $("#panelTableros").hidden = false; cargarTableros(); $("#nombreTablero").focus(); }
$("#abrirTableros").onclick = acciones.tableros;
$("#cerrarTableros").onclick = () => ($("#panelTableros").hidden = true);
$("#formTablero").onsubmit = async (e) => {
  e.preventDefault();
  const t = await api("/api/tableros", { method: "POST", ...json({ nombre: $("#nombreTablero").value, curso: $("#cursoTablero").value }) });
  e.target.reset(); $("#panelTableros").hidden = true; abrirTablero(t.id);
};
window.addEventListener("keydown", (e) => {
  if (e.target.closest("input, [contenteditable], dialog")) return;
  const k = e.key.toLowerCase();
  if (k === "v") elegirHerramienta("seleccionar");
  if (k === "h") elegirHerramienta("mano");
  if (k === "n") elegirHerramienta("nota");
  if (k === "u") acciones.subir();
  if (k === "f") { e.preventDefault(); acciones.buscar(); }
  if (k === "escape") { $("#panelTableros").hidden = true; if (!$("#buscador").hidden) acciones.buscar(); elegirHerramienta("seleccionar"); }
});

// ---------- Buscar ----------
function aplicarFiltro(el, tj) {
  const f = estado.filtro.trim().toLowerCase();
  el.classList.toggle("apagada", !!f && !JSON.stringify(tj).toLowerCase().includes(f));
}
function aplicarFiltroATodas() { for (const [id, el] of estado.tarjetas) aplicarFiltro(el, estado.datos.get(id)); }
$("#textoBuscar").oninput = (e) => { estado.filtro = e.target.value; aplicarFiltroATodas(); };

// ---------- Subir ----------
async function subirArchivos(archivos, posicion) {
  if (!archivos?.length) return;
  if (!estado.tableroId) { estado.archivosPendientes = [...archivos]; $("#dialogoPrimero").showModal(); $("#primeroNombre").focus(); return; }
  const fd = new FormData();
  const p = posicion ?? centroLienzo();
  fd.append("x", p.x); fd.append("y", p.y);
  [...archivos].forEach((f) => fd.append("archivos", f));
  try {
    const nuevas = await api(`/api/tableros/${estado.tableroId}/archivos`, { method: "POST", body: fd });
    nuevas.forEach((tj) => pintarTarjeta(tj));
    $("#vacio").hidden = true; mostrarEstadoAgente("pendiente"); cargarTableros();
  } catch (e) { alert(e.message); }
}
$("#archivos").onchange = (e) => { subirArchivos(e.target.files); e.target.value = ""; };
["dragenter", "dragover"].forEach((ev) => lienzo.addEventListener(ev, (e) => { e.preventDefault(); $("#soltar").hidden = false; }));
["dragleave", "drop"].forEach((ev) => lienzo.addEventListener(ev, (e) => { e.preventDefault(); $("#soltar").hidden = true; }));
lienzo.addEventListener("drop", (e) => {
  const { x, y } = aLienzo(e.clientX, e.clientY);
  subirArchivos(e.dataTransfer.files, estado.tableroId ? { x: Math.round(x), y: Math.round(y) } : null);
});

// Primer tablero: se crea al soltar los primeros apuntes.
$("#formPrimero").onsubmit = async (e) => {
  e.preventDefault();
  const t = await api("/api/tableros", { method: "POST", ...json({ nombre: $("#primeroNombre").value, curso: $("#primeroCurso").value }) });
  $("#dialogoPrimero").close(); e.target.reset();
  await abrirTablero(t.id);
  const pendientes = estado.archivosPendientes; estado.archivosPendientes = null;
  await subirArchivos(pendientes, { x: 40, y: 40 });
  ajustarVista();
};
$("#primeroCancelar").onclick = () => { estado.archivosPendientes = null; $("#dialogoPrimero").close(); };

// ---------- Arranque ----------
(async () => {
  const lista = await cargarTableros();
  let ultimo = null;
  try { ultimo = localStorage.getItem("cubo-board:ultimo"); } catch { /* sin almacenamiento */ }
  if (ultimo && lista.some((t) => t.id === ultimo)) abrirTablero(ultimo);
  else if (lista.length) abrirTablero(lista.at(-1).id);
})();
