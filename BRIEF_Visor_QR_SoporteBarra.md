# Visor QR de piezas — Soporte de Barra Tipo T

Documento de traspaso para Claude Code. Contiene todo el contexto necesario para
construir el sistema desde cero.

---

## 1. Qué se quiere construir

Un sistema de identificación de piezas por QR para el montaje en obra.

Cada pieza galvanizada lleva pegada una etiqueta con un código QR. El armador la
escanea con el celular y se abre, a pantalla completa, el modelo 3D de la torre
con esa pieza pintada de azul y todo el resto en gris translúcido. Puede girar el
modelo con el dedo y hacer zoom. Abajo ve una ficha con el código, el perfil, la
longitud y la cantidad por torre.

El objetivo es que el armador entienda dónde va la pieza sin tener que leer un
plano.

### Alcance

1. Un visor web estático (un `index.html`, sin backend ni base de datos).
2. Un generador de etiquetas QR en PDF, listo para imprimir.

### Lo que NO es

El QR **no reemplaza** el estampado con punzón de 12 mm que exige la
especificación técnica ANDE ET Nº 03.01.61.02. Es complementario. Ambas cosas
conviven en la pieza.

---

## 2. Contexto del proyecto

- Empresa: INGEPRO S.A., Ciudad del Este, Paraguay.
- Obra: Subestación Eléctrica Acaray, contrato LPI 1815/2024.
- Producto: 42 torres reticuladas galvanizadas, tipo Soporte de Barra Tipo T.
- Cada torre tiene 219 piezas y pesa unos 997 kg.
- Cadena de suministro: INGEPRO → ECOMIPA → Rieder → ANDE.
- El galvanizado se hace en GALVAMAX S.A., Ypané.

La etiqueta QR se pega en la etapa de acondicionamiento, **después** del baño de
galvanizado. Ninguna etiqueta sobrevive los 450 °C del baño de zinc.

---

## 3. Archivos de entrada

| Archivo | Qué es |
|---|---|
| `Z27_PAR_TORRE_SUBESTACION_ACARAY_V2.ifc` | Modelo 3D, IFC2x3 exportado de Revit 2025, 9 MB |
| `mapeo_QR.json` | Mapeo código de pieza → GlobalIds del IFC |
| `mapeo_QR_soporte_barra.csv` | El mismo mapeo, legible en Excel |

Los tres tienen que estar en la carpeta de trabajo antes de empezar.

---

## 4. El mapeo, y cómo se construyó

Este trabajo ya está hecho. Se documenta para que se entienda de dónde sale el
JSON y se pueda rehacer si cambia el modelo.

El modelo de Revit trae códigos propios en las propiedades `Etiqueta` y
`Comentarios` de cada elemento (DS10, DN10, H05, N1, S1, etc.). Esos códigos
**no se usan**. Son nomenclatura interna del modelador: DS significa diagonal
sur, DN diagonal norte.

El código real, el que se estampa con punzón en la pieza, es un código numérico
de tres dígitos que viene de un cuaderno de obra: 501, 502, 601, 801, etc.

El puente entre ambos es la combinación **perfil + longitud de corte**. Es unívoco
en todo el modelo.

### Detalle crítico sobre la longitud

Revit exporta la barra extruida completa, no la pieza cortada. La longitud
correcta está en la propiedad `Longitud de corte` del elemento, no en el `Depth`
del `IfcExtrudedAreaSolid`.

Ejemplo: la pieza H19 tiene `Depth = 526.9` mm pero `Longitud de corte = 131.0`
mm. Los 131 mm son la medida real. Lo mismo pasa con H20: extrusión de 1607 mm,
corte de 1140,6 mm.

De las 181 piezas de perfil, 178 tienen `Longitud de corte`. Para las tres
restantes se usa el `Depth`.

### Resultado

217 de 219 elementos quedaron asociados a un código. Se generan **41 QR
distintos**.

| Perfil | QR | Piezas |
|---|---|---|
| L 2"×2"×4,8 mm | 19 | 118 |
| L 2½"×2½"×4,8 mm | 9 | 36 |
| L 2½"×2½"×6 mm | 2 | 16 |
| L 4"×4"×9,5 mm | 2 | 12 |
| UPN 152 | 2 | 3 |
| Platinas (chapa) | 7 | 34 |

### Decisiones ya tomadas

**Pares con corte y sin corte.** Trece códigos vienen de a pares que comparten
perfil y longitud, y se diferencian solo en si la pieza lleva un corte en punta
(por ejemplo 501 sin corte y 502 con corte). El modelo de Revit no modela esos
cortes, así que geométricamente son idénticas. Ambos códigos apuntan al mismo
grupo de piezas y la ficha aclara cuál lleva corte. Para el armador da igual:
lo que necesita saber es dónde va la pieza.

En el JSON esos pares figuran como una sola clave, `"501/502"`.

**Conjunto de base soldado.** Los códigos `104/105` agrupan tres elementos que
salen soldados del taller: el montante de 1660 mm, la pieza de 170 mm y la placa
base de 250 × 250 × 25 mm. Un solo QR para el conjunto.

**Códigos inexistentes.** El 808 y el 809 no se generan. El 809 es una platina
que agregó el fiscal de obra y no está en el modelo.

**Platina 807.** Figura con 4,8 mm de espesor en el cuaderno y 6,3 mm en el
modelo. Es un error de anotación del cuaderno. Vale 6,3 mm.

### Pendientes de resolver con Lucas

1. Dos chapas de 100 × 70 × 6 mm no están identificadas. No figuran en el
   cuaderno ni coinciden con ninguna platina de la serie 801 a 807. Sin resolver,
   quedan sin QR.
