const MAX_TEKST  = 40000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GH_TOKEN   = process.env.GH_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME  = process.env.REPO_NAME;

const CATEGORIEEN = {
  nl_uitgelicht: () => haalNlUitgelicht(),
  en_uitgelicht: () => haalEnUitgelicht(),
  biologie:      () => haalNlCategorie('Biologie', 'biologie'),
  geschiedenis:  () => haalNlCategorie('Geschiedenis', 'geschiedenis'),
  kunst:         () => haalNlCategorie('Kunst en cultuur', 'kunst cultuur'),
  landen:        () => haalNlCategorie('Landen en volken', 'geografie landen'),
  maatschappij:  () => haalNlCategorie('Samenleving', 'maatschappij'),
  politiek:      () => haalNlCategorie('Politiek', 'politiek'),
  religie:       () => haalNlCategorie('Religie', 'religie'),
  sport:         () => haalNlCategorie('Sport', 'sport'),
  taal:          () => haalNlCategorie('Taalkunde', 'taal'),
  wetenschap:    () => haalNlCategorie('Wetenschap', 'wetenschap technologie'),
  willekeurig:   () => haalNlWillekeurig(),
};

async function haalNlUitgelicht() {
  const res = await fetch('https://nl.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Categorie:Wikipedia:Etalage&cmlimit=500&cmnamespace=0&format=json&origin=*');
  const data = await res.json();
  const leden = data?.query?.categorymembers || [];
  if (!leden.length) throw new Error('Geen etalage-artikelen gevonden');
  return leden[Math.floor(Math.random() * leden.length)].title;
}

async function haalEnUitgelicht() {
  const nu    = new Date();
  const jaar  = nu.getUTCFullYear();
  const maand = String(nu.getUTCMonth() + 1).padStart(2, '0');
  const dag   = String(nu.getUTCDate()).padStart(2, '0');
  const res   = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/featured/${jaar}/${maand}/${dag}`);
  if (!res.ok) throw new Error('Featured article API niet bereikbaar');
  const data  = await res.json();
  const titel = data?.tfa?.title;
  if (!titel) throw new Error('Geen featured article gevonden');
  return titel;
}

async function haalNlCategorie(categorieNaam, zoekterm) {
  try {
    const res = await fetch(`https://nl.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Categorie:${encodeURIComponent(categorieNaam)}&cmlimit=500&cmnamespace=0&cmtype=page&format=json&origin=*`);
    if (res.ok) {
      const data  = await res.json();
      const leden = data?.query?.categorymembers || [];
      if (leden.length) return leden[Math.floor(Math.random() * leden.length)].title;
    }
  } catch(e) {}

  try {
    const subRes = await fetch(`https://nl.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Categorie:${encodeURIComponent(categorieNaam)}&cmlimit=30&cmtype=subcat&format=json&origin=*`);
    if (subRes.ok) {
      const subData = await subRes.json();
      const subcats = subData?.query?.categorymembers || [];
      if (subcats.length) {
        const subNaam  = subcats[Math.floor(Math.random() * subcats.length)].title.replace('Categorie:', '');
        const artRes   = await fetch(`https://nl.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=Categorie:${encodeURIComponent(subNaam)}&cmlimit=100&cmnamespace=0&cmtype=page&format=json&origin=*`);
        if (artRes.ok) {
          const artData  = await artRes.json();
          const artikelen = artData?.query?.categorymembers || [];
          if (artikelen.length) return artikelen[Math.floor(Math.random() * artikelen.length)].title;
        }
      }
    }
  } catch(e) {}

  const offset = Math.floor(Math.random() * 80);
  const res    = await fetch(`https://nl.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(zoekterm)}&srnamespace=0&srlimit=10&sroffset=${offset}&format=json&origin=*`);
  if (res.ok) {
    const data      = await res.json();
    const resultaten = data?.query?.search || [];
    if (resultaten.length) return resultaten[Math.floor(Math.random() * resultaten.length)].title;
  }
  return haalNlWillekeurig();
}

async function haalNlWillekeurig() {
  const res  = await fetch('https://nl.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*');
  const data = await res.json();
  return data?.query?.random?.[0]?.title;
}

