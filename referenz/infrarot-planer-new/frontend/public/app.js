'use strict';

const API = window.location.origin + '/api';

// ═══ STATE ═══
const state = {
  project: null,
  plannedModules: null,
  settings: {},
  rules: {},
  modules: [],
  activeFloorIndex: 0,
};

// ═══ INIT ═══
async function init() {
  await Promise.all([loadSettings(), loadRules(), loadModules()]);
  // Version aus Backend laden
  try {
    var vResp = await fetch(API + '/health');
    var vData = await vResp.json();
    var badge = document.querySelector('.version-badge');
    if (badge && vData.version) badge.textContent = 'v' + vData.version;
  } catch(e) {}
  renderModulesTable();
  renderRulesForm();
  renderSettingsForm();
  updateFloorInputs();
  updateDashboard();
}

// ═══ NAVIGATION ═══
function showView(name) {
  document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });

  var view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');

  var nav = document.getElementById('nav-' + name);
  if (nav) nav.classList.add('active');

  if (name === 'projects')  loadProjectsList();
  if (name === 'rooms')     renderRoomsView();
  if (name === 'offer')     renderOfferView();
  if (name === 'floors')    renderFloorsView();
  if (name === 'dashboard') updateDashboard();
}

// ═══ PROJEKT ANLEGEN ═══
function updateFloorInputs() {
  var count = parseInt(document.getElementById('projFloorCount').value || 1);
  var defaults = ['Erdgeschoss', 'Obergeschoss', 'Dachgeschoss', 'Untergeschoss'];
  var grid = document.getElementById('floorNamesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (var i = 0; i < count; i++) {
    grid.innerHTML += '<div class="form-group"><label class="form-label">Geschoss ' + (i+1) + '</label>' +
      '<input class="form-input" id="floorName' + i + '" value="' + (defaults[i] || 'Geschoss '+(i+1)) + '"></div>';
  }
}

async function createProject() {
  var number  = document.getElementById('projNumber').value.trim();
  var name    = document.getElementById('projName').value.trim();
  var cname   = document.getElementById('custName').value.trim();
  var caddr   = document.getElementById('custAddress').value.trim();
  var czip    = document.getElementById('custZip').value.trim();
  var ccity   = document.getElementById('custCity').value.trim();

  if (!number || !name || !cname || !caddr || !czip || !ccity) {
    toast('Bitte alle Pflichtfelder ausfüllen!', 'error'); return;
  }

  var count = parseInt(document.getElementById('projFloorCount').value);
  var floors = [];
  for (var i = 0; i < count; i++) {
    var fn = document.getElementById('floorName' + i);
    floors.push({ floor_name: fn ? fn.value : ('Geschoss '+(i+1)), floor_index: i, rooms: [] });
  }

  state.project = {
    project_number: number,
    project_name: name,
    created_at: new Date().toISOString(),
    customer: {
      company_name: document.getElementById('custCompany').value.trim() || null,
      contact_name: cname, address: caddr, zip_code: czip, city: ccity,
      phone: document.getElementById('custPhone').value.trim() || null,
      email: document.getElementById('custEmail').value.trim() || null,
    },
    floors: floors,
  };
  state.plannedModules = null;

  document.getElementById('projectStatus').textContent = 'Projekt: ' + name;
  await autoSaveProject();
  updateBadges();
  toast('Projekt angelegt: ' + name, 'success');
  showView('floors');
}

