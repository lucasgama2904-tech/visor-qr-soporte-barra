// Visor QR de piezas — Soporte de Barra Tipo T
// INGEPRO S.A. — SE Acaray
//
// Un solo modelo cargado una vez. Se puede llegar a un código por el
// parámetro ?p= de la URL (al escanear un QR) o eligiéndolo del menú de
// piezas, sin necesidad de volver a escanear.

import * as THREE from "three";
import CameraControls from "camera-controls";
import * as FRAGS from "@thatopen/fragments";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

// ---------------------------------------------------------------------------
// Identidad visual (ver BRIEF_Visor_QR_SoporteBarra.md §5)
// ---------------------------------------------------------------------------
const COLOR_RESALTADO = 0x0d3b65; // Azul Ingepro
const COLOR_RESTO = 0x4a4a4a; // Gris
const OPACIDAD_RESTO = 0.25;

const MODEL_ID = "torre";
const FRAG_URL = "./modelo.frag";
const MAPEO_URL = "./mapeo_QR.json";
const FAMILIAS_URL = "./familias.json";
const WORKER_URL = "./fragments-worker.mjs";

// Cada cuánto (ms) se recalcula oclusión/solapamiento de etiquetas. No se
// recalcula si la cámara no se movió desde la última vez: en obra, con el
// celular quieto leyendo la torre, esto no debe gastar batería de más.
const INTERVALO_ETIQUETAS_MS = 200;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let model = null;
let fragments = null;
let camera, controls, scene, renderer;
let allLocalIds = [];
let highlightLocalIds = [];
let otherLocalIds = [];
let isolatedView = false; // false = torre completa con pieza resaltada
let mapeoCache = null;

// --- Familias / filtro (Función 1) ---
let familiasData = null; // { familias: [{id, nombre}], piezas: { clave: id } }
let familiasActivas = new Set(); // ids de familia activos en el filtro
let codigoSeleccionado = null; // clave individual seleccionada (prevalece sobre el filtro)
let codigoUrlActual = null; // el código tal cual se pidió (para reflejar ?p= sin ambigüedad)
const localIdsPorClave = new Map(); // caché: clave -> localIds ya resueltos

// --- Modo etiquetas (Función 2) ---
let modoEtiquetas = false;
let labelRenderer = null;
const labelObjects = new Map(); // clave -> { obj: CSS2DObject, anchor: THREE.Vector3 }
let ultimaActualizacionEtiquetas = 0;
const ultimaCamPos = new THREE.Vector3();
const ultimaCamQuat = new THREE.Quaternion();
let primerChequeoEtiquetas = true;

const $ = (sel) => document.querySelector(sel);
const els = {
  canvas: $("#viewer"),
  ficha: $("#ficha"),
  fichaToggle: $("#ficha-toggle"),
  fichaBody: $("#ficha-body"),
  codigo: $("#f-codigo"),
  perfil: $("#f-perfil"),
  medida: $("#f-medida"),
  cantidad: $("#f-cantidad"),
  nota: $("#f-nota"),
  aviso: $("#aviso"),
  isoBtn: $("#iso-toggle"),
  loading: $("#loading"),
  menuToggle: $("#menu-toggle"),
  menuClose: $("#menu-close"),
  menuBackdrop: $("#menu-backdrop"),
  menuPanel: $("#menu-panel"),
  menuList: $("#menu-list"),
  familiaChips: $("#familia-chips"),
  familiaLimpiar: $("#familia-limpiar"),
  labelsToggle: $("#labels-toggle"),
};

