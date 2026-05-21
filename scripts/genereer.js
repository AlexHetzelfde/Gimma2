// scripts/genereer.js – Leerpaden generator (Wikipedia-loze versie)

const MAX_TEKST  = 40000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GH_TOKEN   = process.env.GH_TOKEN;
const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPOSITORY || 'AlexHetzelfde/Gimma2').split('/');

// ════════════════════════════════════════
// HULPFUNCTIES (ongewijzigd)
// ════════════════════════════════════════

async function metRetry(fn, maxPogingen = 3, wachtMs = 30000) {
  for (let i = 0; i < maxPogingen; i++) {
    try {
      return await fn();
    } catch (e) {
      console.warn(`Poging ${i + 1} mislukt: ${e.message}`);
      if (i < maxPogingen - 1) {
        await new Promise(r => setTimeout(r, wachtMs));
      }
    }
  }
  throw new Error(`Alle ${maxPogingen} pogingen mislukt`);
}
async function geminiCall(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7 } })
  });
  if (!res.ok) {
    const fout = await res.json().catch(() => ({}));
    throw new Error(`Gemini fout ${res.status}: ${fout?.error?.message || ''}`);
  }
  const data = await res.json();
  const ruwe = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!ruwe) throw new Error('Geen antwoord van Gemini');
  let schoon = ruwe.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const eerste = schoon.indexOf('{');
  const laatste = schoon.lastIndexOf('}');
  if (eerste !== -1 && laatste !== -1) schoon = schoon.slice(eerste, laatste + 1);
  return JSON.parse(schoon);
}

async function geminiMetRetry(prompt) {
  const wachttijden = [60000, 300000, 900000];
  for (let i = 0; i <= wachttijden.length; i++) {
    try {
      return await geminiCall(prompt);
    } catch(e) {
      if (i === wachttijden.length) throw e;
      console.log(`Poging ${i + 1} mislukt: ${e.message}. Wacht ${wachttijden[i] / 1000}s...`);
      await new Promise(r => setTimeout(r, wachttijden[i]));
    }
  }
}

async function schrijfNaarGitHub(pad, inhoud, bericht) {
  const url    = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${pad}`;
  const headers = { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' };
  let sha = null;
  try {
    const getRes = await fetch(url, { headers });
    if (getRes.ok) sha = (await getRes.json()).sha;
  } catch(e) {}
  const body = { message: bericht, content: Buffer.from(inhoud).toString('base64') };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub write mislukt voor ${pad}: ${err.message || res.status}`);
  }
}

// ════════════════════════════════════════
// ONDERWERP KIEZEN UIT CATEGORIE
// ════════════════════════════════════════

