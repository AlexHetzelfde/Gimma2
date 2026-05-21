// ════════════════════════════════════════
// CONSTANTEN
// ════════════════════════════════════════
const LS_KEY          = 'wikileer_api_key';
const LS_SR           = 'wikileer_sr';
const LS_LAST_SESSION = 'wikileer_last_session';
const LS_LAYOUT       = 'wikileer_layout';
const LS_CATS         = 'wikileer_categories';
const LS_STREAK       = 'wikileer_streak';
const LS_FEEDBACK     = 'wikileer_feedback';
const LS_GITHUB_TOKEN = 'wikileer_github_token';
const LS_GESELECTEERDE_CATS = 'wikileer_geselecteerde_cats';
const REPO_OWNER = 'AlexHetzelfde';
const REPO_NAME  = 'Gimma2';

function lokaalDatum(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ════════════════════════════════════════
// INDEXEDDB LAAG (ongewijzigd)
// ════════════════════════════════════════
const DB_NAAM = 'wikileer_db';
const DB_VERSIE = 1;
const STORE_KV = 'kv';
let db = null;
const _memFallback = {};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAAM, DB_VERSIE);
    req.onupgradeneeded = e => { e.target.result.createObjectStore(STORE_KV); };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(sleutel) {
  if (!db) return Promise.resolve(_memFallback[sleutel] ?? null);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readonly');
    const req = tx.objectStore(STORE_KV).get(sleutel);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

function dbSet(sleutel, waarde) {
  if (!db) { _memFallback[sleutel] = waarde; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readwrite');
    const req = tx.objectStore(STORE_KV).put(waarde, sleutel);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function migreerVanLocalStorage() {
  const alGedaan = await dbGet('_migratie_gedaan');
  if (alGedaan) return;
  const teVerhuizen = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('wikileer_')) teVerhuizen.push(k);
  }
  for (const k of teVerhuizen) {
    const waarde = localStorage.getItem(k);
    if (waarde !== null) {
      try { await dbSet(k, waarde); localStorage.removeItem(k); } catch(e) {}
    }
  }
  await dbSet('_migratie_gedaan', '1');
}

async function haalKey() { return (await dbGet(LS_KEY)) || ''; }
async function slaKeyOp(k) { await dbSet(LS_KEY, k.trim()); }

async function haalSRData() {
  try { const raw = await dbGet(LS_SR); return raw ? JSON.parse(raw) : []; } catch(e) { return []; }
}
async function slaSRDataOp(data) { await dbSet(LS_SR, JSON.stringify(data)); }

function vandaagProgSleutel() { return 'wikileer_prog_' + lokaalDatum(); }

async function haalVoortgang() {
  const raw = await dbGet(vandaagProgSleutel());
  return raw ? JSON.parse(raw) : null;
}
async function slaVoortgangOp(obj) { await dbSet(vandaagProgSleutel(), JSON.stringify(obj)); }
async function verwijderVoortgang() { await dbDelete(vandaagProgSleutel()); }

async function haalGithubToken() { return (await dbGet(LS_GITHUB_TOKEN)) || ''; }
async function slaGithubTokenOp(token) { await dbSet(LS_GITHUB_TOKEN, token.trim()); }

async function haalGeselecteerdeCategorieen() {
  const raw = await dbGet(LS_GESELECTEERDE_CATS);
  return raw ? JSON.parse(raw) : ['nl_uitgelicht'];
}
async function slaGeselecteerdeCategorieenLokaalOp(ids) { await dbSet(LS_GESELECTEERDE_CATS, JSON.stringify(ids)); }

async function haalCategorieën() {
  const raw = await dbGet(LS_CATS); return raw ? JSON.parse(raw) : [];
}
async function slaCategoriënOp(cats) { await dbSet(LS_CATS, JSON.stringify(cats)); }

// ════════════════════════════════════════
// LEERPAD DATA OPHALEN (VAN GITHUB)
// ════════════════════════════════════════

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fout bij ophalen ${url}`);
  return res.json();
}

function rawURL(pad) {
  return `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${pad}`;
}

async function haalActiefLeerpad() {
  try {
    const data = await fetchJSON(rawURL('actief-leerpad.json'));
    if (data && data.id) return data;
  } catch(e) { console.warn('Geen actief leerpad:', e); }
  return null;
}

async function haalArchiefOverzichten() {
  try {
    // Omdat we niet alle bestanden kunnen lijsten, gebruiken we een fallback: tonen alleen statische lijst als aanwezig.
    // Voor nu retourneren we een lege array; we kunnen later een index.json genereren.
    return [];
  } catch(e) { return []; }
}

async function haalLes(padId, lesNummer) {
  const cacheKey = `les_${padId}_${lesNummer}`;
  const cached = await dbGet(cacheKey);
  if (cached) return JSON.parse(cached);
  
  const url = rawURL(`lessen/${padId}-les-${lesNummer}.json`);
  const data = await fetchJSON(url);
  await dbSet(cacheKey, JSON.stringify(data));
  return data;
}

// ════════════════════════════════════════
// SIDEBAR
// ════════════════════════════════════════

function openSidebar() {
  document.getElementById('sidebar-overlay').classList.add('zichtbaar');
  document.getElementById('sidebar').classList.add('open');
  renderSidebar();
}

function sluitSidebar() {
  document.getElementById('sidebar-overlay').classList.remove('zichtbaar');
  document.getElementById('sidebar').classList.remove('open');
}

async function renderSidebar() {
  const inhoud = document.getElementById('sidebar-inhoud');
  inhoud.innerHTML = '';

  const actief = await haalActiefLeerpad();
  const archief = await haalArchiefOverzichten();

  // Actief pad
  if (actief) {
    const beschikbaar = actief.lessen.filter(l => l.status === 'beschikbaar').length;
    const totaal = actief.aantalLessen;
    const voortgangPct = Math.round((beschikbaar / totaal) * 100);
    
    inhoud.innerHTML += `
      <div class="sidebar-sectie-kop">Actief</div>
      <div class="sidebar-pad-rij" onclick="toonLeerpadDetail('${actief.id}')">
        <span class="sidebar-pad-icoon">●</span>
        <div class="sidebar-pad-info">
          <div class="sidebar-pad-naam">${actief.onderwerp}</div>
          <div class="sidebar-pad-meta">Les ${beschikbaar} van ${totaal} · ${actief.categorieId}</div>
        </div>
        <div class="sidebar-pad-voortgang">${voortgangPct}%</div>
      </div>`;
  }

  // Archief (nu nog leeg, maar toon placeholder)
  inhoud.innerHTML += `<div class="sidebar-sectie-kop">Archief</div>`;
  if (archief.length === 0) {
    inhoud.innerHTML += `<div style="padding:1rem;color:var(--muted);font-size:0.8rem;">Nog geen voltooide paden.</div>`;
  }
}

// ════════════════════════════════════════
// LEERPAD DETAIL PAGINA (vervanger van home)
// ════════════════════════════════════════
let huidigBekekenPadId = null;

async function toonLeerpadDetail(padId) {
  sluitSidebar();
  const actief = await haalActiefLeerpad();
  if (!actief || actief.id !== padId) return; // archief later
  
  huidigBekekenPadId = padId;
  document.getElementById('homescreen').style.display = 'none';
  // We tonen een aparte sectie (tijdelijk onder les-scherm of een nieuwe div; voor nu gebruiken we de bestaande les-scherm niet, maar maken een simpele weergave in homescreen)
  // Voor snelheid: we renderen een lijst direct in de homescreen.
  const home = document.getElementById('homescreen');
  home.innerHTML = `
    <div style="padding:2rem; max-width:600px; margin:0 auto; width:100%;">
      <h2 style="font-family:Lora;color:var(--text)">${actief.onderwerp}</h2>
      <p style="color:var(--muted);margin-bottom:1.5rem;">${actief.aantalLessen} lessen · ${actief.categorieId} · gestart ${actief.aangemaakt}</p>
      <div class="pad-les-lijst" id="pad-les-lijst"></div>
      <button class="knop-secundair" onclick="toonHomescreen()" style="margin-top:1.5rem;">← Terug naar home</button>
      <button class="knop-secundair" style="background:var(--fout);margin-top:0.5rem;" onclick="openOverslaanModal('${actief.id}','${actief.onderwerp}')">🔀 Dit onderwerp interesseert me niet</button>
    </div>`;
  
  const lijst = document.getElementById('pad-les-lijst');
  actief.lessen.forEach(les => {
    let icoon = '🔒';
    if (les.status === 'beschikbaar') icoon = '▶';
    if (les.datumVoltooid) icoon = '✓';
    const klikbaar = les.status === 'beschikbaar' ? `onclick="startLesVanLeerpad('${padId}',${les.nummer})" style="cursor:pointer;hover:opacity:0.8;"` : '';
    lijst.innerHTML += `
      <div class="les-rij" ${klikbaar}>
        <span style="font-size:1.2rem;width:2rem;">${icoon}</span>
        <div>
          <div style="font-weight:600;">Les ${les.nummer}: ${les.titel}</div>
          <div style="font-size:0.8rem;color:var(--muted);">${les.status === 'gepland' ? 'Komt beschikbaar' : les.beschrijving || ''}</div>
        </div>
      </div>`;
  });
  
  home.style.display = 'block';
}

function openOverslaanModal(padId, naam) {
  document.getElementById('overslaan-padnaam').textContent = `"${naam}"`;
  document.getElementById('overslaan-bevestig-knop').onclick = () => bevestigOverslaan(padId);
  document.getElementById('overslaan-modal').classList.add('zichtbaar');
}

function sluitOverslaanModal() {
  document.getElementById('overslaan-modal').classList.remove('zichtbaar');
}

async function bevestigOverslaan(padId) {
  sluitOverslaanModal();
  const token = await haalGithubToken();
  if (!token) {
    toonToast('Je hebt een GitHub token nodig om een pad over te slaan. Voeg die toe in Instellingen.');
    return;
  }
  try {
    await schrijfStatusJson(token, true);
    toonToast('Leerpad wordt morgen vervangen door een nieuw onderwerp.');
    // Voor nu resetten we de UI
    document.getElementById('homescreen').style.display = 'none';
    await toonHomescreen();
  } catch(e) {
    toonToast('Overslaan mislukt: ' + e.message);
  }
}

async function schrijfStatusJson(token, overgeslagen) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/status.json`;
  const headers = { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };
  
  const getRes = await fetch(url, { headers });
  if (!getRes.ok) throw new Error('Kon status.json niet lezen');
  const getData = await getRes.json();
  
  const huidig = JSON.parse(atob(getData.content));
  huidig.padOvergeslagen = overgeslagen;
  huidig.overgeslageOp = overgeslagen ? lokaalDatum() : null;
  
  const putRes = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: overgeslagen ? 'Gebruiker slaat leerpad over' : 'Reset overslaan-status',
      content: btoa(unescape(encodeURIComponent(JSON.stringify(huidig, null, 2)))),
      sha: getData.sha
    })
  });
  if (!putRes.ok) throw new Error('Kon status.json niet updaten');
}