// ---------------------------------------------------------------------------
// Escena three.js
// ---------------------------------------------------------------------------
function initScene() {
  scene = new THREE.Scene();
  scene.background = null;

  // El modelo está en metros (la torre completa mide ~8.5 m de alto), no en
  // milímetros. near/far calibrados a esa escala real: un rango near..far
  // demasiado amplio para el tamaño del modelo degrada la precisión del
  // depth buffer y causa z-fighting (parpadeo/mezcla de color en piezas que
  // se tocan), mucho más visible en GPUs de celular.
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.01,
    1000,
  );
  camera.position.set(5, 5, 5);

  renderer = new THREE.WebGLRenderer({
    canvas: els.canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1.6);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(1, 2, 1);
  scene.add(dir);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.6);
  dir2.position.set(-1, -0.5, -1);
  scene.add(dir2);

  CameraControls.install({ THREE });
  controls = new CameraControls(camera, renderer.domElement);
  // Un dedo gira. Dos dedos hacen zoom + desplazan. (defaults, explícitos igual)
  controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
  controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK;
  controls.dollyToCursor = false;
  // En metros: 5 cm mínimo (para poder inspeccionar el detalle de una pieza
  // chica de cerca) y 500 m máximo (de sobra para una torre de ~8.5 m).
  controls.minDistance = 0.05;
  controls.maxDistance = 500;

  // Modo etiquetas (Función 2): renderer aparte para las tarjetas HTML
  // ancladas a cada pieza. Se apila sobre el canvas WebGL, sin capturar
  // toque (pointer-events:none vía CSS) para no interferir con girar/zoom.
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.id = "labels-root";
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(labelRenderer.domElement);

  window.addEventListener("resize", onResize);

  let lastTime = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;
    controls.update(delta);
    renderer.render(scene, camera);
    if (modoEtiquetas) {
      actualizarEtiquetasFrame(now);
      labelRenderer.render(scene, camera);
    }
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------
async function initFragments() {
  fragments = new FRAGS.FragmentsModels(WORKER_URL);
  controls.addEventListener("update", () => fragments.update());

  fragments.models.materials.list.onItemSet.add(({ value: material }) => {
    if (!("isLodMaterial" in material && material.isLodMaterial)) {
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
    }
  });

  const res = await fetch(FRAG_URL);
  const buffer = await res.arrayBuffer();
  model = await fragments.load(buffer, { modelId: MODEL_ID });
  model.useCamera(camera);
  scene.add(model.object);

  // Por defecto, Fragments cambia a geometría LOD simplificada en piezas
  // lejanas para rendir mejor, pero esa geometría no respeta el color ni la
  // opacidad que le pusimos a la pieza resaltada (se ve lavada/opaca al
  // alejar la cámara). La torre es chica: forzamos geometría completa
  // siempre. ALL_GEOMETRY sigue respetando setVisible (para "ver pieza
  // aislada"), a diferencia de ALL_VISIBLE.
  await model.setLodMode(FRAGS.LodMode.ALL_GEOMETRY);

  await fragments.update(true);

  allLocalIds = await model.getLocalIds();
}

// ---------------------------------------------------------------------------
// Mapeo de código de pieza
// ---------------------------------------------------------------------------
async function cargarMapeo() {
  const res = await fetch(MAPEO_URL);
  return res.json();
}

async function cargarFamilias() {
  const res = await fetch(FAMILIAS_URL);
  return res.json();
}

function buscarEntrada(mapeo, codigo) {
  for (const [clave, valor] of Object.entries(mapeo)) {
    if (clave === "SIN CODIGO") continue;
    const partes = clave.split("/").map((p) => p.trim());
    if (partes.includes(codigo)) return { clave, ...valor };
  }
  return null;
}

function formatMedida(med) {
  // Números simples ("885") llevan unidad. Formatos compuestos
  // ("386x122x6.3" o el conjunto soldado 104/105) ya se explican solos.
  if (/^\d+([.,]\d+)?$/.test(med)) return `${med} mm`;
  return med;
}

function notaPar(clave) {
  if (clave === "104/105") {
    return "Conjunto de base soldado: montante, pieza corta y placa base salen soldados del taller.";
  }
  if (clave.includes("/")) {
    const [a, b] = clave.split("/");
    return `Código agrupa dos variantes (con corte y sin corte en punta): ${a} y ${b}. El modelo 3D no las diferencia; van en el mismo lugar.`;
  }
  return null;
}

function esProvisorio(codigo) {
  return codigo === "301" || codigo === "302";
}