// ═══ PROJEKTVERWALTUNG ═══
async function loadProjectsList() {
  var tbody = document.getElementById('projectsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:16px">Wird geladen...</td></tr>';
  try {
    var resp = await fetch(API + '/projects');
    var projects = await resp.json();
    if (!projects.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">Noch keine Projekte vorhanden</td></tr>';
      return;
    }
    var html = '';
    projects.forEach(function(p) {
      var date = p.updated_at ? new Date(p.updated_at).toLocaleDateString('de-DE') : '-';
      html += '<tr>' +
        '<td><span class="badge badge-orange">' + (p.project_number||'-') + '</span></td>' +
        '<td><strong>' + (p.project_name||'-') + '</strong></td>' +
        '<td>' + (p.customer_name||'-') + '</td>' +
        '<td>' + (p.customer_city||'-') + '</td>' +
        '<td style="text-align:center">' + (p.floor_count||0) + '</td>' +
        '<td style="text-align:center">' + (p.room_count||0) + '</td>' +
        '<td style="font-size:11px;color:var(--muted)">' + date + '</td>' +
        '<td><div class="btn-group">' +
        '<button class="btn btn-sm btn-secondary" onclick="openProject(\'' + p.project_id + '\')">Öffnen</button>' +
        '<button class="btn btn-sm btn-danger" onclick="deleteProject(\'' + p.project_id + '\',\'' + (p.project_name||'').replace(/'/g, '') + '\')">✕</button>' +
        '</div></td></tr>';
    });
    tbody.innerHTML = html;
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--red);padding:16px">Fehler: ' + e.message + '</td></tr>';
  }
}

async function openProject(projectId) {
  showLoading('Projekt wird geladen...', '');
  try {
    var resp = await fetch(API + '/projects/' + projectId);
    var project = await resp.json();
    state.project = project;
    state.plannedModules = null;
    document.getElementById('projectStatus').textContent = 'Projekt: ' + project.project_name;
    updateBadges();
    hideLoading();
    toast('Projekt geladen: ' + project.project_name, 'success');
    showView('dashboard');
    updateDashboard();
  } catch(e) {
    hideLoading();
    toast('Fehler: ' + e.message, 'error');
  }
}

async function deleteProject(projectId, projectName) {
  if (!confirm('Projekt "' + projectName + '" wirklich löschen?')) return;
  try {
    await fetch(API + '/projects/' + projectId, { method: 'DELETE' });
    toast('Projekt gelöscht', 'success');
    loadProjectsList();
  } catch(e) {
    toast('Fehler: ' + e.message, 'error');
  }
}

async function autoSaveProject() {
  if (!state.project) return;
  try {
    var resp = await fetch(API + '/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.project)
    });
    var result = await resp.json();
    if (result.project_id) state.project.project_id = result.project_id;
  } catch(e) {
    console.warn('Auto-Save fehlgeschlagen:', e);
  }
}

// ═══ BAUPLÄNE ═══
function renderFloorsView() {
  var container = document.getElementById('floors-container');
  if (!state.project) {
    container.innerHTML = '<div class="alert alert-warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>Bitte zuerst ein Projekt anlegen.</div>';
    return;
  }
  var html = '';
  state.project.floors.forEach(function(floor, idx) {
    var hasRooms = floor.rooms && floor.rooms.length > 0;
    var hasPdf = floor.pdf_base64 || floor.pdf_path;
    html += '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-header"><div class="card-title">' + floor.floor_name +
      (hasRooms ? ' <span class="badge badge-green">' + floor.rooms.length + ' Räume</span>' : '') +
      (hasPdf && !hasRooms ? ' <span class="badge badge-orange">PDF hochgeladen</span>' : '') +
      '</div></div>' +
      '<div class="card-body">' +
      '<div class="upload-zone" id="uploadZone' + idx + '" ondragover="dragOver(event,' + idx + ')" ondragleave="dragLeave(' + idx + ')" ondrop="dropFile(event,' + idx + ')">' +
      '<input type="file" accept=".pdf" onchange="handleFileSelect(event,' + idx + ')">';
    if (hasPdf) {
      html += '<div class="upload-file-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>' +
        (floor.pdf_filename || 'Bauplan.pdf') + ' <span class="badge badge-green" style="margin-left:8px">✓</span></div>';
    } else {
      html += '<div class="upload-icon">📐</div><div class="upload-text">PDF hierher ziehen oder klicken</div><div class="upload-hint">Max. 20 MB · PDF-Grundriss</div>';
    }
    html += '</div>';
    if (hasPdf && !hasRooms) {
      html += '<div style="margin-top:12px"><button class="btn btn-primary" onclick="analyzeFloor(' + idx + ')">KI-Analyse starten</button></div>';
    }
    if (hasRooms) {
      html += '<div class="alert alert-success" style="margin-top:12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' +
        floor.rooms.length + ' Räume erkannt. ' +
        '<button class="btn btn-sm btn-secondary" style="margin-left:8px" onclick="reanalyzeFloor(' + idx + ')">Neu analysieren</button></div>';
    }
    html += '</div></div>';
  });
  html += '<div class="btn-group"><button class="btn btn-primary" onclick="showView(\'rooms\')">Weiter zu Räumen →</button></div>';
  container.innerHTML = html;
}