// ════════════════════════════════════════
// LES STARTEN VANUIT LEERPAD
// ════════════════════════════════════════
let huidigPadId = null;
let huidigLesNummer = null;

async function startLesVanLeerpad(padId, lesNummer) {
  huidigPadId = padId;
  huidigLesNummer = lesNummer;
  
  document.getElementById('homescreen').style.display = 'none';
  document.getElementById('les-scherm').classList.add('zichtbaar');
  
  // Les ophalen
  setStatus('Les laden...', 20);
  const les = await haalLes(padId, lesNummer);
  artikelTitel = les.titel;
  lesData = { secties: les.secties };
  huidigeCategorieKleur = les.categorieKleur || '#c8a96e';
  huidigeCategorieNaam = les.categorie || '';
  pasCategorieKleurToe(huidigeCategorieKleur);
  
  // Voortgang resetten (we kunnen per pad/les opslaan)
  huidigeSectie = 0;
  inVraagModus = false;
  sessieAntwoorden = [];
  vraagResultaten = {};
  
  await startLes(); // bestaande functie start de leesflow
  verbergStatus();
}

// ════════════════════════════════════════
// HUIDIGE LES KNOP OP HOME
// ════════════════════════════════════════
async function startHuidigeLes() {
  const actief = await haalActiefLeerpad();
  if (!actief) {
    toonToast('Er is nog geen leerpad. Dit wordt vannacht aangemaakt.');
    return;
  }
  const volgendeLes = actief.lessen.find(l => l.status === 'beschikbaar' && !l.datumVoltooid);
  if (volgendeLes) {
    await startLesVanLeerpad(actief.id, volgendeLes.nummer);
  } else {
    toonToast('Alle beschikbare lessen zijn al gemaakt. Volgende les komt morgen.');
  }
}

