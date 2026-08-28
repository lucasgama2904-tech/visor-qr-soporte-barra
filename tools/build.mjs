// Empaqueta el visor: src/app.js -> web/app.bundle.js
// y copia el worker de fragments + el mapeo a la carpeta web/.
//
// Uso: node tools/build.mjs

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

await esbuild.build({
  entryPoints: [path.join(root, "src", "app.js")],
  outfile: path.join(root, "web", "app.bundle.js"),
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: true,
  sourcemap: true,
  logLevel: "info",
  // El visor nunca parsea IFC en el navegador (eso ya se hizo en
  // convert-ifc.mjs), pero @thatopen/fragments importa "web-ifc" a nivel de
  // módulo para su IfcImporter. Sin este alias, ese import mete >3 MB de
  // web-ifc sin usar en el bundle del celular.
  alias: {
    "web-ifc": path.join(root, "tools", "stubs", "web-ifc-empty.mjs"),
  },
});

// Copiar el worker de @thatopen/fragments (se sirve como archivo estático,
// no se bundlea, porque FragmentsModels lo instancia como Worker por URL).
const workerSrc = path.join(
  root,
  "node_modules",
  "@thatopen",
  "fragments",
  "dist",
  "Worker",
  "worker.min.mjs",
);
const workerDst = path.join(root, "web", "fragments-worker.mjs");
fs.copyFileSync(workerSrc, workerDst);
console.log(`Copiado: ${workerDst}`);

// Copiar el mapeo de códigos
const mapeoSrc = path.join(root, "mapeo_QR.json");
const mapeoDst = path.join(root, "web", "mapeo_QR.json");
fs.copyFileSync(mapeoSrc, mapeoDst);
console.log(`Copiado: ${mapeoDst}`);

// Copiar el logo de Ingepro (header del visor)
const logoSrc = path.join(root, "LOGO.svg");
const logoDst = path.join(root, "web", "LOGO.svg");
fs.copyFileSync(logoSrc, logoDst);
console.log(`Copiado: ${logoDst}`);
