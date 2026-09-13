# Visor QR de piezas — Soporte de Barra Tipo T

**Resumen del proyecto para consulta con Claude AI**
INGEPRO S.A. — SE Acaray, contrato LPI 1815/2024

---

## 1. Qué es esto

Un sistema para que el armador, en obra, escanee el código QR pegado a una
pieza galvanizada y vea al instante, en el celular, **dónde va esa pieza
dentro de la torre**: el modelo 3D completo se abre a pantalla completa con
esa pieza pintada de azul y el resto de la estructura en gris translúcido.
Abajo aparece una ficha con el código, el perfil, la medida y la cantidad
por torre.

El objetivo es que el armador entienda la posición de la pieza sin tener que
leer un plano. El QR es un complemento visual — **no reemplaza** el estampado
con punzón que exige la especificación técnica de ANDE; ambas cosas conviven
en la pieza.

El proyecto tiene dos partes que se complementan:

1. **Un visor web 3D**, ya publicado y funcionando en:
   `https://lucasgama2904-tech.github.io/visor-qr-soporte-barra/`
2. **Un generador de etiquetas QR en PDF**, listo para imprimir en obra
   cuando se confirme el dominio definitivo de Ingepro.

Todo el trabajo está resguardado en un repositorio propio de GitHub
(`github.com/lucasgama2904-tech/visor-qr-soporte-barra`), con historial de
cambios completo.

---

## 2. Qué se logró

- **Conversión del modelo pesado a algo que carga en celular.** El IFC
  original de Revit pesa 9 MB y tarda demasiado en abrirse en un teléfono.
  Se armó una conversión a un formato liviano ("Fragments") que deja el
  modelo en 0.64 MB — carga casi instantáneo, incluso con mala señal.
- **41 códigos de pieza mapeados y verificados uno por uno.** Cada código
  (501, 518/519, 104/105, etc.) se probó de forma automática contra el
  modelo 3D real para confirmar que resalta exactamente las piezas
  correctas — no es una suposición, quedó chequeado con pruebas
  automatizadas repetibles.
- **Visor que funciona sin internet.** Una vez que se abrió una vez, el
  celular guarda todo en caché y lo puede volver a abrir sin señal — pensado
  específicamente para la mala cobertura en la subestación Acaray.
- **Corrección de un problema real de escala.** Se detectó y corrigió un
  desajuste de unidades en la cámara 3D que limitaba mucho el zoom y hacía
  que el color resaltado se viera lavado en pantallas de celular — quedó
  verificado con capturas de antes/después.
- **Menú de navegación entre piezas.** Además de escanear cada QR, ahora se
  puede abrir el visor una sola vez y navegar libremente entre las 41
  piezas desde un menú, sin volver a escanear.
- **Identidad visual de Ingepro aplicada en todo el visor**: colores, logo
  en el header, tipografía — el visor se ve como un producto de la empresa,
  no como una herramienta genérica.
- **Publicado en un hosting real y estable** (GitHub Pages), gratuito,
  con HTTPS y buena reputación — evita los avisos de "sitio no seguro" que
  dan los navegadores con hosting temporal.
- **Generador de etiquetas listo para imprimir**: un PDF con QR + código
  grande + perfil + medida, con corrección de error alta (tolera suciedad y
  rayones en obra), que respeta automáticamente la cantidad de piezas por
  torre y por lote.

---

## 3. Cómo funciona (arquitectura, en criollo)

```
Modelo IFC de Revit (9 MB)
        │
        │  conversión (una sola vez, en la PC)
        ▼
Archivo .frag (0.64 MB) ──────────────► se publica junto con el visor
        │
        ▼
Visor web (HTML + JavaScript + 3D) ────► GitHub Pages (URL pública, gratis)
        │
        ▼
QR impreso en la pieza ────► apunta a esa URL + el código de la pieza
        │
        ▼
Celular del armador escanea ────► abre el visor, resalta la pieza
```

No hay servidor propio, no hay base de datos: todo es HTML/JavaScript
estático. Eso simplifica muchísimo el mantenimiento a futuro — no hay nada
que se pueda "caer" del lado del servidor.

---

## 4. Lenguajes y tecnologías utilizadas

| Parte | Tecnología | Para qué |
|---|---|---|
| Visor 3D | **JavaScript** (three.js, camera-controls, @thatopen/fragments) | Renderiza el modelo, maneja el giro/zoom táctil, pinta las piezas |
| Interfaz | **HTML + CSS** | Header, menú, ficha de datos, identidad visual |
| Offline | **Service Worker** (JavaScript) | Cachea el modelo para uso sin conexión |
| Conversión del modelo | **Node.js** | Convierte el IFC de Revit al formato liviano, una sola vez |
| Generador de etiquetas | **Python** (reportlab, qrcode, Pillow) | Genera el PDF de impresión y las tarjetas QR de revisión |
| Empaquetado | **esbuild** | Compacta el código del visor para que cargue rápido en celular |
| Control de versiones | **Git / GitHub** | Historial de cambios, respaldo, publicación |
| Hosting | **GitHub Pages** | Publicación gratuita, estable, con HTTPS |

Todo el código es texto plano, comentado en español, sin dependencias raras
ni licencias pagas.

---

## 5. Explicación carpeta por carpeta / archivo por archivo

### En la raíz del proyecto