// ---------------------------------------------------------------------------
// Menú de piezas
// ---------------------------------------------------------------------------
function construirMenu(mapeo) {
  const entradas = Object.entries(mapeo).filter(([clave]) => clave !== "SIN CODIGO");
  entradas.sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));

  els.menuList.innerHTML = "";
  for (const [clave, datos] of entradas) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    item.dataset.familia = familiasData?.piezas?.[clave] ?? "";
    item.innerHTML = `<span class="menu-item-code">${clave}</span><span class="menu-item-perfil">${datos.perfil}</span>`;
    item.addEventListener("click", () => {
      cerrarMenu();
      seleccionarCodigo(clave.split("/")[0].trim());
    });
    els.menuList.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// Filtro por familia constructiva (chips en el panel "Piezas")
// ---------------------------------------------------------------------------
function clavesDeFamilias(idsFamilia) {
  if (!familiasData || idsFamilia.size === 0) return [];
  return Object.entries(familiasData.piezas)
    .filter(([clave, fam]) => idsFamilia.has(fam) && mapeoCache[clave])
    .map(([clave]) => clave);
}

async function resolverLocalIds(clave) {
  if (localIdsPorClave.has(clave)) return localIdsPorClave.get(clave);
  const datos = mapeoCache[clave];
  if (!datos) return [];
  const resueltos = await model.getLocalIdsByGuids(datos.gids);
  const ids = resueltos.filter((id) => id !== null);
  localIdsPorClave.set(clave, ids);
  return ids;
}

// Resuelve varios códigos de una sola vez, en una única llamada combinada
// al worker de Fragments (en vez de una llamada por código): pedirle al
// worker varias resoluciones de GUIDs en paralelo hace que pierda la
// mayoría de las respuestas en silencio, sin error — se probó con el filtro
// de familia (19 códigos) y quedó confirmado. Una sola llamada con todos
// los GUIDs juntos evita el problema y además es más rápida.
async function resolverLocalIdsDeClaves(claves) {
  const porResolver = claves.filter((c) => !localIdsPorClave.has(c) && mapeoCache[c]);

  if (porResolver.length > 0) {
    const guidsCombinados = [];
    const segmentos = []; // [clave, inicio, cantidad]
    for (const c of porResolver) {
      const gids = mapeoCache[c].gids;
      segmentos.push([c, guidsCombinados.length, gids.length]);
      guidsCombinados.push(...gids);
    }
    const resueltos = await model.getLocalIdsByGuids(guidsCombinados);
    for (const [c, inicio, cantidad] of segmentos) {
      const ids = resueltos.slice(inicio, inicio + cantidad).filter((id) => id !== null);
      localIdsPorClave.set(c, ids);
    }
  }

  const idsResaltados = [];
  for (const c of claves) {
    idsResaltados.push(...(localIdsPorClave.get(c) ?? []));
  }
  return idsResaltados;
}

function construirChips() {
  if (!familiasData) return;
  els.familiaChips.innerHTML = "";
  for (const fam of familiasData.familias) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = fam.nombre;
    chip.dataset.id = fam.id;
    chip.addEventListener("click", () => onClickChip(fam.id));
    els.familiaChips.appendChild(chip);
  }
  els.familiaLimpiar.addEventListener("click", onLimpiarFiltros);
}

function actualizarEstadoChips() {
  els.familiaChips.querySelectorAll(".chip").forEach((chip) => {
    chip.classList.toggle("activo", familiasActivas.has(chip.dataset.id));
  });
  els.familiaLimpiar.hidden = familiasActivas.size === 0;
  // El modo etiquetas solo tiene sentido con un filtro activo (ver
  // clavesActivasParaEtiquetas): si no hay familia elegida, no hay nada
  // que la etiqueta pueda mostrar.
  els.labelsToggle.hidden = familiasActivas.size === 0;
}

function aplicarFiltroMenuLista() {
  els.menuList.querySelectorAll(".menu-item").forEach((item) => {
    const mostrar = familiasActivas.size === 0 || familiasActivas.has(item.dataset.familia);
    item.classList.toggle("oculto-por-filtro", !mostrar);
  });
}

async function onClickChip(id) {
  if (familiasActivas.has(id)) familiasActivas.delete(id);
  else familiasActivas.add(id);
  await salirDeSeleccionIndividual();
  actualizarEstadoChips();
  aplicarFiltroMenuLista();
  await aplicarFiltroFamilias();
  actualizarURL();
}

