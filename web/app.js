// CUBO Board: el canvas. Sin librerías. El estudiante pone tarjetas; el agente
// agrega las suyas en otro color. Todo lo que viene del servidor se escribe
// como texto, nunca como HTML, para que nada subido pueda ejecutar código.
const $ = (s) => document.querySelector(s);
const api = async (ruta, opciones = {}) => {
  const r = await fetch(ruta, opciones);
  if (r.status === 204) return null;
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Algo falló");
  return d;
};

const estado = { tableroId: null, tarjetas: new Map(), vista: { x: 0, y: 0, z: 1 }, sondeo: null };

// ---------- Tableros ----------
async function cargarTableros() {
  const lista = await api("/api/tableros");
  const ul = $("#listaTableros");
  ul.replaceChildren(...lista.map((t) => {
    const li = document.createElement("li");
    li.textContent = t.nombre;
    const small = document.createElement("small");
    small.textContent = t.tarjetas;
    li.append(small);
    li.classList.toggle("activo", t.id === estado.tableroId);
    li.onclick = () => abrirTablero(t.id);
    return li;
  }));
}

async function abrirTablero(id) {
  estado.tableroId = id;
  const t = await api(`/api/tableros/${id}`);
  $("#tituloTablero").textContent = t.nombre;
  $("#metaTablero").textContent = [t.curso, t.fecha].filter(Boolean).join(" · ");
  $("#capa").replaceChildren();
  estado.tarjetas.clear();
  t.tarjetas.forEach((tj) => pintarTarjeta(tj));
  $("#vacio").hidden = t.tarjetas.length > 0;
  mostrarEstadoAgente(t.agente);
  cargarTableros();
  clearInterval(estado.sondeo);
  estado.sondeo = setInterval(refrescar, 4000);
}

// Cada pocos segundos pregunta si el agente agregó tarjetas nuevas.
async function refrescar() {
  if (!estado.tableroId) return;
  const t = await api(`/api/tableros/${estado.tableroId}`);
  t.tarjetas.forEach((tj) => {
    const existente = estado.tarjetas.get(tj.id);
    if (!existente) pintarTarjeta(tj);
    else if (existente.dataset.estado !== (tj.estado ?? "")) pintarTarjeta(tj, existente);
  });
  $("#vacio").hidden = t.tarjetas.length > 0;
  mostrarEstadoAgente(t.agente);
}

function mostrarEstadoAgente(estadoAgente) {
  const el = $("#estadoAgente");
  const textos = { pendiente: "El agente va a revisar lo nuevo…", trabajando: "El agente está trabajando…" };
  el.hidden = !textos[estadoAgente];
  el.textContent = textos[estadoAgente] ?? "";
}

$("#formTablero").onsubmit = async (e) => {
  e.preventDefault();
  const t = await api("/api/tableros", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: $("#nombreTablero").value, curso: $("#cursoTablero").value, fecha: $("#fechaTablero").value }),
  });
  e.target.reset();
  abrirTablero(t.id);
};

// ---------- Tarjetas ----------
const TITULOS = {
  nota: "Tu nota", archivo: "Tu archivo", resumen: "Resumen", explicacion: "Explicación",
  glosario: "Glosario", tarea: "Tarea", repaso: "Repaso", alerta: "Contenido sospechoso",
  aprobacion: "Espera tu aprobación", conexion: "Conexión con otra clase",
};

function pintarTarjeta(tj, el) {
  if (!el) {
    el = $("#tplTarjeta").content.firstElementChild.cloneNode(true);
    $("#capa").append(el);
    hacerArrastrable(el, tj);
    el.querySelector(".cerrar").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("¿Borrar esta tarjeta?")) return;
      await api(`/api/tableros/${estado.tableroId}/tarjetas/${tj.id}`, { method: "DELETE" });
      el.remove(); estado.tarjetas.delete(tj.id);
    };
  }
  estado.tarjetas.set(tj.id, el);
  el.dataset.origen = tj.origen; el.dataset.tipo = tj.tipo; el.dataset.estado = tj.estado ?? "";
  el.style.left = `${tj.x}px`; el.style.top = `${tj.y}px`;
  el.querySelector(".tarjeta-tipo").textContent = TITULOS[tj.tipo] ?? tj.tipo;

  const cuerpo = el.querySelector(".tarjeta-cuerpo");
  cuerpo.replaceChildren();
  if (tj.tipo === "archivo") {
    if (tj.mime?.startsWith("image/")) {
      const img = new Image(); img.src = `/archivos/${tj.archivo}`; img.alt = tj.nombreOriginal;
      cuerpo.append(img);
    } else {
      const a = document.createElement("a");
      a.className = "archivo"; a.href = `/archivos/${tj.archivo}`; a.target = "_blank"; a.textContent = tj.nombreOriginal;
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
  } else if (Array.isArray(tj.puntos)) {
    if (tj.texto) cuerpo.append(document.createTextNode(tj.texto));
    const ul = document.createElement("ul");
    tj.puntos.forEach((p) => { const li = document.createElement("li"); li.textContent = p; ul.append(li); });
    cuerpo.append(ul);
  } else {
    cuerpo.textContent = tj.texto ?? "";
  }

  const pie = el.querySelector(".tarjeta-pie");
  pie.replaceChildren(); pie.hidden = true;
  if (tj.tipo === "tarea" && tj.fecha) {
    pie.hidden = false; pie.textContent = `Entrega: ${tj.fecha}`;
  }
  if (tj.tipo === "aprobacion") {
    pie.hidden = false;
    if (tj.estado === "aprobada") pie.textContent = "Aprobada ✓";
    else {
      const b = document.createElement("button"); b.className = "btn"; b.type = "button"; b.textContent = "Aprobar";
      b.onclick = async (e) => {
        e.stopPropagation();
        const actualizada = await api(`/api/tableros/${estado.tableroId}/tarjetas/${tj.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aprobada: true }),
        });
        pintarTarjeta(actualizada, el);
      };
      pie.append(b);
    }
  }
  return el;
}

function hacerArrastrable(el, tj) {
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a")) return;
    e.stopPropagation();
    el.setPointerCapture(e.pointerId); el.classList.add("moviendo");
    const inicio = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
    const mover = (ev) => {
      el.style.left = `${inicio.left + (ev.clientX - inicio.x) / estado.vista.z}px`;
      el.style.top = `${inicio.top + (ev.clientY - inicio.y) / estado.vista.z}px`;
    };
    const soltar = async () => {
      el.classList.remove("moviendo");
      el.removeEventListener("pointermove", mover); el.removeEventListener("pointerup", soltar);
      tj.x = el.offsetLeft; tj.y = el.offsetTop;
      await api(`/api/tableros/${estado.tableroId}/tarjetas/${tj.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: tj.x, y: tj.y }),
      });
    };
    el.addEventListener("pointermove", mover); el.addEventListener("pointerup", soltar);
  });
}