function dragOver(e, idx) { e.preventDefault(); var z = document.getElementById('uploadZone'+idx); if(z) z.classList.add('drag-over'); }
function dragLeave(idx) { var z = document.getElementById('uploadZone'+idx); if(z) z.classList.remove('drag-over'); }
async function dropFile(e, idx) { e.preventDefault(); dragLeave(idx); var f = e.dataTransfer.files[0]; if(f) await uploadFloorPdf(f, idx); }
async function handleFileSelect(e, idx) { var f = e.target.files[0]; if(f) await uploadFloorPdf(f, idx); }

async function uploadFloorPdf(file, idx) {
  if (!file.name.toLowerCase().endsWith('.pdf')) { toast('Nur PDF-Dateien erlaubt', 'error'); return; }
  if (file.size > 20 * 1024 * 1024) { toast('Datei zu groß (max. 20 MB)', 'error'); return; }
  var b64 = await fileToBase64(file);
  state.project.floors[idx].pdf_base64 = b64;
  state.project.floors[idx].pdf_filename = file.name;
  state.project.floors[idx]._pdfFile = file;
  toast(file.name + ' hochgeladen', 'success');
  renderFloorsView();
}

async function analyzeFloor(idx) {
  var floor = state.project.floors[idx];
  if (!floor._pdfFile && !floor.pdf_base64) { toast('Kein PDF vorhanden', 'error'); return; }
  showLoading('KI analysiert ' + floor.floor_name + '...', 'Das kann 20-60 Sekunden dauern');
  try {
    var formData = new FormData();
    if (floor._pdfFile) {
      formData.append('file', floor._pdfFile);
    } else {
      formData.append('file', base64ToBlob(floor.pdf_base64, 'application/pdf'), floor.pdf_filename || 'plan.pdf');
    }
    formData.append('floor_name', floor.floor_name);
    var resp = await fetch(API + '/analyze-floor-plan', { method: 'POST', body: formData });
    if (!resp.ok) { var err = await resp.json(); throw new Error(err.detail || 'Analysefehler'); }
    var result = await resp.json();
    state.project.floors[idx].rooms = (result.rooms || []).map(function(r) {
      return Object.assign({}, r, { floor: floor.floor_name });
    });
    if (result.pdf_base64) state.project.floors[idx].pdf_base64 = result.pdf_base64;
    await autoSaveProject();
    updateBadges();
    hideLoading();
    toast((result.rooms||[]).length + ' Räume in ' + floor.floor_name + ' erkannt!', 'success');
    renderFloorsView();
  } catch(e) {
    hideLoading();
    toast('Fehler: ' + e.message, 'error');
  }
}

async function reanalyzeFloor(idx) { state.project.floors[idx].rooms = []; await analyzeFloor(idx); }

// ═══ RÄUME & MODULE ═══
function renderRoomsView() {
  if (!state.project) return;
  var nav = document.getElementById('floorTabNav');
  nav.innerHTML = state.project.floors.map(function(f, i) {
    return '<div class="floor-tab ' + (i === state.activeFloorIndex ? 'active' : '') + '" onclick="setActiveFloor(' + i + ')">' +
      f.floor_name + ' (' + (f.rooms ? f.rooms.length : 0) + ')</div>';
  }).join('');
  renderFloorRooms(state.activeFloorIndex);
}

function setActiveFloor(idx) { state.activeFloorIndex = idx; renderRoomsView(); }

