// scripts/genereer.js – Leerpaden generator (Fase 2)

const MAX_TEKST  = 40000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GH_TOKEN   = process.env.GH_TOKEN;
const [REPO_OWNER, REPO_NAME] = (process.env.GITHUB_REPOSITORY || '').split('/');

// ════════════════════════════════════════
// HULPFUNCTIES (ongewijzigd)
// ════════════════════════════════════════

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
// NIEUWE FUNCTIES
// ════════════════════════════════════════

async function haalWikipediaTekst(titel, taal = 'nl') {
  const base = taal === 'nl' ? 'https://nl.wikipedia.org' : 'https://en.wikipedia.org';
  const res  = await fetch(`${base}/w/api.php?action=query&titles=${encodeURIComponent(titel)}&prop=extracts&explaintext=true&format=json&origin=*`);
  const data = await res.json();
  const page = Object.values(data.query.pages)[0];
  if (!page || page.missing) throw new Error(`Artikel niet gevonden: ${titel}`);
  return { titel: page.title, tekst: page.extract || '' };
}

async function valideerArtikelen(lessen) {
  for (const les of lessen) {
    if (les.isSynthese) continue; // syntheseles heeft geen Wikipedia
    try {
      const { tekst } = await haalWikipediaTekst(les.wikipediaArtikel);
      if (tekst.length < 3000) {
        throw new Error(`Artikel te kort (${tekst.length} tekens)`);
      }
    } catch (e) {
      console.warn(`Validatie mislukt voor "${les.wikipediaArtikel}": ${e.message}`);
      return false;
    }
  }
  return true;
}

async function maakPadStructuur(categorieId, categorienaam) {
  const prompt = `Je bent een educatieve planner.

Kies één specifiek Wikipedia-onderwerp uit de categorie "${categorienaam}" dat geschikt is voor een diepgaand leerpad.

Bepaal zelf hoeveel lessen nodig zijn (minimaal 6, maximaal 10).
De structuur is altijd:
- Les 1: brede introductie op het hoofdonderwerp
- Lessen 2 t/m N-1: elk één deelonderwerp, steeds dieper, altijd bekeken vanuit het hoofdonderwerp
- Laatste les: altijd een synthese zonder Wikipedia-artikel

Regels:
- Elk deelonderwerp moet een bestaand Nederlands Wikipedia-artikel hebben
- De lessen moeten logisch op elkaar voortbouwen
- Vermijd overlap tussen lessen

Geef terug als JSON:
{
  "onderwerp": "Naam van het hoofdonderwerp",
  "wikipediaHoofdArtikel": "Exacte Wikipedia-paginanaam",
  "aantalLessen": 8,
  "lessen": [
    {
      "nummer": 1,
      "titel": "Pakkende lestitel",
      "beschrijving": "Wat de lezer leert",
      "wikipediaArtikel": "Exacte Wikipedia-paginanaam",
      "focus": "Specifieke invalshoek vanuit het hoofdonderwerp",
      "isSynthese": false
    }
  ]
}`;

  let resultaat;
  for (let poging = 0; poging < 3; poging++) {
    resultaat = await geminiMetRetry(prompt);
    if (resultaat.onderwerp && resultaat.lessen?.length >= 6 && resultaat.lessen.length <= 10) {
      // Valideer de artikelen
      if (await valideerArtikelen(resultaat.lessen)) {
        return resultaat;
      }
      console.log('Validatie artikelen mislukt, nieuwe poging...');
    } else {
      console.log('Ongeldige structuur, nieuwe poging...');
    }
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
      wikipediaArtikel: l.wikipediaArtikel || null,
      focus: l.focus || '',
      isSynthese: l.isSynthese || false,
      samenvatting: '',
      status: (idx === 0) ? 'beschikbaar' : 'gepland',
      datumGegenereerd: (idx === 0) ? new Date().toISOString().slice(0, 10) : null,
      datumVoltooid: null
    }))
  };
}

