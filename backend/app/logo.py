"""Logo-Upload für Firmendaten (Paket M3, 02.11.2026) – abgesichert.

- Erlaubt: PNG, JPEG, SVG, höchstens 2 MB. Der Typ wird am Inhalt erkannt (Magic Bytes bzw. SVG-Wurzelelement),
  nicht an der Endung.
- PNG/JPEG werden mit Pillow geprüft und neu gespeichert (entfernt Metadaten und angehängte Daten).
- SVG wird nie gespeichert oder ausgeliefert: erst mit defusedxml sicher geparst (keine Entitäten/DTD), Skripte,
  Ereignis-Attribute und externe Verweise entfernt, dann serverseitig mit CairoSVG (ohne Zugriff auf Dateien und
  Netz) in PNG umgewandelt. Berichte und Excel arbeiten so immer mit PNG/JPEG.
- Dateiname wird neu vergeben (zufällig), Ablage im Volume uploads/logos, Dateirechte ohne Ausführung (0640).
"""
import io
import os
import secrets
from pathlib import Path

from xml.etree import ElementTree

from defusedxml import ElementTree as SicheresXml
from PIL import Image

MAX_BYTES = 2 * 1024 * 1024
MAX_PIXEL = 4000
SVG_BREITE_PX = 1200
ORDNER = Path(os.environ.get("INFRAROT_LOGO_ORDNER", "/app/uploads/logos"))
SVG_NS = "{http://www.w3.org/2000/svg}"
XLINK = "{http://www.w3.org/1999/xlink}href"
VERBOTEN = {"script", "foreignObject", "iframe", "object", "embed", "audio", "video", "animate", "set", "handler"}


class LogoFehler(ValueError):
    pass


def erkennen(inhalt: bytes) -> str:
    """'png', 'jpeg' oder 'svg' am Inhalt erkennen."""
    if inhalt.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if inhalt.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    kopf = inhalt[:2048].lstrip(b"\xef\xbb\xbf").lstrip()
    if kopf.startswith((b"<?xml", b"<svg", b"<!--")) and b"<svg" in inhalt[:8192]:
        return "svg"
    raise LogoFehler("Nur PNG, JPG oder SVG sind erlaubt (am Dateiinhalt geprüft).")


def _lokal(name: str) -> str:
    return name.split("}", 1)[-1]


def svg_bereinigen(inhalt: bytes) -> bytes:
    """Sicher parsen und alles Ausführbare bzw. Externe entfernen; gibt bereinigtes SVG zurück."""
    try:
        wurzel = SicheresXml.fromstring(inhalt)
    except Exception as e:  # noqa: BLE001 – DTD, Entitäten oder kaputtes XML
        raise LogoFehler("Die SVG-Datei ist ungültig oder enthält nicht erlaubte Bestandteile (DTD/Entitäten).") from e
    if _lokal(wurzel.tag) != "svg":
        raise LogoFehler("Die Datei ist kein SVG-Bild.")
    for eltern in list(wurzel.iter()):
        for kind in list(eltern):
            if _lokal(kind.tag) in VERBOTEN:
                eltern.remove(kind)
    for el in wurzel.iter():
        for attr in list(el.attrib):
            name = _lokal(attr).lower()
            wert = el.attrib[attr].strip().lower()
            if name.startswith("on"):
                del el.attrib[attr]
            elif name == "href" and not (wert.startswith("#") or wert.startswith("data:image/png") or wert.startswith("data:image/jpeg")):
                del el.attrib[attr]
            elif "javascript:" in wert or "url(http" in wert.replace(" ", "") or "@import" in wert:
                del el.attrib[attr]
        if _lokal(el.tag) == "style" and el.text and ("@import" in el.text or "url(" in el.text):
            el.text = ""
    return ElementTree.tostring(wurzel)


def _svg_zu_png(svg: bytes) -> bytes:
    import cairosvg  # erst hier laden (braucht libcairo im Container)

    return cairosvg.svg2png(bytestring=svg, output_width=SVG_BREITE_PX, unsafe=False)


def _raster_pruefen(inhalt: bytes, typ: str) -> tuple[bytes, str]:
    try:
        with Image.open(io.BytesIO(inhalt)) as bild:
            bild.verify()
        bild = Image.open(io.BytesIO(inhalt))
        bild.load()
    except Exception as e:  # noqa: BLE001
        raise LogoFehler("Das Bild lässt sich nicht lesen.") from e
    if (bild.format or "").lower() != typ:
        raise LogoFehler("Dateiinhalt und Bildformat passen nicht zusammen.")
    if bild.width > MAX_PIXEL or bild.height > MAX_PIXEL:
        raise LogoFehler(f"Das Bild ist zu groß (höchstens {MAX_PIXEL} × {MAX_PIXEL} Pixel).")
    aus = io.BytesIO()
    if typ == "png":
        bild.save(aus, "PNG", optimize=True)
        return aus.getvalue(), "png"
    bild.convert("RGB").save(aus, "JPEG", quality=92)
    return aus.getvalue(), "jpg"


def verarbeiten(inhalt: bytes) -> tuple[bytes, str]:
    """Prüft und wandelt das hochgeladene Logo; gibt (Bilddaten, Endung 'png'|'jpg') zurück."""
    if len(inhalt) > MAX_BYTES:
        raise LogoFehler("Das Logo ist größer als 2 MB.")
    if not inhalt:
        raise LogoFehler("Die Datei ist leer.")
    typ = erkennen(inhalt)
    if typ == "svg":
        png = _svg_zu_png(svg_bereinigen(inhalt))
        return _raster_pruefen(png, "png")
    return _raster_pruefen(inhalt, typ)


def speichern(daten: bytes, endung: str) -> str:
    """Unter neuem, zufälligem Namen ablegen (nicht ausführbar); gibt den Dateinamen zurück."""
    ORDNER.mkdir(parents=True, exist_ok=True)
    name = f"logo_{secrets.token_hex(12)}.{endung}"
    pfad = ORDNER / name
    pfad.write_bytes(daten)
    pfad.chmod(0o640)
    return name


def pfad(name: str) -> Path:
    p = (ORDNER / name).resolve()
    if p.parent != ORDNER.resolve():  # nie außerhalb des Ordners
        raise LogoFehler("Ungültiger Dateiname.")
    return p


def loeschen(name: str | None) -> None:
    if name:
        try:
            pfad(name).unlink(missing_ok=True)
        except LogoFehler:
            pass
