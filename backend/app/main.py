"""FastAPI-Anwendung Infrarot-Planer."""
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.routers import auth, benutzer, berechnungen, bibliotheken, hierarchie, projekte

app = FastAPI(
    title="Infrarot-Planer API",
    version="0.1.0",
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


for modul in (auth, benutzer, projekte, hierarchie, bibliotheken, berechnungen):
    app.include_router(modul.router, prefix="/api")
