"""
Planungslogik für Infrarot-Heizungsmodule
Berechnet Heizlast und wählt optimale Module für jeden Raum
"""
import logging
from typing import List, Dict, Tuple, Optional
import math

logger = logging.getLogger(__name__)


class InfrarotPlanner:
    def __init__(self, rules: dict, modules: list):
        self.rules = rules
        # Module nach Leistung sortieren
        self.modules = sorted(modules, key=lambda m: m["power_w"])

    def plan_project(self, project: dict) -> dict:
        """Komplettes Projekt planen - alle Geschosse"""
        result = {
            "floors": [],
            "summary": {
                "total_rooms": 0,
                "total_modules": 0,
                "total_power_w": 0,
                "total_cost_modules": 0.0,
                "total_cost_installation": 0.0,
                "total_cost_electrical": 0.0,
                "total_cost_net": 0.0,
                "total_vat": 0.0,
                "total_gross": 0.0
            }
        }

        for floor in project.get("floors", []):
            floor_result = self._plan_floor(floor)
            result["floors"].append(floor_result)

            # Zusammenfassung akkumulieren
            s = result["summary"]
            fs = floor_result["summary"]
            s["total_rooms"] += fs["room_count"]
            s["total_modules"] += fs["module_count"]
            s["total_power_w"] += fs["total_power_w"]
            s["total_cost_modules"] += fs["cost_modules"]
            s["total_cost_installation"] += fs["cost_installation"]
            s["total_cost_electrical"] += fs["cost_electrical"]

        net = (result["summary"]["total_cost_modules"] +
               result["summary"]["total_cost_installation"] +
               result["summary"]["total_cost_electrical"])
        result["summary"]["total_cost_net"] = round(net, 2)
        result["summary"]["total_vat"] = round(net * 0.19, 2)
        result["summary"]["total_gross"] = round(net * 1.19, 2)

        return result

    def _plan_floor(self, floor: dict) -> dict:
        """Alle Räume eines Geschosses planen"""
        floor_result = {
            "floor_name": floor.get("floor_name", "Unbekannt"),
            "floor_index": floor.get("floor_index", 0),
            "pdf_path": floor.get("pdf_path"),
            "pdf_base64": floor.get("pdf_base64"),
            "house_width_cm": floor.get("house_width_cm"),
            "house_height_cm": floor.get("house_height_cm"),
            "house_x0_percent": floor.get("house_x0_percent"),
            "house_y0_percent": floor.get("house_y0_percent"),
            "house_x1_percent": floor.get("house_x1_percent"),
            "house_y1_percent": floor.get("house_y1_percent"),
            "wall_thickness_cm": floor.get("wall_thickness_cm") or 25,
            "inner_walls": floor.get("inner_walls", []),
            "house_x0_percent": floor.get("house_x0_percent"),
            "house_y0_percent": floor.get("house_y0_percent"),
            "house_x1_percent": floor.get("house_x1_percent"),
            "house_y1_percent": floor.get("house_y1_percent"),
            
            
            "rooms": [],
            "summary": {
                "room_count": 0,
                "module_count": 0,
                "total_power_w": 0,
                "cost_modules": 0.0,
                "cost_installation": 0.0,
                "cost_electrical": 0.0
            }
        }

        rooms = floor.get("rooms", [])
        cost_per_module = float(self.rules.get("cost_per_module_installation", 80))
        cost_electrical = float(self.rules.get("cost_electrical_per_room", 100))

        for room in rooms:
            room_result = self._plan_room(room)
            floor_result["rooms"].append(room_result)

            # Statistiken akkumulieren
            s = floor_result["summary"]
            s["room_count"] += 1
            module_count = sum(m["quantity"] for m in room_result.get("modules", []))
            s["module_count"] += module_count
            s["total_power_w"] += room_result.get("total_power_w", 0)
            s["cost_modules"] += room_result.get("cost_modules", 0)
            s["cost_installation"] += module_count * cost_per_module
            s["cost_electrical"] += cost_electrical

        return floor_result

    def _plan_room(self, room: dict) -> dict:
        """Module für einen einzelnen Raum planen"""
        # Heizlast berechnen
        heat_load_w = self._calculate_heat_load(room)

        # Module auswählen
        modules_assigned = self._select_modules(room, heat_load_w)

        # Eckfenster-Zusatzmodul prüfen
        if (room.get("has_corner_window") and
                self.rules.get("add_corner_module", True)):
            corner_area = float(room.get("corner_window_area_m2", 0) or 0)
            min_area = float(self.rules.get("corner_window_min_area", 4.0))
            if corner_area >= min_area:
                corner_mod = self._find_module_by_name("ST-680")
                if corner_mod:
                    modules_assigned.append({
                        "model": corner_mod["model"],
                        "quantity": 1,
                        "power_w": corner_mod["power_w"],
                        "cost_eur": corner_mod["cost_eur"],
                        "is_corner_module": True,
                        "placement_note": "Eckfenster-Zusatzmodul – direkt im Eckbereich an der Decke"
                    })

        total_power = sum(m["power_w"] * m["quantity"] for m in modules_assigned)
        total_cost_modules = sum(m["cost_eur"] * m["quantity"] for m in modules_assigned)
        module_count = sum(m["quantity"] for m in modules_assigned)

        return {
            "room_id": room.get("room_id", ""),
            "name": room.get("name", "Unbekannt"),
            "floor": room.get("floor", ""),
            "area_m2": room.get("area_m2", 0),
            "room_type": room.get("room_type", "standard"),
            "heat_load_w_per_m2": self._get_heat_load_per_m2(room),
            "heat_load_required_w": round(heat_load_w, 0),
            "total_power_w": total_power,
            "coverage_percent": round((total_power / heat_load_w * 100) if heat_load_w > 0 else 0, 1),
            "modules": modules_assigned,
            "module_count": module_count,
            "cost_modules": round(total_cost_modules, 2),
            "has_corner_window": room.get("has_corner_window", False),
            "notes": room.get("notes", ""),
            # Raumzentrum
            "x_pos_percent": room.get("x_pos_percent"),
            "y_pos_percent": room.get("y_pos_percent"),
            # Modulpositionen aus KI-Analyse (nach Planungsregeln)
            "module_x_percent": room.get("module_x_percent"),
            "module_y_percent": room.get("module_y_percent"),
            "module_x2_percent": room.get("module_x2_percent"),
            "module_y2_percent": room.get("module_y2_percent"),
            "placement_reason": room.get("placement_reason", ""),
            "x1_cm": room.get("x1_cm"),
            "y1_cm": room.get("y1_cm"),
            "width_cm": room.get("width_cm"),
            "length_cm": room.get("length_cm"),
            # cm-Koordinaten aus KI-Analyse (fuer Grundrisszeichnung)
            "x_cm": room.get("x_cm"),
            "y_cm": room.get("y_cm"),
            "module_x_cm": room.get("module_x_cm"),
            "module_y_cm": room.get("module_y_cm"),
            "module_x2_cm": room.get("module_x2_cm"),
            "module_y2_cm": room.get("module_y2_cm"),
            "placement_reason": room.get("placement_reason", ""),
            "x1_cm": room.get("x1_cm"),
            "y1_cm": room.get("y1_cm"),
        }

    def _calculate_heat_load(self, room: dict) -> float:
        """Heizlast für einen Raum berechnen"""
        area = float(room.get("area_m2", 0))
        if area <= 0:
            return 0.0

        # Individuelle Heizlast?
        custom = room.get("custom_heat_load_w_m2")
        if custom:
            return area * float(custom)

        # Badezimmer
        room_type = room.get("room_type", "standard")
        if room_type == "bathroom":
            return area * float(self.rules.get("heat_load_bathroom", 80))

        return area * float(self.rules.get("heat_load_standard", 40))

    def _get_heat_load_per_m2(self, room: dict) -> float:
        custom = room.get("custom_heat_load_w_m2")
        if custom:
            return float(custom)
        if room.get("room_type") == "bathroom":
            return float(self.rules.get("heat_load_bathroom", 80))
        return float(self.rules.get("heat_load_standard", 40))

    def _select_modules(self, room: dict, heat_load_w: float) -> List[dict]:
        """
        Modulauswahl nach Planungsregeln:
        - Heizlast knapp ueberschreiten (moeglichst kleines Modul)
        - Raum >= 15m2: 2 Module symmetrisch in Bewegungsflaechen
        - Raum 10-15m2: 1 Modul bevorzugt, 2 Module nur wenn sinnvoll
        - Raum < 10m2: immer 1 Modul
        """
        if heat_load_w <= 0 or not self.modules:
            return []

        area = float(room.get("area_m2", 0))

        # ── Regel: Raum >= 15m2 → 2 Module symmetrisch ──
        if area >= 15.0:
            half = heat_load_w / 2.0
            best_half = self._find_best_single_module(half)
            if best_half:
                note = self._get_placement_note(room, best_half)
                note += " - 2x symmetrisch in Bewegungsflaechen"
                return [{
                    "model": best_half["model"],
                    "quantity": 2,
                    "power_w": best_half["power_w"],
                    "cost_eur": best_half["cost_eur"] * 2,
                    "is_corner_module": False,
                    "placement_note": note
                }]

        # ── Regel: 1 Modul - kleinstes das Heizlast deckt ──
        best = self._find_best_single_module(heat_load_w)
        if best:
            return [{
                "model": best["model"],
                "quantity": 1,
                "power_w": best["power_w"],
                "cost_eur": best["cost_eur"],
                "is_corner_module": False,
                "placement_note": self._get_placement_note(room, best)
            }]

        # ── Fallback: mehrere Module wenn Heizlast > groesstes Modul ──
        return self._multi_module_selection(room, heat_load_w, area)


    def _find_best_single_module(self, heat_load_w: float) -> Optional[dict]:
        """Kleinstes Modul das die Heizlast deckt"""
        for mod in self.modules:
            if mod["power_w"] >= heat_load_w:
                return mod
        # Kein einzelnes Modul reicht → Null zurückgeben
        return None

    def _multi_module_selection(self, room: dict, heat_load_w: float, area_m2: float) -> List[dict]:
        """Mehrere Module für große Räume auswählen"""
        assigned = []
        remaining = heat_load_w

        # Versuche mit dem größten Modul anzufangen
        largest = self.modules[-1]  # Sortiert aufsteigend, also letztes = größtes

        while remaining > 0:
            best = self._find_best_single_module(remaining)
            if best:
                # Dieses Modul deckt den Rest
                assigned.append({
                    "model": best["model"],
                    "quantity": 1,
                    "power_w": best["power_w"],
                    "cost_eur": best["cost_eur"],
                    "is_corner_module": False,
                    "placement_note": self._get_placement_note(room, best)
                })
                remaining = 0
            else:
                # Größtes verfügbares Modul nehmen
                assigned.append({
                    "model": largest["model"],
                    "quantity": 1,
                    "power_w": largest["power_w"],
                    "cost_eur": largest["cost_eur"],
                    "is_corner_module": False,
                    "placement_note": self._get_placement_note(room, largest)
                })
                remaining -= largest["power_w"]
                if remaining <= 0:
                    break

        # Gleiche Module zusammenfassen
        return self._consolidate_modules(assigned)

    def _consolidate_modules(self, modules: List[dict]) -> List[dict]:
        """Gleiche Modultypen zusammenfassen"""
        consolidated = {}
        for mod in modules:
            key = mod["model"]
            if key in consolidated:
                consolidated[key]["quantity"] += mod["quantity"]
                consolidated[key]["power_w"] += mod["power_w"]
                consolidated[key]["cost_eur"] += mod["cost_eur"]
            else:
                consolidated[key] = mod.copy()
        return list(consolidated.values())

    def _find_module_by_name(self, model_name: str) -> Optional[dict]:
        for mod in self.modules:
            if mod["model"] == model_name:
                return mod
        # Fallback: ST-680 Werte
        return {"model": "ST-680", "power_w": 680, "cost_eur": 600,
                "width_cm": 100, "height_cm": 60}

    def _get_placement_note(self, room: dict, module: dict) -> str:
        """Platzierungshinweis für ein Modul generieren"""
        room_type = room.get("room_type", "standard")
        name = room.get("name", "")

        if room_type == "bathroom":
            return "Deckenmontage, mind. 50cm von Wänden, IP44 beachten"
        elif any(x in name.lower() for x in ["schlaf", "bett", "kind"]):
            return "Deckenmontage über Fußbereich des Bettes, mind. 50cm von Wänden"
        elif any(x in name.lower() for x in ["büro", "arbeit", "home"]):
            return "Deckenmontage, nicht direkt über Schreibtisch"
        elif any(x in name.lower() for x in ["wohn", "essen", "küche"]):
            return "Deckenmontage, mind. 50cm von Wänden, nicht über Sofa/Esstisch"
        else:
            return "Deckenmontage, mind. 50cm von Wänden"
