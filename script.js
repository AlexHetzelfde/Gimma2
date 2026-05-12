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
const MAX_TEKST       = 40000;

// ════════════════════════════════════════
// INDEXEDDB LAAG
// ════════════════════════════════════════
const DB_NAAM   = 'wikileer_db';
const DB_VERSIE = 1;
const STORE_KV  = 'kv';
let db = null;
const _memFallback = {};

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAAM, DB_VERSIE);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE_KV);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbGet(sleutel) {
  if (!db) return Promise.resolve(_memFallback[sleutel] ?? null);
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readonly');
    const req = tx.objectStore(STORE_KV).get(sleutel);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

function dbSet(sleutel, waarde) {
  if (!db) { _memFallback[sleutel] = waarde; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readwrite');
    const req = tx.objectStore(STORE_KV).put(waarde, sleutel);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(sleutel) {
  if (!db) { delete _memFallback[sleutel]; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readwrite');
    const req = tx.objectStore(STORE_KV).delete(sleutel);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbGetAllKeys() {
  if (!db) return Promise.resolve(Object.keys(_memFallback));
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_KV, 'readonly');
    const req = tx.objectStore(STORE_KV).getAllKeys();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function migreerVanLocalStorage() {
  const alGedaan = await dbGet('_migratie_gedaan');
  if (alGedaan) return;

  const statischeSleutels = [LS_KEY, LS_SR, LS_LAST_SESSION, LS_CATS];
  const prefixen          = ['wikileer_les_', 'wikileer_prog_'];

  const teVerhuizen = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (statischeSleutels.includes(k) || prefixen.some(p => k.startsWith(p))) {
      teVerhuizen.push(k);
    }
  }

  for (const k of teVerhuizen) {
    const waarde = localStorage.getItem(k);
    if (waarde !== null) {
      try {
        await dbSet(k, waarde);
        localStorage.removeItem(k);
      } catch (e) {
        console.warn('Migratie mislukt voor', k, e);
      }
    }
  }

  await dbSet('_migratie_gedaan', '1');
}

// ════════════════════════════════════════
// OPSLAG HELPERS
// ════════════════════════════════════════

async function haalKey() {
  return (await dbGet(LS_KEY)) || '';
}

async function slaKeyOp(k) {
  await dbSet(LS_KEY, k.trim());
}

async function haalGecachedeLes() {
  try {
    const raw = await dbGet(vandaagSleutel());
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Fout bij laden gecachede les:', e);
    return null;
  }
}

async function slaLesOp(lesObj) {
  try {
    const sleutels = await dbGetAllKeys();
    for (const k of sleutels) {
      if (typeof k === 'string' && k.startsWith('wikileer_les_') && k !== vandaagSleutel()) {
        await dbDelete(k);
      }
    }
    await dbSet(vandaagSleutel(), JSON.stringify(lesObj));
  } catch (e) {
    console.warn('Fout bij opslaan les:', e);
  }
}

async function haalSRData() {
  try {
    const raw = await dbGet(LS_SR);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Fout bij laden SR data:', e);
    return [];
  }
}

async function slaSRDataOp(data) {
  try {
    await dbSet(LS_SR, JSON.stringify(data));
  } catch (e) {
    console.warn('Fout bij opslaan SR data:', e);
  }
}

function vandaagProgSleutel() {
  return 'wikileer_prog_' + new Date().toISOString().slice(0, 10);
}

async function haalVoortgang() {
  try {
    const raw = await dbGet(vandaagProgSleutel());
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Fout bij laden voortgang:', e);
    return null;
  }
}

async function slaVoortgangOp(obj) {
  try {
    await dbSet(vandaagProgSleutel(), JSON.stringify(obj));
  } catch (e) {
    console.warn('Fout bij opslaan voortgang:', e);
  }
}

async function verwijderVoortgang() {
  try {
    await dbDelete(vandaagProgSleutel());
  } catch (e) {
    console.warn('Fout bij verwijderen voortgang:', e);
  }
}

async function verwijderLesUitSR(artikelTitelStr) {
  const basis = artikelTitelStr.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
  const sr    = (await haalSRData()).filter(item => !item.id.startsWith(basis));
  await slaSRDataOp(sr);
}

async function haalCategorieën() {
  try {
    const raw = await dbGet(LS_CATS);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Fout bij laden categorieën:', e);
    return [];
  }
}

async function slaCategoriënOp(cats) {
  try {
    await dbSet(LS_CATS, JSON.stringify(cats));
  } catch (e) {
    console.warn('Fout bij opslaan categorieën:', e);
  }
}

async function registreerCategorie(naam, kleur) {
  if (!naam || !kleur) return;
  const cats = await haalCategorieën();
  if (!cats.find(c => c.naam === naam)) {
    cats.push({ naam, kleur });
    await slaCategoriënOp(cats);
  }
}

// ════════════════════════════════════════
// CATEGORIE & KLEUR SYSTEEM
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

// ════════════════════════════════════════
// LAYOUT TOGGLE
// ════════════════════════════════════════
function setLayout(modus) {
  localStorage.setItem(LS_LAYOUT, modus);
  document.body.classList.toggle('layout-telefoon', modus === 'telefoon');
  document.getElementById('knop-desktop').classList.toggle('actief', modus === 'desktop');
  document.getElementById('knop-telefoon').classList.toggle('actief', modus === 'telefoon');
}

function herstelLayout() {
  const opgeslagen = localStorage.getItem(LS_LAYOUT) || 'desktop';
  setLayout(opgeslagen);
}

// ════════════════════════════════════════
// TOAST
// ════════════════════════════════════════
let toastTimer = null;
let pendingSR = [];            // items die aan het eind van de les nog herhaald moeten worden
let smartActive = false;   
let srCallback = null;
let srVervolgTekst = 'Doorgaan naar les →';// vlag voor smart session loop

function toonToast(tekst, duur = 2500) {
  const el = document.getElementById('toast');
  el.textContent = tekst;
  el.classList.add('zichtbaar');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('zichtbaar'), duur);
}

// ════════════════════════════════════════
// STATS MODAL
// ════════════════════════════════════════
function toonStatsModal() {
  document.getElementById('stats-modal').classList.add('zichtbaar');
  renderStats();
}

function sluitStatsModal() {
  document.getElementById('stats-modal').classList.remove('zichtbaar');
}

async function renderStats() {
  const el = document.getElementById('stats-inhoud');
  const sr         = await haalSRData();
  const streakData = await haalStreak();

  const streakHtml = streakData.huidig > 0 ? `
    <div class="stats-streak-balk">
      <span>🔥 Huidige streak: <strong>${streakData.huidig} dag${streakData.huidig !== 1 ? 'en' : ''}</strong></span>
      <span style="color:var(--muted);font-size:0.78rem">Langste: ${streakData.langste} dag${streakData.langste !== 1 ? 'en' : ''}</span>
    </div>` : '';

  const totaal = sr.length;
  if (totaal === 0) {
    el.innerHTML = `
      ${streakHtml}
      <div class="stats-hero">
        <div class="stats-leeg">🌱 Nog geen data — maak je eerste les om je voortgang bij te houden.</div>
      </div>`;
    return;
  }
  const nieuw = sr.filter(i => (i.strength ?? 20) < 35).length;
  const lerend = sr.filter(i => (i.strength ?? 20) >= 35 && (i.strength ?? 20) < 70).length;
  const beheerst = sr.filter(i => (i.strength ?? 20) >= 70).length;
  const gemStr = Math.round(sr.reduce((s, i) => s + (i.strength ?? 20), 0) / totaal);
  const uniekeLessen = new Set(sr.map(i => i.id.replace(/_[^_]+_[^_]+$/, ''))).size;

  const vandaag = Date.now();
  const morgen = new Date(); morgen.setDate(morgen.getDate() + 1); morgen.setHours(23,59,59,999);
  const teHerhalen = sr.filter(i => i.next_due && i.next_due <= vandaag).length;
  const morgenDue = sr.filter(i => i.next_due && i.next_due > vandaag && i.next_due <= morgen.getTime()).length;

  // Komende 7 dagen (exclusief vandaag)
  const komendeDagen = [];
  for (let i = 1; i <= 7; i++) {
    const dagStart = new Date(); dagStart.setDate(dagStart.getDate() + i); dagStart.setHours(0,0,0,0);
    const dagEind = new Date(dagStart); dagEind.setHours(23,59,59,999);
    const count = sr.filter(i => i.next_due && i.next_due >= dagStart.getTime() && i.next_due <= dagEind.getTime()).length;
    komendeDagen.push({ dag: dagStart.toLocaleDateString('nl-NL', { weekday:'short', day:'numeric' }), count });
  }

  // Weekhistorie (laatste 7 dagen)
  const dagNamen = ['zo','ma','di','wo','do','vr','za'];
  const weekData = [];
  for (let d = 6; d >= 0; d--) {
    const dagStart = new Date(); dagStart.setDate(dagStart.getDate() - d); dagStart.setHours(0,0,0,0);
    const dagEind = new Date(dagStart); dagEind.setHours(23,59,59,999);
    const count = sr.filter(i => i.last_seen && i.last_seen >= dagStart.getTime() && i.last_seen <= dagEind.getTime()).length;
    weekData.push({ label: dagNamen[dagStart.getDay()], count, isVandaag: d === 0 });
  }
  const maxWeek = Math.max(...weekData.map(d => d.count), 1);

  // Categorieën verbeterd
  const catMap = {};
  for (const item of sr) {
    const naam = item.categorieNaam || 'Overig';
    const kleur = item.categorieKleur || '#e68a2e';
    if (!catMap[naam]) catMap[naam] = { kleur, items: [], totalStrength: 0, count: 0 };
    catMap[naam].items.push(item.strength ?? 20);
    catMap[naam].totalStrength += (item.strength ?? 20);
    catMap[naam].count++;
  }
  const catLijst = Object.entries(catMap).map(([naam, { kleur, totalStrength, count }]) => ({
    naam, kleur, aantal: count, gemStr: Math.round(totalStrength / count)
  })).sort((a,b) => b.aantal - a.aantal);

  // HTML bouwen
  const nPct = totaal ? Math.round((nieuw/totaal)*100) : 0;
  const lPct = totaal ? Math.round((lerend/totaal)*100) : 0;
  const bPct = totaal ? Math.round((beheerst/totaal)*100) : 0;

  const weekHtml = weekData.map(dag => `
    <div class="stats-week-dag">
      <div class="stats-week-balk-wrap">
        <div class="stats-week-balk ${dag.count > 0 ? 'heeft-data' : ''} ${dag.isVandaag ? 'vandaag-balk' : ''}" style="height:${Math.max(6, Math.round((dag.count/maxWeek)*100))}%"></div>
      </div>
      <div class="stats-week-label ${dag.isVandaag ? 'vandaag-label' : ''}">${dag.label}</div>
    </div>
  `).join('');

  const komendeHtml = komendeDagen.map(d => `
    <div style="text-align:center; font-size:0.7rem; min-width: 32px;">
      <div style="font-weight:600; margin-bottom:2px;">${d.dag}</div>
      <div style="background:var(--les-kleur); border-radius:10px; padding:2px 0; color:#000; font-weight:bold;">${d.count}</div>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="stats-hero">
      <div class="stats-hero-item accent-tegel"><div class="stats-hero-getal">${totaal}</div><div class="stats-hero-label">Vragen geleerd</div></div>
      <div class="stats-hero-item"><div class="stats-hero-getal">${beheerst}</div><div class="stats-hero-label">Beheerst</div></div>
      <div class="stats-hero-item"><div class="stats-hero-getal">${gemStr}%</div><div class="stats-hero-label">Gem. sterkte</div></div>
      <div class="stats-hero-item"><div class="stats-hero-getal">${uniekeLessen}</div><div class="stats-hero-label">Lessen gevolgd</div></div>
    </div>
    <div class="stats-due-balk" style="background:rgba(230,138,46,0.07); border-color:rgba(230,138,46,0.2);">
      <div class="stats-due-tekst">${teHerhalen > 0 ? `🔁 ${teHerhalen} te herhalen vandaag` : (morgenDue > 0 ? `✓ Alles gedaan — morgen ${morgenDue} vragen` : `✓ Geen herhalingen gepland`)}</div>
      <div class="stats-due-getal">${teHerhalen > 0 ? teHerhalen : '✓'}</div>
    </div>
    <div class="stats-sectie-kop">Komende herhalingen (7 dagen)</div>
    <div style="display:flex; gap:0.5rem; justify-content:space-around; margin-bottom:1rem;">${komendeHtml}</div>
    <div class="stats-sectie-kop">Sterkte verdeling</div>
    <div class="stats-verdeling"><div class="stats-verdeling-balk" style="width:${nPct}%;background:var(--fout)"></div><div class="stats-verdeling-balk" style="width:${lPct}%;background:var(--accent)"></div><div class="stats-verdeling-balk" style="width:${bPct}%;background:var(--goed)"></div></div>
    <div class="stats-legenda">
      <span class="stats-legenda-item"><span class="stats-legenda-dot" style="background:var(--fout)"></span>Nieuw (${nieuw})</span>
      <span class="stats-legenda-item"><span class="stats-legenda-dot" style="background:var(--accent)"></span>Aan het leren (${lerend})</span>
      <span class="stats-legenda-item"><span class="stats-legenda-dot" style="background:var(--goed)"></span>Beheerst (${beheerst})</span>
    </div>
    <div class="stats-sectie-kop">Activiteit (7 dagen)</div>
    <div class="stats-week-wrap">${weekHtml}</div>
    <div class="stats-sectie-kop">Categorieën</div>
    <div>${catLijst.map(c => `
      <div class="stats-cat-rij">
        <div class="stats-cat-dot" style="background:${c.kleur}"></div>
        <div class="stats-cat-naam">${c.naam}</div>
        <div class="stats-cat-balk-wrap"><div class="stats-cat-balk" style="width:${c.gemStr}%;background:${sterktekleur(c.gemStr)}"></div></div>
        <div class="stats-cat-getal">${c.gemStr}%</div>
        <div class="stats-cat-getal" style="min-width:36px;text-align:right">${c.aantal} ✦</div>
      </div>
    `).join('')}</div>
  `;
}

// ════════════════════════════════════════
// DATUM / TIJD HELPERS
// ════════════════════════════════════════
function vandaagSleutel() {
  return 'wikileer_les_' + new Date().toISOString().slice(0, 10);
}

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getEndOfDay() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

async function lastSessionToday() {
  const val = await dbGet(LS_LAST_SESSION);
  return val === new Date().toISOString().slice(0, 10);
}

async function markSessionDone() {
  try {
    await dbSet(LS_LAST_SESSION, new Date().toISOString().slice(0, 10));
    await updateStreak();
  } catch (e) {
    console.warn('Fout bij markeren sessie:', e);
  }
}

async function haalStreak() {
  try {
    const raw = await dbGet(LS_STREAK);
    return raw ? JSON.parse(raw) : { huidig: 0, langste: 0, laatste_datum: null };
  } catch (e) {
    return { huidig: 0, langste: 0, laatste_datum: null };
  }
}

async function updateStreak() {
  const streak    = await haalStreak();
  const vandaag   = new Date().toISOString().slice(0, 10);
  const gisteren  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (streak.laatste_datum === vandaag) return;
  streak.huidig       = streak.laatste_datum === gisteren ? streak.huidig + 1 : 1;
  streak.langste      = Math.max(streak.langste, streak.huidig);
  streak.laatste_datum = vandaag;
  await dbSet(LS_STREAK, JSON.stringify(streak));
}

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

function toonFeedbackPicker(container, vraagId, vraagTekst, antwoord) {
  const redenen = ['Te vaag', 'Antwoord klopt niet', 'Vraag en antwoord zeggen hetzelfde', 'Andere reden'];
  const wrap  = document.createElement('div');
  wrap.className = 'feedback-wrap';

  const knop  = document.createElement('button');
  knop.className = 'feedback-duim-knop';
  knop.innerHTML = '👎 <span>Meld probleem</span>';

  const picker = document.createElement('div');
  picker.className = 'feedback-picker';
  picker.style.display = 'none';

  const label = document.createElement('div');
  label.className = 'feedback-picker-label';
  label.textContent = 'Wat klopt er niet?';
  picker.appendChild(label);

  redenen.forEach(reden => {
    const btn = document.createElement('button');
    btn.className = 'feedback-optie';
    btn.textContent = reden;
    btn.addEventListener('click', async () => {
      await voegFeedbackToe({ vraagId, vraagTekst, antwoord, reden });
      picker.style.display = 'none';
      knop.innerHTML = '✓ Bedankt';
      knop.disabled = true;
      knop.classList.add('feedback-verstuurd');
      toonToast('Feedback opgeslagen!');
    });
    picker.appendChild(btn);
  });

  knop.addEventListener('click', () => {
    picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
  });

  wrap.appendChild(knop);
  wrap.appendChild(picker);
  container.appendChild(wrap);
}

async function getDueItems() {
  const sr      = await haalSRData();
  const vandaag = await lastSessionToday();
  const threshold = vandaag ? Date.now() : getEndOfDay();
  return sr
    .filter(item => item.next_due && item.next_due <= threshold)
    .sort((a, b) => {
      const sA = a.strength ?? 20;
      const sB = b.strength ?? 20;
      if (sA !== sB) return sA - sB;
      return (a.next_due ?? 0) - (b.next_due ?? 0);
    });
}

async function registreerAntwoord({ id, vraag, type, antwoordData, goed }) {
  const sr  = await haalSRData();
  const idx = sr.findIndex(v => v.id === id);
  const now    = Date.now();
  const morgen = getTomorrow();

  if (idx === -1) {
    // Nieuw item — begin met SM-2 defaults
    const ef         = goed ? Math.max(1.3, 2.5 - 0.8) : Math.max(1.3, 2.5 - 0.2); // q=5 of q=0
    const repetities = goed ? 1 : 0;
    const interval   = goed ? 1 : 1;
    const strength   = Math.min(100, Math.max(0, Math.round(repetities * 13 + (ef - 1.3) * 15)));

    sr.push({
      id, vraag, type,
      ...antwoordData,
      categorieKleur: huidigeCategorieKleur,
      categorieNaam:  huidigeCategorieNaam,
      ef, interval, repetities, strength,
      streak:    goed ? 1 : 0,
      next_due:  goed ? now + interval * 86400000 : morgen,
      last_seen: now
    });

  } else {
    const item = sr[idx];
    Object.assign(item, antwoordData);
    item.last_seen = now;

    // Migratie: vul SM-2 velden in voor oude items
    if (item.ef == null) {
      item.ef         = 2.5;
      item.repetities = item.streak || 0;
      item.interval   = [1, 2, 4, 7, 14, 30][Math.min(item.interval_step || 0, 5)];
    }

    if (!item.categorieKleur && huidigeCategorieKleur) {
      item.categorieKleur = huidigeCategorieKleur;
      item.categorieNaam  = huidigeCategorieNaam;
    }

    if (goed) {
      item.streak     = (item.streak || 0) + 1;
      item.repetities = (item.repetities || 0) + 1;
      // EF aanpassen (kwaliteit 5 = perfect)
      item.ef = Math.max(1.3, item.ef + 0.1 - (5 - 5) * (0.08 + (5 - 5) * 0.02));

      if      (item.repetities === 1) item.interval = 1;
      else if (item.repetities === 2) item.interval = 6;
      else    item.interval = Math.max(1, Math.round((item.interval || 1) * item.ef));

      item.next_due = now + item.interval * 86400000;
    } else {
      item.streak     = 0;
      item.ef         = Math.max(1.3, (item.ef || 2.5) - 0.2);
      item.repetities = 0;
      item.interval   = 1;
      item.next_due   = morgen;
    }

    item.strength = Math.min(100, Math.max(0,
      Math.round((item.repetities || 0) * 13 + ((item.ef || 2.5) - 1.3) * 15)
    ));
  }

  await slaSRDataOp(sr);
}

function maakVraagId(artikelTitel, sectieIndex, vraagIndex) {
  const basis = artikelTitel.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40);
  return `${basis}_s${sectieIndex}_v${vraagIndex}`;
}

function sterktekleur(strength) {
  if (strength < 35) return 'var(--fout)';
  if (strength < 65) return 'var(--accent)';
  return 'var(--goed)';
}

// ════════════════════════════════════════
// DATUM IN HEADER + MOBILE DATUMBALK
// ════════════════════════════════════════
const datumTekst = new Date().toLocaleDateString('nl-NL', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

document.getElementById('header-datum').textContent = datumTekst;

const datumMobielEl = document.getElementById('datum-mobiel-tekst');
if (datumMobielEl) {
  datumMobielEl.textContent = datumTekst;
}

// ════════════════════════════════════════
// LOGO KLIKKEN — terug naar home
// ════════════════════════════════════════
function logoKlikken() {
  const inLes   = document.getElementById('les-scherm').classList.contains('zichtbaar');
  const inKlaar = document.getElementById('klaar-scherm').classList.contains('zichtbaar');
  if (inLes || inKlaar) {
    toonTerugNaarHomeModal();
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

  lesData      = null;
  inVraagModus = false;

  await toonHomescreen();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
async function init() {
  const key = await haalKey();
  if (!key) {
    document.getElementById('key-scherm').classList.add('zichtbaar');
  } else {
    await toonHomescreen();
  }
}

// ════════════════════════════════════════
// HOMESCREEN
// ════════════════════════════════════════
async function toonHomescreen() {
  pasCategorieKleurToe('#ed5b36');
  document.getElementById('key-scherm').classList.remove('zichtbaar');
  document.getElementById('key-knop-header').style.display = 'flex';
  document.getElementById('homescreen').classList.add('zichtbaar');

  const cache     = await haalGecachedeLes();
  const voortgang = await haalVoortgang();
  const dueItems  = await getDueItems();

  const streak    = await haalStreak();
  const streakEl  = document.getElementById('streak-display');
  if (streakEl) {
    if (streak.huidig > 1) {
      streakEl.textContent = `🔥 ${streak.huidig} dagen op rij`;
      streakEl.style.display = '';
    } else {
      streakEl.style.display = 'none';
    }
  }

  // Categorie‑chip
  const chip = document.getElementById('categorie-chip');
  if (cache && cache.categorieKleur) {
    huidigeCategorieKleur = cache.categorieKleur;
    huidigeCategorieNaam  = cache.categorie || '';
    document.getElementById('categorie-dot').style.background = cache.categorieKleur;
    document.getElementById('categorie-naam-tekst').textContent = cache.categorie || '';
    document.getElementById('knop-les-nieuw').style.borderLeftColor = cache.categorieKleur;
    chip.style.display = '';
  } else {
    chip.style.display = 'none';
    document.getElementById('knop-les-nieuw').style.borderLeftColor = '';
  }

  // Bepaal statussen
  const lesVoltooid = voortgang && voortgang.voltooid;
  const heeftCache = !!cache;
  const heeftDue = dueItems.length > 0;

  // Knoppen wrapper zichtbaar
  document.getElementById('home-knoppen-wrap').style.display = 'flex';

  // ── SMART SESSION ──
  const smartBtn = document.getElementById('knop-smart');
  const smartSub = document.getElementById('smart-sub');
  if (!heeftDue && (lesVoltooid || !heeftCache)) {
    // Niks te doen
    smartBtn.disabled = true;
    smartBtn.setAttribute('data-tip', 'Alles is al gedaan vandaag');
    smartSub.textContent = 'Je bent helemaal bij! 🎉';
  } else {
    smartBtn.disabled = false;
    smartBtn.removeAttribute('data-tip');
    const delen = [];
    if (heeftDue) delen.push(`${dueItems.length} herhaling${dueItems.length>1?'en':''}`);
    if (!lesVoltooid) delen.push('les van vandaag');
    smartSub.textContent = delen.join(' + ');
  }

  // ── VAULT PRACTICE ──
  const vaultBtn = document.getElementById('knop-vault');
  const vaultSub = document.getElementById('vault-sub');
  if (!heeftDue) {
    vaultBtn.disabled = true;
    vaultBtn.setAttribute('data-tip', 'Alles bij! Geen herhalingen nodig');
    vaultSub.textContent = 'Je kluis is leeg';
  } else {
    vaultBtn.disabled = false;
    vaultBtn.removeAttribute('data-tip');
    vaultSub.textContent = `${dueItems.length} vraag${dueItems.length>1?'en':''} klaar voor herhaling`;
  }

  // ── LES VAN DE DAG ──
  const lesBtn = document.getElementById('knop-les-nieuw');
  const lesSub = document.getElementById('les-sub');
  if (lesVoltooid) {
    lesBtn.disabled = false;
    lesBtn.onclick = toonAlGemaaktModal;
    lesSub.textContent = 'Al voltooid — bekijk/opnieuw';
  } else if (!heeftCache) {
    lesBtn.disabled = false;
    lesBtn.onclick = startLesVanVandaag;
    lesSub.textContent = 'Nieuwe les genereren';
  } else if (voortgang && !voortgang.voltooid) {
    const sectieTekst = `sectie ${voortgang.sectieIndex + 1}${voortgang.inVragen ? `, vraag ${(voortgang.vraagIndex || 0) + 1}` : ''}`;
    lesBtn.disabled = false;
    lesBtn.onclick = startLesVanVandaag;
    lesSub.textContent = `Hervatten bij ${sectieTekst}`;
  } else {
    lesBtn.disabled = false;
    lesBtn.onclick = startLesVanVandaag;
    lesSub.textContent = 'Les staat klaar';
  }

  // Oude elementen verbergen (fallback)
  document.getElementById('knop-les').style.display = 'none';
  document.getElementById('cache-melding').style.display = 'none';

  await renderCategorieOverzicht();
}

// ═══ SMART SESSION ═══
async function startSmartSession() {
  const dueItems = await getDueItems();
  const voortgang = await haalVoortgang();
  const lesVoltooid = voortgang && voortgang.voltooid;
  
  if (dueItems.length > 0) {
    smartActive = true;
        srVervolgTekst = 'Doorgaan naar les →';
    srCallback = null;   // of eventueel een callback als je later les wil starten
    toonSRReview(dueItems);
  } else if (!lesVoltooid) {
    await maakLes();
  }
}

// ═══ VAULT PRACTICE ═══
async function startVaultPractice() {
  const dueItems = await getDueItems();
  if (dueItems.length > 0) {
    smartActive = false;
        srVervolgTekst = 'Terug naar home →';
    srCallback = null;   // gewone afronding
    toonSRReview(dueItems);
  }
}

// ═══ LES VAN DE DAG starten met SR aan het eind ═══
async function startLesVanVandaag() {
  const dueItems = await getDueItems();
  pendingSR = dueItems.length > 0 ? dueItems : [];
  await toonArtikelKiezer();
}

// ════════════════════════════════════════
// CATEGORIE OVERZICHT (homescreen)
// ════════════════════════════════════════
async function renderCategorieOverzicht() {
  const cats = await haalCategorieën();
  const el   = document.getElementById('categorie-overzicht');
  if (!el) return;
  if (!cats || cats.length === 0) { el.style.display = 'none'; return; }
  el.innerHTML = cats.map(c =>
    `<span class="cat-chip" style="border-color:rgba(${hexNaarRgb(c.kleur)},0.4);color:${c.kleur}">
      <span class="cat-chip-dot" style="background:${c.kleur}"></span>${c.naam}
    </span>`
  ).join('');
  el.style.display = 'flex';
}

// ════════════════════════════════════════
// CATEGORIE BADGE (reader header)
// ════════════════════════════════════════
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

// ════════════════════════════════════════
// SR REVIEW — rondes totdat alles goed is
// ════════════════════════════════════════
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

    // ─────────────────────────────────────────
    // MULTIPLE CHOICE UI
    // ─────────────────────────────────────────
    if (vraagType === 'multiplechoice') {
      const opties = item.opties || [];
      const correcteIndex = item.correcteIndex;

      // shuffle opties
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
          // disable alle opties
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
    // ─────────────────────────────────────────
    // FLASHCARD UI (open vraag)
    // ─────────────────────────────────────────
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

  // Als we in een smart session zitten, start dan de les
  if (smartActive) {
    smartActive = false;
    const lesVoltooid = (await haalVoortgang())?.voltooid;
    if (!lesVoltooid) {
      await maakLes();
      return;
    }
    // anders terug naar home
    await toonHomescreen();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  // Normale vault practice of einde-les SR: terug naar home
  await toonHomescreen();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ════════════════════════════════════════
// KEY BEHEER
// ════════════════════════════════════════
async function slaKeyOpEnStart() {
  const invoer = document.getElementById('key-invoer-setup').value.trim();
  const fout   = document.getElementById('key-fout-setup');
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
  const fout   = document.getElementById('key-fout-modal');
  if (!invoer.startsWith('AIza') || invoer.length < 20) {
    fout.textContent = 'Vul een geldige Gemini API key in (begint met AIza...)';
    return;
  }
  await slaKeyOp(invoer);
  sluitKeyModal();
  toonToast('✓ API key opgeslagen');
}

// ════════════════════════════════════════
// AL GEMAAKT MODAL
// ════════════════════════════════════════
function toonAlGemaaktModal() {
  document.getElementById('algemaakt-modal').classList.add('zichtbaar');
}

function sluitAlGemaaktModal() {
  document.getElementById('algemaakt-modal').classList.remove('zichtbaar');
}

async function herbeginLes() {
  sluitAlGemaaktModal();
  const cache = await haalGecachedeLes();
  if (cache) await verwijderLesUitSR(cache.titel);
  await verwijderVoortgang();
  await maakLes();
}

// ════════════════════════════════════════
// STATUS / LAADBALK
// ════════════════════════════════════════
let schijnInterval = null;

function setStatus(tekst, voortgang, shimmer = false) {
  document.getElementById('status-wrap').classList.add('zichtbaar');
  document.getElementById('status-tekst').textContent = tekst;
  document.getElementById('laadbalk').style.width = voortgang + '%';
  document.getElementById('laadbalk-shimmer').style.display = shimmer ? 'block' : 'none';
}

function startSchijnVoortgang(van, tot) {
  let huidige = van;
  schijnInterval = setInterval(() => {
    huidige = Math.min(huidige + 0.6, tot);
    document.getElementById('laadbalk').style.width = huidige + '%';
  }, 600);
}

function stopSchijnVoortgang() {
  if (schijnInterval) { clearInterval(schijnInterval); schijnInterval = null; }
  document.getElementById('laadbalk-shimmer').style.display = 'none';
}

function verbergStatus() {
  stopSchijnVoortgang();
  document.getElementById('status-wrap').classList.remove('zichtbaar');
}

function toonFout(bericht) {
  document.getElementById('fout-wrap').innerHTML =
    `<div class="fout-melding">⚠️ ${bericht}</div>`;
  document.getElementById('knop-les').disabled = false;
}

// ════════════════════════════════════════
// WIKIPEDIA — ARTIKEL OPHALEN (English)
// ════════════════════════════════════════
async function haalUitgelichtArtikel() {
  try {
    const res = await fetch('https://en.wikipedia.org/w/api.php?action=parse&page=Main_Page&prop=text&format=json&origin=*');
    if (!res.ok) throw new Error('Main Page niet bereikbaar');
    const data = await res.json();
    const doc  = new DOMParser().parseFromString(data.parse.text['*'], 'text/html');

    let titel = null;
    const uitgelichtDiv = doc.querySelector('#mp-tfa');
    if (uitgelichtDiv) {
      const link = uitgelichtDiv.querySelector('a[href^="/wiki/"]:not([href*=":"])');
      if (link) titel = decodeURIComponent(link.getAttribute('href').replace('/wiki/', '').replace(/_/g, ' '));
    }

    if (!titel) {
      for (const link of doc.querySelectorAll('a[href^="/wiki/"]:not([href*=":"])')) {
        const t = decodeURIComponent(link.getAttribute('href').replace('/wiki/', '').replace(/_/g, ' '));
        if (t && t !== 'Main Page' && link.textContent.length > 3) { titel = t; break; }
      }
    }

    if (titel) return titel;
  } catch (e) {
    console.warn('Main Page-scraping mislukt, val terug op willekeurig artikel:', e);
  }

  const fallbackRes = await fetch(
    'https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*'
  );
  if (!fallbackRes.ok) throw new Error('Kon geen Wikipedia-artikel ophalen');
  const fallbackData = await fallbackRes.json();
  const titel = fallbackData?.query?.random?.[0]?.title;
  if (!titel) throw new Error('Wikipedia gaf geen artikeltitel terug');
  return titel;
}

async function haalVolledigeTekst(titel, taal = 'en') {
  const base = taal === 'nl' ? 'https://nl.wikipedia.org' : 'https://en.wikipedia.org';
  const url = `${base}/w/api.php?action=query&titles=${encodeURIComponent(titel)}&prop=extracts&explaintext=true&format=json&origin=*`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error('Kon het artikel niet ophalen');
  const data = await res.json();
  const page = Object.values(data.query.pages)[0];
  if (!page || page.missing) throw new Error(`Artikel "${titel}" niet gevonden`);
  return { titel: page.title, tekst: page.extract };
}

// ════════════════════════════════════════
// WIKIPEDIA — AFBEELDINGEN OPHALEN (English)
// ════════════════════════════════════════
async function haalAfbeeldingen(titel, taal = 'en') {
  const base = taal === 'nl' ? 'https://nl.wikipedia.org' : 'https://en.wikipedia.org';
  try {
    const res = await fetch(
      `${base}/w/api.php?action=query&titles=${encodeURIComponent(titel)}&prop=images&imlimit=30&format=json&origin=*`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const page = Object.values(data.query.pages)[0];
    if (!page || !page.images) return [];

    const bestandsnamen = page.images
      .map(img => img.title)
      .filter(t => {
        const l = t.toLowerCase();
        return (l.endsWith('.jpg') || l.endsWith('.jpeg') || l.endsWith('.png')) &&
          !l.includes('icon') && !l.includes('logo') && !l.includes('flag') &&
          !l.includes('commons') && !l.includes('wikimedia') && !l.includes('edit-') &&
          !l.includes('button') && !l.includes('arrow') && !l.includes('question') &&
          !l.includes('stub') && !l.includes('portal') && !l.includes('disambig');
      })
      .slice(0, 12);

    if (bestandsnamen.length === 0) return [];

    const titelsParam = bestandsnamen.join('|');
    const infoRes = await fetch(
      `${base}/w/api.php?action=query&titles=${encodeURIComponent(titelsParam)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=720&format=json&origin=*`
    );
    if (!infoRes.ok) return [];
    const infoData = await infoRes.json();

    const resultaat = [];
    for (const p of Object.values(infoData.query.pages)) {
      if (!p.imageinfo?.[0]) continue;
      const info = p.imageinfo[0];

      if ((info.width || 0) < 250 || (info.height || 0) < 180) continue;

      const meta = info.extmetadata || {};
      const beschrijving = (
        meta.ImageDescription?.value?.replace(/<[^>]*>/g, '').trim() ||
        meta.ObjectName?.value ||
        p.title.replace('File:', '').replace(/_/g, ' ').replace(/\.[^.]+$/, '')
      ).slice(0, 400);

      resultaat.push({
        naam: p.title.replace('File:', ''),
        url:  info.thumburl || info.url,
        beschrijving,
        breedte: info.width,
        hoogte:  info.height
      });
    }

    return resultaat;
  } catch (e) {
    console.warn('Afbeeldingen ophalen mislukt:', e);
    return [];
  }
}

// ════════════════════════════════════════
// GEMINI — TWEE CALLS
// ════════════════════════════════════════

async function geminiCall(key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    })
  });

  if (!res.ok) {
    const fout = await res.json().catch(() => ({}));
    const msg  = fout?.error?.message || '';
    if (res.status === 400 && msg.toLowerCase().includes('api key'))
      throw new Error('Ongeldige API key. Klik op ⚙ in de header om hem te wijzigen.');
    if (res.status === 429)
      throw new Error('Gemini dagelijks limiet bereikt. Probeer morgen opnieuw.');
    throw new Error(msg || `Gemini API fout (${res.status})`);
  }

  const data = await res.json();
  const ruwe = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!ruwe) throw new Error('Gemini gaf geen antwoord terug');

  let schoon = ruwe.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const eersteAccolade  = schoon.indexOf('{');
  const laatsteAccolade = schoon.lastIndexOf('}');
  if (eersteAccolade !== -1 && laatsteAccolade !== -1)
    schoon = schoon.slice(eersteAccolade, laatsteAccolade + 1);

  try {
    return JSON.parse(schoon);
  } catch {
    const afgekort = !ruwe.trimEnd().endsWith('}');
    if (afgekort)
      throw new Error('Gemini-antwoord werd afgekapt. Probeer het opnieuw — bij een lang artikel kan dit soms voorkomen.');
    throw new Error('Kon JSON niet verwerken. Eerste 300 tekens: ' + ruwe.slice(0, 300));
  }
}

async function verwerkTekstMetGemini(titel, tekst, taal = 'en') {
  const key = await haalKey();

  const ingekorte = tekst.length > MAX_TEKST
    ? tekst.slice(0, MAX_TEKST) + '\n\n[tekst ingekort vanwege lengte]'
    : tekst;

  const bronTaalTekst = taal === 'nl'
    ? `De brontekst is in het Nederlands.`
    : `De brontekst is in het Engels. Schrijf ALLE output uitsluitend in correct Nederlands. Vertaal en herschrijf; kopieer nooit Engelse zinnen.`;

  const prompt = `Je bent redacteur bij NRC. Jouw enige taak: schrijf een heldere, boeiende les over "${titel}" in goed Nederlands proza.

TAAL: ${bronTaalTekst}

SCHRIJFREGELS — elk van deze regels is verplicht:

1. DOORLOPEND VERHAAL: De les vertelt één verhaal. Elke sectie bouwt voort op de vorige. Stel jezelf na elke sectie de vraag: wat weet de lezer nu dat hij daarvoor nog niet wist? Als het antwoord "niets nieuws" is, herschrijf dan.

2. BEGRIPPEN UITLEGGEN: Elk vaktaalbegrip of moeilijk woord wordt uitgelegd op het moment dat je het introduceert — in dezelfde of de volgende zin. Schrijf niet "de devotie rond de heilige", maar "de devotie — het actief vereren van een heilige via gebeden, processies en pelgrimstochten —". Geen enkel begrip mag onverklaard blijven.

3. VERBODEN WOORDEN: Gebruik nooit: indrukwekkend, meesterlijk, iconisch, verfijnd, bijzonder, opmerkelijk, fascinerend, uniek, spectaculair, enorm belangrijk. Als je wil zeggen dat iets belangrijk is: leg uit waaróm. Als je wil zeggen dat iets mooi is: beschrijf wat je ziet.

4. CONCREET EN CAUSAAL: Schrijf niet "de materialen waren van hoge kwaliteit". Schrijf wát de materialen waren en wat dat betekende voor wie ze gebruikte of zag. Elk oordeel heeft een onderbouwing.

5. ZINSVARIATIE: Wissel korte zinnen (5–10 woorden) bewust af met langere. Een korte zin na een lange geeft nadruk. Gebruik dat.

6. SELECTEER: Je hoeft niet alles uit de brontekst te verwerken. Kies wat het verhaal vooruithelpt. Drie alinea's die goed samenhangen zijn beter dan zes die los van elkaar staan.

STRUCTUUR:
- Minimaal 3, maximaal 6 secties
- Elke sectie heeft een pakkende titel
- Elke sectie heeft een "kernpunt": één heldere zin die samenvat wat de lezer na deze sectie begrijpt — niet wát er staat, maar wát de inzicht is

GEEF JE ANTWOORD UITSLUITEND ALS GELDIGE JSON — geen uitleg, geen markdown, geen backticks.

{
  "secties": [
    {
      "titel": "Pakkende sectietitel",
      "tekst": "Lopende tekst in alinea's, gescheiden door \\n\\n.",
      "kernpunt": "Na deze sectie begrijpt de lezer dat..."
    }
  ]
}

ARTIKELTEKST:
${ingekorte}`;

  async function probeerGeminiAanroep(gebuikteTekst) {
    const ingekorteVersie = gebuikteTekst.length > MAX_TEKST
      ? gebuikteTekst.slice(0, MAX_TEKST) + '\n\n[tekst ingekort vanwege lengte]'
      : gebuikteTekst;
    const splitsPos  = prompt.lastIndexOf('\nARTIKELTEKST:\n');
    const kortPrompt = prompt.slice(0, splitsPos + '\nARTIKELTEKST:\n'.length) + ingekorteVersie;
    return await geminiCall(key, kortPrompt);
  }

  let resultaat;
  try {
    resultaat = await geminiCall(key, prompt);
  } catch (e) {
    if (!e.message.includes('afgekapt')) throw e;
    setStatus('Artikel te lang — tweede poging met kortere tekst...', 55, true);
    resultaat = await probeerGeminiAanroep(tekst.slice(0, Math.floor(tekst.length / 2)));
  }

  if (!resultaat.secties || resultaat.secties.length === 0) {
    throw new Error('Gemini kon het artikel niet in secties opdelen. Probeer het opnieuw.');
  }

  return resultaat;
}

// ════════════════════════════════════════
// GEMINI — FLASHCARD VRAGEN GENEREREN
// ════════════════════════════════════════
async function maakMetadataEnVragenMetGemini(titel, secties, afbeeldingen, cats) {
  const key = await haalKey();

  const feedbackItems = (await haalFeedback()).slice(-10);
  const feedbackTekst = feedbackItems.length > 0
    ? `\nNEGATIEVE VOORBEELDEN — vermijd vragen van dit type:\n${feedbackItems.map(f => `- "${f.vraagTekst}" (reden: ${f.reden})`).join('\n')}\n`
    : '';

  const catsTekst = cats.length > 0
    ? `Bestaande categorieën (gebruik er één als die goed past, exact dezelfde naam en kleur):\n${JSON.stringify(cats.map(c => ({ naam: c.naam, kleur: c.kleur })), null, 2)}`
    : 'Nog geen bestaande categorieën — maak een nieuwe aan.';

  const bestaandeKleuren = cats.map(c => c.kleur).join(', ') || 'geen';

  const afbeeldingenTekst = afbeeldingen.length > 0
    ? `BESCHIKBARE AFBEELDINGEN:\n${afbeeldingen.map(a => `• "${a.naam}": ${a.beschrijving}`).join('\n')}\n\nRegel: max één afbeelding per sectie, alleen bij visuele concepten (architectuur, anatomie, geografie, kunstwerken, diersoorten). Anders null.`
    : 'Geen afbeeldingen beschikbaar. Gebruik altijd null voor het afbeelding-veld.';

  const sectiesVoorPrompt = secties.map((s, i) => ({
    sectie: i + 1,
    titel: s.titel,
    tekst: s.tekst,
    kernpunt: s.kernpunt
  }));

  const prompt = `Je krijgt een les over "${titel}", verdeeld in secties. Elke sectie heeft een kernpunt: wat de lezer na het lezen moet begrijpen.

Jouw taken: bepaal categorie, koppel afbeeldingen, maak tijdlijnen waar nodig, schrijf vragen.

CATEGORIE & KLEUR:
${catsTekst}
Nieuwe categorie regels:
- Korte Nederlandse naam, max 20 tekens
- Kleur leesbaar op donkere achtergrond (#0f0f0f), perceived lightness > 50%
- Duidelijk anders dan: ${bestaandeKleuren}
- Voorbeelden: #7cb9e8, #e07b6a, #82d4b0, #c9a0dc, #f4c56a

${afbeeldingenTekst}

TIJDLIJN: Alleen toevoegen als de sectie expliciete historische datums bevat. Anders weglaten.

VRAGEN — verplichte regels:
1. Elke vraag is gebaseerd op het kernpunt van de sectie, niet op een los feit
2. Vraag naar WAAROM of HOE, nooit alleen naar WAT. "Wat is X?" is alleen geldig als het antwoord een mechanisme of oorzaak-gevolgrelatie uitlegt
3. Het antwoord mag NOOIT dezelfde woorden herhalen als de vraag. Als de vraag "waarom was X belangrijk?" is, geeft het antwoord de concrete reden — niet "omdat X zo bijzonder was"
4. Wissel flashcard (open) en multiplechoice (4 opties, 1 correct) af
5. Foute opties bij multiple choice zijn aannemelijk maar aantoonbaar onjuist op basis van de tekst
6. 2 à 3 vragen per sectie

GEEF JE ANTWOORD UITSLUITEND ALS GELDIGE JSON — geen uitleg, geen markdown.

{
  "categorie": "Naam",
  "categorieKleur": "#hexkleur",
  "secties": [
    {
      "afbeelding": "Exacte_bestandsnaam.jpg of null",
      "tijdlijn": [{"jaar": "1200", "gebeurtenis": "Wat er gebeurde"}],
      "vragen": [
        {
          "type": "multiplechoice",
          "vraag": "Waarom/Hoe-vraag gebaseerd op het kernpunt",
          "opties": ["A", "B", "C", "D"],
          "correcteIndex": 0
        },
        {
          "type": "flashcard",
          "vraag": "Waarom/Hoe-vraag gebaseerd op het kernpunt",
          "antwoord": "Concreet antwoord dat de redenering uitlegt"
        }
      ]
    }
  ]
}

${feedbackTekst}LES:
${JSON.stringify(sectiesVoorPrompt, null, 2)}`;

  return await geminiCall(key, prompt);
}

async function verwerkMetGemini(titel, tekst, taal = 'en') {
  // Call 1 en afbeeldingen parallel starten
  const [schrijfResultaat, afbeeldingen] = await Promise.all([
    verwerkTekstMetGemini(titel, tekst, taal),
    haalAfbeeldingen(titel, taal).catch(e => {
      console.warn('Afbeeldingen ophalen mislukt, ga door zonder:', e);
      return [];
    })
  ]);

  const cats = await haalCategorieën();

  await new Promise(r => setTimeout(r, 500));

  // Call 2: metadata + vragen
  const metadataResultaat = await maakMetadataEnVragenMetGemini(
    titel, schrijfResultaat.secties, afbeeldingen, cats
  );

  if (!metadataResultaat.secties || metadataResultaat.secties.length === 0) {
    throw new Error('Gemini kon geen vragen genereren. Probeer het opnieuw.');
  }

  if (metadataResultaat.categorie && metadataResultaat.categorieKleur) {
    await registreerCategorie(metadataResultaat.categorie, metadataResultaat.categorieKleur);
  }

  // Afbeelding-URL matching
  const metaSecties = metadataResultaat.secties;
  if (afbeeldingen.length > 0) {
    for (const sectie of metaSecties) {
      if (sectie.afbeelding && sectie.afbeelding !== 'null') {
        const naamGemini = sectie.afbeelding.toLowerCase().replace(/\.[^.]+$/, '');
        const match = afbeeldingen.find(a => {
          const aNaam = a.naam.toLowerCase().replace(/\.[^.]+$/, '');
          return aNaam === naamGemini || aNaam.includes(naamGemini) || naamGemini.includes(aNaam);
        });
        sectie.afbeeldingUrl = match ? match.url : null;
        if (!match) sectie.afbeelding = null;
      } else {
        sectie.afbeelding = null;
        sectie.afbeeldingUrl = null;
      }
    }
  }

  // Samenvoegen
  const secties = schrijfResultaat.secties.map((sectie, i) => ({
    ...sectie,
    afbeelding:    metaSecties[i]?.afbeelding    || null,
    afbeeldingUrl: metaSecties[i]?.afbeeldingUrl || null,
    tijdlijn:      metaSecties[i]?.tijdlijn      || [],
    vragen:        metaSecties[i]?.vragen        || []
  }));

  return {
    categorie:      metadataResultaat.categorie,
    categorieKleur: metadataResultaat.categorieKleur,
    secties
  };
}

// ════════════════════════════════════════
// HOOFDFUNCTIE — LES MAKEN
// ════════════════════════════════════════
let lesData      = null;
let artikelTitel = '';

async function maakLes(gekozenArtikel = null) {
  document.getElementById('fout-wrap').innerHTML = '';
  document.getElementById('homescreen').classList.add('zichtbaar');
  document.getElementById('key-scherm').classList.remove('zichtbaar');

  // Als er geen gekozen artikel is, gebruik cache van vandaag
  if (!gekozenArtikel) {
    const cache = await haalGecachedeLes();
    if (cache) {
      lesData      = { secties: cache.secties };
      artikelTitel = cache.titel;

      huidigeCategorieKleur = cache.categorieKleur || '#c8a96e';
      huidigeCategorieNaam  = cache.categorie || '';
      pasCategorieKleurToe(huidigeCategorieKleur);

      await startLes();
      return;
    }
  }

  try {
    const taal = gekozenArtikel ? (gekozenArtikel.taal || 'en') : 'en';
    let naamVoorOphalen;

    if (gekozenArtikel) {
      naamVoorOphalen = gekozenArtikel.titel;
      setStatus(`"${naamVoorOphalen}" ophalen...`, 10);
    } else {
      setStatus('Wikipedia hoofdpagina ophalen...', 10);
      naamVoorOphalen = await haalUitgelichtArtikel();
    }

    setStatus(`"${naamVoorOphalen}" ophalen...`, 22);
    const { titel, tekst } = await haalVolledigeTekst(naamVoorOphalen, taal);
    artikelTitel = titel;

    setStatus('Artikel en afbeeldingen verwerken...', 35, true);
    startSchijnVoortgang(35, 62);
    lesData = await verwerkMetGemini(titel, tekst, taal);

    stopSchijnVoortgang();

    huidigeCategorieKleur = lesData.categorieKleur || '#c8a96e';
    huidigeCategorieNaam  = lesData.categorie || '';
    pasCategorieKleurToe(huidigeCategorieKleur);

    setStatus('Les klaar!', 100);

    await slaLesOp({
      titel:          artikelTitel,
      secties:        lesData.secties,
      categorie:      lesData.categorie,
      categorieKleur: lesData.categorieKleur
    });

    setTimeout(async () => {
      verbergStatus();
      await startLes();
    }, 400);

  } catch (err) {
    stopSchijnVoortgang();
    verbergStatus();
    toonFout(err.message);
  }
}

// ════════════════════════════════════════
// LES FLOW — GLOBALE STAAT
// ════════════════════════════════════════
let huidigeSectie    = 0;
let huidigeVraag     = 0;
let inVraagModus     = false;
let sessieAntwoorden = [];
let vraagResultaten  = {};

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
      const id  = maakVraagId(artikelTitel, si, vi);
      const el  = document.createElement('div');
      el.className = 'shield-item';
      el.title = `Sectie ${si + 1}, vraag ${vi + 1}`;

      const res = vraagResultaten[id];
      if (res === 'goed') {
        el.classList.add('goed');
      } else if (res === 'fout') {
        el.classList.add('fout');
      } else if (inVraagModus && si === huidigeSectie && vi === huidigeVraag) {
        el.classList.add('huidig');
      }

      balk.appendChild(el);
    });
  });
}

