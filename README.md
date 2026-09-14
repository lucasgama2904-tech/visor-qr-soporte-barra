# Visor QR de piezas — Soporte de Barra Tipo T

Ver `BRIEF_Visor_QR_SoporteBarra.md` para el contexto completo. Este README
es la referencia rápida de comandos.

## Instalar dependencias

```
npm install
```

(Requiere Node.js. El generador de PDF requiere Python 3 con `pip install qrcode[pil] reportlab`.)

## 1. Convertir el IFC a Fragments

Solo hace falta correrlo de nuevo si cambia el modelo de Revit/IFC.

```
npm run convert
```

Lee `Z27_PAR_TORRE SUBESTACION ACARAY V2.ifc` y genera `web/modelo.frag`
(~0.6 MB, de los ~9 MB del IFC original).

## 2. Construir el visor

```
npm run build
```

Empaqueta `src/app.js` (three.js + camera-controls + @thatopen/fragments) a
`web/app.bundle.js` y copia el worker de fragments y `mapeo_QR.json` a `web/`.
Correr de nuevo cada vez que se edite `src/app.js` o cambie `mapeo_QR.json`.

## 3. Probar en local

```
npm run serve
```

Sirve `web/` en `http://localhost:8080`. Para probar desde un celular en la
misma red, usar la IP local de la PC en vez de `localhost`
(`http://<IP-de-la-PC>:8080`).

**Importante:** el Service Worker (cacheo offline) solo se activa en
`localhost` o HTTPS. Probar desde la IP de la LAN por HTTP valida el visor y
el resaltado de piezas, pero no el comportamiento offline — eso se confirma
recién en el hosting final (HTTPS) o en `localhost` de la propia PC.

## 4. Verificar integridad del mapeo (opcional pero recomendado)

Con el servidor de local corriendo (`npm run serve` en otra terminal):

```
npm run verify
```

Abre cada uno de los 41 códigos de `mapeo_QR.json` en un Chromium headless y
confirma que sus GUIDs resuelven contra `modelo.frag`. Útil para detectar
desajustes si se reconvierte el IFC más adelante.

## 5. Publicar

El sitio en vivo es:

```
https://lucasgama2904-tech.github.io/visor-qr-soporte-barra/
```

Lo sirve GitHub Pages desde la rama `gh-pages`, que tiene el **interior de
`web/` en su raíz** (no la carpeta `web/` en sí). Ojo con esto: pushear a
`main` NO actualiza el sitio. Después de cada cambio hay que correr el build
y publicar el subárbol:

```
npm run build
git add -A && git commit -m "..."
git push origin main
git subtree push --prefix web origin gh-pages
```

Y antes de publicar, subir `CACHE` en `web/sw.js` (`visor-qr-vN` -> `vN+1`).
Sin eso, los celulares que ya abrieron el visor siguen sirviendo la versión
vieja desde el caché offline. Con el número nuevo, el service worker se
reinstala, borra el caché anterior y la página se recarga sola una vez.

Para comprobar qué está publicado de verdad, conviene pedir los archivos al
sitio en lugar de mirar el navegador propio (que tiene caché):

```
curl -s https://lucasgama2904-tech.github.io/visor-qr-soporte-barra/index.html
```

El visor es 100% estático: no requiere backend ni base de datos.

## 6. Generar el PDF de etiquetas

**No correr esto en serio hasta tener la URL definitiva** (ver brief §7). El
dominio queda grabado en cada QR; si cambia después, hay que reimprimir todo.

```
py tools/generate_qr_pdf.py --url "https://TU-DOMINIO/sb/" --torres 5
```

- `--torres N`: cantidad de torres del lote (multiplica las cantidades).
- `--out archivo.pdf`: nombre de salida (por defecto `etiquetas_QR.pdf`).
- Sin `--url`: genera `etiquetas_QR_PRUEBA.pdf` con una URL de prueba, para
  revisar el diseño de la etiqueta sin comprometerse a un dominio.

## Estado de los pendientes del brief (§4)

- **2 chapas 100×70×6 mm sin identificar**: quedan sin QR (clave
  `"SIN CODIGO"` en el mapeo, no genera etiqueta). Sin resolver.
- **Códigos 301/302 (UPN 152)**: se usan tal cual están en el mapeo. El
  visor los marca como "(provisorio)" en la ficha, y el PDF los marca como
  "(prov.)" en la etiqueta, para que quede visible que faltan confirmar.

## Decisiones de diseño no explícitas en el brief

- **Pares con/sin corte** (ej. `501/502`) y el **conjunto soldado 104/105**:
  se imprime **una sola etiqueta por grupo** (mismo código compuesto), con
  cantidad = el campo `n` del mapeo. El QR de esa etiqueta apunta al primer
  número del grupo (ej. `?p=501`), que el visor ya resuelve igual para
  cualquiera de los dos números. Esto asume que el taller no necesita
  etiquetas separadas por cada número físico estampado dentro del par; si sí
  las necesita, avisar para ajustar `tools/generate_qr_pdf.py` (haría falta
  saber cuántas de las `n` piezas son de cada número).
- La URL de los QR incluye `https://` explícito (el brief lo omite en su
  ejemplo, `ingepro.com.py/sb/?p=518`) para asegurar que cualquier lector de
  QR la reconozca como link y la abra directo, en vez de solo mostrar texto.

## Riesgo de rendimiento a validar en campo

Carga inicial (primera vez, antes de que el Service Worker cachee todo):
~1.2 MB comprimidos (JS + worker + modelo). En una conexión 4G normal esto
carga en 2–5 s; en 3G débil puede superar los 5 s que pide el brief. Una vez
cacheado, carga instantáneo y offline. Confirmar en el punto 8 del brief
(prueba en campo) si esto es un problema real en la señal de Acaray.

## Estructura

```
BRIEF_Visor_QR_SoporteBarra.md   Brief original
mapeo_QR.json                   Mapeo código → GUIDs (fuente de verdad)
mapeo_QR_soporte_barra.csv       Mismo mapeo, legible en Excel
Z27_PAR_TORRE SUBESTACION ACARAY V2.ifc   Modelo IFC original

src/app.js                      Código fuente del visor
tools/convert-ifc.mjs           Conversión IFC -> Fragments
tools/build.mjs                 Empaquetado del visor (esbuild)
tools/verify-mapeo.mjs          Chequeo de integridad mapeo <-> modelo
tools/generate_qr_pdf.py        Generador de etiquetas QR en PDF
tools/stubs/                    Stub para excluir web-ifc del bundle del navegador

web/                            Carpeta a publicar (estática)
  index.html, style.css, app.bundle.js, fragments-worker.mjs,
  modelo.frag, mapeo_QR.json, sw.js, manifest.webmanifest
```