function renderFloorRooms(floorIdx) {
  var floor = state.project.floors[floorIdx];
  var content = document.getElementById('floorRoomsContent');
  if (!floor.rooms || !floor.rooms.length) {
    content.innerHTML = '<div class="alert alert-warning" style="margin-top:12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>Keine Räume – bitte Bauplan hochladen und analysieren.</div>' +
      '<div style="margin-top:12px"><button class="btn btn-primary" onclick="showView(\'floors\')">Zu Bauplänen →</button></div>';
    return;
  }
  var html = '<div class="rooms-grid" style="margin-top:16px">';
  floor.rooms.forEach(function(room, roomIdx) {
    var heatLoad = room.heat_load_required_w || ((room.room_type === 'bathroom' ? 80 : 40) * (room.area_m2 || 0));
    var modules = room.modules || [];
    var modCount = modules.reduce(function(s,m) { return s + (m.quantity||1); }, 0);
    html += '<div class="room-card">' +
      '<div class="room-card-header">' +
        '<div class="room-name">' + room.name + '</div>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
          '<span class="badge ' + (room.room_type === 'bathroom' ? 'badge-blue' : 'badge-orange') + '">' + (room.room_type === 'bathroom' ? 'Bad' : 'Standard') + '</span>' +
          '<button class="btn btn-sm btn-danger" onclick="removeRoom(' + floorIdx + ',' + roomIdx + ')" style="padding:3px 6px">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="room-body">' +
        '<div class="form-grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">' +
          '<div class="form-group"><label class="form-label" style="font-size:11px">Fläche (m²)</label>' +
            '<input class="form-input" style="padding:5px 8px;font-size:12px" type="number" step="0.5" value="' + (room.area_m2||0) + '" onchange="updateRoom(' + floorIdx + ',' + roomIdx + ',\'area_m2\',parseFloat(this.value))"></div>' +
          '<div class="form-group"><label class="form-label" style="font-size:11px">Raumtyp</label>' +
            '<select class="form-select" style="padding:5px 8px;font-size:12px" onchange="updateRoom(' + floorIdx + ',' + roomIdx + ',\'room_type\',this.value)">' +
              '<option value="standard"' + (room.room_type !== 'bathroom' ? ' selected' : '') + '>Standard</option>' +
              '<option value="bathroom"' + (room.room_type === 'bathroom' ? ' selected' : '') + '>Bad/WC</option>' +
            '</select></div>' +
          '<div class="form-group"><label class="form-label" style="font-size:11px">Ind. W/m²</label>' +
            '<input class="form-input" style="padding:5px 8px;font-size:12px" type="number" step="5" value="' + (room.custom_heat_load_w_m2||'') + '" placeholder="Standard" onchange="updateRoom(' + floorIdx + ',' + roomIdx + ',\'custom_heat_load_w_m2\',this.value?parseFloat(this.value):null)"></div>' +
          '<div class="form-group"><label class="form-label" style="font-size:11px">Eckfenster</label>' +
            '<select class="form-select" style="padding:5px 8px;font-size:12px" onchange="updateRoom(' + floorIdx + ',' + roomIdx + ',\'has_corner_window\',this.value===\'true\')">' +
              '<option value="false"' + (!room.has_corner_window ? ' selected' : '') + '>Nein</option>' +
              '<option value="true"' + (room.has_corner_window ? ' selected' : '') + '>Ja</option>' +
            '</select></div>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">Heizlast: <strong style="color:var(--accent)">' + Math.round(heatLoad) + ' W</strong>' +
          (modCount > 0 ? ' · <strong style="color:var(--green)">' + modCount + ' Modul(e)</strong>' : '') + '</div>';
    if (modules.length) {
      modules.forEach(function(m) {
        html += '<div class="room-module-item">' +
          '<div class="module-icon ' + (m.is_corner_module ? 'corner' : '') + '">' + (m.model||'').replace('ST-','') + '</div>' +
          '<div><strong>' + (m.model||'') + '</strong>' + (m.quantity > 1 ? ' ×'+m.quantity : '') + ' · ' + ((m.power_w||0)*(m.quantity||1)) + ' W</div>' +
          '<div style="margin-left:auto;font-size:11px;color:var(--muted)">' + ((m.cost_eur||0)*(m.quantity||1)).toFixed(0) + ' €</div></div>';
        if (m.placement_note) html += '<div style="font-size:10px;color:var(--muted);padding:0 10px 4px;font-style:italic">' + m.placement_note + '</div>';
      });
    } else {
      html += '<div style="font-size:11px;color:var(--muted);font-style:italic">Noch keine Module geplant</div>';
    }
    html += '</div></div>';
  });
  html += '</div><div style="margin-top:12px"><button class="btn btn-sm btn-secondary" onclick="addRoomManually(' + floorIdx + ')">+ Raum manuell hinzufügen</button></div>';
  content.innerHTML = html;
}