async function kiesOnderwerpUitCategorie(categorieId) {
  const categorieMap = {
    'nl_uitgelicht': 'Hoofdpagina',
    'en_uitgelicht': 'Hoofdpagina',
    'biologie':      'Biologie',
    'geschiedenis':  'Geschiedenis',
    'kunst':         'Kunst en cultuur',
    'landen':        'Landen en volken',
    'maatschappij':  'Samenleving',
    'politiek':      'Politiek',
    'religie':       'Religie',
    'sport':         'Sport',
    'taal':          'Taalkunde',
    'wetenschap':    'Wetenschap',
    'willekeurig':   'Willekeurig'
  };

  const catNaam = categorieMap[categorieId] || 'Willekeurig';

  async function haalNlWillekeurig() {
    try {
      return await metRetry(async () => {
        const res = await fetch('https://nl.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*');
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        if (!data?.query?.random?.length) throw new Error('Geen resultaat');
        return data.query.random[0].title;
      });
    } catch(e) {
      console.warn('Wikipedia random blijft falen, val terug op hardcoded onderwerp.');
      const fallbacks = [
        'Klimaatverandering', 'Renaissance', 'Universum', 'Mensenrechten',
        'Zwarte gaten', 'Evolutie', 'Romeinse Rijk', 'Microbiologie',
        'Himalaya', 'Taalfilosofie', 'Franse Revolutie', 'Kunstmatige intelligentie',
        'Pandemieën', 'Oude Griekenland', 'Aarde'
      ];
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  async function haalTitelUitCategorie(catNaam) {
    try {
      return await metRetry(async () => {
        const res = await fetch(`https://nl.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Categorie:${encodeURIComponent(catNaam)}&cmlimit=500&cmnamespace=0&cmtype=page&format=json&origin=*`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        const leden = data?.query?.categorymembers || [];
        if (!leden.length) throw new Error('Geen leden in categorie');
        return leden[Math.floor(Math.random() * leden.length)].title;
      });
    } catch(e) {
      console.warn(`Categorie "${catNaam}" blijft falen, val terug op willekeurig.`);
      return await haalNlWillekeurig();
    }
  }

  if (catNaam === 'Willekeurig' || catNaam === 'Hoofdpagina') {
    return await haalNlWillekeurig();
  }

  // Functie om een willekeurig artikel uit een categorie te halen
  async function haalTitelUitCategorie(catNaam) {
  try {
    return await metRetry(async () => {
      const res = await fetch(`https://nl.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Categorie:${encodeURIComponent(catNaam)}&cmlimit=500&cmnamespace=0&cmtype=page&format=json&origin=*`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      const leden = data?.query?.categorymembers || [];
      if (!leden.length) throw new Error('Geen leden in categorie');
      return leden[Math.floor(Math.random() * leden.length)].title;
    });
  } catch(e) {
    console.warn(`Categorie "${catNaam}" blijft falen, val terug op willekeurig.`);
    return await haalNlWillekeurig();
  }
}
    } catch(e) {}
    // Fallback: probeer een willekeurig artikel
    return await haalNlWillekeurig();
  }

  if (catNaam === 'Willekeurig' || catNaam === 'Hoofdpagina') {
    return await haalNlWillekeurig();
  }

  return await haalTitelUitCategorie(catNaam);
}

// ════════════════════════════════════════
// LEERPADSTRUCTUUR GENEREREN
// ════════════════════════════════════════

async function maakPadStructuur(onderwerp, categorieNaam) {
  const prompt = `Je bent een educatieve planner.

We hebben het onderwerp "${onderwerp}" gekozen uit de categorie "${categorieNaam}".
Ontwerp een leerpad van 6 tot 10 lessen dat steeds dieper op dit onderwerp ingaat.

Structuur:
- Les 1: brede introductie op het onderwerp
- Lessen 2 t/m N-1: elk één specifiek deelonderwerp, bekeken vanuit het hoofdonderwerp
- Laatste les: synthese die alle voorgaande lessen samenbrengt (geen nieuw feitenmateriaal)

Je mag volledig vertrouwen op je eigen kennis; Wikipedia-artikelen zijn niet nodig.
Geef elke les een pakkende titel en een korte beschrijving (1 zin) van wat de lezer leert.

Geef terug als JSON:
{
  "onderwerp": "${onderwerp}",
  "aantalLessen": 8,
  "lessen": [
    {
      "nummer": 1,
      "titel": "Pakkende lestitel",
      "beschrijving": "Wat de lezer in deze les leert",
      "isSynthese": false
    },
    ...
  ]
}`;

  for (let poging = 0; poging < 3; poging++) {
    const resultaat = await geminiMetRetry(prompt);
    if (resultaat.onderwerp && resultaat.lessen?.length >= 6 && resultaat.lessen.length <= 10) {
      return resultaat;
    }
    console.log('Ongeldige structuur, nieuwe poging...');
  }
  throw new Error('Kon geen geldig leerpad genereren na 3 pogingen');
}

function maakPadId(onderwerp) {
  const slug = onderwerp.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  const datum = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `lp_${slug}_${datum}`;
}

function bouwActiefLeerpad(padStruct, padId, categorieId, categorieKleur) {
  return {
    id: padId,
    onderwerp: padStruct.onderwerp,
    categorieId,
    categorieKleur,
    aangemaakt: new Date().toISOString().slice(0, 10),
    aantalLessen: padStruct.aantalLessen,
    lessen: padStruct.lessen.map((l, idx) => ({
      nummer: idx + 1,
      titel: l.titel,
      beschrijving: l.beschrijving,
      focus: l.focus || '',
      isSynthese: l.isSynthese || false,
      samenvatting: '',
      status: (idx === 0) ? 'beschikbaar' : 'gepland',
      datumGegenereerd: (idx === 0) ? new Date().toISOString().slice(0, 10) : null,
      datumVoltooid: null
    }))
  };
}

function bouwPadContext(actiefPad, lesNummer) {
  // Verzamel samenvattingen van alle lessen vóór lesNummer
  const vorigeLessen = actiefPad.lessen.filter(l => l.nummer < lesNummer && l.samenvatting);
  if (vorigeLessen.length === 0) return '';
  
  let context = `Leerpad: ${actiefPad.onderwerp} (les ${lesNummer} van ${actiefPad.aantalLessen})\n\n`;
  context += `De lezer heeft al geleerd:\n`;
  vorigeLessen.forEach(l => {
    context += `- Les ${l.nummer} "${l.titel}": ${l.samenvatting}\n`;
  });
  context += `\nSchrijf nu les ${lesNummer} over "${actiefPad.lessen[lesNummer-1].titel}". `;
  context += `Veronderstel dat de lezer de basis uit eerdere lessen kent. Ga dieper. Bouw voort op wat al behandeld is. Herhaal geen informatie uit eerdere lessen.`;
  return context;
}

// ════════════════════════════════════════
// LESSEN GENEREREN (ZONDER WIKIPEDIA)
// ════════════════════════════════════════

function maakSectiePrompt(titel, padContext = '') {
  const contextDeel = padContext ? `\nCONTEXT VAN HET LEERPAD:\n${padContext}\n` : '';
  
  return `Je bent redacteur bij NRC. Schrijf een heldere, boeiende les over "${titel}" in goed Nederlands proza.
Gebruik je eigen kennis over dit onderwerp; je krijgt geen brontekst.${contextDeel}
TAAL: De les is in het Nederlands.

SCHRIJFREGELS — elk van deze regels is verplicht:

1. DOORLOPEND VERHAAL: De les vertelt één verhaal. Elke sectie bouwt voort op de vorige. Stel jezelf na elke sectie de vraag: wat weet de lezer nu dat hij daarvoor nog niet wist? Als het antwoord "niets nieuws" is, herschrijf dan.

2. BEGRIPPEN UITLEGGEN: Elk vaktaalbegrip of moeilijk woord wordt uitgelegd op het moment dat je het introduceert — in dezelfde of de volgende zin. Schrijf niet "de devotie rond de heilige", maar "de devotie — het actief vereren van een heilige via gebeden, processies en pelgrimstochten —". Geen enkel begrip mag onverklaard blijven.

3. VERBODEN WOORDEN: Gebruik nooit: indrukwekkend, meesterlijk, iconisch, verfijnd, bijzonder, opmerkelijk, fascinerend, uniek, spectaculair, enorm belangrijk. Als je wil zeggen dat iets belangrijk is: leg uit waaróm. Als je wil zeggen dat iets mooi is: beschrijf wat je ziet.

4. CONCREET EN CAUSAAL: Schrijf niet "de materialen waren van hoge kwaliteit". Schrijf wát de materialen waren en wat dat betekende voor wie ze gebruikte of zag. Elk oordeel heeft een onderbouwing.

5. ZINSVARIATIE: Wissel korte zinnen (5–10 woorden) bewust af met langere. Een korte zin na een lange geeft nadruk. Gebruik dat.

6. SELECTEER: Je hoeft niet alles over het onderwerp te behandelen. Kies wat het verhaal vooruithelpt. Drie alinea's die goed samenhangen zijn beter dan zes die los van elkaar staan.

STRUCTUUR:
- Minimaal 3, maximaal 6 secties
- Elke sectie heeft een pakkende titel
- Elke sectie heeft een "kernpunt": één heldere zin die samenvat wat de lezer na deze sectie begrijpt — niet wát er staat, maar wát het inzicht is

GEEF JE ANTWOORD UITSLUITEND ALS GELDIGE JSON — geen uitleg, geen markdown, geen backticks.

{
  "secties": [
    {
      "titel": "Pakkende sectietitel",
      "tekst": "Lopende tekst in alinea's, gescheiden door \\n\\n.",
      "kernpunt": "Na deze sectie begrijpt de lezer dat..."
    }
  ]
}`;
}

function maakVragenPrompt(titel, secties) {
  const sectiesVoorPrompt = secties.map((s, i) => ({
    sectie: i + 1, titel: s.titel, tekst: s.tekst, kernpunt: s.kernpunt
  }));
  return `Je krijgt een les over "${titel}", verdeeld in secties. Elke sectie heeft een kernpunt: wat de lezer na het lezen moet begrijpen.

Jouw taken: bepaal categorie, maak tijdlijnen waar nodig, schrijf vragen.

CATEGORIE & KLEUR:
- Korte Nederlandse naam, max 20 tekens
- Kleur leesbaar op donkere achtergrond (#0f0f0f), perceived lightness > 50%
- Voorbeelden: #7cb9e8, #e07b6a, #82d4b0, #c9a0dc, #f4c56a

TIJDLIJN: Alleen toevoegen als de sectie expliciete historische datums bevat. Anders lege array.

VRAGEN — verplichte regels:
1. Elke vraag is gebaseerd op het kernpunt van de sectie, niet op een los feit
2. Vraag naar WAAROM of HOE, nooit alleen naar WAT
3. Het antwoord mag NOOIT dezelfde woorden herhalen als de vraag
4. Wissel flashcard (open) en multiplechoice (4 opties, 1 correct) af
5. Foute opties bij multiple choice zijn aannemelijk maar aantoonbaar onjuist op basis van de tekst
6. 2 à 3 vragen per sectie

GEEF JE ANTWOORD UITSLUITEND ALS GELDIGE JSON — geen uitleg, geen markdown.

{
  "categorie": "Naam",
  "categorieKleur": "#hexkleur",
  "secties": [
    {
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

LES:
${JSON.stringify(sectiesVoorPrompt, null, 2)}`;
}

async function genereerLes(padId, lesNummer, lesTitel, onderwerp, padContext = '') {
  console.log(`Genereer les ${lesNummer}: "${lesTitel}"`);
  
  // Call 2: eerste versie secties, nu met padcontext
  const ruweSecties = await geminiMetRetry(maakSectiePrompt(lesTitel, padContext));
  if (!ruweSecties.secties?.length) throw new Error('Geen secties ontvangen');

  // Call 2b: kwaliteitsreview en herschrijving
  const reviewPrompt = `Je hebt de volgende les geschreven over "${lesTitel}". 
Jouw taak: verbeter de tekst zodat deze **zeer helder en vloeiend leest**, zonder dat de lezer moeite hoeft te doen.
Pas de schrijfregels strikt toe, maar let nu extra op:

- Geen enkele zin mag langer zijn dan 25 woorden.
- Elk abstract begrip moet onmiddellijk in eenvoudige taal worden uitgelegd.
- Zorg dat elke alinea één duidelijke gedachte bevat.
- Gebruik actieve, directe taal.
- Behoud de originele structuur (sectietitels, kernpunten, aantal secties).

Geef de verbeterde les terug in exact hetzelfde JSON-formaat als de invoer.

Invoer:
${JSON.stringify(ruweSecties, null, 2)}`;

  const verbeterdeSecties = await geminiMetRetry(reviewPrompt);
  if (!verbeterdeSecties.secties?.length) {
    console.warn('Review mislukt, gebruik originele versie');
    var definitieveSecties = ruweSecties;
  } else {
    var definitieveSecties = verbeterdeSecties;
  }

  await new Promise(r => setTimeout(r, 1000));

  // Call 3: vragen genereren op basis van de definitieve secties
  const vragenResultaat = await geminiMetRetry(maakVragenPrompt(lesTitel, definitieveSecties.secties));
  if (!vragenResultaat.secties?.length) throw new Error('Geen vragen ontvangen');

  const secties = definitieveSecties.secties.map((s, i) => ({
    ...s,
    afbeelding: null,
    afbeeldingUrl: null,
    tijdlijn: vragenResultaat.secties[i]?.tijdlijn || [],
    vragen: vragenResultaat.secties[i]?.vragen || []
  }));

  const les = {
    padId,
    lesNummer,
    titel: lesTitel,
    secties,
    categorie: vragenResultaat.categorie || onderwerp,
    categorieKleur: vragenResultaat.categorieKleur || '#82d4b0',
    datum: new Date().toISOString().slice(0, 10)
  };

  // Schrijf lesbestand
  await schrijfNaarGitHub(`lessen/${padId}-les-${lesNummer}.json`, JSON.stringify(les, null, 2), `Les ${lesNummer} voor pad ${padId}`);

  // Samenvatting: combineer alle kernpunten
  const samenvatting = definitieveSecties.secties.map(s => s.kernpunt).join(' ');
  return { les, samenvatting };
}

// ════════════════════════════════════════
// ARCHIVERING EN STATUS
// ════════════════════════════════════════

async function leesStatus() {
  try {
    const { readFile } = await import('fs/promises');
    return JSON.parse(await readFile('status.json', 'utf8'));
  } catch (e) {
    return { padOvergeslagen: false, overgeslageOp: null };
  }
}

async function schrijfStatus(statusObj) {
  await schrijfNaarGitHub('status.json', JSON.stringify(statusObj, null, 2), 'Update status.json');
}

async function archiveerPad(padId, reden) {
  const { readFile } = await import('fs/promises');
  
  // Lees het actieve pad
  let actiefPad;
  try {
    actiefPad = JSON.parse(await readFile('actief-leerpad.json', 'utf8'));
  } catch (e) {
    console.log('Geen actief pad om te archiveren.');
    return;
  }
  
  const overzicht = {
    id: actiefPad.id,
    onderwerp: actiefPad.onderwerp,
    categorieKleur: actiefPad.categorieKleur,
    aangemaakt: actiefPad.aangemaakt,
    afgesloten: new Date().toISOString().slice(0, 10),
    reden,
    aantalLessen: actiefPad.aantalLessen,
    lessen: actiefPad.lessen.map(l => ({
      nummer: l.nummer,
      titel: l.titel,
      datumGegenereerd: l.datumGegenereerd,
      datumVoltooid: l.datumVoltooid
    }))
  };
  
  // Schrijf archiefoverzicht
  await schrijfNaarGitHub(`archief/${padId}-overzicht.json`, JSON.stringify(overzicht, null, 2), 
    `Archiveer pad ${padId} (${reden})`);
  
  // Verwijder actief-leerpad.json (maak leeg of commit een delete – we gebruiken schrijfNaarGitHub met een leeg object is lastig; we kunnen ook een dummy schrijven. Eenvoudiger: we overschrijven met `null` of een leeg JSON object)
  await schrijfNaarGitHub('actief-leerpad.json', '{}', `Verwijder actief pad na archivering`);
  console.log(`Leerpad ${padId} gearchiveerd (reden: ${reden}).`);
}

// ════════════════════════════════════════
// MAIN
// ════════════════════════════════════════

async function main() {
  const { readFile } = await import('fs/promises');
  const vandaag = new Date().toISOString().slice(0, 10);
  
  // 1. Lees config.json
  const config = JSON.parse(await readFile('config.json', 'utf8'));
  const geselecteerdeCats = config.geselecteerdeCategorieen || ['nl_uitgelicht'];
  
  // 2. Lees status.json
  const status = await leesStatus();
  if (status.padOvergeslagen) {
    console.log('Pad was overgeslagen. Archiveer en start nieuw pad.');
    // Zoek het actieve pad (mocht het nog bestaan) en archiveer
    try {
      const actiefPad = JSON.parse(await readFile('actief-leerpad.json', 'utf8'));
      await archiveerPad(actiefPad.id, 'overgeslagen');
    } catch (e) {
      console.log('Geen actief pad gevonden om te archiveren.');
    }
    // Reset status
    await schrijfStatus({ padOvergeslagen: false, overgeslageOp: null });
    // Start nieuw pad
    // (val door naar de code onderaan die een nieuw pad maakt)
  }
  
  // 3. Lees actief-leerpad.json
  let actiefPad = null;
  try {
    actiefPad = JSON.parse(await readFile('actief-leerpad.json', 'utf8'));
    // Controleer of het bestand niet leeg is (door archivering)
    if (!actiefPad.id) actiefPad = null;
  } catch (e) {
    console.log('Geen actief leerpad gevonden.');
  }
  
  if (actiefPad) {
    // Zoek de eerste geplande les
    const volgendeLes = actiefPad.lessen.find(l => l.status === 'gepland');
    
    if (volgendeLes) {
      // Genereer deze les
      const padContext = bouwPadContext(actiefPad, volgendeLes.nummer);
      const { samenvatting } = await genereerLes(
        actiefPad.id,
        volgendeLes.nummer,
        volgendeLes.titel,
        actiefPad.onderwerp,
        padContext
      );
      
      // Update het actief pad
      actiefPad.lessen[volgendeLes.nummer - 1].status = 'beschikbaar';
      actiefPad.lessen[volgendeLes.nummer - 1].samenvatting = samenvatting;
      actiefPad.lessen[volgendeLes.nummer - 1].datumGegenereerd = vandaag;
      
      await schrijfNaarGitHub('actief-leerpad.json', JSON.stringify(actiefPad, null, 2), 
        `Les ${volgendeLes.nummer} gegenereerd voor pad ${actiefPad.id}`);
      console.log(`Les ${volgendeLes.nummer} succesvol gegenereerd.`);
      return;
    } else {
      // Alle lessen zijn gegenereerd – archiveer als voltooid en start nieuw pad
      console.log('Alle lessen gegenereerd, archiveer pad als voltooid.');
      await archiveerPad(actiefPad.id, 'voltooid');
      // val door naar nieuw pad
    }
  }
  
  // 4. Start een nieuw leerpad
  const categorieId = geselecteerdeCats[Math.floor(Math.random() * geselecteerdeCats.length)];
  console.log(`Categorie gekozen: ${categorieId}`);
  
  const onderwerp = await kiesOnderwerpUitCategorie(categorieId);
  console.log(`Onderwerp gekozen: "${onderwerp}"`);
  
  const padStruct = await maakPadStructuur(onderwerp, categorieId);
  console.log(`Padstructuur ontvangen: ${padStruct.onderwerp} (${padStruct.aantalLessen} lessen)`);
  
  const padId = maakPadId(padStruct.onderwerp);
  
  const nieuwPad = bouwActiefLeerpad(padStruct, padId, categorieId, '#82d4b0');
  
  // Genereer Les 1
  const les1Titel = padStruct.lessen[0].titel;
  const { samenvatting } = await genereerLes(padId, 1, les1Titel, padStruct.onderwerp);
  
  nieuwPad.lessen[0].status = 'beschikbaar';
  nieuwPad.lessen[0].samenvatting = samenvatting;
  
  await schrijfNaarGitHub('actief-leerpad.json', JSON.stringify(nieuwPad, null, 2), 
    `Nieuw leerpad: ${padStruct.onderwerp}`);
  
  console.log('Nieuw leerpad succesvol aangemaakt!');
}

main().catch(e => { console.error('Fout:', e); process.exit(1); });
