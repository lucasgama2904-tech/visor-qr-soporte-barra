// Verificación de integridad: para cada código de mapeo_QR.json, abre el
// visor con ?p=<código> en un Chromium headless y confirma que todos los
// GUIDs de ese código resuelven a piezas del modelo.frag actual (si el
// modelo cambia — nueva exportación de Revit — los GUIDs pueden no calzar
// más, y esto lo detecta antes de imprimir etiquetas).
//
// Requiere el visor sirviendo en localhost:8080 (`npm run serve`) y
// Playwright con Chromium instalado (`npx playwright install chromium`).
//
// Uso: node tools/verify-mapeo.mjs

import { chromium } from "playwright";
import * as fs from "node:fs";

const BASE = "http://localhost:8080";
const mapeo = JSON.parse(fs.readFileSync("mapeo_QR.json", "utf8"));

const codes = [];
for (const clave of Object.keys(mapeo)) {
  if (clave === "SIN CODIGO") continue;
  for (const c of clave.split("/")) codes.push(c.trim());
}

const browser = await chromium.launch();
// Una sola pestaña, navegando de código en código: abrir 56 pestañas nuevas
// sin cerrar el browser acumula contextos WebGL (cada carga instancia un
// WebGLRenderer) hasta agotar el límite del proceso y volver todo lento.
// Navegar (en vez de abrir pestañas nuevas) libera el contexto anterior.
const page = await browser.newPage();
let failures = 0;

for (const code of codes) {
  const warnings = [];
  const errors = [];
  const onError = (e) => errors.push(e.message);
  const onConsole = (msg) => {
    const t = msg.text();
    if (t.includes("THREE.Clock") || t.includes("GL Driver Message")) return;
    if (msg.type() === "warning" || msg.type() === "error") warnings.push(t);
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);

  await page.goto(`${BASE}/?p=${code}`, { waitUntil: "networkidle", timeout: 30000 });
  await page
    .waitForFunction(() => document.querySelector("#f-codigo")?.textContent?.trim().length > 0, { timeout: 10000 })
    .catch(() => {});
  const codigoTxt = await page.$eval("#f-codigo", (el) => el.textContent).catch(() => null);
  const ok = codigoTxt && codigoTxt.startsWith(code) && errors.length === 0 && warnings.length === 0;
  if (!ok) {
    failures++;
    console.log(`FAIL p=${code}: codigoTxt="${codigoTxt}" warnings=${JSON.stringify(warnings)} errors=${JSON.stringify(errors)}`);
  }

  page.off("pageerror", onError);
  page.off("console", onConsole);
}

console.log(`\nTotal códigos probados: ${codes.length}. Fallas: ${failures}.`);
await browser.close();
process.exit(failures > 0 ? 1 : 0);