function updateRoom(floorIdx, roomIdx, field, value) {
  state.project.floors[floorIdx].rooms[roomIdx][field] = value;
  if (['area_m2','room_type','custom_heat_load_w_m2'].indexOf(field) >= 0) {
    state.project.floors[floorIdx].rooms[roomIdx].modules = null;
  }
  updateBadges();
}

function removeRoom(floorIdx, roomIdx) {
  state.project.floors[floorIdx].rooms.splice(roomIdx, 1);
  renderRoomsView(); updateBadges();
}

function addRoomManually(floorIdx) {
  var name = prompt('Raumname:'); if (!name) return;
  var area = parseFloat(prompt('Fläche in m²:') || 0);
  state.project.floors[floorIdx].rooms.push({
    room_id: 'R-' + Date.now(), name: name,
    floor: state.project.floors[floorIdx].floor_name,
    area_m2: area, room_type: 'standard', has_corner_window: false,
  });
  renderRoomsView(); updateBadges();
}

// ═══ MODUL-PLANUNG ═══
async function planAllModules() {
  if (!state.project) { toast('Kein Projekt aktiv', 'error'); return; }
  showLoading('Module werden geplant...', 'Heizlast wird berechnet');
  try {
    var resp = await fetch(API + '/plan-modules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.project)
    });
    if (!resp.ok) throw new Error((await resp.json()).detail);
    var result = await resp.json();
    (result.floors || []).forEach(function(floorResult, fi) {
      if (state.project.floors[fi]) {
        (floorResult.rooms || []).forEach(function(roomResult, ri) {
          if (state.project.floors[fi].rooms[ri]) {
            state.project.floors[fi].rooms[ri] = Object.assign({}, state.project.floors[fi].rooms[ri], roomResult);
          }
        });
      }
    });
    state.plannedModules = result;
    await autoSaveProject();
    hideLoading();
    var s = result.summary;
    toast(s.total_modules + ' Module · ' + (s.total_power_w/1000).toFixed(1) + ' kW · ' + s.total_cost_net.toFixed(0) + ' € netto', 'success');
    updateDashboard(); renderRoomsView(); updateBadges();
  } catch(e) { hideLoading(); toast('Fehler: ' + e.message, 'error'); }
}