async function onLimpiarFiltros() {
  familiasActivas.clear();
  await salirDeSeleccionIndividual();
  actualizarEstadoChips();
  aplicarFiltroMenuLista();
  await aplicarFiltroFamilias();
  actualizarURL();
}

async function salirDeSeleccionIndividual() {
  codigoSeleccionado = null;
  codigoUrlActual = null;
  els.ficha.hidden = true;
  els.isoBtn.hidden = true;
  els.aviso.hidden = true;
}

async function aplicarFiltroFamilias() {
  // Si hay una pieza puntual seleccionada, su resaltado prevalece: no se
  // vuelve a pintar la vista de familia encima.
  if (codigoSeleccionado) return;

  await limpiarResaltadoAnterior();

  if (familiasActivas.size === 0) {
    await encuadrarTorreCompleta();
    await actualizarEtiquetas();
    return;
  }

  const claves = clavesDeFamilias(familiasActivas);
  const idsResaltados = await resolverLocalIdsDeClaves(claves);
  const idsSet = new Set(idsResaltados);
  const idsResto = allLocalIds.filter((id) => !idsSet.has(id));

  const totalEsperado = claves.reduce((acc, c) => acc + (mapeoCache[c]?.gids?.length ?? 0), 0);
  if (idsResaltados.length !== totalEsperado) {
    console.warn(
      `[visor-qr] filtro por familia (${[...familiasActivas].join(",")}): se esperaban ${totalEsperado} piezas, se resolvieron ${idsResaltados.length}.`,
    );
  }

  await model.setColor(idsResto, new THREE.Color(COLOR_RESTO));
  await model.setOpacity(idsResto, OPACIDAD_RESTO);
  await model.setColor(idsResaltados, new THREE.Color(COLOR_RESALTADO));
  await model.setOpacity(idsResaltados, 1);
  await fragments.update(true);

  if (idsResaltados.length > 0) {
    const box = await model.getMergedBox(idsResaltados);
    await controls.fitToBox(box, true, {
      paddingTop: 0.4,
      paddingBottom: 0.4,
      paddingLeft: 0.4,
      paddingRight: 0.4,
    });
  }

  await actualizarEtiquetas();
}

function actualizarURL() {
  const url = new URL(window.location.href);
  if (codigoUrlActual) url.searchParams.set("p", codigoUrlActual);
  else url.searchParams.delete("p");
  if (familiasActivas.size > 0) url.searchParams.set("familia", [...familiasActivas].join(","));
  else url.searchParams.delete("familia");
  window.history.replaceState(null, "", url);
}

function abrirMenu() {
  els.menuBackdrop.hidden = false;
  els.menuPanel.classList.add("open");
}

function cerrarMenu() {
  els.menuBackdrop.hidden = true;
  els.menuPanel.classList.remove("open");
}

function initMenu() {
  els.menuToggle.addEventListener("click", () => {
    if (els.menuPanel.classList.contains("open")) cerrarMenu();
    else abrirMenu();
  });
  els.menuClose.addEventListener("click", cerrarMenu);
  els.menuBackdrop.addEventListener("click", cerrarMenu);
}

// ---------------------------------------------------------------------------
// Selección de código (desde ?p= al escanear, o desde el menú)
// ---------------------------------------------------------------------------
async function limpiarResaltadoAnterior() {
  if (!model || allLocalIds.length === 0) return;
  await model.setVisible(allLocalIds, true);
  await model.resetColor(undefined);
  await model.resetOpacity(undefined);
  isolatedView = false;
  els.isoBtn.textContent = "Ver pieza aislada";
}

async function seleccionarCodigo(codigo) {
  await limpiarResaltadoAnterior();
  const entrada = buscarEntrada(mapeoCache, codigo);

  if (entrada) {
    codigoSeleccionado = entrada.clave;
    codigoUrlActual = codigo;
    await resaltarCodigo(codigo, entrada);
    mostrarFicha(codigo, entrada);
    els.aviso.hidden = true;
    actualizarURL();
  } else {
    codigoSeleccionado = null;
    codigoUrlActual = null;
    await encuadrarTorreCompleta();
    els.ficha.hidden = true;
    els.isoBtn.hidden = true;
    mostrarAviso(`Código no reconocido: ${codigo}`);
    actualizarURL();
  }
  await actualizarEtiquetas();
}

