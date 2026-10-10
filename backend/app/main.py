"""FastAPI-Anwendung Infrarot-Planer."""
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app import protokoll  # noqa: F401  (registriert das Änderungsprotokoll)
from app.routers import auth, benutzer, berechnungen, bibliotheken, fachvorgaben, hierarchie, offline, projekte

app = FastAPI(
    title="Infrarot-Planer API",
    version="0.2.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)


@app.exception_handler(IntegrityError)
def integritaetsfehler(request: Request, fehler: IntegrityError) -> JSONResponse:
    # Doppelte Schlüssel, ungültige Verweise auf Bibliotheken, noch verwendete Bibliothekseinträge
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "Konflikt mit vorhandenen Daten (doppelter Eintrag oder ungültiger Verweis)"},
    )


@app.get("/api/gesundheit", tags=["System"])
def gesundheit() -> dict:
    return {"status": "ok"}


for modul in (auth, benutzer, projekte, hierarchie, fachvorgaben, bibliotheken, berechnungen, offline):
    app.include_router(modul.router, prefix="/api")