// ---------- Lienzo: mover y acercar ----------
const lienzo = $("#lienzo"), capa = $("#capa");
function aplicarVista() {
  const { x, y, z } = estado.vista;
  capa.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
}
lienzo.addEventListener("pointerdown", (e) => {
  if (e.target !== lienzo && e.target !== capa) return;
  lienzo.classList.add("arrastrando");
  const inicio = { x: e.clientX - estado.vista.x, y: e.clientY - estado.vista.y };
  const mover = (ev) => { estado.vista.x = ev.clientX - inicio.x; estado.vista.y = ev.clientY - inicio.y; aplicarVista(); };
  const soltar = () => { lienzo.classList.remove("arrastrando"); window.removeEventListener("pointermove", mover); window.removeEventListener("pointerup", soltar); };
  window.addEventListener("pointermove", mover); window.addEventListener("pointerup", soltar);
});
lienzo.addEventListener("wheel", (e) => {
  e.preventDefault();
  const z = Math.min(2, Math.max(0.4, estado.vista.z * (e.deltaY < 0 ? 1.08 : 0.92)));
  estado.vista.z = z; aplicarVista();
}, { passive: false });

// Dónde colocar una tarjeta nueva: en el centro visible, con un pequeño desorden.
function posicionNueva() {
  const r = lienzo.getBoundingClientRect(), { x, y, z } = estado.vista;
  return { x: Math.round((r.width / 2 - x) / z - 130 + (Math.random() * 120 - 60)), y: Math.round((r.height / 2 - y) / z - 60 + (Math.random() * 120 - 60)) };
}

// ---------- Subir ----------
async function subirArchivos(archivos) {
  if (!estado.tableroId) return alert("Primero creá o elegí un tablero.");
  const fd = new FormData();
  [...archivos].forEach((f) => fd.append("archivos", f));
  try {
    const nuevas = await api(`/api/tableros/${estado.tableroId}/archivos`, { method: "POST", body: fd });
    nuevas.forEach((tj, i) => { const p = posicionNueva(); tj.x = p.x + i * 30; tj.y = p.y + i * 30; pintarTarjeta(tj); });
    $("#vacio").hidden = true; mostrarEstadoAgente("pendiente"); cargarTableros();
  } catch (e) { alert(e.message); }
}
$("#archivos").onchange = (e) => { subirArchivos(e.target.files); e.target.value = ""; };
["dragenter", "dragover"].forEach((ev) => lienzo.addEventListener(ev, (e) => { e.preventDefault(); $("#soltar").hidden = false; }));
["dragleave", "drop"].forEach((ev) => lienzo.addEventListener(ev, (e) => { e.preventDefault(); $("#soltar").hidden = true; }));
lienzo.addEventListener("drop", (e) => subirArchivos(e.dataTransfer.files));

$("#formNota").onsubmit = async (e) => {
  e.preventDefault();
  const texto = $("#textoNota").value.trim();
  if (!texto) return;
  if (!estado.tableroId) return alert("Primero creá o elegí un tablero.");
  const tj = await api(`/api/tableros/${estado.tableroId}/notas`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto, ...posicionNueva() }),
  });
  pintarTarjeta(tj); $("#textoNota").value = ""; $("#vacio").hidden = true; mostrarEstadoAgente("pendiente"); cargarTableros();
};
$("#textoNota").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#formNota").requestSubmit(); }
});

cargarTableros();
