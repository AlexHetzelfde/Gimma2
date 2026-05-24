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
// INDEXEDDB LAAG
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

function dbDelete(sleutel) {
  if (!db) { delete _memFallback[sleutel]; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readwrite');
    const req = tx.objectStore(STORE_KV).delete(sleutel);
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

async function haalFeedback() {
  try {
    const raw = await dbGet(LS_FEEDBACK);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

async function voegFeedbackToe(item) {
  const feedback = await haalFeedback();
  feedback.push({ ...item, timestamp: Date.now() });
  if (feedback.length > 50) feedback.splice(0, feedback.length - 50);
  await dbSet(LS_FEEDBACK, JSON.stringify(feedback));
}

// ════════════════════════════════════════
// LEERPAD DATA VAN GITHUB
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
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/archief`;
    const res = await fetch(url);
    if (!res.ok) return []; // Map bestaat nog niet

    const bestanden = await res.json();
    const overzichten = await Promise.all(
      bestanden
        .filter(b => b.name.endsWith('-overzicht.json'))
        .map(async b => {
          try { return await fetchJSON(rawURL(b.path)); }
          catch (e) { return null; }
        })
    );
    return overzichten
      .filter(Boolean)
      .sort((a, b) => (b.afgesloten || '').localeCompare(a.afgesloten || ''));
  } catch (e) {
    console.warn('Archief ophalen mislukt:', e);
    return [];
  }
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

  inhoud.innerHTML += `<div class="sidebar-sectie-kop">Archief</div>`;
  if (archief.length === 0) {
    inhoud.innerHTML += `<div style="padding:1rem;color:var(--muted);font-size:0.8rem;">Nog geen voltooide paden.</div>`;
  } else {
    archief.forEach(pad => {
      const redenLabel = pad.reden === 'voltooid' ? '✓ Voltooid' : '⏭ Overgeslagen';
      inhoud.innerHTML += `
        <div class="sidebar-pad-rij">
          <span class="sidebar-pad-icoon" style="color:var(--goed)">●</span>
          <div class="sidebar-pad-info">
            <div class="sidebar-pad-naam">${pad.onderwerp}</div>
            <div class="sidebar-pad-meta">${redenLabel} · ${pad.afgesloten || ''}</div>
          </div>
        </div>`;
    });
  }
}

async function startSmartSession() {
  const dueItems = await getDueItems();
  if (dueItems.length > 0) {
    smartActive = true;
    srVervolgTekst = 'Doorgaan naar les →';
    srCallback = null;
    toonSRReview(dueItems);
  } else {
    await startHuidigeLes();
  }
}

// ════════════════════════════════════════
// LEERPAD DETAIL
// ════════════════════════════════════════
let huidigBekekenPadId = null;

async function toonLeerpadDetail(padId) {
  sluitSidebar();
  const actief = await haalActiefLeerpad();
  if (!actief || actief.id !== padId) return;

  huidigBekekenPadId = padId;

  // Verberg homescreen, toon apart detailscherm (geen DOM-destructie meer)
  document.getElementById('homescreen').classList.remove('zichtbaar');
  document.getElementById('leerpad-detail-scherm').classList.add('zichtbaar');

  const inhoud = document.getElementById('leerpad-detail-inhoud');
  inhoud.innerHTML = `
    <h2 style="font-family:Lora;color:var(--text);margin-bottom:0.4rem">${actief.onderwerp}</h2>
    <p style="color:var(--muted);margin-bottom:1.5rem;font-size:0.88rem">
      ${actief.aantalLessen} lessen · ${actief.categorieId} · gestart ${actief.aangemaakt}
    </p>
    <div class="pad-les-lijst" id="pad-les-lijst"></div>
    <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:1.5rem"></div>`;

  // Lessenlijst opbouwen via DOM (geen inline-onclick, veilig voor bijzondere tekens)
  const lijst = document.getElementById('pad-les-lijst');
  actief.lessen.forEach(les => {
    let icoon = '🔒';
    if (les.datumVoltooid) icoon = '✓';
    else if (les.status === 'beschikbaar') icoon = '▶';

    const klikbaar = les.status === 'beschikbaar' && !les.datumVoltooid;

    const rij = document.createElement('div');
    rij.className = 'les-rij' + (klikbaar ? ' les-rij-klikbaar' : '');
    if (klikbaar) {
      rij.addEventListener('click', () => startLesVanLeerpad(actief.id, les.nummer));
    }
    rij.innerHTML = `
      <span class="les-rij-icoon">${icoon}</span>
      <div>
        <div class="les-rij-titel">Les ${les.nummer}: ${les.titel}</div>
        <div class="les-rij-sub">${les.status === 'gepland' ? 'Komt beschikbaar' : les.beschrijving || ''}</div>
      </div>`;
    lijst.appendChild(rij);
  });

  // Knoppen onderaan — via DOM zodat aanhalingstekens in onderwerpnamen veilig zijn
  const knoppen = inhoud.querySelector('div:last-child');
  const terugKnop = document.createElement('button');
  terugKnop.className = 'knop-secundair';
  terugKnop.textContent = '← Terug naar home';
  terugKnop.addEventListener('click', sluitLeerpadDetail);
  knoppen.appendChild(terugKnop);

  const overslaanKnop = document.createElement('button');
  overslaanKnop.className = 'knop-secundair';
  overslaanKnop.style.background = 'var(--fout)';
  overslaanKnop.textContent = '🔀 Dit onderwerp interesseert me niet';
  overslaanKnop.addEventListener('click', () => openOverslaanModal(actief.id, actief.onderwerp));
  knoppen.appendChild(overslaanKnop);
}

function sluitLeerpadDetail() {
  document.getElementById('leerpad-detail-scherm').classList.remove('zichtbaar');
  toonHomescreen();
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
  
  document.getElementById('homescreen').classList.remove('zichtbaar');
  document.getElementById('leerpad-detail-scherm').classList.remove('zichtbaar');
  document.getElementById('les-scherm').classList.add('zichtbaar');
  
  setStatus('Les laden...', 20);
  const les = await haalLes(padId, lesNummer);
  artikelTitel = les.titel;
  lesData = { secties: les.secties };
  huidigeCategorieKleur = les.categorieKleur || '#c8a96e';
  huidigeCategorieNaam = les.categorie || '';
  pasCategorieKleurToe(huidigeCategorieKleur);
  
  huidigeSectie = 0;
  inVraagModus = false;
  sessieAntwoorden = [];
  vraagResultaten = {};
  
  await startLes();
  verbergStatus();
}

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
// SR AANPASSING (nieuwe maakVraagId)
// ════════════════════════════════════════
function maakVraagId(artikelTitel, sectieIndex, vraagIndex) {
  if (huidigPadId && huidigLesNummer) {
    const basis = huidigPadId.replace(/[^a-z0-9]/g, '_').slice(0, 40);
    return `${basis}_les${huidigLesNummer}_s${sectieIndex}_v${vraagIndex}`;
  }
  const basis = artikelTitel.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
  return `${basis}_s${sectieIndex}_v${vraagIndex}`;
}

// ════════════════════════════════════════
// KLEUREN & LAYOUT
// ════════════════════════════════════════
function hexNaarRgb(hex) {
  const clean = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '237, 91, 54';
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ].join(', ');
}

function pasCategorieKleurToe(kleur) {
  if (!kleur || !/^#[0-9a-fA-F]{6}$/i.test(kleur)) kleur = '#ed5b36';
  document.documentElement.style.setProperty('--les-kleur', kleur);
  document.documentElement.style.setProperty('--les-kleur-rgb', hexNaarRgb(kleur));
  const dot = document.getElementById('datum-mobiel-dot');
  if (dot) dot.style.background = kleur;
}

let huidigeCategorieKleur = '#ed5b36';
let huidigeCategorieNaam  = '';

function setLayout(modus) {
  // Schrijf naar beide — localStorage voor directe sync, IndexedDB als primaire opslag
  try { localStorage.setItem(LS_LAYOUT, modus); } catch(e) {}
  dbSet(LS_LAYOUT, modus).catch(() => {});
  document.body.classList.toggle('layout-telefoon', modus === 'telefoon');
  document.getElementById('knop-desktop').classList.toggle('actief', modus === 'desktop');
  document.getElementById('knop-telefoon').classList.toggle('actief', modus === 'telefoon');
}

function herstelLayout() {
  // Lees synchroon uit localStorage voor directe render (geen flicker)
  const lokaal = localStorage.getItem(LS_LAYOUT) || 'desktop';
  setLayout(lokaal);
  // Controleer ook IndexedDB (kan afwijken na migratie)
  dbGet(LS_LAYOUT).then(val => {
    if (val && val !== lokaal) setLayout(val);
  }).catch(() => {});
}

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
let toastTimer = null;
function toonToast(tekst, duur = 2500) {
  const el = document.getElementById('toast');
  el.textContent = tekst;
  el.classList.add('zichtbaar');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('zichtbaar'), duur);
}

// ════════════════════════════════════════
// STATS
// ════════════════════════════════════════
function toonStatsModal() { document.getElementById('stats-modal').classList.add('zichtbaar'); renderStats(); }
function sluitStatsModal() { document.getElementById('stats-modal').classList.remove('zichtbaar'); }

async function renderStats() {
  const el = document.getElementById('stats-inhoud');
  const sr = await haalSRData();
  const streakData = await haalStreak();

  const streakHtml = streakData.huidig > 0 ? `
    <div class="stats-streak-balk">
      <span>🔥 Huidige streak: <strong>${streakData.huidig} dag${streakData.huidig !== 1 ? 'en' : ''}</strong></span>
      <span style="color:var(--muted);font-size:0.78rem">Langste: ${streakData.langste} dag${streakData.langste !== 1 ? 'en' : ''}</span>
    </div>` : '';

  const totaal = sr.length;
  if (totaal === 0) {
    el.innerHTML = `${streakHtml}<div class="stats-hero"><div class="stats-leeg">🌱 Nog geen data — maak je eerste les om je voortgang bij te houden.</div></div>`;
    return;
  }
  const nieuw = sr.filter(i => (i.strength ?? 20) < 35).length;
  const lerend = sr.filter(i => (i.strength ?? 20) >= 35 && (i.strength ?? 20) < 70).length;
  const beheerst = sr.filter(i => (i.strength ?? 20) >= 70).length;
  const gemStr = Math.round(sr.reduce((s, i) => s + (i.strength ?? 20), 0) / totaal);
  const uniekeLessen = new Set(sr.map(i => i.id.replace(/_[^_]+_[^_]+$/, ''))).size;
  // rest van stats weergave (identiek aan eerder)
  el.innerHTML = `<div class="stats-hero">
    <div class="stats-hero-item accent-tegel"><div class="stats-hero-getal">${totaal}</div><div class="stats-hero-label">Vragen geleerd</div></div>
    <div class="stats-hero-item"><div class="stats-hero-getal">${beheerst}</div><div class="stats-hero-label">Beheerst</div></div>
    <div class="stats-hero-item"><div class="stats-hero-getal">${gemStr}%</div><div class="stats-hero-label">Gem. sterkte</div></div>
    <div class="stats-hero-item"><div class="stats-hero-getal">${uniekeLessen}</div><div class="stats-hero-label">Lessen gevolgd</div></div>
  </div>`;
}

// ════════════════════════════════════════
// DATUM & STREAK
// ════════════════════════════════════════
async function lastSessionToday() {
  const val = await dbGet(LS_LAST_SESSION);
  return val === new Date().toISOString().slice(0, 10);
}

async function markSessionDone() {
  await dbSet(LS_LAST_SESSION, new Date().toISOString().slice(0, 10));
  await updateStreak();
}

async function haalStreak() {
  try {
    const raw = await dbGet(LS_STREAK);
    return raw ? JSON.parse(raw) : { huidig: 0, langste: 0, laatste_datum: null };
  } catch (e) { return { huidig: 0, langste: 0, laatste_datum: null }; }
}

async function updateStreak() {
  const streak = await haalStreak();
  const vandaag = new Date().toISOString().slice(0, 10);
  const gisteren = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (streak.laatste_datum === vandaag) return;
  streak.huidig = streak.laatste_datum === gisteren ? streak.huidig + 1 : 1;
  streak.langste = Math.max(streak.langste, streak.huidig);
  streak.laatste_datum = vandaag;
  await dbSet(LS_STREAK, JSON.stringify(streak));
}

// ════════════════════════════════════════
// SPACED REPETITION
// ════════════════════════════════════════
async function getDueItems() {
  const sr = await haalSRData();
  const vandaag = await lastSessionToday();
  const threshold = vandaag ? Date.now() : new Date().setHours(23,59,59,999);
  return sr.filter(i => i.next_due && i.next_due <= threshold)
    .sort((a,b) => (a.strength ?? 20) - (b.strength ?? 20));
}

async function registreerAntwoord({ id, vraag, type, antwoordData, goed }) {
  const sr = await haalSRData();
  const idx = sr.findIndex(v => v.id === id);
  const now = Date.now();
  const morgen = new Date(); morgen.setDate(morgen.getDate()+1); morgen.setHours(0,0,0,0);
  
  if (idx === -1) {
    const ef = goed ? 2.5 : 2.3;
    sr.push({
      id, vraag, type, ...antwoordData,
      categorieKleur: huidigeCategorieKleur,
      categorieNaam: huidigeCategorieNaam,
      ef, interval: 1, repetities: goed ? 1 : 0,
      strength: goed ? 20 : 0,
      streak: goed ? 1 : 0,
      next_due: goed ? now + 86400000 : morgen.getTime(),
      last_seen: now
    });
  } else {
    const item = sr[idx];
    Object.assign(item, antwoordData);
    item.last_seen = now;
    if (goed) {
      item.repetities = (item.repetities||0) + 1;
      item.ef = Math.max(1.3, (item.ef||2.5) + 0.1);
      item.interval = item.repetities === 1 ? 1 : item.repetities === 2 ? 6 : Math.round(item.interval * item.ef);
      item.next_due = now + item.interval * 86400000;
      item.streak = (item.streak||0) + 1;
    } else {
      item.repetities = 0;
      item.ef = Math.max(1.3, (item.ef||2.5) - 0.2);
      item.interval = 1;
      item.next_due = morgen.getTime();
      item.streak = 0;
    }
    item.strength = Math.min(100, Math.max(0, Math.round((item.repetities||0)*13 + ((item.ef||2.5)-1.3)*15)));
  }
  await slaSRDataOp(sr);
}

function sterktekleur(strength) {
  if (strength < 35) return 'var(--fout)';
  if (strength < 65) return 'var(--accent)';
  return 'var(--goed)';
}

// ════════════════════════════════════════
// HOMESCREEN
// ════════════════════════════════════════
async function toonHomescreen() {
  pasCategorieKleurToe('#ed5b36');
  document.getElementById('key-scherm').classList.remove('zichtbaar');
  document.getElementById('leerpad-detail-scherm').classList.remove('zichtbaar');
  document.getElementById('key-knop-header').style.display = 'flex';
  document.getElementById('homescreen').classList.add('zichtbaar');

  const dueItems = await getDueItems();
  const streak = await haalStreak();
  const streakEl = document.getElementById('streak-display');
  if (streak.huidig > 1) {
    streakEl.textContent = `🔥 ${streak.huidig} dagen op rij`;
    streakEl.style.display = '';
  } else {
    streakEl.style.display = 'none';
  }

  document.getElementById('home-knoppen-wrap').style.display = 'flex';

  // Smart Session
  const smartBtn = document.getElementById('knop-smart');
  const smartSub = document.getElementById('smart-sub');
  if (dueItems.length === 0) {
    smartBtn.disabled = true;
    smartBtn.setAttribute('data-tip', 'Alles bij! Geen herhalingen nodig');
    smartSub.textContent = 'Je bent helemaal bij! 🎉';
  } else {
    smartBtn.disabled = false;
    smartBtn.removeAttribute('data-tip');
    smartSub.textContent = `${dueItems.length} herhaling${dueItems.length>1?'en':''}`;
  }

  // Vault Practice
  const vaultBtn = document.getElementById('knop-vault');
  const vaultSub = document.getElementById('vault-sub');
  if (dueItems.length === 0) {
    vaultBtn.disabled = true;
    vaultBtn.setAttribute('data-tip', 'Alles bij! Geen herhalingen nodig');
    vaultSub.textContent = 'Je kluis is leeg';
  } else {
    vaultBtn.disabled = false;
    vaultBtn.removeAttribute('data-tip');
    vaultSub.textContent = `${dueItems.length} vraag${dueItems.length>1?'en':''} klaar voor herhaling`;
  }

  // Huidige les
  const lesBtn = document.getElementById('knop-les-nieuw');
  const lesSub = document.getElementById('les-sub');
  const actief = await haalActiefLeerpad();
  if (actief) {
    const volgendeLes = actief.lessen.find(l => l.status === 'beschikbaar' && !l.datumVoltooid);
    if (volgendeLes) {
      lesBtn.disabled = false;
      lesBtn.onclick = () => startLesVanLeerpad(actief.id, volgendeLes.nummer);
      lesSub.textContent = `Les ${volgendeLes.nummer} van ${actief.aantalLessen} · ${actief.onderwerp}`;
    } else {
      lesBtn.disabled = true;
      lesBtn.setAttribute('data-tip', 'Alle lessen zijn al gemaakt. Volgende les komt morgen.');
      lesSub.textContent = 'Wachten op volgende les...';
    }
  } else {
    lesBtn.disabled = true;
    lesBtn.setAttribute('data-tip', 'Er is nog geen leerpad. Dit wordt vannacht aangemaakt.');
    lesSub.textContent = 'Leerpad wordt voorbereid';
  }
}

async function startSmartSession() {
  const dueItems = await getDueItems();
  if (dueItems.length > 0) {
    smartActive = true;
    srVervolgTekst = 'Doorgaan naar les →';
    srCallback = null;
    toonSRReview(dueItems);
  } else {
    await startHuidigeLes();
  }
}

async function startVaultPractice() {
  const dueItems = await getDueItems();
  if (dueItems.length > 0) {
    smartActive = false;
    srVervolgTekst = 'Terug naar home →';
    srCallback = null;
    toonSRReview(dueItems);
  }
}

// ════════════════════════════════════════
// SR REVIEW (HERHALING)
// ════════════════════════════════════════
let smartActive = false;
let srCallback = null;
let srVervolgTekst = 'Doorgaan naar les →';

function toonSRReview(dueItems) {
  const wrap = document.getElementById('sr-review-wrap');
  wrap.style.display = 'block';

  let rondeNummer = 1;
  let rondeWachtrij = [...dueItems];
  let rondeResultaten = [];

  const inhoud = document.getElementById('sr-vragen-inhoud');
  inhoud.innerHTML = '';

  function updateSubTitel(huidigeIndex) {
    const rondeLabel = rondeNummer > 1 ? ` · ronde ${rondeNummer}` : '';
    document.getElementById('sr-review-sub').textContent =
      `Vraag ${huidigeIndex + 1} van ${rondeWachtrij.length}${rondeLabel}`;
  }

  function startRonde() {
    rondeResultaten = new Array(rondeWachtrij.length).fill(null);
    toonSRVraag(0);
  }

  function toonSREinde() {
    inhoud.innerHTML = '';
    const fouteItems = rondeWachtrij.filter((_, i) => rondeResultaten[i] && !rondeResultaten[i].goed);

    if (fouteItems.length > 0) {
      rondeWachtrij = fouteItems;
      rondeNummer++;
      document.getElementById('sr-review-sub').textContent =
        `${fouteItems.length} vraag${fouteItems.length !== 1 ? 'en' : ''} nog fout · ronde ${rondeNummer}`;

      const melding = document.createElement('div');
      melding.style.cssText = 'text-align:center;padding:2rem 1rem 1.5rem;';
      melding.innerHTML = `
        <div style="font-size:2rem;margin-bottom:0.65rem;line-height:1">🔁</div>
        <div style="font-family:'Lora',serif;font-size:1.05rem;font-weight:600;color:var(--text);margin-bottom:0.4rem;">
          Nog niet helemaal goed
        </div>
        <div style="font-size:0.87rem;color:var(--muted);line-height:1.6;max-width:320px;margin:0 auto 1.5rem;">
          ${fouteItems.length} vraag${fouteItems.length !== 1 ? 'en' : ''} 
          ${fouteItems.length !== 1 ? 'komen' : 'komt'} terug.
          Je kan pas door als alles goed is.
        </div>
      `;
      inhoud.appendChild(melding);
      const knopOpnieuw = document.createElement('button');
      knopOpnieuw.className = 'knop-primair';
      knopOpnieuw.style.cssText = 'width:100%;';
      knopOpnieuw.textContent = `Opnieuw oefenen (${fouteItems.length}) →`;
      knopOpnieuw.addEventListener('click', () => {
        inhoud.innerHTML = '';
        startRonde();
      });
      inhoud.appendChild(knopOpnieuw);
      window.scrollTo({ top: wrap.offsetTop - 40, behavior: 'smooth' });
    } else {
      document.getElementById('sr-review-sub').textContent = 'Alles goed! 🎉';
      const scoreEl = document.getElementById('sr-score-tekst');
      if (rondeNummer === 1) {
        scoreEl.innerHTML = `<strong>Alles in één ronde goed!</strong> Knap gedaan. 🎉`;
      } else {
        scoreEl.innerHTML = `<strong>Alles onthouden!</strong> Na ${rondeNummer} rondes alles goed. 💪`;
      }
      const knop = document.querySelector('#sr-klaar-balk .knop-primair');
      if (knop) knop.textContent = srVervolgTekst;
      if (typeof srCallback === 'function') {
        setTimeout(() => { const cb = srCallback; srCallback = null; cb(); }, 600);
      } else {
        document.getElementById('sr-klaar-balk').style.display = 'flex';
      }
      window.scrollTo({ top: wrap.offsetTop - 40, behavior: 'smooth' });
    }
  }

  function toonSRVraag(index) {
    if (index >= rondeWachtrij.length) {
      toonSREinde();
      return;
    }

    updateSubTitel(index);
    inhoud.innerHTML = '';
    window.scrollTo({ top: wrap.offsetTop - 40, behavior: 'smooth' });

    const item = rondeWachtrij[index];
    const itemKleur = item.categorieKleur || '#ed5b36';
    const itemRgb = hexNaarRgb(itemKleur);
    const vraagType = item.type || 'flashcard';

    const blok = document.createElement('div');
    blok.className = 'vraag-blok';
    blok.style.background = `rgba(${itemRgb}, 0.08)`;
    blok.style.border = `1px solid rgba(${itemRgb}, 0.25)`;
    blok.style.borderRadius = '8px';
    blok.style.padding = '1.1rem 1.2rem';
    blok.style.marginBottom = '0';

    const strength = item.strength ?? 20;
    const kleur = sterktekleur(strength);
    const catTagHtml = item.categorieNaam
      ? `<span class="sr-cat-tag" style="background:rgba(${itemRgb},0.15);color:${itemKleur}">● ${item.categorieNaam}</span>`
      : '';

    const sterkteMeter = `
      <div class="sr-sterkte-balk-wrap">
        <span class="sr-sterkte-label">Sterkte</span>
        <div class="sr-sterkte-balk">
          <div class="sr-sterkte-vulling" style="width:${strength}%; background:${kleur}"></div>
        </div>
        <span class="sr-sterkte-label">${strength}%</span>
        ${catTagHtml}
      </div>`;

    function maakVolgendeKnop() {
      const knopWrap = document.createElement('div');
      knopWrap.style.marginTop = '1rem';
      const isLaatste = index === rondeWachtrij.length - 1;
      const knop = document.createElement('button');
      knop.className = 'knop-primair';
      knop.style.width = '100%';
      knop.textContent = isLaatste ? 'Bekijk resultaat →' : 'Volgende →';
      knop.addEventListener('click', () => toonSRVraag(index + 1));
      knopWrap.appendChild(knop);
      blok.appendChild(knopWrap);
    }

    function verwerkAntwoord(goed, antwoordData) {
      rondeResultaten[index] = { goed };
      const voorheen = [huidigeCategorieKleur, huidigeCategorieNaam];
      huidigeCategorieKleur = itemKleur;
      huidigeCategorieNaam = item.categorieNaam || '';
      registreerAntwoord({
        id: item.id,
        vraag: item.vraag,
        type: vraagType,
        antwoordData: antwoordData,
        goed
      });
      [huidigeCategorieKleur, huidigeCategorieNaam] = voorheen;
      setTimeout(() => maakVolgendeKnop(), 400);
      const srAntwoord = vraagType === 'multiplechoice'
        ? (item.opties && item.opties[item.correcteIndex]) || ''
        : item.antwoord || '';
      setTimeout(() => toonFeedbackPicker(blok, item.id, item.vraag, srAntwoord), 600);
    }

    // MULTIPLE CHOICE UI
    if (vraagType === 'multiplechoice') {
      const opties = item.opties || [];
      const correcteIndex = item.correcteIndex;

      let optiesMetIndex = opties.map((opt, idx) => ({ opt, idx }));
      for (let i = optiesMetIndex.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [optiesMetIndex[i], optiesMetIndex[j]] = [optiesMetIndex[j], optiesMetIndex[i]];
      }

      blok.innerHTML = `
        ${sterkteMeter}
        <div class="vraag-tekst" style="color:var(--text); margin-bottom:1rem;">${item.vraag}</div>
        <div class="opties-grid" id="sr-mc-opties-${index}"></div>
      `;

      const optiesContainer = blok.querySelector(`#sr-mc-opties-${index}`);
      let beantwoord = false;

      optiesMetIndex.forEach(({ opt, idx }) => {
        const knop = document.createElement('button');
        knop.className = 'optie-knop';
        knop.textContent = opt;
        knop.addEventListener('click', () => {
          if (beantwoord) return;
          beantwoord = true;
          const gekozenIndex = idx;
          const goed = (gekozenIndex === correcteIndex);
          optiesContainer.querySelectorAll('.optie-knop').forEach(b => b.disabled = true);
          if (goed) {
            knop.classList.add('goed');
          } else {
            knop.classList.add('fout');
            const correcteKnop = Array.from(optiesContainer.querySelectorAll('.optie-knop')).find(
              (b, i) => optiesMetIndex[i].idx === correcteIndex
            );
            if (correcteKnop) correcteKnop.classList.add('gemist');
          }
          verwerkAntwoord(goed, {
            vraag: item.vraag,
            opties: opties,
            correcteIndex: correcteIndex,
            gekozenIndex: gekozenIndex
          });
        });
        optiesContainer.appendChild(knop);
      });
      inhoud.appendChild(blok);
    }
    // FLASHCARD UI
    else {
      const antwoord = item.antwoord || item.goed || '';
      blok.innerHTML = `
        ${sterkteMeter}
        <div class="vraag-tekst" style="color:var(--text)">${item.vraag}</div>
        <div class="flashcard-onthul-wrap" id="sr-onthul-${index}">
          <button class="knop-onthul">Tik om het antwoord te zien ↓</button>
        </div>
        <div class="flashcard-antwoord-wrap" id="sr-antwoord-${index}" style="display:none">
          <div class="flashcard-antwoord sr-flashcard-antwoord">${antwoord}</div>
          <div class="flashcard-goed-fout">
            <button class="knop-flashcard-fout" id="sr-fout-${index}">✗ Fout</button>
            <button class="knop-flashcard-goed" id="sr-goed-${index}">✓ Goed</button>
          </div>
        </div>
      `;
      let beantwoord = false;
      blok.querySelector('.knop-onthul').addEventListener('click', () => {
        document.getElementById(`sr-onthul-${index}`).style.display = 'none';
        document.getElementById(`sr-antwoord-${index}`).style.display = 'block';
      });
      blok.querySelector(`#sr-goed-${index}`).addEventListener('click', () => {
        if (beantwoord) return;
        beantwoord = true;
        blok.querySelector(`#sr-goed-${index}`).classList.add('actief-goed');
        blok.querySelector(`#sr-fout-${index}`).disabled = true;
        verwerkAntwoord(true, { antwoord: antwoord });
      });
      blok.querySelector(`#sr-fout-${index}`).addEventListener('click', () => {
        if (beantwoord) return;
        beantwoord = true;
        blok.querySelector(`#sr-fout-${index}`).classList.add('actief-fout');
        blok.querySelector(`#sr-goed-${index}`).disabled = true;
        verwerkAntwoord(false, { antwoord: antwoord });
      });
      inhoud.appendChild(blok);
    }
  }

  startRonde();
}

async function afrondSRReview() {
  await markSessionDone();
  document.getElementById('sr-review-wrap').style.display = 'none';

  if (smartActive) {
    smartActive = false;
    const lesVoltooid = (await haalVoortgang())?.voltooid;
    if (!lesVoltooid) {
      await startHuidigeLes();
      return;
    }
  }
  await toonHomescreen();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ════════════════════════════════════════
// INSTELLINGEN MODAL
// ════════════════════════════════════════
const ALLE_CATEGORIEEN = [
  { id: 'nl_uitgelicht', label: '🇳🇱 Nederlands uitgelicht' },
  { id: 'en_uitgelicht', label: '🌟 Engels uitgelicht' },
  { id: 'biologie', label: '🔬 Biologie' },
  { id: 'geschiedenis', label: '🏛️ Geschiedenis' },
  { id: 'kunst', label: '🎨 Kunst & cultuur' },
  { id: 'landen', label: '🌍 Landen & volken' },
  { id: 'maatschappij', label: '👥 Mens & maatschappij' },
  { id: 'politiek', label: '🗳️ Politiek' },
  { id: 'religie', label: '🕌 Religie' },
  { id: 'sport', label: '⚽ Sport' },
  { id: 'taal', label: '💬 Taal' },
  { id: 'wetenschap', label: '🔭 Wetenschap & tech' },
  { id: 'willekeurig', label: '🎲 Willekeurig' },
];

let tijdelijkeSelectie = [];

async function toonInstellingenModal() {
  tijdelijkeSelectie = await haalGeselecteerdeCategorieen();
  document.getElementById('categorie-opslaan-melding').textContent = '';
  document.getElementById('github-token-melding').textContent = '';
  document.getElementById('key-fout-instellingen').textContent = '';

  const grid = document.getElementById('categorie-tegels');
  grid.innerHTML = '';
  ALLE_CATEGORIEEN.forEach(cat => {
    const tegel = document.createElement('button');
    tegel.className = 'categorie-tegel' + (tijdelijkeSelectie.includes(cat.id) ? ' actief' : '');
    tegel.textContent = cat.label;
    tegel.onclick = () => {
      if (tijdelijkeSelectie.includes(cat.id)) {
        tijdelijkeSelectie = tijdelijkeSelectie.filter(id => id !== cat.id);
        tegel.classList.remove('actief');
      } else {
        tijdelijkeSelectie.push(cat.id);
        tegel.classList.add('actief');
      }
    };
    grid.appendChild(tegel);
  });

  const token = await haalGithubToken();
  const invoer = document.getElementById('github-token-invoer');
  invoer.value = '';
  invoer.placeholder = token ? 'ghp_••••••• (al opgeslagen)' : 'ghp_...';

  document.getElementById('instellingen-modal').classList.add('zichtbaar');
}

function sluitInstellingenModal() {
  document.getElementById('instellingen-modal').classList.remove('zichtbaar');
}

async function slaCategorievoorkeurOp() {
  if (tijdelijkeSelectie.length === 0) tijdelijkeSelectie = ['nl_uitgelicht'];
  await slaGeselecteerdeCategorieenLokaalOp(tijdelijkeSelectie);

  const token = await haalGithubToken();
  const melding = document.getElementById('categorie-opslaan-melding');

  if (token) {
    try {
      await schrijfConfigNaarGitHub(token, tijdelijkeSelectie);
      melding.style.color = 'var(--goed)';
      melding.textContent = '✓ Opgeslagen en gesynchroniseerd met GitHub';
    } catch(e) {
      melding.style.color = 'var(--accent)';
      melding.textContent = '✓ Lokaal opgeslagen (GitHub sync mislukt: ' + e.message + ')';
    }
  } else {
    melding.style.color = 'var(--muted)';
    melding.textContent = '✓ Lokaal opgeslagen — voer een GitHub token in om te synchroniseren';
  }
}

async function schrijfConfigNaarGitHub(token, geselecteerdeIds) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/config.json`;
  const headers = { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };

  const getRes = await fetch(url, { headers });
  if (!getRes.ok) throw new Error('Kon config.json niet ophalen van GitHub');
  const getData = await getRes.json();

  let huidig = {};
  try { huidig = JSON.parse(atob(getData.content)); } catch(e) {}
  huidig.geselecteerdeCategorieen = geselecteerdeIds;

  const putRes = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: 'Update categorievoorkeur via app',
      content: btoa(unescape(encodeURIComponent(JSON.stringify(huidig, null, 2)))),
      sha: getData.sha
    })
  });
  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || putRes.status);
  }
}

async function slaGithubTokenOpEnBevestig() {
  const invoer = document.getElementById('github-token-invoer').value.trim();
  const melding = document.getElementById('github-token-melding');
  if (!invoer.startsWith('ghp_')) {
    melding.style.color = 'var(--fout)';
    melding.textContent = 'Vul een geldig GitHub token in (begint met ghp_)';
    return;
  }
  await slaGithubTokenOp(invoer);
  document.getElementById('github-token-invoer').value = '';
  document.getElementById('github-token-invoer').placeholder = 'ghp_••••••• (al opgeslagen)';
  melding.style.color = 'var(--goed)';
  melding.textContent = '✓ Token opgeslagen';
}

async function slaKeyOpViaInstellingen() {
  const invoer = document.getElementById('key-invoer-instellingen').value.trim();
  const fout = document.getElementById('key-fout-instellingen');
  if (!invoer.startsWith('AIza') || invoer.length < 20) {
    fout.textContent = 'Vul een geldige Gemini API key in (begint met AIza...)';
    return;
  }
  await slaKeyOp(invoer);
  fout.textContent = '';
  toonToast('✓ API key opgeslagen');
  sluitInstellingenModal();
}

// ════════════════════════════════════════
// KEY BEHEER
// ════════════════════════════════════════
async function slaKeyOpEnStart() {
  const invoer = document.getElementById('key-invoer-setup').value.trim();
  const fout = document.getElementById('key-fout-setup');
  if (!invoer.startsWith('AIza') || invoer.length < 20) {
    fout.textContent = 'Vul een geldige Gemini API key in (begint met AIza...)';
    return;
  }
  fout.textContent = '';
  await slaKeyOp(invoer);
  await toonHomescreen();
}

function toonKeyModal() {
  document.getElementById('key-invoer-modal').value = '';
  document.getElementById('key-fout-modal').textContent = '';
  document.getElementById('key-modal').classList.add('zichtbaar');
  setTimeout(() => document.getElementById('key-invoer-modal').focus(), 50);
}

function sluitKeyModal() {
  document.getElementById('key-modal').classList.remove('zichtbaar');
}

async function slaKeyOpViaModal() {
  const invoer = document.getElementById('key-invoer-modal').value.trim();
  const fout = document.getElementById('key-fout-modal');
  if (!invoer.startsWith('AIza') || invoer.length < 20) {
    fout.textContent = 'Vul een geldige Gemini API key in (begint met AIza...)';
    return;
  }
  await slaKeyOp(invoer);
  sluitKeyModal();
  toonToast('✓ API key opgeslagen');
}

// ════════════════════════════════════════
// AL GEMAAKT / TERUG NAAR HOME
// ════════════════════════════════════════
function toonAlGemaaktModal() {
  document.getElementById('algemaakt-modal').classList.add('zichtbaar');
}

function sluitAlGemaaktModal() {
  document.getElementById('algemaakt-modal').classList.remove('zichtbaar');
}

async function herbeginLes() {
  sluitAlGemaaktModal();
  if (huidigPadId && huidigLesNummer) {
    await verwijderVoortgang();
    await startLesVanLeerpad(huidigPadId, huidigLesNummer);
  } else {
    toonToast('Er is geen actieve les om opnieuw te starten.');
  }
}

function logoKlikken() {
  const inLes    = document.getElementById('les-scherm').classList.contains('zichtbaar');
  const inKlaar  = document.getElementById('klaar-scherm').classList.contains('zichtbaar');
  const inDetail = document.getElementById('leerpad-detail-scherm').classList.contains('zichtbaar');
  if (inLes || inKlaar) {
    toonTerugNaarHomeModal();
  } else if (inDetail) {
    sluitLeerpadDetail();
  }
}

function toonTerugNaarHomeModal() {
  document.getElementById('terug-home-modal').classList.add('zichtbaar');
}

function sluitTerugNaarHomeModal() {
  document.getElementById('terug-home-modal').classList.remove('zichtbaar');
}

async function bevestigTerugNaarHome() {
  sluitTerugNaarHomeModal();
  document.getElementById('les-scherm').classList.remove('zichtbaar');
  document.getElementById('klaar-scherm').classList.remove('zichtbaar');
  document.getElementById('shields-balk').style.display = 'none';
  document.getElementById('les-voortgang').classList.remove('zichtbaar');
  document.getElementById('les-voortgang').classList.remove('vervaag');
  document.getElementById('les-voortgang-balk').style.width = '0%';
  lesData = null;
  inVraagModus = false;
  document.getElementById('leerpad-detail-scherm').classList.remove('zichtbaar');
  await toonHomescreen();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ════════════════════════════════════════
// STATUS / LAADBALK
// ════════════════════════════════════════
function setStatus(tekst, voortgang) {
  document.getElementById('status-wrap').classList.add('zichtbaar');
  document.getElementById('status-tekst').textContent = tekst;
  document.getElementById('laadbalk').style.width = voortgang + '%';
}

function verbergStatus() {
  document.getElementById('status-wrap').classList.remove('zichtbaar');
}

// ════════════════════════════════════════
// LES FLOW
// ════════════════════════════════════════
let lesData = null;
let artikelTitel = '';
let huidigeSectie = 0;
let huidigeVraag = 0;
let inVraagModus = false;
let sessieAntwoorden = [];
let vraagResultaten = {};
let pendingSR = [];

function setLeesKaart(zichtbaar) {
  document.getElementById('lees-kaart').style.display = zichtbaar ? 'block' : 'none';
}

function renderShields() {
  const balk = document.getElementById('shields-balk');
  balk.innerHTML = '';
  if (!lesData) return;
  lesData.secties.forEach((sectie, si) => {
    if (si > 0) {
      const sep = document.createElement('div');
      sep.className = 'shield-sep';
      balk.appendChild(sep);
    }
    sectie.vragen.forEach((_, vi) => {
      const id = maakVraagId(artikelTitel, si, vi);
      const el = document.createElement('div');
      el.className = 'shield-item';
      el.title = `Sectie ${si+1}, vraag ${vi+1}`;
      const res = vraagResultaten[id];
      if (res === 'goed') el.classList.add('goed');
      else if (res === 'fout') el.classList.add('fout');
      else if (inVraagModus && si === huidigeSectie && vi === huidigeVraag) el.classList.add('huidig');
      balk.appendChild(el);
    });
  });
}

function updateVoortgangsbalk() {
  if (!lesData) return;
  const pct = Math.round((huidigeSectie / lesData.secties.length) * 100);
  document.getElementById('les-voortgang-balk').style.width = pct + '%';
}

function vulSectieInhoud(si) {
  const sectie = lesData.secties[si];
  const tekstEl = document.getElementById('sectie-tekst');
  tekstEl.innerHTML = '';

  if (sectie.afbeelding && sectie.afbeeldingUrl) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'sectie-afbeelding';
    const caption = sectie.afbeelding.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    imgWrap.innerHTML = `<img src="${sectie.afbeeldingUrl}" alt="${caption}" loading="lazy" onerror="this.closest('.sectie-afbeelding').style.display='none'"><div class="sectie-afbeelding-caption">${caption}</div>`;
    tekstEl.appendChild(imgWrap);
  }

  sectie.tekst.split(/\n\n+/).filter(a => a.trim()).forEach(a => {
    const p = document.createElement('p');
    p.textContent = a.trim();
    tekstEl.appendChild(p);
  });

  if (sectie.kernpunt) {
    const kp = document.createElement('div');
    kp.className = 'kernpunt-blok';
    kp.innerHTML = `<span class="kernpunt-label">💡 Kernpunt</span><span class="kernpunt-tekst">${sectie.kernpunt}</span>`;
    tekstEl.appendChild(kp);
  }
  
  const tijdlijnInhoud = document.getElementById('tijdlijn-inhoud');
  tijdlijnInhoud.innerHTML = sectie.tijdlijn && sectie.tijdlijn.length
    ? sectie.tijdlijn.map(t => `<div class="tijdlijn-rij"><span class="tijdlijn-jaar">${t.jaar}</span><span>${t.gebeurtenis}</span></div>`).join('')
    : '';
}

async function startLes() {
  document.getElementById('homescreen').classList.remove('zichtbaar');
  pasCategorieKleurToe(huidigeCategorieKleur);

  document.getElementById('les-voortgang').classList.add('zichtbaar');
  document.getElementById('les-scherm').classList.add('zichtbaar');
  document.getElementById('shields-balk').style.display = 'flex';

  sessieAntwoorden = [];
  inVraagModus = false;

  const opgeslagen = await haalVoortgang();
  if (opgeslagen && !opgeslagen.voltooid && opgeslagen.sectieIndex != null) {
    vraagResultaten = opgeslagen.vraagResultaten || {};
    huidigeSectie = opgeslagen.sectieIndex;
    vulSectieInhoud(huidigeSectie);
    if (opgeslagen.inVragen && opgeslagen.vraagIndex != null) {
      toonVraag(opgeslagen.vraagIndex);
    } else {
      toonSectie(huidigeSectie);
    }
  } else {
    vraagResultaten = {};
    huidigeSectie = 0;
    toonSectie(0);
  }
}

function toonSectie(index) {
  huidigeSectie = index;
  huidigeVraag = 0;
  inVraagModus = false;
  updateVoortgangsbalk();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  slaVoortgangOp({ sectieIndex: index, inVragen: false, voltooid: false, titel: artikelTitel, vraagResultaten });

  const sectie = lesData.secties[index];
  document.getElementById('sectie-label-tekst').textContent = artikelTitel;
  document.getElementById('sectie-titel').textContent = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Pagina ${index+1} van ${lesData.secties.length}`;

  const dot = document.getElementById('sectie-label-dot');
  if (huidigeCategorieKleur) {
    dot.style.background = huidigeCategorieKleur;
    dot.style.display = 'inline-block';
  } else {
    dot.style.display = 'none';
  }

  updateReaderCatBadge();
  vulSectieInhoud(index);
  setLeesKaart(true);
  document.getElementById('sectie-tekst').style.display = 'block';
  document.getElementById('tijdlijn-wrap').style.display = (sectie.tijdlijn && sectie.tijdlijn.length) ? 'block' : 'none';
  document.getElementById('knop-gelezen-wrap').style.display = 'block';
  const knopGelezen = document.querySelector('#knop-gelezen-wrap .knop-gelezen');
  const heeftVragen = sectie.vragen && sectie.vragen.length > 0;
  knopGelezen.textContent = heeftVragen ? 'Ik heb dit gelezen →' : 'Volgende sectie →';
  knopGelezen.onclick = heeftVragen ? () => toonVraag(0) : volgendeSectie;
  document.getElementById('vragen-sectie').style.display = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display = 'none';
  document.getElementById('knop-volgende').disabled = true;
  renderShields();
}

function toonVraag(vi) {
  huidigeVraag = vi;
  inVraagModus = true;
  updateVoortgangsbalk();

  const sectie = lesData.secties[huidigeSectie];
  const vraag = sectie.vragen[vi];
  const vraagId = maakVraagId(artikelTitel, huidigeSectie, vi);
  const aantalInSec = sectie.vragen.length;
  const isLaatste = vi === aantalInSec - 1;
  const isLaatsteSec = huidigeSectie === lesData.secties.length - 1;

  slaVoortgangOp({ sectieIndex: huidigeSectie, vraagIndex: vi, inVragen: true, voltooid: false, titel: artikelTitel, vraagResultaten });

  document.getElementById('sectie-label-tekst').textContent = artikelTitel;
  document.getElementById('sectie-titel').textContent = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Vraag ${vi+1} van ${aantalInSec}`;

  setLeesKaart(false);
  document.getElementById('terug-naar-vraag-balk').style.display = 'none';
  document.getElementById('vragen-sectie').style.display = 'block';

  const weetNietBtn = document.getElementById('knop-weetniets');
  const kijkOpBtn = document.getElementById('knop-kijkop');
  if (weetNietBtn) weetNietBtn.style.display = 'inline-flex';
  if (kijkOpBtn) kijkOpBtn.style.display = 'inline-flex';

  const knopVolgende = document.getElementById('knop-volgende');
  knopVolgende.disabled = true;
  knopVolgende.textContent = (isLaatste && isLaatsteSec) ? 'Afronden →' : (isLaatste ? 'Volgende sectie →' : 'Volgende →');
  knopVolgende.onclick = () => { if (isLaatste) volgendeSectie(); else toonVraag(vi+1); };

  const inhoud = document.getElementById('vragen-inhoud');
  inhoud.innerHTML = '';

  const vraagType = vraag.type || 'flashcard';
  if (vraagType === 'multiplechoice') {
    // Meerkeuze UI (ongewijzigd, jouw bestaande code)
    const opties = vraag.opties || [];
    const correcteIndex = vraag.correcteIndex;
    let optiesMetIndex = opties.map((opt, idx) => ({ opt, idx }));
    for (let i = optiesMetIndex.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [optiesMetIndex[i], optiesMetIndex[j]] = [optiesMetIndex[j], optiesMetIndex[i]];
    }

    const blok = document.createElement('div');
    blok.className = 'vraag-blok';
    let beantwoord = false;
    let gekozenIndex = -1;

    function onAntwoord(goed) {
      if (beantwoord) return;
      beantwoord = true;
      vraagResultaten[vraagId] = goed ? 'goed' : 'fout';
      sessieAntwoorden.push({ sectieIndex: huidigeSectie, vraagIndex: vi, id: vraagId, goed });
      registreerAntwoord({
        id: vraagId, vraag: vraag.vraag, type: 'multiplechoice',
        antwoordData: { vraag: vraag.vraag, opties, correcteIndex, gekozenIndex }, goed
      });
      if (weetNietBtn) weetNietBtn.style.display = 'none';
      if (kijkOpBtn) kijkOpBtn.style.display = 'none';
      knopVolgende.disabled = false;
      slaVoortgangOp({ sectieIndex: huidigeSectie, vraagIndex: vi, inVragen: true, voltooid: false, titel: artikelTitel, vraagResultaten });
      renderShields();
      setTimeout(() => toonFeedbackPicker(blok, vraagId, vraag.vraag, vraag.opties[vraag.correcteIndex] || ''), 500);
    }

    const vraagDiv = document.createElement('div');
    vraagDiv.className = 'vraag-tekst';
    vraagDiv.textContent = vraag.vraag;
    blok.appendChild(vraagDiv);

    const optiesDiv = document.createElement('div');
    optiesDiv.className = 'opties-grid';
    optiesMetIndex.forEach(({ opt, idx }) => {
      const knop = document.createElement('button');
      knop.className = 'optie-knop';
      knop.textContent = opt;
      knop.addEventListener('click', () => {
        if (beantwoord) return;
        gekozenIndex = idx;
        const goed = (gekozenIndex === correcteIndex);
        optiesDiv.querySelectorAll('.optie-knop').forEach(b => b.disabled = true);
        if (goed) knop.classList.add('goed');
        else {
          knop.classList.add('fout');
          const correcteKnop = Array.from(optiesDiv.querySelectorAll('.optie-knop')).find((b, i) => optiesMetIndex[i].idx === correcteIndex);
          if (correcteKnop) correcteKnop.classList.add('gemist');
        }
        onAntwoord(goed);
      });
      optiesDiv.appendChild(knop);
    });
    blok.appendChild(optiesDiv);
    inhoud.appendChild(blok);
  } else {
    // Flashcard UI (ongewijzigd)
    const antwoord = vraag.antwoord || '';
    const blok = document.createElement('div');
    blok.className = 'vraag-blok';
    let beantwoord = false;

    blok.innerHTML = `
      <div class="vraag-tekst">${vraag.vraag}</div>
      <div class="flashcard-onthul-wrap" id="fc-onthul-wrap-${vi}">
        <button class="knop-onthul">Tik om het antwoord te zien ↓</button>
      </div>
      <div class="flashcard-antwoord-wrap" id="fc-antwoord-wrap-${vi}" style="display:none">
        <div class="flashcard-antwoord">${antwoord}</div>
        <div class="flashcard-goed-fout">
          <button class="knop-flashcard-fout" id="fc-fout-${vi}">✗ Fout</button>
          <button class="knop-flashcard-goed" id="fc-goed-${vi}">✓ Goed</button>
        </div>
      </div>
    `;

    function onFlashcardAntwoord(goed) {
      if (beantwoord) return;
      beantwoord = true;
      vraagResultaten[vraagId] = goed ? 'goed' : 'fout';
      sessieAntwoorden.push({ sectieIndex: huidigeSectie, vraagIndex: vi, id: vraagId, goed });
      registreerAntwoord({
        id: vraagId, vraag: vraag.vraag, type: 'flashcard',
        antwoordData: { antwoord }, goed
      });
      if (weetNietBtn) weetNietBtn.style.display = 'none';
      if (kijkOpBtn) kijkOpBtn.style.display = 'none';
      knopVolgende.disabled = false;
      slaVoortgangOp({ sectieIndex: huidigeSectie, vraagIndex: vi, inVragen: true, voltooid: false, titel: artikelTitel, vraagResultaten });
      renderShields();
      setTimeout(() => toonFeedbackPicker(blok, vraagId, vraag.vraag, antwoord), 500);
    }

    blok.querySelector('.knop-onthul').onclick = () => {
      document.getElementById(`fc-onthul-wrap-${vi}`).style.display = 'none';
      document.getElementById(`fc-antwoord-wrap-${vi}`).style.display = 'block';
      if (kijkOpBtn) kijkOpBtn.style.display = 'none';
    };
    blok.querySelector(`#fc-goed-${vi}`).onclick = () => {
      if (beantwoord) return;
      blok.querySelector(`#fc-goed-${vi}`).classList.add('actief-goed');
      blok.querySelector(`#fc-fout-${vi}`).disabled = true;
      onFlashcardAntwoord(true);
    };
    blok.querySelector(`#fc-fout-${vi}`).onclick = () => {
      if (beantwoord) return;
      blok.querySelector(`#fc-fout-${vi}`).classList.add('actief-fout');
      blok.querySelector(`#fc-goed-${vi}`).disabled = true;
      onFlashcardAntwoord(false);
    };
    inhoud.appendChild(blok);
  }

  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function markeerHuidigeVraagFout() {
  if (!inVraagModus) return;
  const sectie = lesData.secties[huidigeSectie];
  const vraag = sectie.vragen[huidigeVraag];
  const vraagId = maakVraagId(artikelTitel, huidigeSectie, huidigeVraag);

  let antwoordData = {};
  if (vraag.type === 'multiplechoice') {
    antwoordData = { vraag: vraag.vraag, opties: vraag.opties, correcteIndex: vraag.correcteIndex, gekozenIndex: -1 };
  } else {
    antwoordData = { antwoord: vraag.antwoord || '' };
  }

  vraagResultaten[vraagId] = 'fout';
  sessieAntwoorden.push({ sectieIndex: huidigeSectie, vraagIndex: huidigeVraag, id: vraagId, goed: false });
  registreerAntwoord({ id: vraagId, vraag: vraag.vraag, type: vraag.type || 'flashcard', antwoordData, goed: false });

  const inhoud = document.getElementById('vragen-inhoud');
  const blok = inhoud.querySelector('.vraag-blok');
  if (blok) {
    if (vraag.type === 'multiplechoice') {
      const optieKnoppen = blok.querySelectorAll('.optie-knop');
      optieKnoppen.forEach(btn => btn.disabled = true);
      const correcteOptie = Array.from(optieKnoppen).find(btn => btn.textContent === vraag.opties[vraag.correcteIndex]);
      if (correcteOptie) correcteOptie.classList.add('gemist');
      const feedback = document.createElement('div');
      feedback.className = 'feedback fout';
      feedback.textContent = `Weet niet – juiste antwoord: ${vraag.opties[vraag.correcteIndex]}`;
      blok.appendChild(feedback);
    } else {
      const antwoordWrap = blok.querySelector('.flashcard-antwoord-wrap');
      if (antwoordWrap && antwoordWrap.style.display !== 'block') {
        blok.querySelector('.flashcard-onthul-wrap').style.display = 'none';
        antwoordWrap.style.display = 'block';
      }
      const feedback = document.createElement('div');
      feedback.className = 'feedback fout';
      feedback.textContent = `Weet niet – het juiste antwoord is: ${vraag.antwoord || '?'}`;
      blok.appendChild(feedback);
    }
  }

  document.getElementById('knop-weetniets').style.display = 'none';
  document.getElementById('knop-kijkop').style.display = 'none';
  document.getElementById('knop-volgende').disabled = false;

  slaVoortgangOp({ sectieIndex: huidigeSectie, vraagIndex: huidigeVraag, inVragen: true, voltooid: false, titel: artikelTitel, vraagResultaten });
  renderShields();
}

function toonTekstLookup() {
  inVraagModus = false;
  const sectie = lesData.secties[huidigeSectie];
  document.getElementById('sectie-titel').textContent = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = 'Kijk op in de tekst';
  updateReaderCatBadge();
  setLeesKaart(true);
  document.getElementById('sectie-tekst').style.display = 'block';
  document.getElementById('tijdlijn-wrap').style.display = (sectie.tijdlijn && sectie.tijdlijn.length) ? 'block' : 'none';
  document.getElementById('vragen-sectie').style.display = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display = 'block';
  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function terugNaarVraag() {
  inVraagModus = true;
  const sectie = lesData.secties[huidigeSectie];
  document.getElementById('sectie-label-tekst').textContent = artikelTitel;
  document.getElementById('sectie-titel').textContent = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Vraag ${huidigeVraag+1} van ${sectie.vragen.length}`;
  updateReaderCatBadge();
  setLeesKaart(false);
  document.getElementById('terug-naar-vraag-balk').style.display = 'none';
  document.getElementById('vragen-sectie').style.display = 'block';
  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function volgendeSectie() {
  huidigeSectie++;
  inVraagModus = false;
  if (huidigeSectie >= lesData.secties.length) {
    startHerhaling();
  } else {
    toonSectie(huidigeSectie);
  }
}

// Herhaling
let herhalingsWachtrij = [];

function startHerhaling() {
  herhalingsWachtrij = sessieAntwoorden.filter(a => !a.goed).map(a => ({
    id: a.id,
    vraagData: lesData.secties[a.sectieIndex].vragen[a.vraagIndex]
  }));
  if (herhalingsWachtrij.length === 0) {
    toonKlaarScherm();
  } else {
    toonHerhalingsRonde();
  }
}

function toonHerhalingsRonde() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  inVraagModus = false;
  document.getElementById('sectie-label-tekst').textContent = artikelTitel;
  document.getElementById('sectie-titel').textContent = 'Nog niet helemaal...';
  document.getElementById('sectie-nummer-tekst').textContent = `${herhalingsWachtrij.length} vraag${herhalingsWachtrij.length !== 1 ? 'en' : ''} opnieuw`;
  setLeesKaart(true);
  document.getElementById('sectie-tekst').style.display = 'block';
  document.getElementById('sectie-tekst').innerHTML = '<p style="color:rgba(232,227,219,0.65)">De vragen die je net fout had komen hieronder terug. Ga door totdat alles goed is.</p>';
  document.getElementById('tijdlijn-wrap').style.display = 'none';
  document.getElementById('knop-gelezen-wrap').style.display = 'none';
  document.getElementById('vragen-sectie').style.display = 'block';
  document.getElementById('knop-weetniets').style.display = 'none';
  document.getElementById('knop-kijkop').style.display = 'none';
  document.getElementById('knop-volgende').disabled = true;
  document.getElementById('knop-volgende').textContent = 'Volgende →';
  document.getElementById('knop-volgende').onclick = null;

  const inhoud = document.getElementById('vragen-inhoud');
  inhoud.innerHTML = '';
  const rondeResultaten = herhalingsWachtrij.map(() => ({ beantwoord: false, goed: false }));

  function checkAllesHerhaling() {
    if (!rondeResultaten.every(r => r.beantwoord)) return;
    const nogFout = herhalingsWachtrij.filter((_, i) => !rondeResultaten[i].goed);
    const knopVolgende = document.getElementById('knop-volgende');
    if (nogFout.length === 0) {
      knopVolgende.disabled = false;
      knopVolgende.textContent = 'Alles goed! →';
      knopVolgende.onclick = toonKlaarScherm;
    } else {
      knopVolgende.disabled = false;
      knopVolgende.textContent = `Nog ${nogFout.length} fout — nog een ronde →`;
      knopVolgende.onclick = () => {
        herhalingsWachtrij = nogFout;
        toonHerhalingsRonde();
      };
    }
  }

  herhalingsWachtrij.forEach((item, hi) => {
    const vraag = item.vraagData;
    const blok = document.createElement('div');
    blok.className = 'vraag-blok';
    if (vraag.type === 'multiplechoice') {
      const opties = vraag.opties || [];
      const correcteIndex = vraag.correcteIndex;
      let optiesMetIndex = opties.map((opt, idx) => ({ opt, idx }));
      for (let i = optiesMetIndex.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [optiesMetIndex[i], optiesMetIndex[j]] = [optiesMetIndex[j], optiesMetIndex[i]];
      }
      blok.innerHTML = `<div class="vraag-tekst">${hi+1}. ${vraag.vraag}</div><div class="opties-grid" id="h-mc-opties-${hi}"></div>`;
      const container = blok.querySelector(`#h-mc-opties-${hi}`);
      let beantwoord = false;
      optiesMetIndex.forEach(({ opt, idx }) => {
        const knop = document.createElement('button');
        knop.className = 'optie-knop';
        knop.textContent = opt;
        knop.addEventListener('click', () => {
          if (beantwoord) return;
          beantwoord = true;
          container.querySelectorAll('.optie-knop').forEach(b => b.disabled = true);
          const goed = idx === correcteIndex;
          if (goed) knop.classList.add('goed');
          else {
            knop.classList.add('fout');
            const correcteKnop = Array.from(container.querySelectorAll('.optie-knop')).find((b, i) => optiesMetIndex[i].idx === correcteIndex);
            if (correcteKnop) correcteKnop.classList.add('gemist');
          }
          rondeResultaten[hi] = { beantwoord: true, goed };
          registreerAntwoord({ id: item.id, vraag: vraag.vraag, type: 'multiplechoice', antwoordData: { vraag: vraag.vraag, opties, correcteIndex, gekozenIndex: idx }, goed });
          checkAllesHerhaling();
        });
        container.appendChild(knop);
      });
    } else {
      const antwoord = vraag.antwoord || vraag.goed || '';
      blok.innerHTML = `<div class="vraag-tekst">${hi+1}. ${vraag.vraag}</div>
        <div class="flashcard-onthul-wrap" id="h-onthul-${hi}"><button class="knop-onthul">Tik om het antwoord te zien ↓</button></div>
        <div class="flashcard-antwoord-wrap" id="h-antwoord-${hi}" style="display:none">
          <div class="flashcard-antwoord">${antwoord}</div>
          <div class="flashcard-goed-fout">
            <button class="knop-flashcard-fout" id="h-fout-${hi}">✗ Fout</button>
            <button class="knop-flashcard-goed" id="h-goed-${hi}">✓ Goed</button>
          </div>
        </div>`;
      blok.querySelector('.knop-onthul').addEventListener('click', () => {
        document.getElementById(`h-onthul-${hi}`).style.display = 'none';
        document.getElementById(`h-antwoord-${hi}`).style.display = 'block';
      });
      blok.querySelector(`#h-goed-${hi}`).addEventListener('click', () => {
        if (rondeResultaten[hi].beantwoord) return;
        blok.querySelector(`#h-goed-${hi}`).classList.add('actief-goed');
        blok.querySelector(`#h-fout-${hi}`).disabled = true;
        rondeResultaten[hi] = { beantwoord: true, goed: true };
        registreerAntwoord({ id: item.id, vraag: vraag.vraag, type: 'flashcard', antwoordData: { antwoord }, goed: true });
        checkAllesHerhaling();
      });
      blok.querySelector(`#h-fout-${hi}`).addEventListener('click', () => {
        if (rondeResultaten[hi].beantwoord) return;
        blok.querySelector(`#h-fout-${hi}`).classList.add('actief-fout');
        blok.querySelector(`#h-goed-${hi}`).disabled = true;
        rondeResultaten[hi] = { beantwoord: true, goed: false };
        registreerAntwoord({ id: item.id, vraag: vraag.vraag, type: 'flashcard', antwoordData: { antwoord }, goed: false });
        checkAllesHerhaling();
      });
    }
    inhoud.appendChild(blok);
  });
}

