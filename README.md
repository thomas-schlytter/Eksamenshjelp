<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="LearnHarness" width="640">
  </picture>
</p>

<p align="center"><strong>Eksamensrettet AI-hjelp for NTNU-studenter.</strong></p>

<p align="center">
  <a href="#slik-fungerer-det">Slik fungerer det</a> ·
  <a href="#kom-i-gang">Kom i gang</a> ·
  <a href="#bygger-på-learnharness">Opphav</a> ·
  <a href="docs/development.md">Utviklerdokumentasjon</a>
</p>

Dette er en norsk, eksamensrettet versjon av LearnHarness for studenter ved NTNU. Du velger fag med fagkode, appen henter konteksten selv fra NTNUs emnesider, og du kan legge til ditt eget materiale. Eksamensmodus kartlegger hva du kan, og lager en fargekodet plan fram mot eksamen.

Appen er gratis og har åpen kildekode. Alt i appen er på norsk bokmål.

> **Bygger på [LearnHarness](https://github.com/amosblomqvist/learnharness) av Amos Blomqvist.** Læringsmotoren, kunnskapskartet og skrivebordsappen kommer fra originalprosjektet. Denne versjonen legger til fag, eksamensmodus, hjelpesenter og norsk språk. Se [Bygger på LearnHarness](#bygger-på-learnharness).

![En læringsøkt i LearnHarness](docs/assets/teaching-session.png)

*Skjermbildene er fra den originale, engelske utgaven av LearnHarness.*

## Slik fungerer det

1. **Velg fag.** Søk opp faget med fagkode, for eksempel `TTK4100`. Appen henter emnebeskrivelsen fra NTNUs emnesider: faglig innhold, læringsutbytte og eksamensinformasjon. Finnes ikke faget hos NTNU, kan du legge det inn manuelt.
2. **Legg til eget materiale (valgfritt).** Filer, mapper, lenker og notater du legger til, blir en del av konteksten agenten bruker i faget. Appen kan ikke logge inn i Canvas, så tidligere eksamener og løsningsforslag laster du ned selv og drar inn.
3. **Kartlegg.** Appen lager en temaliste for faget. Du setter farge på hvert tema selv på ett minutt, eller lar AI-en stille spørsmål på tvers av temaene og sette fargene for deg.
4. **Følg planen.** Du får en plan dag for dag fram mot eksamensdatoen. Hvert tema har en farge og en tekst: grå «Ikke kartlagt», rød «Kan ikke ennå», gul «Usikker» og grønn «Kan dette».
5. **Lær og øv.** Hvert tema har to handlinger. **Lær** bygger forståelsen steg for steg, med utgangspunkt i det du allerede kan. **Øv** gir deg oppgaver å løse, gjerne i eksamensform.

**Eksamensøkt.** Vil du heller ta hele faget i ett løp, starter du en eksamensøkt fra fagsiden. Agenten kartlegger pensum fra tidligere eksamener, og du følger framgangen i et eksamenskart med én kolonne per emne og de samme fargene som på fagsiden.

**Tenk høyt.** I tankefeltene kan du forklare hvordan du resonnerer, og hva du er usikker på. Da får agenten et bedre bilde enn bare riktig eller galt svar. Du kan skrive eller bruke diktering.

Står du fast på et spørsmål, kan du hoppe over det eller spørre agenten før du svarer. Underveis får du flervalg med en kort forklaring. Når et tema skal godkjennes, løser du en oppgave med egne ord.

Agenten kan også gjøre research i bakgrunnen, lage visualiseringer og bygge interaktive demoer.

## Kunnskapskartet

Det du lærer, samles som påstander og resonnementskjeder: enkeltpåstander og premissene som leder fram til dem. Kunnskapskartet viser denne strukturen, med lenker tilbake til øktene de kom fra. Du kan også importere notater.

Senere økter kan lese kartet i stedet for å begynne fra bunnen av, og øvingsøkter kan hente stoff fra det. Kartet lagrer ideene og sammenhengene mellom dem, ikke karakterer på hvor flink du er.

![Kunnskapskartet i LearnHarness](docs/assets/knowledge-graph.png)

## Hjelpesenter

Hjelpesenteret i appen har søk i funksjoner, spørsmål og svar, og interaktive veivisere som viser deg rundt. Du kan også åpne søket fra sidemenyen, uansett hvor du er i appen.

## Kom i gang

Denne versjonen kjører du fra kildekoden:

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # deterministisk, uten LLM og uten nettverk
```

Velg modeller første gang du åpner appen, og legg deretter til et fag.

Den originale LearnHarness-appen (på engelsk, uten NTNU-funksjonene) kan lastes ned fra [learnharness.ai](https://learnharness.ai) eller [GitHub Releases](https://github.com/amosblomqvist/learnharness/releases).

### Har du brukt LearnHarness før?

Da kan du ta med deg øktene og kunnskapskartet. Når du kjører fra kildekoden, ligger dataene i repoets `data/`, ikke i mappen den vanlige LearnHarness-appen bruker. Åpne **Innstillinger → Generelt → Importer fra LearnHarness** (eller søk etter «importer» i søket). Appen finner selv mappen til skrivebordsappen hvis den ligger på maskinen:

| System | Mappe |
|---|---|
| Mac | `~/Library/Application Support/LearnHarness` |
| Windows | `%APPDATA%\LearnHarness` |
| Linux | `~/.config/LearnHarness` |

Ligger dataene på en annen maskin, kopierer du hele mappen over og limer inn stien til kopien. Du velger selv hva som blir med: økter, kunnskapskart, innstillinger, API-nøkler (av som standard) og egne systeminstrukser.

Importen legger bare til. Ingenting hos deg slettes eller overskrives, dataene i den andre mappen endres ikke, og det tas en sikkerhetskopi av kunnskapskartet og innstillingene dine i `data/backups/` før noe skrives. Du kan trygt kjøre importen flere ganger; det som alt er hentet inn, hoppes over.

### Egne nøkler og modeller

Appen har ingen egen konto og ingen innebygd AI-tjeneste. Du kobler til modeller selv, på én av disse måtene:

- API-nøkler fra en leverandør
- støttede abonnementstilkoblinger i skrivebordsappen
- en installert [Claude Code CLI](docs/claude-code.md)
- et [egendefinert OpenAI-kompatibelt endepunkt](docs/custom-providers.md), for eksempel en lokal modellserver

Diktering og nettsøk er valgfritt og bruker egne tjenestenøkler.

**Diktering:** Lag en [Deepgram API-nøkkel](https://console.deepgram.com/) med rollen **Member eller høyere** ([kreves for å utstede tokener](https://developers.deepgram.com/reference/auth/tokens/grant)), og legg den inn under **Innstillinger → Leverandører → Diktering**. Språket velger du under nøkkelen.

## Personvern og lokal lagring

- **Dine nøkler og modeller.** Det finnes ikke noe LearnHarness-abonnement og ikke noe påslag. Hva du betaler, avhenger av leverandøren, CLI-oppsettet, abonnementet eller det lokale oppsettet ditt. Kostnadsmåleren i appen anslår kjente API-kostnader, ikke kostnader for abonnement, CLI eller egendefinerte endepunkter.
- **Lokal lagring.** Fagene, øktene, kunnskapskartet, innstillingene og API-nøklene dine ligger på din egen maskin. Det du har lært, lagres som vanlige filer du kan se på.
- **Eksterne tjenester.** Modellene kjører hos leverandørene du har satt opp, og forespørslene sender med den konteksten oppgaven trenger. Appen henter emneinformasjon fra NTNUs emnesider. Research på nettet og diktering kontakter også eksterne tjenester. Lokal lagring betyr ikke at alt behandles uten nett.
- **Innsyn.** System-promptene er synlige og kan redigeres, og kildekoden er åpen.

## Utvikling

Se [utviklerguiden](docs/development.md) for oppsett og kontroller, [arkitekturen](docs/architecture.md) for hvordan appen er bygd opp, [tastaturreferansen](docs/keyboard.md) for snarveier og [guiden for skrivebordsutgivelser](docs/desktop-release.md) for pakking og oppdateringer. Utviklerdokumentasjonen under `docs/` er på engelsk og beskriver i hovedsak originalprosjektet.

## Bygger på LearnHarness

Dette prosjektet er en videreutvikling av **[LearnHarness](https://github.com/amosblomqvist/learnharness)**, laget av **Amos Blomqvist**. Læringsmetodikken, agentene, kunnskapskartet, skrivebordsappen og det aller meste av koden er hans arbeid. Nettsiden til originalprosjektet er [learnharness.ai](https://learnharness.ai).

Denne versjonen legger til fag med fagkode og kontekst fra NTNU, eksamensmodus med kartlegging og fargekodet plan, hjelpesenteret og norsk språk i appen. Den er ikke en offisiell utgave av LearnHarness og er ikke tilknyttet NTNU.

Feil og ønsker som gjelder originalappen, hører hjemme i [GitHub Issues](https://github.com/amosblomqvist/learnharness/issues) hos originalprosjektet.

## Lisens

[AGPL-3.0](LICENSE), samme lisens som originalprosjektet. Endringene i denne versjonen er lisensiert på samme vilkår.