function maakSectiePromptLes1(titel, tekst) {
  const ingekorte = tekst.length > MAX_TEKST ? tekst.slice(0, MAX_TEKST) + '\n\n[tekst ingekort]' : tekst;
  return `Je bent redacteur bij NRC. Jouw enige taak: schrijf een heldere, boeiende les over "${titel}" in goed Nederlands proza.

TAAL: De brontekst is in het Nederlands.

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

// Prompts voor les 1 (zoals nu, maar met padcontext)
function maakVragenPromptLes1(titel, secties) {
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

async function genereerLes1EnUpdatePad(padId, lesNummer, wikipediaArtikel, onderwerp) {
  // Haal Wikipedia op
  const { titel, tekst } = await haalWikipediaTekst(wikipediaArtikel);
  
  // Call 2: secties
  console.log('Gemini call 2: sectietekst (les 1)...');
  const sectieResultaat = await geminiMetRetry(maakSectiePromptLes1(titel, tekst));
  if (!sectieResultaat.secties?.length) throw new Error('Geen secties ontvangen');

  await new Promise(r => setTimeout(r, 1000));

  // Call 3: vragen
  console.log('Gemini call 3: vragen (les 1)...');
  const vragenResultaat = await geminiMetRetry(maakVragenPromptLes1(titel, sectieResultaat.secties));
  if (!vragenResultaat.secties?.length) throw new Error('Geen vragen ontvangen');

  const secties = sectieResultaat.secties.map((s, i) => ({
    ...s,
    afbeelding: null,
    afbeeldingUrl: null,
    tijdlijn: vragenResultaat.secties[i]?.tijdlijn || [],
    vragen: vragenResultaat.secties[i]?.vragen || []
  }));

  const les = {
    padId,
    lesNummer,
    titel,
    secties,
    categorie: vragenResultaat.categorie || onderwerp,
    categorieKleur: vragenResultaat.categorieKleur || '#82d4b0',
    datum: new Date().toISOString().slice(0, 10)
  };

  // Schrijf lesbestand
  await schrijfNaarGitHub(`lessen/${padId}-les-${lesNummer}.json`, JSON.stringify(les, null, 2), `Les ${lesNummer} voor pad ${padId}`);

  return { les, samenvatting: sectieResultaat.secties.map(s => s.kernpunt).join(' ') };
}

// ════════════════════════════════════════
// MAIN
// ════════════════════════════════════════

async function main() {
  const { readFile } = await import('fs/promises');
  
  // Lees config.json
  const config = JSON.parse(await readFile('config.json', 'utf8'));
  const geselecteerdeCats = config.geselecteerdeCategorieen || ['nl_uitgelicht'];
  
  // Kies willekeurig een categorie (mappen naar oude namen, maar we gebruiken gewoon de id)
  const categorieId = geselecteerdeCats[Math.floor(Math.random() * geselecteerdeCats.length)];
  
  // Bepaal categorie-naam (optioneel – je kunt een mapping maken of gewoon de id gebruiken)
  const categorienaam = categorieId; // in de prompt gebruik ik de id als naam, pas later aan naar mooie namen
  
  console.log(`Nieuw leerpad genereren voor categorie: ${categorienaam}`);
  
  // Call 1: padstructuur
  const padStruct = await maakPadStructuur(categorieId, categorienaam);
  console.log(`Padstructuur ontvangen: ${padStruct.onderwerp} (${padStruct.aantalLessen} lessen)`);
  
  const padId = maakPadId(padStruct.onderwerp);
  
  // Bouw actief-leerpad.json (met les1 al beschikbaar)
  const actiefPad = bouwActiefLeerpad(padStruct, padId, categorieId, '#82d4b0'); // kleur later door Gemini laten bepalen
  
  // Genereer les 1
  const les1 = padStruct.lessen[0];
  const { samenvatting } = await genereerLes1EnUpdatePad(padId, 1, les1.wikipediaArtikel, padStruct.onderwerp);
  
  // Update samenvatting in actiefPad
  actiefPad.lessen[0].samenvatting = samenvatting;
  
  // Schrijf actief-leerpad.json
  await schrijfNaarGitHub('actief-leerpad.json', JSON.stringify(actiefPad, null, 2), `Nieuw leerpad: ${padStruct.onderwerp}`);
  
  console.log('Leerpad succesvol aangemaakt!');
}

main().catch(e => { console.error('Fout:', e); process.exit(1); });