2. Las dos piezas UPN 152 tienen asignados provisionalmente los códigos 301
   (1000 mm) y 302 (1140 mm), que estaban anotados como pendientes en el
   cuaderno. Falta confirmación.

---

## 5. Especificación del visor

### Comportamiento

| Situación | Qué hace |
|---|---|
| Se abre con `?p=518` | Carga el modelo, pinta de azul todas las piezas del código 518, el resto en gris translúcido, encuadra la cámara sobre el grupo resaltado y muestra la ficha |
| Se abre sin parámetro | Muestra la torre completa en color normal, sin ficha |
| Código inexistente | Muestra la torre completa y un aviso discreto de código no reconocido |
| Sin conexión | Sirve desde caché si ya se abrió una vez |

### Interacción

Un dedo gira, dos dedos hacen zoom y desplazan. Nada más. Sin menús, sin árbol de
modelo, sin herramientas de medición. La pantalla es el modelo.

Un solo control visible: un botón para alternar entre ver la pieza aislada y ver
la torre completa con la pieza resaltada.

### Ficha de pieza

Barra inferior fija, colapsable con un toque. Contenido:

- Código de pieza, en grande
- Perfil
- Longitud de corte en mm
- Cantidad por torre
- Si aplica, la aclaración de con corte o sin corte

### Identidad visual

| Elemento | Color |
|---|---|
| Pieza resaltada | Azul Ingepro `#0D3B65` |
| Resto del modelo | Gris `#4A4A4A` al 25 % de opacidad |
| Fondo | Hueso `#E9E5D6` |
| Texto de la ficha | Negro `#1B1B1B` |
| Acento secundario | Verde `#4DB69C` |

Tipografías: Orpheus Pro Condensed en títulos, Aktiv Grotesk en cuerpo. Si no hay
licencia web de esas fuentes, usar una sans-serif de sistema. No usar cursivas.

### Stack técnico

- Three.js para el render.
- That Open Engine (`@thatopen/components`, `web-ifc`) para leer el IFC.
- Conversión previa del IFC a formato Fragments (`.frag`). Esto es obligatorio:
  el IFC crudo de 9 MB tarda demasiado en parsear en un celular. Convertido baja
  a un par de MB y carga casi instantáneo.
- Service worker para cachear el modelo y permitir uso offline. La subestación
  Acaray no tiene buena señal.
- Todo estático. Sin backend, sin base de datos, sin dependencias de servidor.

### Estructura de carpeta esperada

```
/
  index.html
  modelo.frag
  mapeo_QR.json
  sw.js
```

---

## 6. Generador de etiquetas QR

Script Python aparte, no forma parte de la web.

Entrada: `mapeo_QR.json` y la URL base definitiva.

Salida: un PDF A4 con las etiquetas listas para mandar a imprimir.

### Diseño de la etiqueta

- Tamaño mínimo 30 × 30 mm de área de QR. En obra se escanea con guantes, con
  polvo y con mala luz.
- Al lado del QR, el código numérico impreso en tamaño grande, legible sin
  celular. Esto es importante: si el QR se raya o el operario no tiene el
  teléfono a mano, el número sigue sirviendo.
- Corrección de error nivel Q o H, para que tolere suciedad y rayones.
- Debajo, el perfil y la longitud en letra chica.

### Cantidades

El PDF tiene que respetar la cantidad de piezas por torre de cada código, y
permitir multiplicar por la cantidad de torres del lote. Por ejemplo el código
518/519 lleva 24 piezas por torre: en un lote de 5 torres son 120 etiquetas de
ese código.

Total aproximado por torre: 219 etiquetas. Por lote de 5 torres: 1.095.

### Recomendación de URL

La URL del QR tiene que ser lo más corta posible. Cada carácter agrega densidad
al código y lo hace más frágil. Algo como `ingepro.com.py/sb/?p=518` es ideal.
Evitar URLs largas de GitHub Pages si hay alternativa.

### Impresión

Vinilo o poliéster autoadhesivo con laminado UV, adhesivo acrílico industrial. Se
pega sobre el zinc previamente limpiado con alcohol isopropílico, porque el
galvanizado recién salido tiene una superficie rugosa que no agarra bien.

---

## 7. Orden de trabajo

El orden importa. No se pueden generar los QR antes de tener la URL definitiva,
porque la URL queda grabada en el dibujo del código. Si después cambia el
dominio, hay que reimprimir todo.

1. Convertir el IFC a Fragments y verificar que carga rápido en celular.
2. Construir el visor y probarlo con servidor local en un celular real de la red.
3. Definir el hosting y la URL definitiva.
4. Publicar.
5. Recién ahí, generar el PDF de etiquetas.
6. Imprimir y aplicar en acondicionamiento.

### Decisión de hosting pendiente

Dos opciones. Si Ingepro tiene dominio y hosting propio, es la mejor: URL corta y
bajo control de la empresa. Si no, GitHub Pages es gratis, confiable y trae HTTPS,
pero la URL queda más larga.

---

## 8. Validación antes de producción

Probar el flujo completo con una sola pieza antes de imprimir mil etiquetas.

- Imprimir una etiqueta de prueba, pegarla en una pieza ya galvanizada y
  escanearla con el celular de alguien del taller, no con el propio.
- Verificar que el modelo carga en menos de cinco segundos con datos móviles.
- Verificar que se ve bien al sol.
- Dejar la etiqueta pegada una semana en la intemperie y revisar si aguanta.

---

## 9. Presentación a ANDE

Conviene presentar esto al fiscal como valor agregado de Ingepro, nunca como
sustitución del estampado normativo. Planteado como reemplazo abre una discusión
de conformidad con la ET que no hace falta dar.