function updateVoortgangsbalk() {
  const pct = Math.round((huidigeSectie / lesData.secties.length) * 100);
  document.getElementById('les-voortgang-balk').style.width = pct + '%';
}

function vulSectieInhoud(si) {
  const sectie  = lesData.secties[si];
  const tekstEl = document.getElementById('sectie-tekst');
  tekstEl.innerHTML = '';

  if (sectie.afbeelding && sectie.afbeeldingUrl) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'sectie-afbeelding';
    const caption = sectie.afbeelding
      .replace(/\.[^.]+$/, '')
      .replace(/_/g, ' ');
    imgWrap.innerHTML = `
      <img
        src="${sectie.afbeeldingUrl}"
        alt="${caption}"
        loading="lazy"
        onerror="this.closest('.sectie-afbeelding').style.display='none'"
      />
      <div class="sectie-afbeelding-caption">${caption}</div>
    `;
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
  tijdlijnInhoud.innerHTML = sectie.tijdlijn && sectie.tijdlijn.length > 0
    ? sectie.tijdlijn.map(t =>
        `<div class="tijdlijn-rij">
          <span class="tijdlijn-jaar">${t.jaar}</span>
          <span>${t.gebeurtenis}</span>
        </div>`).join('')
    : '';
}

async function startLes() {
  document.getElementById('homescreen').classList.remove('zichtbaar');
  pasCategorieKleurToe(huidigeCategorieKleur);

  const voortgangBalk = document.getElementById('les-voortgang');
  voortgangBalk.classList.remove('vervaag');
  voortgangBalk.classList.add('zichtbaar');
  document.getElementById('les-scherm').classList.add('zichtbaar');
  document.getElementById('shields-balk').style.display = 'flex';

  sessieAntwoorden = [];
  inVraagModus     = false;

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
  huidigeVraag  = 0;
  inVraagModus  = false;

  updateVoortgangsbalk();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  slaVoortgangOp({
    sectieIndex: index,
    inVragen:    false,
    voltooid:    false,
    titel:       artikelTitel,
    vraagResultaten: vraagResultaten
  });

  const sectie = lesData.secties[index];
  const totaal = lesData.secties.length;

  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Pagina ${index + 1} van ${totaal}`;

  const dot = document.getElementById('sectie-label-dot');
  if (huidigeCategorieKleur) {
    dot.style.background = huidigeCategorieKleur;
    dot.style.display    = 'inline-block';
  } else {
    dot.style.display = 'none';
  }

  updateReaderCatBadge();
  vulSectieInhoud(index);

  setLeesKaart(true);
  document.getElementById('sectie-tekst').style.display = 'block';

  const tijdlijnWrap = document.getElementById('tijdlijn-wrap');
  tijdlijnWrap.style.display = (sectie.tijdlijn && sectie.tijdlijn.length > 0) ? 'block' : 'none';

  document.getElementById('knop-gelezen-wrap').style.display      = 'block';
    const knopGelezen = document.querySelector('#knop-gelezen-wrap .knop-gelezen');
  const heeftVragen = sectie.vragen && sectie.vragen.length > 0;
  knopGelezen.textContent = heeftVragen ? 'Ik heb dit gelezen →' : 'Volgende sectie →';
  knopGelezen.onclick = heeftVragen ? () => toonVraag(0) : volgendeSectie;
  document.getElementById('vragen-sectie').style.display           = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display   = 'none';
  document.getElementById('knop-volgende').disabled                = true;

  renderShields();
}

function toonVraag(vi) {
  huidigeVraag = vi;
  inVraagModus = true;

  updateVoortgangsbalk();

  const sectie      = lesData.secties[huidigeSectie];
  const vraag       = sectie.vragen[vi];
  const vraagId     = maakVraagId(artikelTitel, huidigeSectie, vi);
  const aantalInSec = sectie.vragen.length;
  const isLaatste   = vi === aantalInSec - 1;
  const isLaatsteSec = huidigeSectie === lesData.secties.length - 1;

  slaVoortgangOp({
    sectieIndex: huidigeSectie,
    vraagIndex:  vi,
    inVragen:    true,
    voltooid:    false,
    titel:       artikelTitel,
    vraagResultaten: vraagResultaten
  });

  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Vraag ${vi + 1} van ${aantalInSec}`;

  updateReaderCatBadge();

  setLeesKaart(false);
  document.getElementById('terug-naar-vraag-balk').style.display  = 'none';
  document.getElementById('vragen-sectie').style.display          = 'block';

  // 'Weet niet' knop zichtbaar
  const weetNietBtn = document.getElementById('knop-weetniets');
  if (weetNietBtn) weetNietBtn.style.display = 'inline-flex';
  const kijkOpBtn = document.getElementById('knop-kijkop');
  if (kijkOpBtn) kijkOpBtn.style.display = 'inline-flex';

  const knopVolgende = document.getElementById('knop-volgende');
  knopVolgende.disabled = true;
  if (isLaatste && isLaatsteSec) {
    knopVolgende.textContent = 'Afronden →';
  } else if (isLaatste) {
    knopVolgende.textContent = `Volgende sectie →`;
  } else {
    knopVolgende.textContent = 'Volgende →';
  }
  knopVolgende.onclick = () => {
    if (isLaatste) {
      volgendeSectie();
    } else {
      toonVraag(vi + 1);
    }
  };

  const inhoud = document.getElementById('vragen-inhoud');
  inhoud.innerHTML = '';

  // --- Bepaal type vraag ---
  const vraagType = vraag.type || 'flashcard';

  if (vraagType === 'multiplechoice') {
    // --- Meerkeuze UI ---
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
    optiesDiv.style.cssText = 'display:flex;flex-direction:column;gap:0.65rem;margin-top:1rem';
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
    // --- FLASHCARD UI (open vraag) ---
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

  // Bepaal antwoordData op basis van type
  let antwoordData = {};
  if (vraag.type === 'multiplechoice') {
    antwoordData = {
      vraag: vraag.vraag,
      opties: vraag.opties,
      correcteIndex: vraag.correcteIndex,
      gekozenIndex: -1
    };
  } else {
    antwoordData = { antwoord: vraag.antwoord || '' };
  }

  vraagResultaten[vraagId] = 'fout';
  sessieAntwoorden.push({ sectieIndex: huidigeSectie, vraagIndex: huidigeVraag, id: vraagId, goed: false });
  registreerAntwoord({
    id: vraagId,
    vraag: vraag.vraag,
    type: vraag.type || 'flashcard',
    antwoordData,
    goed: false
  });

  // UI feedback: toon het juiste antwoord
  const inhoud = document.getElementById('vragen-inhoud');
  const blok = inhoud.querySelector('.vraag-blok');
  if (blok) {
    if (vraag.type === 'multiplechoice') {
      const optieKnoppen = blok.querySelectorAll('.optie-knop');
      optieKnoppen.forEach(btn => btn.disabled = true);
      const correcteOptie = Array.from(optieKnoppen).find((btn, idx) => {
        const optieTekst = btn.textContent;
        return optieTekst === vraag.opties[vraag.correcteIndex];
      });
      if (correcteOptie) correcteOptie.classList.add('gemist');
      const feedback = document.createElement('div');
      feedback.className = 'feedback fout';
      feedback.textContent = `Weet niet – juiste antwoord: ${vraag.opties[vraag.correcteIndex]}`;
      blok.appendChild(feedback);
    } else {
      // Flashcard: toon antwoord als dat nog niet gebeurd is
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

  slaVoortgangOp({
    sectieIndex: huidigeSectie,
    vraagIndex: huidigeVraag,
    inVragen: true,
    voltooid: false,
    titel: artikelTitel,
    vraagResultaten
  });
  renderShields();
}

function toonTekstLookup() {
  inVraagModus = false;

  const sectie = lesData.secties[huidigeSectie];

  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = 'Kijk op in de tekst';

  updateReaderCatBadge();

  setLeesKaart(true);
  document.getElementById('sectie-tekst').style.display = 'block';

  const tijdlijnWrap = document.getElementById('tijdlijn-wrap');
  tijdlijnWrap.style.display = (sectie.tijdlijn && sectie.tijdlijn.length > 0) ? 'block' : 'none';

  document.getElementById('vragen-sectie').style.display         = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display = 'block';

  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function terugNaarVraag() {
  inVraagModus = true;

  const sectie = lesData.secties[huidigeSectie];
  const aantalInSec = sectie.vragen.length;

  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = sectie.titel;
  document.getElementById('sectie-nummer-tekst').textContent = `Vraag ${huidigeVraag + 1} van ${aantalInSec}`;

  updateReaderCatBadge();

  setLeesKaart(false);
  document.getElementById('terug-naar-vraag-balk').style.display  = 'none';
  document.getElementById('vragen-sectie').style.display          = 'block';

  renderShields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Volgende sectie ──
function volgendeSectie() {
  huidigeSectie++;
  inVraagModus = false;
  if (huidigeSectie >= lesData.secties.length) {
    startHerhaling();
  } else {
    toonSectie(huidigeSectie);
  }
}

// ════════════════════════════════════════
// HERHALING (FLASHCARD) — FIX: antwoord voor MC-vragen
// ════════════════════════════════════════
let herhalingsWachtrij = [];

function startHerhaling() {
  herhalingsWachtrij = sessieAntwoorden
    .filter(a => !a.goed)
    .map(a => ({
      id:        a.id,
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

  document.getElementById('sectie-label-tekst').textContent  = artikelTitel;
  document.getElementById('sectie-titel').textContent        = 'Nog niet helemaal...';
  document.getElementById('sectie-nummer-tekst').textContent =
    `${herhalingsWachtrij.length} vraag${herhalingsWachtrij.length !== 1 ? 'en' : ''} opnieuw`;

  updateReaderCatBadge();

  setLeesKaart(true);
  const tekstEl = document.getElementById('sectie-tekst');
  tekstEl.innerHTML = '';
  const uitleg = document.createElement('p');
  uitleg.style.color = 'rgba(232,227,219,0.65)';
  uitleg.textContent = 'De vragen die je net fout had komen hieronder terug. Ga door totdat alles goed is.';
  tekstEl.appendChild(uitleg);
  tekstEl.style.display = 'block';

  document.getElementById('tijdlijn-wrap').style.display          = 'none';
  document.getElementById('knop-gelezen-wrap').style.display       = 'none';
  document.getElementById('terug-naar-vraag-balk').style.display   = 'none';
  document.getElementById('vragen-sectie').style.display           = 'block';
  document.getElementById('knop-weetniets').style.display          = 'none';
  document.getElementById('knop-kijkop').style.display             = 'none';

  const knopVolgende       = document.getElementById('knop-volgende');
  knopVolgende.disabled    = true;
  knopVolgende.textContent = 'Volgende →';
  knopVolgende.onclick     = null;

  const inhoud = document.getElementById('vragen-inhoud');
  inhoud.innerHTML = '';

  const rondeResultaten = herhalingsWachtrij.map(() => ({ beantwoord: false, goed: false }));

  function checkAllesHerhaling() {
    if (!rondeResultaten.every(r => r.beantwoord)) return;

    const nogFout = herhalingsWachtrij.filter((_, i) => !rondeResultaten[i].goed);

    if (nogFout.length === 0) {
      knopVolgende.disabled    = false;
      knopVolgende.textContent = 'Alles goed! →';
      knopVolgende.onclick     = toonKlaarScherm;
    } else {
      knopVolgende.disabled    = false;
      knopVolgende.textContent = `Nog ${nogFout.length} fout — nog een ronde →`;
      knopVolgende.onclick     = () => {
        herhalingsWachtrij = nogFout;
        toonHerhalingsRonde();
      };
    }
  }

  herhalingsWachtrij.forEach((item, hi) => {
    const vraag   = item.vraagData;
    const blok = document.createElement('div');
    blok.className = 'vraag-blok';

    // ══════════════════════════
    // MEERKEUZE VRAGEN
    // ══════════════════════════
    if (vraag.type === 'multiplechoice') {
      const opties = vraag.opties || [];
      const correcteIndex = vraag.correcteIndex;

      // shuffle opties zodat de volgorde niet hetzelfde is als in de les
      let optiesMetIndex = opties.map((opt, idx) => ({ opt, idx }));
      for (let i = optiesMetIndex.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [optiesMetIndex[i], optiesMetIndex[j]] = [optiesMetIndex[j], optiesMetIndex[i]];
      }

      blok.innerHTML = `
        <div class="vraag-tekst">${hi + 1}. ${vraag.vraag}</div>
        <div class="opties-grid" id="h-mc-opties-${hi}"></div>
      `;

      const optiesContainer = blok.querySelector(`#h-mc-opties-${hi}`);
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

          // visuele feedback
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

          rondeResultaten[hi] = { beantwoord: true, goed };

          registreerAntwoord({
            id: item.id,
            vraag: vraag.vraag,
            type: 'multiplechoice',
            antwoordData: {
              vraag: vraag.vraag,
              opties: opties,
              correcteIndex: correcteIndex,
              gekozenIndex: gekozenIndex
            },
            goed
          });

          checkAllesHerhaling();
        });
        optiesContainer.appendChild(knop);
      });

      inhoud.appendChild(blok);
    }
    // ══════════════════════════
    // FLASHCARD VRAGEN (en fallback)
    // ══════════════════════════
    else {
      let antwoord;
      // Fallback voor oude vragen die nog een 'goed'-veld hadden
      antwoord = vraag.antwoord || vraag.goed || '';

      blok.innerHTML = `
        <div class="vraag-tekst">${hi + 1}. ${vraag.vraag}</div>
        <div class="flashcard-onthul-wrap" id="h-onthul-${hi}">
          <button class="knop-onthul">Tik om het antwoord te zien ↓</button>
        </div>
        <div class="flashcard-antwoord-wrap" id="h-antwoord-${hi}" style="display:none">
          <div class="flashcard-antwoord">${antwoord}</div>
          <div class="flashcard-goed-fout">
            <button class="knop-flashcard-fout" id="h-fout-${hi}">✗ Fout</button>
            <button class="knop-flashcard-goed" id="h-goed-${hi}">✓ Goed</button>
          </div>
        </div>
      `;

      blok.querySelector('.knop-onthul').addEventListener('click', () => {
        document.getElementById(`h-onthul-${hi}`).style.display = 'none';
        document.getElementById(`h-antwoord-${hi}`).style.display = 'block';
      });

      blok.querySelector(`#h-goed-${hi}`).addEventListener('click', () => {
        if (rondeResultaten[hi].beantwoord) return;
        blok.querySelector(`#h-goed-${hi}`).classList.add('actief-goed');
        blok.querySelector(`#h-fout-${hi}`).disabled = true;
        rondeResultaten[hi] = { beantwoord: true, goed: true };

        registreerAntwoord({
          id: item.id,
          vraag: vraag.vraag,
          type: 'flashcard',
          antwoordData: { antwoord: antwoord },
          goed: true
        });

        checkAllesHerhaling();
      });

      blok.querySelector(`#h-fout-${hi}`).addEventListener('click', () => {
        if (rondeResultaten[hi].beantwoord) return;
        blok.querySelector(`#h-fout-${hi}`).classList.add('actief-fout');
        blok.querySelector(`#h-goed-${hi}`).disabled = true;
        rondeResultaten[hi] = { beantwoord: true, goed: false };

        registreerAntwoord({
          id: item.id,
          vraag: vraag.vraag,
          type: 'flashcard',
          antwoordData: { antwoord: antwoord },
          goed: false
        });

        checkAllesHerhaling();
      });

      inhoud.appendChild(blok);
    }
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

  const balk = document.getElementById('les-voortgang-balk');
  balk.style.width = '100%';
  setTimeout(() => {
    document.getElementById('les-voortgang').classList.add('vervaag');
  }, 600);

  const totaal = sessieAntwoorden.length;
  const goed   = sessieAntwoorden.filter(a => a.goed).length;
  const pct    = totaal > 0 ? Math.round((goed / totaal) * 100) : 0;

  const catBadge = huidigeCategorieNaam
    ? `<br/><span style="font-size:0.82rem;color:var(--muted)">● ${huidigeCategorieNaam}</span>`
    : '';

  document.getElementById('klaar-stats').innerHTML =
    `Je beantwoordde <strong>${goed} van de ${totaal} vragen</strong> goed (${pct}%).${catBadge}<br/>
    De vragen komen de komende dagen terug via spaced repetition.`;

  document.getElementById('klaar-scherm').classList.add('zichtbaar');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  slaVoortgangOp({ sectieIndex: lesData.secties.length - 1, voltooid: true, titel: artikelTitel });
  markSessionDone();
}

// ════════════════════════════════════════
// ARTIKEL KIEZER
// ════════════════════════════════════════

const AK_BRONNEN = [
  { label: '🇳🇱 Nederlands uitgelicht',    emoji: '🇳🇱', taal: 'nl', haalTitel: () => haalNlUitgelicht() },
  { label: '🌟 Engels uitgelicht',         emoji: '🌟', taal: 'en', haalTitel: () => haalUitgelichtArtikel() },
  { label: '🔬 Biologie',                  emoji: '🔬', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Biologie', 'Biologie') },
  { label: '🏛️ Geschiedenis',              emoji: '🏛️', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Geschiedenis', 'Geschiedenis') },
  { label: '🎨 Kunst & cultuur',           emoji: '🎨', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Kunst en cultuur', 'Kunst') },
  { label: '🌍 Landen & volken',           emoji: '🌍', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Landen en volken', 'geografie') },
  { label: '👥 Mens & maatschappij',       emoji: '👥', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Samenleving', 'maatschappij') },
  { label: '🗳️ Politiek',                  emoji: '🗳️', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Politiek', 'politiek') },
  { label: '🕌 Religie',                   emoji: '🕌', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Religie', 'religie') },
  { label: '⚽ Sport',                     emoji: '⚽', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Sport', 'sport') },
  { label: '💬 Taal',                      emoji: '💬', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Taalkunde', 'taal') },
  { label: '🔭 Wetenschap & technologie',  emoji: '🔭', taal: 'nl', haalTitel: () => haalNlCategorieArtikel('Wetenschap', 'wetenschap technologie') },
  { label: '🎲 Willekeurig',               emoji: '🎲', taal: 'nl', haalTitel: () => haalNlWillekeurig() },
];

let akHuidigeIndex = 0;
let akArtikelenData = [];   // opgehaalde previews per kaart
let akGekozenArtikel = null;

// Toont de modal en laadt alle kaarten
async function toonArtikelKiezer() {
  akHuidigeIndex  = 0;
  akArtikelenData = AK_BRONNEN.map(() => ({ status: 'laden' }));
  akGekozenArtikel = null;

  document.getElementById('artikel-kiezer-modal').classList.add('zichtbaar');
  akRenderAlles();

  // Laad alle artikelpreviews parallel
  AK_BRONNEN.forEach((bron, i) => {
    haalArtikelPreview(bron).then(data => {
      akArtikelenData[i] = { status: 'gereed', ...data, taal: bron.taal, label: bron.label };
      akRenderKaart(i);
    }).catch(() => {
      akArtikelenData[i] = { status: 'fout', label: bron.label, emoji: bron.emoji };
      akRenderKaart(i);
    });
  });
}

function sluitArtikelKiezer() {
  document.getElementById('artikel-kiezer-modal').classList.remove('zichtbaar');
}

// Haalt titel + intro + thumbnail op voor een bron
async function haalArtikelPreview(bron) {
  const titel = await bron.haalTitel();
  const taal  = bron.taal || 'en';
  const base  = taal === 'nl' ? 'https://nl.wikipedia.org' : 'https://en.wikipedia.org';

  // Intro tekst
  const textRes = await fetch(
    `${base}/w/api.php?action=query&titles=${encodeURIComponent(titel)}&prop=extracts&exintro=true&explaintext=true&exsentences=3&format=json&origin=*`
  );
  const textData = await textRes.json();
  const page = Object.values(textData.query.pages)[0];
  const intro = (page?.extract || '').slice(0, 220);

  // Thumbnail
  const imgRes = await fetch(
    `${base}/w/api.php?action=query&titles=${encodeURIComponent(titel)}&prop=pageimages&pithumbsize=480&format=json&origin=*`
  );
  const imgData = await imgRes.json();
  const imgPage = Object.values(imgData.query.pages)[0];
  const thumbnail = imgPage?.thumbnail?.source || null;

  return { titel, intro, thumbnail, emoji: bron.emoji, label: bron.label };
}

// Haalt het uitgelichte artikel van de Nederlandse Wikipedia hoofdpagina
async function haalNlUitgelicht() {
  const res = await fetch(
    'https://nl.wikipedia.org/w/api.php?action=parse&page=Hoofdpagina&prop=text&format=json&origin=*'
  );
  if (!res.ok) throw new Error('Hoofdpagina niet bereikbaar');
  const data = await res.json();
  const doc = new DOMParser().parseFromString(data.parse.text['*'], 'text/html');

  // Probeer de uitgelicht-sectie te vinden
  const sectiePogingen = ['#mf-uitgelicht', '.mp-uitgelicht', '#mp-itn', '.uitgelicht'];
  let link = null;
  for (const sel of sectiePogingen) {
    const el = doc.querySelector(sel);
    if (el) {
      link = el.querySelector('a[href^="/wiki/"]:not([href*=":"])');
      if (link) break;
    }
  }
  // Fallback: eerste prominente link op de pagina
  if (!link) {
    for (const l of doc.querySelectorAll('b a[href^="/wiki/"]:not([href*=":"])')) {
      const t = l.getAttribute('href').replace('/wiki/', '');
      if (t && t !== 'Hoofdpagina' && l.textContent.length > 4) { link = l; break; }
    }
  }
  if (!link) throw new Error('Geen uitgelicht artikel gevonden op NL Wikipedia');
  return decodeURIComponent(link.getAttribute('href').replace('/wiki/', '').replace(/_/g, ' '));
}

// Haalt een willekeurig artikel uit een Nederlandse Wikipedia categorie
// Haalt een willekeurig artikel uit een Nederlandse Wikipedia categorie
// categorieNaam = exacte Wikipedia categorienaam, zoekterm = fallback zoekwoord
// Haalt een willekeurig artikel via subcategorieën of zoekAPI
async function haalNlCategorieArtikel(categorieNaam, zoekterm) {
  // Stap 1: directe artikelen in de categorie
  try {
    const res = await fetch(
      `https://nl.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Categorie:${encodeURIComponent(categorieNaam)}&cmlimit=500&cmnamespace=0&cmtype=page&format=json&origin=*`
    );
    if (res.ok) {
      const data = await res.json();
      const leden = data?.query?.categorymembers || [];
      if (leden.length > 0) {
        return leden[Math.floor(Math.random() * leden.length)].title;
      }
    }
  } catch (e) { console.warn('Stap 1 mislukt:', e); }

  // Stap 2: willekeurige subcategorie induiken
  try {
    const subRes = await fetch(
      `https://nl.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Categorie:${encodeURIComponent(categorieNaam)}&cmlimit=30&cmtype=subcat&format=json&origin=*`
    );
    if (subRes.ok) {
      const subData = await subRes.json();
      const subcats = subData?.query?.categorymembers || [];
      if (subcats.length > 0) {
        const subcat = subcats[Math.floor(Math.random() * subcats.length)];
        const subNaam = subcat.title.replace('Categorie:', '');
        const artRes = await fetch(
          `https://nl.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Categorie:${encodeURIComponent(subNaam)}&cmlimit=100&cmnamespace=0&cmtype=page&format=json&origin=*`
        );
        if (artRes.ok) {
          const artData = await artRes.json();
          const artikelen = artData?.query?.categorymembers || [];
          if (artikelen.length > 0) {
            return artikelen[Math.floor(Math.random() * artikelen.length)].title;
          }
        }
      }
    }
  } catch (e) { console.warn('Stap 2 mislukt:', e); }

  // Stap 3: zoek-API met willekeurige offset
  try {
    const zoek = zoekterm || categorieNaam;
    const offset = Math.floor(Math.random() * 80);
    const res = await fetch(
      `https://nl.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(zoek)}&srnamespace=0&srlimit=10&sroffset=${offset}&format=json&origin=*`
    );
    if (res.ok) {
      const data = await res.json();
      const resultaten = data?.query?.search || [];
      if (resultaten.length > 0) {
        return resultaten[Math.floor(Math.random() * resultaten.length)].title;
      }
    }
  } catch (e) { console.warn('Stap 3 mislukt:', e); }

  // Laatste redmiddel
  return await haalNlWillekeurig();
}

// Willekeurig Nederlands Wikipedia artikel
async function haalNlWillekeurig() {
  const res = await fetch(
    'https://nl.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*'
  );
  if (!res.ok) throw new Error('Willekeurig artikel niet bereikbaar');
  const data = await res.json();
  const titel = data?.query?.random?.[0]?.title;
  if (!titel) throw new Error('Geen willekeurig artikel ontvangen');
  return titel;
}

// ── Carousel rendering ──

function akRenderAlles() {
  const carousel = document.getElementById('ak-carousel');
  const dotsWrap  = document.getElementById('ak-dots');

  carousel.innerHTML = '';
  dotsWrap.innerHTML = '';

  AK_BRONNEN.forEach((bron, i) => {
    const kaart = document.createElement('div');
    kaart.className = 'ak-kaart' + (i === 0 ? ' actief' : '');
    kaart.id = `ak-kaart-${i}`;
    kaart.innerHTML = `
      <div class="ak-kaart-laden">
        <div class="ak-laden-spinner"></div>
        <span>${bron.label}</span>
      </div>`;
    carousel.appendChild(kaart);

    const dot = document.createElement('button');
    dot.className = 'ak-dot' + (i === 0 ? ' actief' : '');
    dot.setAttribute('aria-label', `Ga naar kaart ${i + 1}`);
    dot.onclick = () => akGaNaar(i);
    dotsWrap.appendChild(dot);
  });

  akUpdatePositie();
}

function akRenderKaart(i) {
  const el   = document.getElementById(`ak-kaart-${i}`);
  if (!el) return;
  const data = akArtikelenData[i];
  const wasActief = el.classList.contains('actief');

  if (data.status === 'fout') {
    el.innerHTML = `
      <div class="ak-kaart-afbeelding-placeholder">${data.emoji || '❓'}</div>
      <div class="ak-kaart-body">
        <div class="ak-kaart-bron">${data.label}</div>
        <div class="ak-kaart-fout">Kon dit artikel niet laden. Probeer een andere optie.</div>
      </div>`;
  } else {
    const afbeeldingHtml = data.thumbnail
      ? `<img class="ak-kaart-afbeelding" src="${data.thumbnail}" alt="${data.titel}" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="ak-kaart-afbeelding-placeholder">${data.emoji || '📖'}</div>`;

    el.innerHTML = `
      ${afbeeldingHtml}
      <div class="ak-kaart-body">
        <div class="ak-kaart-bron">${data.label}</div>
        <div class="ak-kaart-titel">${data.titel}</div>
        <div class="ak-kaart-intro">${data.intro || 'Geen samenvatting beschikbaar.'}</div>
      </div>`;
  }

  // Herstel zichtbaarheid
  if (wasActief) el.classList.add('actief');
}

function akUpdatePositie() {
  // Toon alleen de actieve kaart
  document.querySelectorAll('.ak-kaart').forEach((kaart, i) => {
    kaart.classList.toggle('actief', i === akHuidigeIndex);
  });

  // Dots bijwerken
  document.querySelectorAll('.ak-dot').forEach((dot, i) => {
    dot.classList.toggle('actief', i === akHuidigeIndex);
  });

  // Pijlen in-/uitschakelen
  const links  = document.getElementById('ak-pijl-links');
  const rechts = document.getElementById('ak-pijl-rechts');
  if (links)  links.disabled  = akHuidigeIndex === 0;
  if (rechts) rechts.disabled = akHuidigeIndex === AK_BRONNEN.length - 1;
}

function akVorige() {
  if (akHuidigeIndex > 0) { akHuidigeIndex--; akUpdatePositie(); }
}

function akVolgende() {
  if (akHuidigeIndex < AK_BRONNEN.length - 1) { akHuidigeIndex++; akUpdatePositie(); }
}

function akGaNaar(i) {
  akHuidigeIndex = i;
  akUpdatePositie();
}

// Start de les met het gekozen artikel
async function akStartLes() {
  const data = akArtikelenData[akHuidigeIndex];
  if (!data || data.status === 'laden') {
    toonToast('Even geduld, artikel wordt geladen...');
    return;
  }
  if (data.status === 'fout') {
    toonToast('Dit artikel kon niet geladen worden. Kies een andere optie.');
    return;
  }

  sluitArtikelKiezer();

  // Wis cache van vandaag zodat het nieuwe artikel gegenereerd wordt
  await dbDelete(vandaagSleutel());
  await verwijderVoortgang();

  // Start les met het gekozen artikel
  await maakLes({ titel: data.titel, taal: data.taal || 'en' });
}

// ════════════════════════════════════════
// START — async bootstrap
// ════════════════════════════════════════
(async () => {
  try {
    db = await openDB();
    await migreerVanLocalStorage();
  } catch (e) {
    console.warn('IndexedDB niet beschikbaar, gebruik in-memory opslag:', e);
    db = null;
  }
  herstelLayout();
  await init();
})();