// ---------------------------------------------------------------------------
// Resaltado
// ---------------------------------------------------------------------------
async function resaltarCodigo(codigo, entrada) {
  const guids = entrada.gids;
  const resueltos = await model.getLocalIdsByGuids(guids);
  highlightLocalIds = resueltos.filter((id) => id !== null);
  const highlightSet = new Set(highlightLocalIds);
  otherLocalIds = allLocalIds.filter((id) => !highlightSet.has(id));

  await model.setColor(otherLocalIds, new THREE.Color(COLOR_RESTO));
  await model.setOpacity(otherLocalIds, OPACIDAD_RESTO);
  await model.setColor(highlightLocalIds, new THREE.Color(COLOR_RESALTADO));
  await model.setOpacity(highlightLocalIds, 1);
  await fragments.update(true);

  if (highlightLocalIds.length !== guids.length) {
    console.warn(
      `[visor-qr] código ${codigo}: se esperaban ${guids.length} piezas, se resolvieron ${highlightLocalIds.length}. Revisar mapeo_QR.json vs modelo.frag.`,
    );
  }

  if (highlightLocalIds.length > 0) {
    const box = await model.getMergedBox(highlightLocalIds);
    await controls.fitToBox(box, true, {
      paddingTop: 0.6,
      paddingBottom: 0.6,
      paddingLeft: 0.6,
      paddingRight: 0.6,
    });
  }
}

async function encuadrarTorreCompleta() {
  const box = await model.getMergedBox(allLocalIds);
  await controls.fitToBox(box, true, { paddingTop: 0.3, paddingBottom: 0.3, paddingLeft: 0.3, paddingRight: 0.3 });
}

async function toggleAislado() {
  isolatedView = !isolatedView;
  if (isolatedView) {
    await model.setVisible(otherLocalIds, false);
    els.isoBtn.textContent = "Ver torre completa";
    if (highlightLocalIds.length > 0) {
      const box = await model.getMergedBox(highlightLocalIds);
      await controls.fitToBox(box, true, {
        paddingTop: 0.7,
        paddingBottom: 0.7,
        paddingLeft: 0.7,
        paddingRight: 0.7,
      });
    }
  } else {
    await model.setVisible(otherLocalIds, true);
    els.isoBtn.textContent = "Ver pieza aislada";
    if (highlightLocalIds.length > 0) {
      const box = await model.getMergedBox(highlightLocalIds);
      await controls.fitToBox(box, true, {
        paddingTop: 0.6,
        paddingBottom: 0.6,
        paddingLeft: 0.6,
        paddingRight: 0.6,
      });
    }
  }
  await fragments.update(true);
}

// ---------------------------------------------------------------------------
// Modo etiquetas (Función 2): tarjeta HTML anclada a cada pieza, en vez de
// pintarla. Solo muestra piezas del filtro de familia activo — sin filtro,
// no muestra ninguna.
// ---------------------------------------------------------------------------
function clavesActivasParaEtiquetas() {
  return new Set(clavesDeFamilias(familiasActivas));
}

async function obtenerOCrearLabel(clave) {
  if (labelObjects.has(clave)) return labelObjects.get(clave);

  const ids = await resolverLocalIds(clave);
  if (ids.length === 0) return null;

  const box = await model.getMergedBox(ids);
  const anchor = box.getCenter(new THREE.Vector3());

  const el = document.createElement("div");
  el.className = "pieza-label";
  const perfil = mapeoCache[clave]?.perfil ?? "";
  el.innerHTML = `<span class="marca">${clave}</span><span class="perfil">${perfil}</span>`;

  const obj = new CSS2DObject(el);
  // Ancla el borde inferior de la tarjeta al punto exacto de la pieza
  // (en vez del centro): la tarjeta queda flotando arriba, tocando el
  // anclaje con su propia punta (ver ::after en style.css), a modo de
  // línea guía fina sin tener que calcular una línea aparte cada frame.
  obj.center.set(0.5, 1);
  obj.position.copy(anchor);
  obj.visible = false;
  scene.add(obj);

  const entry = { obj, anchor };
  labelObjects.set(clave, entry);
  return entry;
}