function toonKlaarScherm() {
  if (pendingSR && pendingSR.length > 0) {
    const items = pendingSR;
    pendingSR = [];
    smartActive = false;
    srCallback = () => { toonKlaarSchermFinal(); };
    srVervolgTekst = 'Doorgaan naar les →';
    toonSRReview(items);
    return;
  }
  toonKlaarSchermFinal();
}

function toonKlaarSchermFinal() {
  document.getElementById('les-scherm').classList.remove('zichtbaar');
  document.getElementById('shields-balk').style.display = 'none';
  document.getElementById('les-voortgang-balk').style.width = '100%';
  setTimeout(() => document.getElementById('les-voortgang').classList.add('vervaag'), 600);
  const totaal = sessieAntwoorden.length;
  const goed = sessieAntwoorden.filter(a => a.goed).length;
  const pct = totaal > 0 ? Math.round((goed / totaal) * 100) : 0;
  document.getElementById('klaar-stats').innerHTML = `Je beantwoordde <strong>${goed} van de ${totaal} vragen</strong> goed (${pct}%).<br/>De vragen komen de komende dagen terug via spaced repetition.`;
  document.getElementById('klaar-scherm').classList.add('zichtbaar');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  slaVoortgangOp({ sectieIndex: lesData.secties.length - 1, voltooid: true, titel: artikelTitel });
  markSessionDone();
  markeerLesVoltooid(huidigPadId, huidigLesNummer); // fire-and-forget, niet await
}

