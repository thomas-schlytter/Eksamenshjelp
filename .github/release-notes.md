## Slik oppdaterer du

**Har du 0.7.3 eller nyere?** Trykk «Oppdater nå» i appen. Den gjør alt selv.

### Enklest: la Claude eller Codex gjøre det

Åpne Code-fanen i Claude-appen, eller Codex, lim inn teksten under og trykk Enter. Fagene, chattene og flammen din blir med.

<details open><summary><b>Jeg har Claude</b></summary>

<!-- prompt:oppdater-claude -->

```text
Du er i Claude Code og skal oppdatere appen Eksamenshjelp til nyeste versjon for en NTNU-student. Følg stegene i rekkefølge. Ikke utforsk, klon eller bygg noe.

1. Si kort til studenten: «Jeg oppdaterer Eksamenshjelp. Fagene, chattene og flammen din blir med. Du må godkjenne én kommando.»

2. Oppdater appen med ett kommando-kall. Det lukker appen hvis den er åpen, laster ned nyeste versjon fra GitHub og installerer den over den gamle. Studenten må godkjenne kommandoen når Claude spør.
Mac:
curl -fsSL https://eksamenshjelp-one.vercel.app/install.sh | bash
Windows:
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://eksamenshjelp-one.vercel.app/install.ps1 | iex"
Skriver kommandoen «Feil:», forklar feilen for studenten med enkle ord og stopp.

3. Start appen hvis den ikke er åpen (Mac: open -a Eksamenshjelp, Windows: kommandoen nederst i utskriften fra steg 2). Si til slutt: «Ferdig. Eksamenshjelp er oppdatert.»
```

<!-- /prompt:oppdater-claude -->

</details>

<details><summary><b>Jeg har ChatGPT (Codex)</b></summary>

<!-- prompt:oppdater-codex -->

```text
Du er i Codex og skal oppdatere appen Eksamenshjelp til nyeste versjon for en NTNU-student. Følg stegene i rekkefølge. Ikke utforsk, klon eller bygg noe.

1. Si kort til studenten: «Jeg oppdaterer Eksamenshjelp. Fagene, chattene og flammen din blir med. Du må godkjenne én kommando.»

2. Oppdater appen med ett kommando-kall. Det lukker appen hvis den er åpen, laster ned nyeste versjon fra GitHub og installerer den over den gamle. Kommandoen trenger nettverk og skriver utenfor arbeidsmappen, så be om å kjøre den utenfor sandkassen. Studenten må godkjenne den.
Mac:
curl -fsSL https://eksamenshjelp-one.vercel.app/install.sh | bash
Windows:
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://eksamenshjelp-one.vercel.app/install.ps1 | iex"
Skriver kommandoen «Feil:», forklar feilen for studenten med enkle ord og stopp.

3. Start appen hvis den ikke er åpen (Mac: open -a Eksamenshjelp, Windows: kommandoen nederst i utskriften fra steg 2). Si til slutt: «Ferdig. Eksamenshjelp er oppdatert.»
```

<!-- /prompt:oppdater-codex -->

</details>

### Uten AI

1. Last ned: **[Mac](https://github.com/thomas-schlytter/Eksamenshjelp/releases/download/v{{version}}/Eksamenshjelp-{{version}}-arm64.dmg)** · **[Windows](https://github.com/thomas-schlytter/Eksamenshjelp/releases/download/v{{version}}/Eksamenshjelp-{{version}}-x64-setup.exe)**
2. Lukk Eksamenshjelp.
3. **Mac:** åpne filen og dra Eksamenshjelp inn i Programmer, og velg «Erstatt». Sier Mac at appen ikke kan åpnes: Systeminnstillinger → Personvern og sikkerhet → «Åpne likevel».
   **Windows:** kjør filen. Viser Windows «Windows beskyttet PC-en din»: trykk «Mer informasjon» og «Kjør likevel».

Mer hjelp: https://eksamenshjelp-one.vercel.app/oppdater

---

*Filene under trenger du ikke. De brukes av appen og installasjonen.*
