// Inspección puntual: lee el IFC original y extrae las propiedades
// "Etiqueta" y "Comentarios" (las marcas internas de Revit: DS, DN, H, N,
// S, etc. — ver BRIEF_Visor_QR_SoporteBarra.md §4) para cada GUID que ya
// tenemos mapeado en mapeo_QR.json. Sirve para proponer familias
// constructivas basadas en datos reales, no inventados.
//
// Uso: node tools/inspect-marks.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as WEBIFC from "web-ifc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const IFC_PATH = path.join(root, "Z27_PAR_TORRE SUBESTACION ACARAY V2.ifc");
const MAPEO_PATH = path.join(root, "mapeo_QR.json");

const TIPOS = [
  WEBIFC.IFCMEMBER,
  WEBIFC.IFCPLATE,
  WEBIFC.IFCBEAM,
  WEBIFC.IFCCOLUMN,
  WEBIFC.IFCBUILDINGELEMENTPROXY,
  WEBIFC.IFCFOOTING,
];

async function main() {
  const mapeo = JSON.parse(fs.readFileSync(MAPEO_PATH, "utf8"));

  // GUID -> [clave, perfil] para poder reportar por código
  const guidToCodigo = new Map();
  for (const [clave, datos] of Object.entries(mapeo)) {
    for (const gid of datos.gids || []) {
      guidToCodigo.set(gid, { clave, perfil: datos.perfil });
    }
  }

  const ifcAPI = new WEBIFC.IfcAPI();
  ifcAPI.SetWasmPath(path.join(root, "node_modules", "web-ifc") + path.sep, true);
  await ifcAPI.Init();

  const buffer = fs.readFileSync(IFC_PATH);
  const modelID = ifcAPI.OpenModel(new Uint8Array(buffer));

  let encontrados = 0;
  let sinPsets = 0;
  const porCodigo = new Map(); // clave -> array de {guid, etiqueta, comentarios}

  for (const tipo of TIPOS) {
    const ids = ifcAPI.GetLineIDsWithType(modelID, tipo);
    for (let i = 0; i < ids.size(); i++) {
      const expressID = ids.get(i);
      const line = ifcAPI.GetLine(modelID, expressID);
      const guid = line?.GlobalId?.value;
      if (!guid || !guidToCodigo.has(guid)) continue;

      encontrados++;
      const { clave } = guidToCodigo.get(guid);

      const psets = await ifcAPI.properties.getPropertySets(modelID, expressID, true);
      let etiqueta = null;
      let comentarios = null;
      for (const pset of psets) {
        const props = pset.HasProperties || [];
        for (const prop of props) {
          const name = prop?.Name?.value;
          const val = prop?.NominalValue?.value;
          if (!name) continue;
          if (/^etiqueta$/i.test(name)) etiqueta = val;
          if (/^comentarios?$/i.test(name)) comentarios = val;
        }
      }
      if (etiqueta === null && comentarios === null) sinPsets++;

      if (!porCodigo.has(clave)) porCodigo.set(clave, []);
      porCodigo.get(clave).push({ guid, etiqueta, comentarios });
    }
  }

  console.log(`Elementos del mapeo encontrados en el IFC: ${encontrados}`);
  console.log(`Sin Etiqueta/Comentarios legibles: ${sinPsets}\n`);

  const claves = Object.keys(mapeo).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  for (const clave of claves) {
    const items = porCodigo.get(clave) || [];
    const perfil = mapeo[clave].perfil;
    const etiquetas = [...new Set(items.map((i) => i.etiqueta).filter(Boolean))];
    const comentarios = [...new Set(items.map((i) => i.comentarios).filter(Boolean))];
    console.log(
      `${clave.padEnd(10)} perfil=${perfil.padEnd(14)} n=${String(items.length).padEnd(3)} etiqueta=${JSON.stringify(etiquetas).padEnd(30)} comentarios=${JSON.stringify(comentarios)}`,
    );
  }

  ifcAPI.CloseModel(modelID);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