// ════════════════════════════════════════
// SR AANPASSING (maakVraagId)
// ════════════════════════════════════════
function maakVraagId(artikelTitel, sectieIndex, vraagIndex) {
  // Gebruik padId en lesNummer als beschikbaar
  if (huidigPadId && huidigLesNummer) {
    const basis = huidigPadId.replace(/[^a-z0-9]/g, '_').slice(0, 40);
    return `${basis}_les${huidigLesNummer}_s${sectieIndex}_v${vraagIndex}`;
  }
  // Fallback naar oude methode
  const basis = artikelTitel.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
  return `${basis}_s${sectieIndex}_v${vraagIndex}`;
}

// ════════════════════════════════════════
// REST VAN DE CODE (ongewijzigd, maar let op dat functies zoals `startLes`, `toonSectie`, etc. ongewijzigd blijven)
// ... voeg hier alle overige functies uit het oorspronkelijke script.js in, zoals `toonHomescreen`, `startSmartSession`, `startVaultPractice`, `registreerAntwoord`, etc.
// Zorg dat je de bestaande `startLesVanVandaag` verwijdert en de nieuwe `startHuidigeLes` en `startLesVanLeerpad` gebruikt.
// ════════════════════════════════════════

// Plak hieronder jouw huidige script.js, maar:
// - Verwijder `startLesVanVandaag` en `maakLes`
// - Behoud alle andere functies zoals `startSmartSession`, `startVaultPractice`, `toonSectie`, `toonVraag`, `volgendeSectie`, `toonKlaarScherm`, `registreerAntwoord`, etc.
// - Zorg dat `toonHomescreen` de nieuwe knoppen correct instelt (wordt al gedaan in de bestaande code)

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
(async () => {
  try {
    db = await openDB();
    await migreerVanLocalStorage();
  } catch(e) {
    console.warn('IndexedDB niet beschikbaar', e);
    db = null;
  }
  herstelLayout();
  const key = await haalKey();
  if (key) {
    document.getElementById('hamburger-btn').style.display = 'block';
    document.getElementById('key-knop-header').style.display = 'flex';
    await toonHomescreen();
  } else {
    document.getElementById('key-scherm').classList.add('zichtbaar');
  }
})();