async function haalVolledigeTekst(titel, taal) {
  const base = taal === 'nl' ? 'https://nl.wikipedia.org' : 'https://en.wikipedia.org';
  const res  = await fetch(`${base}/w/api.php?action=query&titles=${encodeURIComponent(titel)}&prop=extracts&explaintext=true&format=json&origin=*`);
  const data = await res.json();
  const page = Object.values(data.query.pages)[0];
  if (!page || page.missing) throw new Error(`Artikel niet gevonden: ${titel}`);
  return { titel: page.title, tekst: page.extract || '' };
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

function maakSectiePrompt(titel, tekst, taal) {
  const ingekorte    = tekst.length > MAX_TEKST ? tekst.slice(0, MAX_TEKST) + '\n\n[tekst ingekort]' : tekst;
  const bronTaalTekst = taal === 'nl'
    ? 'De brontekst is in het Nederlands.'
    : 'De brontekst is in het Engels. Schrijf ALLE output uitsluitend in correct Nederlands. Vertaal en herschrijf; kopieer nooit Engelse zinnen.';
  return `Je bent redacteur bij NRC. Jouw enige taak: schrijf een heldere, boeiende les over "${titel}" in goed Nederlands proza.

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
}

ARTIKELTEKST:
${ingekorte}`;
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

async function main() {
  const { readFile } = await import('fs/promises');
  const config       = JSON.parse(await readFile('config.json', 'utf8'));
  const geselecteerd = config.geselecteerdeCategorieen || ['nl_uitgelicht'];
  const gisteren     = config.gisterenArtikel || '';

  const catId      = geselecteerd[Math.floor(Math.random() * geselecteerd.length)];
  const catFunctie = CATEGORIEEN[catId] || CATEGORIEEN.willekeurig;
  const taal       = catId === 'en_uitgelicht' ? 'en' : 'nl';
  console.log(`Categorie: ${catId}`);

  let titel, tekst;
  for (let poging = 0; poging < 5; poging++) {
    const kandidaat = await catFunctie();
    console.log(`Kandidaat: ${kandidaat}`);
    if (kandidaat === gisteren) { console.log('Zelfde als gisteren, opnieuw...'); continue; }
    const r = await haalVolledigeTekst(kandidaat, taal);
    if ((r.tekst || '').length < 3000) { console.log(`Te kort (${r.tekst.length} tekens), opnieuw...`); continue; }
    titel = r.titel; tekst = r.tekst; break;
  }
  if (!titel) throw new Error('Geen geschikt artikel gevonden na 5 pogingen');
  console.log(`Artikel gekozen: ${titel}`);

  console.log('Gemini call 1: sectietekst...');
  const sectieResultaat = await geminiMetRetry(maakSectiePrompt(titel, tekst, taal));
  if (!sectieResultaat.secties?.length) throw new Error('Geen secties ontvangen');

  await new Promise(r => setTimeout(r, 1000));

  console.log('Gemini call 2: vragen...');
  const vragenResultaat = await geminiMetRetry(maakVragenPrompt(titel, sectieResultaat.secties));
  if (!vragenResultaat.secties?.length) throw new Error('Geen vragen ontvangen');

  const secties = sectieResultaat.secties.map((s, i) => ({
    ...s,
    afbeelding:    null,
    afbeeldingUrl: null,
    tijdlijn:      vragenResultaat.secties[i]?.tijdlijn || [],
    vragen:        vragenResultaat.secties[i]?.vragen   || []
  }));

  const vandaag = new Date().toISOString().slice(0, 10);
  const les     = { titel, secties, categorie: vragenResultaat.categorie, categorieKleur: vragenResultaat.categorieKleur, datum: vandaag };

  console.log('Schrijf vandaag-les.json...');
  await schrijfNaarGitHub('vandaag-les.json', JSON.stringify(les, null, 2), `Les van ${vandaag}: ${titel}`);

  config.gisterenArtikel = titel;
  console.log('Update config.json...');
  await schrijfNaarGitHub('config.json', JSON.stringify(config, null, 2), `Update gisterenArtikel: ${titel}`);

  console.log('Klaar!');
}

main().catch(e => { console.error('Fout:', e); process.exit(1); });
