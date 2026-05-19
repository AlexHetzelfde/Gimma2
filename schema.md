# WikiLeer Leerpaden – Datamodellen

## actief-leerpad.json
Wordt beheerd door het dagelijkse script. Bevat het actieve leerpad.

{
  "id": "lp_milieuvervuiling_20260517",
  "onderwerp": "Milieuvervuiling",
  "categorieId": "wetenschap",
  "categorieKleur": "#82d4b0",
  "aangemaakt": "2026-05-17",
  "aantalLessen": 8,
  "lessen": [
    {
      "nummer": 1,
      "titel": "Introductie — Wat is milieuvervuiling?",
      "beschrijving": "Brede basis over alle vormen, oorzaken en gevolgen",
      "wikipediaArtikel": "Milieuvervuiling",
      "focus": "Zo breed mogelijk, legt basis voor alle volgende lessen",
      "isSynthese": false,
      "samenvatting": "",
      "status": "beschikbaar",
      "datumGegenereerd": "2026-05-17",
      "datumVoltooid": null
    },
    {
      "nummer": 2,
      "titel": "Klimaatverandering als versterker",
      "beschrijving": "Hoe klimaatverandering en vervuiling elkaar versterken",
      "wikipediaArtikel": "Klimaatverandering",
      "focus": "Wisselwerking tussen klimaat en milieuvervuiling",
      "isSynthese": false,
      "samenvatting": "",
      "status": "gepland",
      "datumGegenereerd": null,
      "datumVoltooid": null
    },
    {
      "nummer": 8,
      "titel": "Synthese — Het grote plaatje",
      "beschrijving": "Alle verbanden samengevat",
      "wikipediaArtikel": null,
      "focus": "Synthetiseer alle vorige lessen",
      "isSynthese": true,
      "samenvatting": "",
      "status": "gepland",
      "datumGegenereerd": null,
      "datumVoltooid": null
    }
  ]
}

## status.json
Signaalbestand dat de frontend schrijft als de gebruiker een pad overslaat.

{
  "padOvergeslagen": false,
  "overgeslageOp": null
}

## less/[padid]-les-[N].json
Volledige lescontent, identiek aan de huidige vandaag-les.json plus padId/lesNummer.

{
  "padId": "lp_milieuvervuiling_20260517",
  "lesNummer": 1,
  "titel": "Introductie — Wat is milieuvervuiling?",
  "secties": [ ... ],
  "categorie": "Milieuvervuiling",
  "categorieKleur": "#82d4b0",
  "datum": "2026-05-17"
}

## archief/[padid]-overzicht.json
Compacte samenvatting van een afgesloten leerpad.

{
  "id": "lp_milieuvervuiling_20260517",
  "onderwerp": "Milieuvervuiling",
  "categorieKleur": "#82d4b0",
  "aangemaakt": "2026-05-17",
  "afgesloten": "2026-06-03",
  "reden": "voltooid",
  "aantalLessen": 8,
  "lessen": [
    {
      "nummer": 1,
      "titel": "Introductie — Wat is milieuvervuiling?",
      "datumVoltooid": "2026-05-17"
    }
  ]
}
