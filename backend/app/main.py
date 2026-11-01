"""FastAPI-Anwendung Infrarot-Planer."""
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app import protokoll  # noqa: F401  (registriert das Änderungsprotokoll)
from app.fehlertexte import eingabefehler_text
from app.routers import auth, benutzer, berechnungen, bibliotheken, fachvorgaben, hierarchie, offline, projekte, tabellen

app = FastAPI(
    title="Infrarot-Planer API",
    version="0.2.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)


@app.exception_handler(IntegrityError)
def integritaetsfehler(request: Request, fehler: IntegrityError) -> JSONResponse:
    # Doppelte Schlüssel, ungültige Verweise auf Bibliotheken, noch verwendete Einträge. Häufige Fälle (Projektnummer,
    # E-Mail, Raumtyp) prüfen die Endpunkte vorher selbst und melden sie konkret.
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "Speichern nicht möglich: Ein Eintrag mit diesen Angaben gibt es bereits, oder ein verknüpfter "
                           "Eintrag wurde inzwischen gelöscht oder wird noch verwendet. Bitte die Seite neu laden und "
                           "die Angaben prüfen."},
    )


@app.exception_handler(RequestValidationError)
def eingabefehler(request: Request, fehler: RequestValidationError) -> JSONResponse:
    """Ungültige Eingaben als verständlicher deutscher Text (statt technischer Feldliste)."""
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": eingabefehler_text(fehler.errors())})


@app.get("/api/gesundheit", tags=["System"])
def gesundheit() -> dict:
    return {"status": "ok"}


for modul in (auth, benutzer, projekte, hierarchie, fachvorgaben, bibliotheken, tabellen, berechnungen, offline):
    app.include_router(modul.router, prefix="/api")