| Archivo/Carpeta | Qué es |
|---|---|
| `BRIEF_Visor_QR_SoporteBarra.md` | El documento original con todo el contexto del pedido: qué se necesitaba, cómo se armó el mapeo de códigos, y las decisiones ya tomadas. Es la fuente de verdad del proyecto. |
| `RESUMEN_PROYECTO.md` | Este archivo. |
| `README.md` | Guía técnica rápida: qué comando correr para cada tarea (convertir el modelo, construir el visor, generar el PDF, etc.). |
| `mapeo_QR.json` | El corazón del sistema: qué código de pieza corresponde a qué elementos del modelo 3D. 41 códigos, con perfil, medida y cantidad por torre de cada uno. |
| `mapeo_QR_soporte_barra.csv` | Lo mismo que el JSON, pero en un formato que se puede abrir directo en Excel. |
| `Z27_PAR_TORRE SUBESTACION ACARAY V2.ifc` | El modelo 3D original exportado de Revit (9 MB). Es el insumo; no se toca. |
| `LOGO.svg` | El isotipo de Ingepro, usado en el header del visor. |
| `QR/` | Las 41 tarjetas QR (una imagen por código), con el código, el perfil y la cantidad — pensadas para mirar rápido en pantalla, no para imprimir en obra. |
| `etiquetas_QR_PRUEBA.pdf` | Un PDF de prueba con las 217 etiquetas (todas las piezas de una torre), para revisar el diseño antes de imprimir en serio. |
| `package.json` / `package-lock.json` | Configuración del proyecto Node.js: qué herramientas usa y en qué versión exacta, para que cualquiera pueda instalar exactamente lo mismo. |

### `src/` — el código fuente del visor

| Archivo | Qué hace |
|---|---|
| `app.js` | Todo el comportamiento del visor: carga el modelo 3D, lee el código de la URL o del menú, resalta la pieza en azul, muestra la ficha, maneja el menú de piezas, el botón de aislar pieza, y el registro del modo offline. |

### `web/` — lo que se publica tal cual en internet

| Archivo | Qué es |
|---|---|
| `index.html` | La página en sí: header, menú, ficha, y dónde se dibuja el modelo 3D. |
| `style.css` | Todo el diseño visual: colores de Ingepro, tipografía, layout responsive para celular. |
| `app.bundle.js` | El código de `src/app.js` ya compactado y listo para que lo entienda el navegador rápido. |
| `modelo.frag` | El modelo 3D ya convertido, liviano (0.64 MB). |
| `mapeo_QR.json` | Copia del mapeo de códigos, para que el visor la lea directamente. |
| `fragments-worker.mjs` | Un motor auxiliar que hace los cálculos 3D pesados en segundo plano, para que el visor no se trabe. |
| `sw.js` | El Service Worker: guarda todo en caché la primera vez que se abre, para que funcione después sin conexión. |
| `manifest.webmanifest` | Metadata para que el celular pueda "instalar" el visor como si fuera una app. |
| `LOGO.svg` | Copia del logo, servida junto con la página. |
| `serve.json` | Configuración menor para pruebas en la PC local (no afecta la versión publicada). |

### `tools/` — los scripts de trabajo (no forman parte del visor en sí)

| Archivo | Qué hace |
|---|---|
| `convert-ifc.mjs` | Convierte el IFC de Revit al formato liviano `.frag`. Se corre una sola vez, o cada vez que cambie el modelo. |
| `build.mjs` | Empaqueta el código del visor y copia todos los archivos necesarios a la carpeta `web/`. Se corre después de cualquier cambio al visor. |
| `verify-mapeo.mjs` | Chequeo automático de calidad: abre el visor con cada uno de los 41 códigos y confirma que resalta las piezas correctas. Sirve para detectar problemas si el modelo cambia en el futuro. |
| `generate_qr_pdf.py` | Genera el PDF de etiquetas listo para imprimir, respetando cantidad por torre y por lote. |
| `generate_qr_cards.py` | Genera las tarjetas QR individuales (carpeta `QR/`) para revisión rápida. |
| `stubs/` | Un archivo técnico auxiliar que evita que el visor cargue de más en el celular (deja afuera una librería que solo hace falta en la PC, no en el teléfono). |

---

## 6. Estado actual

| Ítem | Estado |
|---|---|
| Visor 3D | Funcionando, publicado y probado en múltiples dispositivos |
| Conversión del modelo | Hecha, verificada |
| Mapeo de 41 códigos | Verificado automáticamente contra el modelo real |
| Modo offline | Implementado |
| Hosting | Publicado en GitHub Pages (estable, gratis, HTTPS) |
| Generador de PDF de etiquetas | Listo, generado en modo prueba |
| Dominio definitivo de Ingepro | **Pendiente de decisión** — cuando se defina, se actualizan los QR con un solo comando, sin rehacer nada más |
| 2 chapas sin identificar (100×70×6 mm) | Pendiente de confirmar con Lucas (obra) |
| Códigos 301/302 (UPN 152) | Provisorios, marcados como tal en el visor y en las etiquetas |

---

## 7. Para probarlo ahora mismo

Escaneando cualquiera de las tarjetas QR de la carpeta `QR/`, o entrando
directo a:

`https://lucasgama2904-tech.github.io/visor-qr-soporte-barra/?p=518`

(cambiando `518` por cualquiera de los 41 códigos del mapeo).

---

*Documento generado como parte del trabajo de desarrollo del visor, para
facilitar el traspaso de contexto y la consulta con otras herramientas de
IA.*
