// Verificación de integridad del filtro por familia (Función 1, sobre
// familias.json). Requiere el visor sirviendo en localhost:8080
// (`npm run serve`).
//
// El modo etiquetas (Función 2) se sacó del visor: no acompañaba bien a
// la pieza al girar la cámara y no se ocultaba del todo.
//
// Uso: node tools/test-familias.mjs

import { chromium } from "playwright";

const BASE = "http://localhost:8080";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
let fallas = 0;
const errores = [];
page.on("pageerror", (e) => errores.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("GL Driver Message")) errores.push(m.text());
});

function chequear(cond, msg) {
  console.log(cond ? `OK   ${msg}` : `FAIL ${msg}`);
  if (!cond) fallas++;
}

async function esperarCarga() {
  await page.waitForFunction(() => document.querySelector("#loading")?.hidden, { timeout: 20000 });
}

async function esperarMenuAbierto() {
  const yaAbierto = await page.$eval("#menu-panel", (el) => el.classList.contains("open"));
  if (!yaAbierto) {
    await page.click("#menu-toggle");
    await page.waitForFunction(() => document.querySelector("#menu-panel")?.classList.contains("open"), { timeout: 10000 });
  }
}

// --- 1. Regresión: ?p= sigue funcionando igual que antes del filtro por familia ---
await page.goto(`${BASE}/?p=518`, { waitUntil: "networkidle" });
await esperarCarga();
await page.waitForFunction(() => document.querySelector("#f-codigo")?.textContent?.includes("518"), { timeout: 15000 });
chequear(true, "?p=518 sigue funcionando (regresión)");

// --- 2. Chips presentes ---
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await esperarCarga();
await esperarMenuAbierto();
const chips = await page.$$eval("#familia-chips .chip", (els) => els.map((e) => e.textContent));
chequear(chips.length === 5, `5 chips de familia (encontrados: ${chips.length})`);

// --- 3. Click en familia: resalta y filtra la lista, sin abrir ficha ---
await page.locator(".chip", { hasText: "Riostras horizontales" }).click();
await page.waitForFunction(() => new URL(window.location.href).searchParams.get("familia") === "horizontales", { timeout: 15000 });
const fichaHidden1 = await page.$eval("#ficha", (el) => el.hidden);
const url1 = new URL(page.url());
chequear(fichaHidden1 === true, "ficha oculta tras filtrar por familia (sin pieza puntual)");
chequear(url1.searchParams.get("familia") === "horizontales", "URL refleja ?familia=horizontales");

const visibles = await page.$$eval(".menu-item:not(.oculto-por-filtro) .menu-item-code", (els) => els.map((e) => e.textContent));
chequear(visibles.length === 19, `lista de piezas filtrada a 19 códigos (encontrados: ${visibles.length})`);

// --- 4. Filtro por código encima del filtro por familia ---
await page.locator(".menu-item:not(.oculto-por-filtro)", { hasText: "201" }).first().click();
await page.waitForFunction(() => document.querySelector("#f-codigo")?.textContent?.trim() === "201", { timeout: 15000 });
const url2 = new URL(page.url());
chequear(url2.searchParams.get("p") === "201" && url2.searchParams.get("familia") === "horizontales", "URL con ?p= y ?familia= a la vez");

// --- 5. Limpiar filtros vuelve a la torre completa, sin código ni familia ---
await esperarMenuAbierto();
await page.click("#familia-limpiar");
await page.waitForFunction(() => document.querySelector("#ficha")?.hidden === true, { timeout: 15000 });
await page.waitForFunction(() => new URL(window.location.href).searchParams.toString() === "", { timeout: 15000 });
chequear(true, "limpiar filtros deja la URL sin parámetros");

// --- 6. El botón/estilos del modo etiquetas (removido) no deben existir ---
const quedaBotonEtiquetas = (await page.$("#labels-toggle")) !== null;
chequear(!quedaBotonEtiquetas, "no quedó rastro del botón de modo etiquetas (removido)");

console.log(`\nTotal: ${fallas === 0 ? "todo OK" : `${fallas} falla(s)`}`);
console.log("Errores de consola/página:", errores.length ? errores : "ninguno");
await browser.close();
process.exit(fallas > 0 || errores.length > 0 ? 1 : 0);
