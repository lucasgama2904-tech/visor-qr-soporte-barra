#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera una imagen PNG por cada código de mapeo_QR.json: el QR arriba y,
debajo, el ID del código, el perfil (en formato legible) y la cantidad por
torre. Sin longitudes — pensado para visualización rápida, no para imprimir
etiquetas de obra (para eso está tools/generate_qr_pdf.py).

Uso:
    py tools/generate_qr_cards.py --url "https://tu-dominio/sb/"
    py tools/generate_qr_cards.py                      (usa la URL de prueba)
"""

import argparse
import json
import re
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_H
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MAPEO_DEFAULT = ROOT / "mapeo_QR.json"
OUT_DEFAULT = ROOT / "QR"

URL_PRUEBA = "https://yard-emission-keyboard-clinton.trycloudflare.com/"

FONT_DIR = Path("C:/Windows/Fonts")
FONT_BOLD = FONT_DIR / "arialbd.ttf"
FONT_REG = FONT_DIR / "arial.ttf"

CARD_W = 640
QR_SIZE = 520
PAD = 24


def cargar_fuente(path, size):
    try:
        return ImageFont.truetype(str(path), size)
    except Exception:
        return ImageFont.load_default()


def formatear_perfil(perfil: str) -> str:
    """'2x2x4,8' -> Ángulo 2" x 2" x 4,8mm ; 'chapa 6.3' -> Platina 6,3mm ; UPN 152 -> igual."""
    m = re.match(r"^([\d½¼¾]+)x([\d½¼¾]+)x([\d.,]+)$", perfil.strip())
    if m:
        a, b, c = m.groups()
        c = c.replace(".", ",")
        return f'Ángulo {a}" x {b}" x {c}mm'

    m2 = re.match(r"^chapa\s+([\d.,]+)$", perfil.strip(), re.IGNORECASE)
    if m2:
        val = m2.group(1)
        if val.endswith(".0"):
            val = val[:-2]
        val = val.replace(".", ",")
        return f"Platina {val}mm"

    return perfil


def hacer_qr(data: str) -> Image.Image:
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=10, border=3)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    return img.resize((QR_SIZE, QR_SIZE), Image.NEAREST)


def hacer_tarjeta(url: str, codigo: str, perfil_fmt: str, cantidad: int) -> Image.Image:
    f_codigo = cargar_fuente(FONT_BOLD, 46)
    f_perfil = cargar_fuente(FONT_REG, 30)
    f_cant = cargar_fuente(FONT_REG, 26)

    tmp = Image.new("RGB", (10, 10))
    d = ImageDraw.Draw(tmp)

    def line_h(font):
        box = d.textbbox((0, 0), "Ag", font=font)
        return box[3] - box[1]

    h_codigo, h_perfil, h_cant = line_h(f_codigo), line_h(f_perfil), line_h(f_cant)
    text_block_h = h_codigo + 14 + h_perfil + 10 + h_cant
    height = PAD + QR_SIZE + PAD + text_block_h + PAD

    img = Image.new("RGB", (CARD_W, height), "white")
    draw = ImageDraw.Draw(img)

    qr_img = hacer_qr(url)
    img.paste(qr_img, ((CARD_W - QR_SIZE) // 2, PAD))

    def center_text(text, font, y):
        box = draw.textbbox((0, 0), text, font=font)
        w = box[2] - box[0]
        draw.text(((CARD_W - w) // 2, y), text, font=font, fill="black")

    y = PAD + QR_SIZE + PAD
    center_text(codigo, f_codigo, y)
    y += h_codigo + 14
    center_text(perfil_fmt, f_perfil, y)
    y += h_perfil + 10
    center_text(f"Cant. por torre: {cantidad}", f_cant, y)

    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mapeo", type=Path, default=MAPEO_DEFAULT)
    ap.add_argument("--url", type=str, default=None, help="URL base para los QR")
    ap.add_argument("--out", type=Path, default=OUT_DEFAULT)
    args = ap.parse_args()

    base_url = (args.url or URL_PRUEBA).rstrip("/")
    es_prueba = args.url is None

    mapeo = json.loads(args.mapeo.read_text(encoding="utf-8"))
    args.out.mkdir(parents=True, exist_ok=True)

    generados = []
    for clave, datos in mapeo.items():
        if clave == "SIN CODIGO":
            continue

        codigo_qr = clave.split("/")[0].strip()
        url = f"{base_url}/?p={codigo_qr}"
        perfil_fmt = formatear_perfil(datos["perfil"])
        cantidad = int(datos["n"])

        img = hacer_tarjeta(url, clave, perfil_fmt, cantidad)
        nombre = clave.replace("/", "-") + ".png"
        img.save(args.out / nombre)
        generados.append(nombre)

    print(f"Generadas {len(generados)} tarjetas QR en: {args.out}")
    print(f"URL base usada: {base_url}/")
    if es_prueba:
        print(
            "\n*** Estas imagenes usan la URL de PRUEBA (tunel temporal). ***\n"
            "*** Van a dejar de funcionar cuando se cierre el tunel.    ***\n"
            "*** Regenerar con --url cuando haya dominio definitivo.    ***"
        )


if __name__ == "__main__":
    main()