// ═══ ANGEBOT ═══
function renderOfferView() {
  var container = document.getElementById('offerSummary');
  if (!state.project || !state.plannedModules) {
    container.innerHTML = '<div class="alert alert-warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>Bitte zuerst Module planen.</div>';
    return;
  }
  var s = state.plannedModules.summary;
  container.innerHTML =
    '<div class="stats-grid">' +
      '<div class="stat-card"><div class="stat-label">Module</div><div class="stat-value">' + s.total_modules + '</div><div class="stat-sub">' + s.total_rooms + ' Räume</div></div>' +
      '<div class="stat-card"><div class="stat-label">Leistung</div><div class="stat-value">' + (s.total_power_w/1000).toFixed(2) + ' kW</div></div>' +
      '<div class="stat-card"><div class="stat-label">Material</div><div class="stat-value">' + s.total_cost_modules.toFixed(0) + ' €</div><div class="stat-sub">netto</div></div>' +
      '<div class="stat-card"><div class="stat-label">Montage</div><div class="stat-value">' + (s.total_cost_installation + s.total_cost_electrical).toFixed(0) + ' €</div></div>' +
    '</div>' +
    '<div class="cost-summary">' +
      '<div class="cost-row"><span>Infrarot-Module (Material)</span><span class="cost-value">' + s.total_cost_modules.toFixed(2) + ' €</span></div>' +
      '<div class="cost-row"><span>Montagekosten</span><span class="cost-value">' + s.total_cost_installation.toFixed(2) + ' €</span></div>' +
      '<div class="cost-row"><span>Elektroinstallation inkl. Thermostat</span><span class="cost-value">' + s.total_cost_electrical.toFixed(2) + ' €</span></div>' +
      '<div class="cost-row"><span><strong>Zwischensumme (netto)</strong></span><span class="cost-value"><strong>' + s.total_cost_net.toFixed(2) + ' €</strong></span></div>' +
      '<div class="cost-row"><span>Umsatzsteuer 19 %</span><span class="cost-value">' + s.total_vat.toFixed(2) + ' €</span></div>' +
      '<div class="cost-row total"><span>GESAMTBETRAG (brutto)</span><span class="cost-value">' + s.total_gross.toFixed(2) + ' €</span></div>' +
    '</div>';
}

async function generateOffer() {
  if (!state.project) { toast('Kein Projekt aktiv', 'error'); return; }
  showLoading('Angebot wird erstellt...', 'Word-Dokument wird generiert');
  try {
    var resp = await fetch(API + '/generate-offer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, state.project, { planned_modules: state.plannedModules }))
    });
    if (!resp.ok) throw new Error((await resp.json()).detail);
    downloadBlob(await resp.blob(), 'Angebot_' + state.project.project_number + '.docx');
    hideLoading(); toast('Word-Angebot heruntergeladen!', 'success');
  } catch(e) { hideLoading(); toast('Fehler: ' + e.message, 'error'); }
}

async function generatePlanPdf() {
  if (!state.project) { toast('Kein Projekt aktiv', 'error'); return; }
  showLoading('Bauplan-PDF wird erstellt...', 'Module werden eingezeichnet');
  try {
    // Projekt mit Base64 senden (falls im State vorhanden)
    var projectData = JSON.parse(JSON.stringify(state.project));
    // Base64 aus originalem State hinzufuegen (wird nicht in DB gespeichert)
    projectData.floors.forEach(function(floor, i) {
      if (state.project.floors[i] && state.project.floors[i].pdf_base64) {
        floor.pdf_base64 = state.project.floors[i].pdf_base64;
      }
    });
    var resp = await fetch(API + '/generate-plan-pdf', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projectData)
    });
    if (!resp.ok) throw new Error((await resp.json()).detail);
    downloadBlob(await resp.blob(), 'Bauplan_' + state.project.project_number + '.pdf');
    hideLoading(); toast('Bauplan-PDF heruntergeladen!', 'success');
  } catch(e) { hideLoading(); toast('Fehler: ' + e.message, 'error'); }
}

// ═══ MODULE EDITOR ═══
function renderModulesTable() {
  var tbody = document.getElementById('modulesTableBody');
  if (!tbody) return;
  tbody.innerHTML = state.modules.map(function(m, i) {
    return '<tr>' +
      '<td><input class="editable" value="' + m.model + '" onchange="state.modules[' + i + '].model=this.value"></td>' +
      '<td><input class="editable" type="number" value="' + m.width_cm + '" onchange="state.modules[' + i + '].width_cm=parseFloat(this.value)"></td>' +
      '<td><input class="editable" type="number" value="' + m.height_cm + '" onchange="state.modules[' + i + '].height_cm=parseFloat(this.value)"></td>' +
      '<td><input class="editable" type="number" value="' + m.power_w + '" onchange="state.modules[' + i + '].power_w=parseInt(this.value)"></td>' +
      '<td><input class="editable" type="number" value="' + m.cost_eur + '" onchange="state.modules[' + i + '].cost_eur=parseFloat(this.value)"></td>' +
      '<td><button class="btn btn-sm btn-danger" onclick="deleteModuleRow(' + i + ')">✕</button></td>' +
      '</tr>';
  }).join('');
}

