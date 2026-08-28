#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generador de etiquetas QR — Soporte de Barra Tipo T (SE Acaray, INGEPRO S.A.)

Lee mapeo_QR.json y genera un PDF A4 con una etiqueta por código, en la
cantidad "piezas por torre" x "cantidad de torres del lote".

IMPORTANTE (ver BRIEF_Visor_QR_SoporteBarra.md §7): no generar el PDF final
de impresión hasta tener la URL definitiva. Cada carácter en la URL agrega
densidad al QR; si el dominio cambia después hay que reimprimir todo.

Uso:
    py tools/generate_qr_pdf.py --url "https://ingepro.com.py/sb/" --torres 5
    py tools/generate_qr_pdf.py --torres 1 --out prueba.pdf   (usa URL de PRUEBA)

Los pares "con corte / sin corte" (ej. 501/502) y el conjunto soldado
104/105 se imprimen como UNA sola etiqueta por el grupo (mismo criterio que
mapeo_QR.json y el visor: un solo QR representa al grupo completo). Si en
el taller se necesitan etiquetas separadas por cada número físico
estampado, avisar para ajustar el script.
"""

import argparse
import io
import json
import sys
import textwrap
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.utils import ImageReader

# ---------------------------------------------------------------------------
# URL de prueba. NO usar para impresión final: reemplazar con --url una vez
# que Ingepro confirme el dominio y la subruta definitivos.
# ---------------------------------------------------------------------------
URL_PRUEBA = "https://PENDIENTE-DEFINIR.ingepro.com.py/sb/"

ROOT = Path(__file__).resolve().parent.parent
MAPEO_DEFAULT = ROOT / "mapeo_QR.json"

# --- Geometría de la etiqueta (mm) -----------------------------------------
LABEL_W = 45.0
LABEL_H = 45.0
QR_SIZE = 32.0  # >= 30x30 mm exigidos por el brief
MARGIN = 10.0
GUTTER = 2.0

FONT_CODE = "Helvetica-Bold"
FONT_TEXT = "Helvetica"


def cargar_mapeo(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def formatear_medida(med: str) -> str:
    """Igual criterio que el visor: número simple -> agrega 'mm'."""
    med = med.strip()
    try:
        float(med.replace(",", "."))
        return f"{med} mm"
    except ValueError:
        return med


def es_provisorio(codigo: str) -> bool:
    return codigo in ("301", "302")


def hacer_qr_imagen(data: str):
    qr = qrcode.QRCode(
        error_correction=ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return ImageReader(buf)


def envolver_texto(c, texto, ancho_mm, font, size, max_lineas=2):
    """Corta el texto a lo que entra en ancho_mm, hasta max_lineas líneas."""
    ancho_pt = ancho_mm * mm
    palabras = texto.split()
    lineas = []
    actual = ""
    for palabra in palabras:
        candidato = f"{actual} {palabra}".strip()
        if stringWidth(candidato, font, size) <= ancho_pt:
            actual = candidato
        else:
            if actual:
                lineas.append(actual)
            actual = palabra
        if len(lineas) == max_lineas - 1 and stringWidth(actual, font, size) > ancho_pt:
            break
    if actual:
        lineas.append(actual)
    if len(lineas) > max_lineas:
        lineas = lineas[:max_lineas]
    # Si igual no entra el texto completo, recorta con "…"
    unido = " ".join(lineas)
    if unido != texto and len(lineas) == max_lineas:
        ultima = lineas[-1]
        while stringWidth(ultima + "…", font, size) > ancho_pt and len(ultima) > 1:
            ultima = ultima[:-1]
        lineas[-1] = ultima + "…"
    return lineas


def dibujar_etiqueta(c, x, y, codigo, perfil, medida, url_qr):
    """Dibuja una etiqueta con esquina inferior-izquierda en (x, y), en mm."""
    x_pt, y_pt = x * mm, y * mm

    # Línea de corte de referencia
    c.setDash(1, 2)
    c.setLineWidth(0.3)
    c.rect(x_pt, y_pt, LABEL_W * mm, LABEL_H * mm)
    c.setDash()

    # QR centrado horizontalmente, arriba
    qr_img = hacer_qr_imagen(url_qr)
    qr_x = x + (LABEL_W - QR_SIZE) / 2
    qr_y = y + LABEL_H - QR_SIZE - 2
    c.drawImage(
        qr_img,
        qr_x * mm,
        qr_y * mm,
        QR_SIZE * mm,
        QR_SIZE * mm,
    )

    # Código grande, debajo del QR — legible sin celular
    label_codigo = f"{codigo} (prov.)" if es_provisorio(codigo) else codigo
    code_size = 15 if len(label_codigo) <= 8 else 11
    c.setFont(FONT_CODE, code_size)
    c.drawCentredString((x + LABEL_W / 2) * mm, (qr_y - 5.5) * mm, label_codigo)

    # Perfil y medida, letra chica
    texto_perfil = envolver_texto(c, perfil, LABEL_W - 4, FONT_TEXT, 6.5, max_lineas=1)
    texto_medida = envolver_texto(c, medida, LABEL_W - 4, FONT_TEXT, 6.5, max_lineas=2)

    c.setFont(FONT_TEXT, 6.5)
    ty = qr_y - 9.5
    for linea in texto_perfil:
        c.drawCentredString((x + LABEL_W / 2) * mm, ty * mm, linea)
        ty -= 3.0
    for linea in texto_medida:
        c.drawCentredString((x + LABEL_W / 2) * mm, ty * mm, linea)
        ty -= 3.0


def generar_pdf(mapeo: dict, base_url: str, torres: int, out_path: Path):
    page_w, page_h = A4
    usable_w = page_w / mm - 2 * MARGIN
    usable_h = page_h / mm - 2 * MARGIN
    cols = int((usable_w + GUTTER) // (LABEL_W + GUTTER))
    rows = int((usable_h + GUTTER) // (LABEL_H + GUTTER))
    por_pagina = cols * rows

    c = canvas.Canvas(str(out_path), pagesize=A4)

    col = 0
    row = 0
    total_etiquetas = 0
    resumen = []

    for clave, datos in mapeo.items():
        if clave == "SIN CODIGO":
            continue
        codigo_qr = clave.split("/")[0].strip()
        perfil = datos["perfil"]
        medida = formatear_medida(datos["med"])
        cantidad = int(datos["n"]) * torres
        url = f"{base_url.rstrip('/')}/?p={codigo_qr}"

        resumen.append((clave, cantidad))

        for _ in range(cantidad):
            if row == 0 and col == 0 and total_etiquetas > 0 and total_etiquetas % por_pagina == 0:
                pass  # el salto de página ya se maneja abajo
            x = MARGIN + col * (LABEL_W + GUTTER)
            y = page_h / mm - MARGIN - LABEL_H - row * (LABEL_H + GUTTER)
            dibujar_etiqueta(c, x, y, clave, perfil, medida, url)
            total_etiquetas += 1

            col += 1
            if col >= cols:
                col = 0
                row += 1
                if row >= rows:
                    row = 0
                    c.showPage()

    if col != 0 or row != 0:
        c.showPage()

    c.save()
    return total_etiquetas, resumen


def main():
    ap = argparse.ArgumentParser(description="Genera el PDF de etiquetas QR de piezas.")
    ap.add_argument("--mapeo", type=Path, default=MAPEO_DEFAULT, help="Ruta a mapeo_QR.json")
    ap.add_argument(
        "--url",
        type=str,
        default=None,
        help="URL base definitiva (ej. https://ingepro.com.py/sb/). "
        "Si se omite, usa una URL de PRUEBA y el PDF queda marcado como no apto para impresión final.",
    )
    ap.add_argument("--torres", type=int, default=1, help="Cantidad de torres del lote (multiplica las cantidades)")
    ap.add_argument("--out", type=Path, default=None, help="Archivo PDF de salida")
    args = ap.parse_args()

    mapeo = cargar_mapeo(args.mapeo)

    es_prueba = args.url is None
    base_url = args.url or URL_PRUEBA
    out_path = args.out or (ROOT / ("etiquetas_QR_PRUEBA.pdf" if es_prueba else "etiquetas_QR.pdf"))

    total, resumen = generar_pdf(mapeo, base_url, args.torres, out_path)

    print(f"\nPDF generado: {out_path}")
    print(f"URL base usada: {base_url}")
    if es_prueba:
        print(
            "\n*** ADVERTENCIA: no se pasó --url. Este PDF usa una URL de PRUEBA ***\n"
            "*** y NO debe imprimirse en serie. Confirmar el dominio definitivo ***\n"
            "*** y volver a generar con --url antes de imprimir.               ***"
        )
    print(f"Lote: {args.torres} torre(s)")
    print(f"Total de etiquetas: {total}")
    print(f"Códigos distintos: {len(resumen)}")
    print("\nDetalle por código:")
    for clave, cantidad in resumen:
        print(f"  {clave:12s} {cantidad:5d} etiquetas")


if __name__ == "__main__":
    sys.exit(main())