async function actualizarEtiquetas() {
  if (!modoEtiquetas) return;
  const claves = clavesActivasParaEtiquetas();
  // Uno por uno, no Promise.all: pedirle al worker de Fragments varias
  // resoluciones de GUIDs en paralelo hace que pierda la mayoría de las
  // respuestas en silencio (sin error) — se probó y quedó documentado.
  for (const c of claves) {
    try {
      await obtenerOCrearLabel(c);
    } catch (err) {
      console.error(`[visor-qr] no se pudo crear la etiqueta de ${c}:`, err);
    }
  }
  // Fuerza un recálculo inmediato (no esperar al próximo throttle) para que
  // el cambio de filtro se note al toque, no 200 ms después.
  primerChequeoEtiquetas = true;
  recalcularVisibilidadEtiquetas();
}

function ocultarTodasLasEtiquetas() {
  for (const { obj } of labelObjects.values()) obj.visible = false;
}

let recalculandoEtiquetas = false;

function actualizarEtiquetasFrame(now) {
  if (now - ultimaActualizacionEtiquetas < INTERVALO_ETIQUETAS_MS) return;
  ultimaActualizacionEtiquetas = now;

  // Si la cámara no se movió desde el último chequeo, no hay nada que
  // recalcular: en obra, con el celular quieto leyendo la ficha, esto
  // ahorra CPU y batería.
  const camQuietaMisma =
    !primerChequeoEtiquetas &&
    camera.position.distanceToSquared(ultimaCamPos) < 1e-8 &&
    camera.quaternion.angleTo(ultimaCamQuat) < 1e-4;
  if (camQuietaMisma) return;

  ultimaCamPos.copy(camera.position);
  ultimaCamQuat.copy(camera.quaternion);
  primerChequeoEtiquetas = false;

  recalcularVisibilidadEtiquetas();
}

async function recalcularVisibilidadEtiquetas() {
  // El raycast de Fragments es async (corre en el worker); si todavía hay
  // uno en vuelo, no se apilan más — se recalcula en el próximo tick.
  if (recalculandoEtiquetas) return;
  recalculandoEtiquetas = true;
  try {
    const clavesActivas = clavesActivasParaEtiquetas();
    const pendientes = [];

    for (const [clave, entry] of labelObjects) {
      if (!clavesActivas.has(clave)) {
        entry.obj.visible = false;
        continue;
      }
      pendientes.push({ clave, entry });
    }

    // Oculta si algo del modelo tapa la pieza desde este ángulo de cámara.
    // Fragments usa mallas propias (BatchedMesh/LOD) que no son compatibles
    // con THREE.Raycaster genérico: hay que usar el raycast propio del
    // modelo, que resuelve en base a un punto de pantalla (mouse en NDC).
    // Uno por uno (no Promise.all): el worker de Fragments pierde respuestas
    // en silencio si se lo llama muchas veces en paralelo (ver actualizarEtiquetas).
    const resultados = [];
    for (const { clave, entry } of pendientes) {
      const distanciaAlAnclaje = camera.position.distanceTo(entry.anchor);
      const ndc = entry.anchor.clone().project(camera);
      const mouse = new THREE.Vector2(ndc.x, ndc.y);
      let oculto = false;
      try {
        const hit = await model.raycast({ camera, mouse, dom: renderer.domElement });
        if (hit && hit.distance < distanciaAlAnclaje - 0.05) oculto = true;
      } catch {
        oculto = false; // ante la duda, mostrar antes que esconder sin motivo
      }
      resultados.push({ clave, entry, distanciaAlAnclaje, oculto, ndc });
    }

    const candidatos = [];
    for (const r of resultados) {
      if (r.oculto) {
        r.entry.obj.visible = false;
        continue;
      }
      const x = (r.ndc.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-r.ndc.y * 0.5 + 0.5) * window.innerHeight;
      candidatos.push({ ...r, x, y });
    }

    // Desempate por solapamiento en pantalla: la más cercana a cámara gana.
    candidatos.sort((a, b) => a.distanciaAlAnclaje - b.distanciaAlAnclaje);
    const ANCHO_ETIQUETA = 130;
    const ALTO_ETIQUETA = 46;
    const ocupados = [];
    for (const c of candidatos) {
      const caja = {
        izq: c.x - ANCHO_ETIQUETA / 2,
        der: c.x + ANCHO_ETIQUETA / 2,
        arr: c.y - ALTO_ETIQUETA,
        abj: c.y,
      };
      const solapa = ocupados.some(
        (o) => !(caja.der < o.izq || caja.izq > o.der || caja.abj < o.arr || caja.arr > o.abj),
      );
      if (solapa) {
        c.entry.obj.visible = false;
      } else {
        c.entry.obj.visible = true;
        ocupados.push(caja);
      }
    }
  } finally {
    recalculandoEtiquetas = false;
  }
}

