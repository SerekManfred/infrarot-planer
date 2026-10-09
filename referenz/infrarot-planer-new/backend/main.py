from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn, json, uuid, logging
from datetime import datetime
from pathlib import Path

from planner import InfrarotPlanner
from document_generator import DocumentGenerator
from pdf_analyzer import PDFAnalyzer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Infrarot-Heizungsplaner API", version="1.3.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

DATA_DIR     = Path("/app/data")
UPLOAD_DIR   = Path("/app/uploads")
OUTPUT_DIR   = Path("/app/outputs")
PROJECTS_DIR = DATA_DIR / "projects"
for d in [DATA_DIR, UPLOAD_DIR, OUTPUT_DIR, PROJECTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

SETTINGS_FILE = DATA_DIR / "settings.json"
RULES_FILE    = DATA_DIR / "rules.json"
MODULES_FILE  = DATA_DIR / "modules.json"

DEFAULT_SETTINGS = {
    "company_name": "Mein Handwerksbetrieb",
    "company_address": "Musterstraße 1",
    "company_zip": "12345",
    "company_city": "Musterstadt",
    "company_phone": "0123 456789",
    "company_email": "info@mein-betrieb.de",
    "company_website": "",
    "tax_number": "",
    "ust_id": "",
    "iban": "",
    "bic": "",
    "bank_name": "",
    "offer_validity_days": 90
}

DEFAULT_RULES = {
    "heat_load_standard": 40,
    "heat_load_bathroom": 80,
    "installation_type": "Decke",
    "min_distance_wall": 50,
    "min_distance_beam": 20,
    "min_distance_light": 50,
    "cost_per_module_installation": 80,
    "cost_electrical_per_room": 100,
    "corner_window_min_area": 4.0,
    "add_corner_module": True
}

DEFAULT_MODULES = [
    {"model": "ST-250",  "width_cm": 70,  "height_cm": 30, "power_w": 250,  "cost_eur": 250},
    {"model": "ST-430",  "width_cm": 90,  "height_cm": 40, "power_w": 430,  "cost_eur": 450},
    {"model": "ST-560",  "width_cm": 120, "height_cm": 40, "power_w": 560,  "cost_eur": 550},
    {"model": "ST-680",  "width_cm": 100, "height_cm": 60, "power_w": 680,  "cost_eur": 600},
    {"model": "ST-860",  "width_cm": 105, "height_cm": 70, "power_w": 860,  "cost_eur": 650},
    {"model": "ST-1035", "width_cm": 150, "height_cm": 60, "power_w": 1035, "cost_eur": 750},
    {"model": "ST-1350", "width_cm": 170, "height_cm": 70, "power_w": 1350, "cost_eur": 780},
]

def load_json(filepath, default):
    if filepath.exists():
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return default

def save_json(filepath, data):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# ── STAMMDATEN ──
@app.get("/api/settings")
async def get_settings():
    s = load_json(SETTINGS_FILE, DEFAULT_SETTINGS)
    s.pop("anthropic_api_key", None)
    return s

@app.post("/api/settings")
async def save_settings(settings: dict):
    api_key = settings.pop("anthropic_api_key", None)
    if api_key:
        with open(DATA_DIR / "api_key.txt", "w") as f:
            f.write(api_key.strip())
    save_json(SETTINGS_FILE, settings)
    return {"status": "ok"}

@app.get("/api/rules")
async def get_rules():
    return load_json(RULES_FILE, DEFAULT_RULES)

@app.post("/api/rules")
async def save_rules(rules: dict):
    save_json(RULES_FILE, rules)
    return {"status": "ok"}

@app.get("/api/modules")
async def get_modules():
    return load_json(MODULES_FILE, DEFAULT_MODULES)

@app.post("/api/modules")
async def save_modules(modules: list):
    save_json(MODULES_FILE, modules)
    return {"status": "ok"}

# ── PROJEKTVERWALTUNG ──
@app.get("/api/projects")
async def list_projects():
    projects = []
    for f in sorted(PROJECTS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            with open(f, "r", encoding="utf-8") as fp:
                p = json.load(fp)
            projects.append({
                "project_id":     p.get("project_id"),
                "project_number": p.get("project_number"),
                "project_name":   p.get("project_name"),
                "created_at":     p.get("created_at"),
                "updated_at":     p.get("updated_at"),
                "customer_name":  p.get("customer", {}).get("contact_name", ""),
                "customer_city":  p.get("customer", {}).get("city", ""),
                "floor_count":    len(p.get("floors", [])),
                "room_count":     sum(len(fl.get("rooms", [])) for fl in p.get("floors", [])),
            })
        except Exception:
            continue
    return projects

@app.post("/api/projects")
async def save_project(project: dict):
    if not project.get("project_id"):
        project["project_id"] = str(uuid.uuid4())[:8]
    project["updated_at"] = datetime.now().isoformat()
    if not project.get("created_at"):
        project["created_at"] = project["updated_at"]
    project_save = json.loads(json.dumps(project))
    for floor in project_save.get("floors", []):
        floor.pop("pdf_base64", None)   # Base64 nicht speichern (zu gross)
        floor.pop("_pdfFile", None)     # File-Objekt nicht speichern
        # pdf_path und pdf_filename BLEIBEN erhalten fuer spaetere PDF-Generierung
    save_json(PROJECTS_DIR / f"{project['project_id']}.json", project_save)
    return {"status": "ok", "project_id": project["project_id"]}

@app.get("/api/projects/{project_id}")
async def load_project(project_id: str):
    filepath = PROJECTS_DIR / f"{project_id}.json"
    if not filepath.exists():
        raise HTTPException(404, "Projekt nicht gefunden")
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    filepath = PROJECTS_DIR / f"{project_id}.json"
    if filepath.exists():
        filepath.unlink()
    return {"status": "ok"}

# ── BAUPLAN ANALYSE ──
@app.post("/api/analyze-floor-plan")
async def analyze_floor_plan(file: UploadFile = File(...), floor_name: str = Form("Erdgeschoss")):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(400, "Nur PDF-Dateien erlaubt")
    content = await file.read()
    temp_path = UPLOAD_DIR / f"plan_{floor_name}_{file.filename}"
    with open(temp_path, "wb") as f:
        f.write(content)
    analyzer = PDFAnalyzer()
    try:
        result = await analyzer.analyze(content, floor_name)
        result["pdf_path"] = str(temp_path)
        result["pdf_filename"] = file.filename
        return result
    except Exception as e:
        logger.error(f"Fehler bei PDF-Analyse: {e}")
        raise HTTPException(500, f"Analysefehler: {str(e)}")

# ── MODUL-PLANUNG ──
@app.post("/api/plan-modules")
async def plan_modules(project: dict):
    rules   = load_json(RULES_FILE, DEFAULT_RULES)
    modules = load_json(MODULES_FILE, DEFAULT_MODULES)
    planner = InfrarotPlanner(rules, modules)
    try:
        return planner.plan_project(project)
    except Exception as e:
        logger.error(f"Planungsfehler: {e}")
        raise HTTPException(500, f"Planungsfehler: {str(e)}")

# ── DOKUMENT-GENERIERUNG ──
@app.post("/api/generate-offer")
async def generate_offer(project: dict):
    settings  = load_json(SETTINGS_FILE, DEFAULT_SETTINGS)
    rules     = load_json(RULES_FILE, DEFAULT_RULES)
    modules   = load_json(MODULES_FILE, DEFAULT_MODULES)
    generator = DocumentGenerator(settings, rules, modules)
    try:
        output_path = OUTPUT_DIR / f"Angebot_{project.get('project_number', 'NEU')}.docx"
        generator.create_offer(project, str(output_path))
        return FileResponse(str(output_path),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=output_path.name)
    except Exception as e:
        logger.error(f"Fehler Dokument: {e}")
        raise HTTPException(500, f"Dokumentfehler: {str(e)}")

@app.post("/api/generate-plan-pdf")
async def generate_plan_pdf(project: dict):
    generator = DocumentGenerator({}, {}, [])
    try:
        output_path = OUTPUT_DIR / f"Bauplan_{project.get('project_number', 'NEU')}.pdf"
        generator.create_annotated_plan(project, str(output_path))
        return FileResponse(str(output_path), media_type="application/pdf", filename=output_path.name)
    except Exception as e:
        logger.error(f"Fehler Plan-PDF: {e}")
        raise HTTPException(500, f"Plan-PDF Fehler: {str(e)}")

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.3.2"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