function addModuleRow() { state.modules.push({ model: 'ST-NEU', width_cm: 100, height_cm: 60, power_w: 500, cost_eur: 500 }); renderModulesTable(); }
function deleteModuleRow(i) { state.modules.splice(i, 1); renderModulesTable(); }

async function saveModules() {
  try {
    await fetch(API + '/modules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.modules) });
    toast('Module gespeichert!', 'success');
  } catch(e) { toast('Fehler: ' + e.message, 'error'); }
}

// ═══ REGELN ═══
function renderRulesForm() {
  var r = state.rules;
  var fields = {
    'rule-heat-standard': r.heat_load_standard || 40,
    'rule-heat-bathroom': r.heat_load_bathroom || 80,
    'rule-dist-wall':     r.min_distance_wall || 50,
    'rule-dist-beam':     r.min_distance_beam || 20,
    'rule-dist-light':    r.min_distance_light || 50,
    'rule-cost-module':   r.cost_per_module_installation || 80,
    'rule-cost-elec':     r.cost_electrical_per_room || 100,
    'rule-corner-area':   r.corner_window_min_area || 4.0,
  };
  Object.keys(fields).forEach(function(id) { var el = document.getElementById(id); if (el) el.value = fields[id]; });
  var ca = document.getElementById('rule-corner-add');
  if (ca) ca.value = r.add_corner_module !== false ? 'true' : 'false';
}

async function saveRules() {
  var get = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
  var rules = {
    heat_load_standard: parseFloat(get('rule-heat-standard')),
    heat_load_bathroom: parseFloat(get('rule-heat-bathroom')),
    min_distance_wall: parseInt(get('rule-dist-wall')),
    min_distance_beam: parseInt(get('rule-dist-beam')),
    min_distance_light: parseInt(get('rule-dist-light')),
    cost_per_module_installation: parseFloat(get('rule-cost-module')),
    cost_electrical_per_room: parseFloat(get('rule-cost-elec')),
    corner_window_min_area: parseFloat(get('rule-corner-area')),
    add_corner_module: get('rule-corner-add') === 'true',
  };
  try {
    await fetch(API + '/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rules) });
    state.rules = rules; toast('Planungsregeln gespeichert!', 'success');
  } catch(e) { toast('Fehler: ' + e.message, 'error'); }
}

// ═══ EINSTELLUNGEN ═══
function renderSettingsForm() {
  var s = state.settings;
  var fields = { 'set-company': s.company_name, 'set-address': s.company_address, 'set-zip': s.company_zip, 'set-city': s.company_city, 'set-phone': s.company_phone, 'set-email': s.company_email, 'set-website': s.company_website, 'set-taxnr': s.tax_number, 'set-ustid': s.ust_id, 'set-bank': s.bank_name, 'set-iban': s.iban, 'set-bic': s.bic, 'set-validity': s.offer_validity_days || 90 };
  Object.keys(fields).forEach(function(id) { var el = document.getElementById(id); if (el) el.value = fields[id] || ''; });
}

async function saveSettings() {
  var get = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var settings = { company_name: get('set-company'), company_address: get('set-address'), company_zip: get('set-zip'), company_city: get('set-city'), company_phone: get('set-phone'), company_email: get('set-email'), company_website: get('set-website'), tax_number: get('set-taxnr'), ust_id: get('set-ustid'), bank_name: get('set-bank'), iban: get('set-iban'), bic: get('set-bic'), offer_validity_days: parseInt(get('set-validity')) || 90 };
  var apiKey = get('set-apikey');
  if (apiKey) settings.anthropic_api_key = apiKey;
  try {
    await fetch(API + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    state.settings = settings; toast('Einstellungen gespeichert!', 'success');
  } catch(e) { toast('Fehler: ' + e.message, 'error'); }
}

// ═══ DASHBOARD ═══
function updateDashboard() {
  if (!state.project) return;
  var allRooms = state.project.floors.reduce(function(a, f) { return a.concat(f.rooms || []); }, []);
  var allModules = allRooms.reduce(function(a, r) { return a.concat(r.modules || []); }, []);
  var totalMods  = allModules.reduce(function(s, m) { return s + (m.quantity||1); }, 0);
  var totalPower = allModules.reduce(function(s, m) { return s + ((m.power_w||0)*(m.quantity||1)); }, 0);
  var totalCost  = allModules.reduce(function(s, m) { return s + ((m.cost_eur||0)*(m.quantity||1)); }, 0);

  document.getElementById('stat-rooms').textContent = allRooms.length;
  document.getElementById('stat-modules').textContent = totalMods;
  document.getElementById('stat-power').textContent = totalPower >= 1000 ? (totalPower/1000).toFixed(1)+' kW' : totalPower+' W';
  document.getElementById('stat-cost').textContent = totalCost.toFixed(0) + ' €';

  document.getElementById('dashboardEmpty').style.display = allRooms.length ? 'none' : 'flex';
  document.getElementById('dashboardContent').style.display = allRooms.length ? 'block' : 'none';

  if (allRooms.length) {
    var html = state.project.floors.map(function(f) {
      return '<div style="margin-bottom:12px"><div style="font-weight:700;margin-bottom:6px;color:var(--accent)">' + f.floor_name + '</div><div style="display:flex;gap:8px;flex-wrap:wrap">' +
        (f.rooms||[]).map(function(r) { return '<span class="badge badge-gray">' + r.name + ' (' + r.area_m2 + ' m²)</span>'; }).join('') +
        '</div></div>';
    }).join('');
    document.getElementById('dashboardFloorList').innerHTML = html;
  }
}

// ═══ DATEN LADEN ═══
async function loadSettings() { try { state.settings = await (await fetch(API + '/settings')).json(); } catch(e) {} }
async function loadRules()    { try { state.rules    = await (await fetch(API + '/rules')).json();    } catch(e) {} }
async function loadModules()  { try { state.modules  = await (await fetch(API + '/modules')).json();  } catch(e) {} }

// ═══ BADGES ═══
function updateBadges() {
  if (!state.project) return;
  var allRooms = state.project.floors.reduce(function(a,f) { return a.concat(f.rooms||[]); }, []);
  var fb = document.getElementById('floorsBadge');
  var rb = document.getElementById('roomsBadge');
  if (fb) { fb.textContent = state.project.floors.length; fb.style.display = 'flex'; }
  if (rb) { rb.textContent = allRooms.length; rb.style.display = allRooms.length ? 'flex' : 'none'; }
}

// ═══ HILFSFUNKTIONEN ═══
function showLoading(title, sub) {
  document.getElementById('loadingTitle').textContent = title || 'Wird geladen...';
  document.getElementById('loadingSub').textContent = sub || '';
  document.getElementById('loadingOverlay').classList.add('active');
}
function hideLoading() { document.getElementById('loadingOverlay').classList.remove('active'); }

function toast(msg, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  var el = document.createElement('div');
  el.className = 'toast ' + type;
  var icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.innerHTML = '<span style="font-size:16px">' + (icons[type]||'ℹ') + '</span><span>' + msg + '</span>';
  container.appendChild(el);
  setTimeout(function() { el.style.opacity='0'; el.style.transform='translateX(100%)'; el.style.transition='.3s'; setTimeout(function() { el.remove(); }, 300); }, 4000);
}

function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function fileToBase64(file) {
  return new Promise(function(res, rej) {
    var r = new FileReader();
    r.onload = function() { res(r.result.split(',')[1]); };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function base64ToBlob(b64, mime) {
  var bytes = atob(b64);
  var arr = new Uint8Array(bytes.length);
  for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// Start
document.addEventListener('DOMContentLoaded', init);