function actualizarClaseBotonEtiquetas() {
  els.labelsToggle.classList.toggle("activo", modoEtiquetas);
  els.labelsToggle.textContent = modoEtiquetas ? "Ocultar etiquetas" : "Ver etiquetas";
}

function initLabelsToggle() {
  modoEtiquetas = sessionStorage.getItem("modoEtiquetas") === "true";
  actualizarClaseBotonEtiquetas();

  els.labelsToggle.addEventListener("click", async () => {
    modoEtiquetas = !modoEtiquetas;
    sessionStorage.setItem("modoEtiquetas", String(modoEtiquetas));
    actualizarClaseBotonEtiquetas();
    if (modoEtiquetas) await actualizarEtiquetas();
    else ocultarTodasLasEtiquetas();
  });
}

// ---------------------------------------------------------------------------
// Ficha / UI
// ---------------------------------------------------------------------------
function mostrarFicha(codigo, entrada) {
  els.codigo.textContent = esProvisorio(codigo) ? `${codigo} (provisorio)` : codigo;
  els.perfil.textContent = entrada.perfil;
  els.medida.textContent = formatMedida(entrada.med);
  els.cantidad.textContent = `${entrada.n} por torre`;
  const nota = notaPar(entrada.clave);
  if (nota) {
    els.nota.textContent = nota;
    els.nota.hidden = false;
  } else {
    els.nota.hidden = true;
  }
  els.ficha.hidden = false;
  els.isoBtn.hidden = false;
}

function mostrarAviso(texto) {
  els.aviso.textContent = texto;
  els.aviso.hidden = false;
  setTimeout(() => (els.aviso.hidden = true), 6000);
}

function initFichaToggle() {
  els.fichaToggle.addEventListener("click", () => {
    els.ficha.classList.toggle("colapsada");
  });
  els.isoBtn.addEventListener("click", toggleAislado);
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
async function main() {
  initScene();
  initFichaToggle();
  initMenu();
  initLabelsToggle();
  await initFragments();

  [mapeoCache, familiasData] = await Promise.all([cargarMapeo(), cargarFamilias()]);
  construirMenu(mapeoCache);
  construirChips();

  const params = new URLSearchParams(window.location.search);
  const codigo = params.get("p")?.trim();
  const familiaParam = params.get("familia")?.trim();

  if (familiaParam) {
    const idsValidos = new Set(familiasData.familias.map((f) => f.id));
    for (const id of familiaParam.split(",").map((s) => s.trim())) {
      if (idsValidos.has(id)) familiasActivas.add(id);
    }
    actualizarEstadoChips();
    aplicarFiltroMenuLista();
  }

  if (codigo) {
    await seleccionarCodigo(codigo);
  } else if (familiasActivas.size > 0) {
    await aplicarFiltroFamilias();
  } else {
    await encuadrarTorreCompleta();
  }

  els.loading.hidden = true;
}

main().catch((err) => {
  console.error(err);
  els.loading.textContent = "Error cargando el modelo. Reintentá con conexión.";
});

// Service worker (cache offline)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
