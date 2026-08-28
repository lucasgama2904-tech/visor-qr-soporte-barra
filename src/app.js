// Visor QR de piezas — Soporte de Barra Tipo T
// INGEPRO S.A. — SE Acaray
//
// Un solo modelo cargado una vez. Se puede llegar a un código por el
// parámetro ?p= de la URL (al escanear un QR) o eligiéndolo del menú de
// piezas, sin necesidad de volver a escanear.

import * as THREE from "three";
import CameraControls from "camera-controls";
import * as FRAGS from "@thatopen/fragments";

// ---------------------------------------------------------------------------
// Identidad visual (ver BRIEF_Visor_QR_SoporteBarra.md §5)
// ---------------------------------------------------------------------------
const COLOR_RESALTADO = 0x0d3b65; // Azul Ingepro
const COLOR_RESTO = 0x4a4a4a; // Gris
const OPACIDAD_RESTO = 0.25;

const MODEL_ID = "torre";
const FRAG_URL = "./modelo.frag";
const MAPEO_URL = "./mapeo_QR.json";
const WORKER_URL = "./fragments-worker.mjs";

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

  window.addEventListener("resize", onResize);

  let lastTime = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;
    controls.update(delta);
    renderer.render(scene, camera);
  });
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
    item.innerHTML = `<span class="menu-item-code">${clave}</span><span class="menu-item-perfil">${datos.perfil}</span>`;
    item.addEventListener("click", () => {
      cerrarMenu();
      seleccionarCodigo(clave.split("/")[0].trim());
    });
    els.menuList.appendChild(item);
  }
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
    await resaltarCodigo(codigo, entrada);
    mostrarFicha(codigo, entrada);
    els.aviso.hidden = true;
    const url = new URL(window.location.href);
    url.searchParams.set("p", codigo);
    window.history.replaceState(null, "", url);
  } else {
    await encuadrarTorreCompleta();
    els.ficha.hidden = true;
    els.isoBtn.hidden = true;
    mostrarAviso(`Código no reconocido: ${codigo}`);
  }
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
  await initFragments();

  mapeoCache = await cargarMapeo();
  construirMenu(mapeoCache);

  const params = new URLSearchParams(window.location.search);
  const codigo = params.get("p")?.trim();

  if (codigo) {
    await seleccionarCodigo(codigo);
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