function updateReaderCatBadge() {
  const el = document.getElementById('reader-cat-badge');
  if (!el) return;
  if (huidigeCategorieNaam) {
    el.textContent = '● ' + huidigeCategorieNaam;
    el.style.color = huidigeCategorieKleur || 'var(--muted)';
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

// Artikelkiezer (niet meer actief, maar voor de zekerheid netjes afgehandeld)
async function akStartLes() {
  toonToast('De artikelkiezer is niet langer beschikbaar. Gebruik het leerpadsysteem.');
}

// ════════════════════════════════════════
// FEEDBACK PICKER
// ════════════════════════════════════════
function toonFeedbackPicker(blok, vraagId, vraagTekst, correctAntwoord) {
  // Voorkom dubbele toevoeging
  if (blok.querySelector('.feedback-wrap')) return;

  const wrap = document.createElement('div');
  wrap.className = 'feedback-wrap';

  const knop = document.createElement('button');
  knop.className = 'feedback-duim-knop';
  knop.innerHTML = '👎 Probleem melden';

  const picker = document.createElement('div');
  picker.className = 'feedback-picker';
  picker.style.display = 'none';

  const label = document.createElement('div');
  label.className = 'feedback-picker-label';
  label.textContent = 'Wat klopt er niet?';
  picker.appendChild(label);

  ['Vraag is onduidelijk', 'Antwoord klopt niet', 'Te makkelijk', 'Te moeilijk', 'Taalfout of typfout']
    .forEach(optie => {
      const btn = document.createElement('button');
      btn.className = 'feedback-optie';
      btn.textContent = optie;
      btn.addEventListener('click', async () => {
        await voegFeedbackToe({ vraagId, vraagTekst, correctAntwoord, probleem: optie });
        knop.textContent = '✓ Bedankt voor je feedback';
        knop.classList.add('feedback-verstuurd');
        knop.disabled = true;
        picker.style.display = 'none';
      });
      picker.appendChild(btn);
    });

  knop.addEventListener('click', () => {
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
  });

  wrap.appendChild(knop);
  wrap.appendChild(picker);
  blok.appendChild(wrap);
}

async function markeerLesVoltooid(padId, lesNummer) {
  if (!padId || !lesNummer) return;
  const token = await haalGithubToken();
  if (!token) return; // Geen token → kan niet schrijven, stil overslaan

  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/actief-leerpad.json`;
    const headers = {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    const getRes = await fetch(url, { headers });
    if (!getRes.ok) return;
    const getData = await getRes.json();

    // GitHub geeft base64 met newlines — replace voor btoa-compatibiliteit
    const pad = JSON.parse(atob(getData.content.replace(/\n/g, '')));
    const les = pad.lessen.find(l => l.nummer === lesNummer);
    if (!les) return;

    les.datumVoltooid = lokaalDatum();

    const putRes = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `Les ${lesNummer} van pad ${padId} voltooid`,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(pad, null, 2)))),
        sha: getData.sha
      })
    });
    if (!putRes.ok) console.warn('Kon les niet als voltooid markeren op GitHub');
  } catch (e) {
    console.warn('markeerLesVoltooid mislukt:', e);
  }
}

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
