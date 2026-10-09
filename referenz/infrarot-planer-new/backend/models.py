"""
Datenmodelle für den Infrarot-Heizungsplaner
"""
from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class ModuleType(BaseModel):
    model: str
    width_cm: float
    height_cm: float
    power_w: int
    cost_eur: float


class RoomData(BaseModel):
    room_id: str
    name: str
    floor: str
    area_m2: float
    room_type: str  # "standard", "bathroom", "custom"
    custom_heat_load_w_m2: Optional[float] = None
    has_corner_window: bool = False
    corner_window_area_m2: Optional[float] = None
    # Aus PDF-Erkennung
    width_cm: Optional[float] = None
    length_cm: Optional[float] = None
    x_pos: Optional[float] = None
    y_pos: Optional[float] = None
    # Berechnet
    heat_load_w: Optional[float] = None
    assigned_modules: Optional[List[Dict]] = None
    notes: Optional[str] = None


class FloorData(BaseModel):
    floor_name: str
    floor_index: int
    pdf_path: Optional[str] = None
    pdf_filename: Optional[str] = None
    pdf_base64: Optional[str] = None
    scale_cm_per_pixel: Optional[float] = None
    rooms: List[RoomData] = []


class CustomerData(BaseModel):
    company_name: Optional[str] = None
    contact_name: str
    address: str
    zip_code: str
    city: str
    phone: Optional[str] = None
    email: Optional[str] = None


class ProjectData(BaseModel):
    project_id: Optional[str] = None
    project_number: str
    project_name: str
    created_at: Optional[str] = None
    customer: CustomerData
    floors: List[FloorData] = []
    planned_modules: Optional[List[Dict]] = None
    total_cost: Optional[float] = None
    notes: Optional[str] = None


class ModuleAssignment(BaseModel):
    room_id: str
    room_name: str
    floor: str
    module_model: str
    quantity: int
    power_w: int
    cost_eur: float
    is_corner_module: bool = False
    position_note: Optional[str] = None


class CompanySettings(BaseModel):
    company_name: str
    company_address: str
    company_zip: str
    company_city: str
    company_phone: str
    company_email: str
    company_website: Optional[str] = None
    tax_number: Optional[str] = None
    ust_id: Optional[str] = None
    iban: Optional[str] = None
    bic: Optional[str] = None
    bank_name: Optional[str] = None
    offer_validity_days: int = 90


class PlacementRules(BaseModel):
    heat_load_standard: float = 40.0
    heat_load_bathroom: float = 80.0
    installation_type: str = "Decke"
    min_distance_wall: int = 50
    min_distance_beam: int = 20
    min_distance_light: int = 50
    cost_per_module_installation: float = 80.0
    cost_electrical_per_room: float = 100.0
    corner_window_min_area: float = 4.0
    add_corner_module: bool = True


class OfferData(BaseModel):
    project: ProjectData
    module_assignments: List[ModuleAssignment]
    subtotal_modules: float
    subtotal_installation: float
    subtotal_electrical: float
    subtotal_net: float
    vat_19: float
    total_gross: float
