/**
 * Help centre content (NTNU round): the questions and answers. Pure data.
 *
 * House rules for this file:
 * - Everything must be TRUE for the shipped app. When unsure about a detail,
 *   describe the behaviour in general terms instead of inventing a button.
 * - Short, concrete, «du»-form. Steps where there is something to do.
 * - Ids are stable slugs: they are the deep links (`/hjelp#<id>`).
 */

import type { HelpArticle, HelpCategory } from "./types.ts";

export const HELP_CATEGORIES: readonly HelpCategory[] = [
	{ id: "komme-i-gang", title: "Komme i gang", blurb: "Hva appen er, og hvordan du starter." },
	{ id: "fag-og-kontekst", title: "Fag og kontekst", blurb: "Legg til fag og gi appen materialet ditt." },
	{ id: "eksamensmodus", title: "Eksamensmodus og planen", blurb: "Kartlegging, farger og plan fram til eksamen." },
	{ id: "okter", title: "Økter og fag-chat", blurb: "Fag-chatten, underchatter og hvordan en økt fungerer." },
	{ id: "sporsmal", title: "Spørsmål i økta", blurb: "Hopp over, spør agenten, «Vet ikke» og forklaringer." },
	{ id: "kunnskapskart", title: "Kunnskapskartet", blurb: "Det du har lært, samlet på ett sted." },
	{ id: "modeller", title: "Modeller, nøkler og kostnad", blurb: "Koble til AI-modeller og hold oversikt over pris." },
	{ id: "personvern", title: "Personvern og data", blurb: "Hvor dataene dine ligger, og hva som sendes ut." },
	{ id: "feilsoking", title: "Feilsøking", blurb: "Når noe ikke virker." },
];

export const HELP_ARTICLES: readonly HelpArticle[] = [
	// ── Komme i gang ────────────────────────────────────────────────────────
	{
		id: "hva-er-learnharness",
		category: "komme-i-gang",
		question: "Hva er Eksamenshjelp?",
		answer: [
			"Eksamenshjelp er et verktøy som hjelper deg å lese til eksamen. Du legger til fagene dine, appen finner ut hva du kan og ikke kan, og lager en plan fram til eksamensdagen.",
			"Selve læringen skjer i økter. Der forklarer en AI-agent stoffet steg for steg, stiller deg spørsmål og gir deg oppgaver, tilpasset det du faktisk kan.",
		],
		keywords: ["hva er", "om appen", "eksamenshjelp", "learnharness", "formål", "hvordan virker", "ntnu", "eksamen"],
		actions: [{ label: "Ta omvisningen", action: { kind: "tour", id: "kom-i-gang" } }],
	},
	{
		id: "hvordan-starte",
		category: "komme-i-gang",
		question: "Hvordan kommer jeg i gang?",
		answer: [
			"Du trenger to ting: en AI som er koblet til, og minst ett fag. Innføringen tar deg gjennom alt, ett steg om gangen.",
		],
		steps: [
			"Koble til Claude eller ChatGPT.",
			"Legg til fagene dine. Har du en mappe for faget i fagmappen (Dokumenter/Eksamenshjelp), kommer faget inn av seg selv.",
			"Legg tidligere eksamener i fagmappen, eller la Claude Code eller Codex hente dem fra Canvas.",
			"Start første økt.",
		],
		keywords: ["komme i gang", "starte", "begynne", "første gang", "oppsett", "ny bruker", "kom i gang", "innføring", "fagmappe"],
		actions: [
			{ label: "Start innføringen", action: { kind: "onboarding" } },
			{ label: "Start veiviseren «Kom i gang»", action: { kind: "tour", id: "kom-i-gang" } },
			{ label: "Sett opp modeller", action: { kind: "tour", id: "sett-opp-modeller" } },
		],
	},
	{
		id: "koster-det-noe",
		category: "komme-i-gang",
		question: "Koster appen noe?",
		answer: [
			"Nei. Eksamenshjelp er gratis og har åpen kildekode (lisensen AGPL-3.0). Det finnes ikke noe Eksamenshjelp-abonnement og ikke noe påslag.",
			"Det som kan koste penger, er AI-modellene du velger å bruke. Det betaler du i så fall direkte til leverandøren, for eksempel gjennom en API-nøkkel eller et abonnement du allerede har.",
		],
		keywords: ["pris", "gratis", "koster", "betale", "abonnement", "open source", "åpen kildekode", "agpl", "lisens"],
		actions: [{ label: "Les om kostnad for modeller", action: { kind: "article", id: "hva-koster-modellene" } }],
	},
	{
		id: "trenger-jeg-konto",
		category: "komme-i-gang",
		question: "Må jeg lage en konto eller logge inn?",
		answer: [
			"Nei. Appen har ingen Eksamenshjelp-konto og ingen innlogging. Du logger heller ikke inn med NTNU-brukeren din.",
			"Det eneste du kobler til, er AI-leverandøren du vil bruke. Det gjør du i innstillingene.",
		],
		keywords: ["konto", "logge inn", "innlogging", "bruker", "feide", "registrere", "passord", "login"],
		actions: [{ label: "Åpne «Koble til AI»", action: { kind: "settings", section: "keys" } }],
	},
	{
		id: "finne-funksjoner",
		category: "komme-i-gang",
		question: "Hvordan finner jeg en funksjon raskt?",
		answer: [
			"Bruk søket. Trykk Ctrl+P (⌘P på Mac), eller søkeknappen i sidemenyen, og skriv det du leter etter. Søket finner funksjoner, spørsmål og svar, veivisere, fagene dine og øktene dine.",
			"Du kan skrive helt vanlige ord, for eksempel «mørk modus», «nøkkel» eller «eksamen».",
		],
		keywords: ["søk", "søke", "finne", "funksjon", "søkemotor", "palett", "kommando", "ctrl p", "hurtigsøk"],
	},
	{
		id: "hurtigtaster",
		category: "komme-i-gang",
		question: "Hvilke hurtigtaster finnes?",
		answer: [
			"Trykk ? når du ikke står i et tekstfelt, så får du en oversikt over alle hurtigtastene. F1 åpner hjelpesenteret, og Ctrl+P (⌘P på Mac) åpner søket.",
			"Du kan bytte ut hurtigtastene med dine egne under «Tastatur» i innstillingene.",
		],
		keywords: ["hurtigtaster", "hurtigtast", "snarvei", "snarveier", "tastatur", "shortcut", "keyboard", "f1"],
		actions: [
			{ label: "Vis snarveioversikten", action: { kind: "shortcut", action: "cheat-sheet" } },
			{ label: "Endre hurtigtaster", action: { kind: "settings", section: "keyboard" } },
		],
	},

	// ── Fag og kontekst ─────────────────────────────────────────────────────
	{
		id: "legge-til-fag",
		category: "fag-og-kontekst",
		question: "Hvordan legger jeg til et fag?",
		answer: ["Du legger til fag fra Hjem. Appen henter informasjonen om faget fra NTNUs åpne emnesider."],
		steps: [
			"Gå til Hjem.",
			"Trykk «Legg til fag».",
			"Søk på fagkode eller navn, for eksempel TTK4100.",
			"Velg faget i lista.",
		],
		keywords: ["legge til fag", "nytt fag", "fagkode", "emne", "emnekode", "kurs", "ntnu"],
		actions: [
			{
				label: "Vis meg knappen",
				action: {
					kind: "point",
					route: "/",
					anchor: "add-course",
					title: "Legg til fag",
					text: "Trykk her og søk på fagkode eller navn, for eksempel TTK4100.",
				},
			},
		],
	},
	{
		id: "finner-ikke-faget",
		category: "fag-og-kontekst",
		question: "Appen finner ikke faget mitt. Hva gjør jeg?",
		answer: [
			"Sjekk først at fagkoden er skrevet riktig. Finnes ikke faget på NTNUs emnesider, kan du legge det inn manuelt med fagkode og navn.",
			"Et manuelt fag har ingen informasjon fra NTNU, så legg inn eksamensdatoen selv, og legg gjerne til egen kontekst slik at appen har noe å jobbe med.",
		],
		keywords: ["finner ikke", "ukjent fag", "manuelt", "egendefinert", "ikke funnet", "annet universitet", "fag mangler"],
		actions: [{ label: "Slik legger du inn egen kontekst", action: { kind: "tour", id: "egen-kontekst" } }],
	},
	{
		id: "hva-hentes-fra-ntnu",
		category: "fag-og-kontekst",
		question: "Hva henter appen selv om faget?",
		answer: [
			"Appen leser NTNUs åpne emneside for faget: navn, studiepoeng, faglig innhold, læringsutbytte og opplysninger om eksamen, som dato og eksamensform når NTNU har lagt det ut.",
			"Appen henter ikke noe som krever innlogging. Forelesningsnotater, øvinger og tidligere eksamener må du legge inn selv.",
		],
		keywords: ["ntnu", "emneside", "henter", "automatisk", "læringsutbytte", "faglig innhold", "eksamensdato", "emnebeskrivelse"],
	},
	{
		id: "hva-er-kontekst",
		category: "fag-og-kontekst",
		question: "Hva er kontekst, og hvorfor bør jeg legge inn noe?",
		answer: [
			"Kontekst er materialet appen leser når den lager temaer, forklarer og lager oppgaver. Jo mer relevant materiale, jo mer treffer hjelpen faget slik det faktisk undervises.",
			"Det viktigste du kan legge inn, er tidligere eksamener. Da kan oppgavene ligne på det du får til eksamen.",
		],
		keywords: ["kontekst", "materiale", "pensum", "kilder", "hvorfor", "tidligere eksamener", "notater"],
		actions: [{ label: "Start veiviseren «Legg inn egen kontekst»", action: { kind: "tour", id: "egen-kontekst" } }],
	},
	{
		id: "legge-inn-filer",
		category: "fag-og-kontekst",
		question: "Hvordan legger jeg inn filer, notater og lenker?",
		answer: ["Alt dette gjør du under «Kilder» nederst på fagsiden."],
		steps: [
			"Åpne faget og klikk på «Kilder» nederst på siden.",
			"Dra inn en mappe eller enkeltfiler.",
			"Lim inn tekst som et notat hvis du har noe som ikke ligger i en fil.",
			"Legg til lenker til åpne nettsider som hører til faget.",
		],
		keywords: ["filer", "mappe", "dra inn", "last opp", "notat", "lenke", "url", "pdf", "kontekst", "legge inn"],
		actions: [{ label: "Vis meg hvordan", action: { kind: "tour", id: "egen-kontekst" } }],
	},
	{
		id: "canvas-og-blackboard",
		category: "fag-og-kontekst",
		question: "Kan appen hente tidligere eksamener fra Canvas eller Blackboard?",
		answer: [
			"Nei, appen kan ikke logge inn i Canvas eller Blackboard. Last ned filene og dra dem inn under «Kilder» på fagsiden, gjerne som én mappe.",
		],
		keywords: ["canvas", "blackboard", "tidligere eksamener", "eksamenssett", "gamle eksamener", "logge inn", "laste ned", "inspera"],
		actions: [{ label: "Vis meg hvordan", action: { kind: "tour", id: "egen-kontekst" } }],
	},
	{
		id: "slette-fag",
		category: "fag-og-kontekst",
		question: "Hva skjer hvis jeg sletter et fag?",
		answer: [
			"Faget forsvinner fra Hjem sammen med temaene, planen og kontekstlista. Øktene du har hatt i faget, blir liggende, så du mister ikke det du har jobbet med.",
			"Filene dine på maskinen blir ikke rørt. Appen har bare husket hvor de ligger.",
		],
		keywords: ["slette fag", "fjerne fag", "slett", "angre", "mister"],
	},

	// ── Eksamensmodus og planen ─────────────────────────────────────────────
	{
		id: "hva-er-eksamensmodus",
		category: "eksamensmodus",
		question: "Hva er eksamensmodus?",
		answer: [
			"Eksamensmodus er måten appen hjelper deg fram til eksamen på: den deler faget i temaer, finner ut hva du kan i hvert tema, og lager en plan for dagene som er igjen.",
			"Du finner alt på fagsiden: øverst en oppsummering, nederst «Alle temaer», «Eksamensplan» og «Kilder».",
		],
		keywords: ["eksamensmodus", "eksamen", "plan", "eksamenslesing", "lese til eksamen", "hvordan virker"],
		actions: [{ label: "Start veiviseren «Eksamensmodus»", action: { kind: "tour", id: "eksamensmodus" } }],
	},
	{
		id: "fargene",
		category: "eksamensmodus",
		question: "Hva betyr fargene på temaene?",
		answer: [
			"Fargen viser hvor godt du kan temaet:",
			"Grå: Ikke kartlagt. Appen vet ikke ennå hva du kan.",
			"Rød: Kan ikke ennå. Dette må du lære.",
			"Gul: Usikker. Du kan noe, men trenger mer øving.",
			"Grønn: Kan dette.",
			"Fargen står alltid sammen med tekst, så du trenger ikke å skille fargene fra hverandre for å lese statusen.",
		],
		keywords: ["farger", "farge", "rød", "gul", "grønn", "grå", "status", "ikke kartlagt", "kan ikke ennå", "usikker", "kan dette", "betyr"],
	},
	{
		id: "kartlegging",
		category: "eksamensmodus",
		question: "Hvordan kartlegger jeg hva jeg kan?",
		answer: [
			"Den raske måten: sett fargen selv på hvert tema under «Alle temaer». Den grundige: be fag-chatten teste deg. Agenten stiller spørsmål på tvers av temaene og setter fargene ut fra svarene dine.",
			"Fargene oppdateres også av seg selv når du jobber i fag-chatten og underchattene, og når du avslutter en økt.",
		],
		keywords: ["kartlegge", "kartlegging", "nivå", "hva kan jeg", "teste", "sette status", "sette farge"],
		actions: [{ label: "Vis meg på fagsiden", action: { kind: "tour", id: "eksamensmodus" } }],
	},
	{
		id: "hvordan-lages-planen",
		category: "eksamensmodus",
		question: "Hvordan lages eksamensplanen?",
		answer: [
			"Planen regnes ut fra tre ting: eksamensdatoen, fargene på temaene og hvor mye tid du har satt av per dag. Temaer du ikke kan, og temaer som er viktige til eksamen, får mest plass.",
			"Planen regnes ut på nytt når noe endrer seg, for eksempel når et tema går fra rødt til grønt.",
		],
		keywords: ["plan", "eksamensplan", "hvordan lages", "regnes ut", "prioritering", "dag for dag", "tidsplan"],
	},
	{
		id: "eksamensplan-eller-eksamensokt",
		category: "eksamensmodus",
		question: "Hva er forskjellen på eksamensplanen og fag-chatten?",
		answer: [
			"Eksamensplanen står på fagsiden. Den viser hva du bør gjøre hver dag, regnet ut fra fargene på temaene, eksamensdatoen og tiden du har per dag.",
			"Fag-chatten er der du jobber. Agenten kartlegger pensum fra tidligere eksamener, finner ut hva du kan, og lager et eksamenskart med én kolonne per emne. Hver boks får farge etter hvert: grå «Ikke kartlagt», rød «Kan ikke ennå», gul «Usikker» og grønn «Kan dette». En boks blir først grønn når du har løst en eksamensoppgave om den med full utregning.",
		],
		steps: [
			"Legg gjerne tidligere eksamener inn under «Kilder» på fagsiden først. Da bruker agenten dem som grunnlag for pensum.",
			"Trykk på faget i sidemenyen. Da åpnes fag-chatten.",
		],
		keywords: ["eksamensøkt", "eksamenskart", "fargekart", "forskjell", "eksamensplan", "emner", "kolonner", "pensum", "tidligere eksamener", "grønn", "plan_status", "fag-chat"],
	},
	{
		id: "endre-eksamensdato",
		category: "eksamensmodus",
		question: "Eksamensdatoen er feil eller mangler. Hvordan retter jeg den?",
		answer: [
			"Åpne faget og rett datoen i feltet for eksamensdato. Datoen du setter selv, gjelder foran den som hentes fra NTNU, og blir ikke overskrevet om fagdataene hentes på nytt.",
		],
		keywords: ["eksamensdato", "dato", "feil dato", "endre dato", "mangler dato", "konte", "utsatt eksamen"],
	},
	{
		id: "tid-per-dag",
		category: "eksamensmodus",
		question: "Kan jeg bestemme hvor mye jeg skal jobbe hver dag?",
		answer: [
			"Ja. Hvert fag har et antall minutter per dag som planen fordeles etter. Standard er to timer. Endrer du tallet, regnes planen ut på nytt.",
		],
		keywords: ["minutter per dag", "tid per dag", "timer", "arbeidsmengde", "hvor mye", "lesetid"],
	},
	{
		id: "bak-planen",
		category: "eksamensmodus",
		question: "Jeg har havnet bak planen. Hva nå?",
		answer: [
			"Det gjør ingenting. Planen tar utgangspunkt i dagen i dag og det du faktisk kan, ikke i hva du skulle ha rukket. Huk av det du har gjort, oppdater fargene på temaene hvis de har endret seg, og fortsett med dagens punkter.",
		],
		keywords: ["bak planen", "henger etter", "rekker ikke", "forsinket", "dårlig tid", "stress"],
	},
	{
		id: "temalista",
		category: "eksamensmodus",
		question: "Hvor kommer temaene fra, og kan jeg endre dem?",
		answer: [
			"Appen lager temalista ut fra emnebeskrivelsen og konteksten din. Har du koblet til en modell, bruker den AI til det. Uten modell lager den en enklere liste ut fra læringsutbyttet.",
			"Du kan endre lista selv under «Alle temaer», og du kan lage den på nytt når du har lagt inn mer kontekst. Temaer som beholdes, beholder fargen sin.",
		],
		keywords: ["temaer", "temaliste", "endre tema", "nytt tema", "lage temaer", "generere", "pensum"],
	},

	// ── Økter: lære og øve ──────────────────────────────────────────────────
	{
		id: "legg-inn-besvarelse",
		category: "okter",
		question: "Hvordan får jeg håndskrevne utregninger inn i økta?",
		answer: [
			"Med «Legg inn besvarelse» gir du agenten utregningen din som fil: en PDF eller et bilde, gjerne flere på en gang. Agenten leser filene selv, side for side, og ser håndskrift og figurer som bilder. Modellen du bruker i økta, må da kunne lese bilder.",
			"Filene blir liggende der de er. Skrivefeltet får en lenke til hver fil, og du sender selv. Et skjermbilde du limer inn, lagres i appens datamappe.",
		],
		steps: [
			"Åpne en økt, eller svar på en oppgave fra agenten.",
			"Trykk på «Legg inn besvarelse» ved skrivefeltet eller svarfeltet, og velg filene. Du kan også dra filene inn i økta eller lime inn et skjermbilde (Cmd+V).",
			"Skriv gjerne noen ord til, og send.",
		],
		keywords: ["besvarelse", "legg inn", "last opp", "pdf", "bilde", "skjermbilde", "screenshot", "håndskrift", "håndskrevet", "utregning", "lim inn", "skann"],
	},
	{
		id: "hva-er-en-okt",
		category: "okter",
		question: "Hva er en økt?",
		answer: [
			"En økt er en samtale med AI-agenten. Agenten finner først ut hva du kan fra før, legger en plan, og tar deg gjennom stoffet. Underveis får du spørsmål som viser om du har forstått.",
			"Øktene lagres, så du kan fortsette der du slapp. I sidemenyen ligger de under faget sitt, og økter uten fag under «Uten fag».",
		],
		keywords: ["økt", "økter", "læringsøkt", "samtale", "chat", "hvordan virker", "session"],
	},
	{
		id: "fag-chat-og-underchats",
		category: "okter",
		question: "Hva er fag-chatten og underchattene?",
		answer: [
			"Hvert fag har én chat: fag-chatten. Der både lærer du og øver. Agenten forklarer når du trenger det, og gir deg eksamensoppgaver når du er klar.",
			"Vil du dele opp, kan du lage underchatter i faget, for eksempel én per tema. De kjenner faget og fargene på temaene like godt, men eksamenskartet hører til fag-chatten.",
			"Lær og Øv finnes ikke lenger som egne valg. Gamle økter fra et fag ligger som underchatter under faget.",
		],
		steps: [
			"Trykk på faget i sidemenyen for å åpne fag-chatten.",
			"For en underchat: hold over faget og trykk «+», eller velg «Ny underchat» i menyen ved fagkoden øverst i fag-chatten.",
		],
		keywords: ["fag-chat", "underchat", "underchatter", "lær", "øv", "lære", "øve", "forskjell", "læringsøkt", "øvingsøkt", "oppgaver", "dele opp", "teach", "practice"],
	},
	{
		id: "starte-okt",
		category: "okter",
		question: "Hvordan starter jeg en økt?",
		answer: [
			"I et fag: trykk på faget i sidemenyen, så åpnes fag-chatten. Du kan også skrive i feltet nederst på fagsiden, så havner meldingen i fag-chatten.",
			"Uten fag: skriv hva du vil forstå i start-boksen på Hjem. Økta havner under «Uten fag» i sidemenyen. Høyreklikk den og velg «Flytt til fag …» hvis den hører til et fag likevel.",
		],
		keywords: ["starte økt", "ny økt", "begynne", "start-boks", "fri økt", "flytt til fag", "uten fag"],
		actions: [{ label: "Ny fri økt", action: { kind: "route", href: "/chat/new" } }],
	},
	{
		id: "tenk-hoyt",
		category: "okter",
		question: "Hva er feltet «Tenk høyt» til?",
		answer: [
			"Der skriver du hvordan du tenker: hva du er usikker på, hvorfor du valgte et svar, eller hva som ikke gir mening. Det gir agenten et mye bedre bilde av deg enn bare riktig og galt, og forklaringene blir mer treffsikre.",
			"Du trenger ikke å formulere deg pent. Stikkord holder.",
		],
		keywords: ["tenk høyt", "tankegang", "tenke", "tankefelt", "begrunnelse", "thinking"],
	},
	{
		id: "diktering",
		category: "okter",
		question: "Kan jeg snakke i stedet for å skrive?",
		answer: [
			"Ja, med diktering. Du trenger en egen nøkkel fra Deepgram, som du legger inn under «Koble til AI» i innstillingene (under «Avansert»). Der velger du også språk.",
			"Slå diktering av og på med Ctrl+D (⌘D på Mac). Esc avbryter dikteringen og forkaster det som ikke er satt inn ennå.",
		],
		keywords: ["diktering", "diktere", "snakke", "tale", "mikrofon", "stemme", "deepgram", "tale til tekst"],
		actions: [{ label: "Sett opp diktering", action: { kind: "settings", section: "keys", row: "DEEPGRAM_API_KEY" } }],
	},
	{
		id: "finne-tidligere-okter",
		category: "okter",
		question: "Hvordan finner jeg igjen en tidligere økt?",
		answer: [
			"Øktene ligger i sidemenyen, under faget sitt eller under «Uten fag». «Søk i appen» med Ctrl+P (⌘P på Mac) finner også økter.",
			"Inne i en økt søker du i teksten med Ctrl+F (⌘F på Mac).",
		],
		keywords: ["tidligere økter", "finne økt", "historikk", "søk i økter", "gamle økter", "fortsette"],
		actions: [{ label: "Søk i appen", action: { kind: "shortcut", action: "open-search" } }],
	},
	{
		id: "bakgrunnsagenter",
		category: "okter",
		question: "Hva gjør agenten i bakgrunnen?",
		answer: [
			"Mens du jobber, kan agenten sette i gang hjelpere som undersøker et spørsmål, lager en visualisering eller bygger en liten interaktiv demo. Resultatet dukker opp i økta når det er klart.",
			"Nettsøk i bakgrunnen krever at du har lagt inn en nøkkel fra Tavily eller Brave Search.",
		],
		keywords: ["bakgrunn", "bakgrunnsagenter", "research", "demo", "visualisering", "nettsøk", "websøk", "figur"],
		actions: [{ label: "Sett opp nettsøk", action: { kind: "settings", section: "keys", row: "TAVILY_API_KEY" } }],
	},

	// ── Spørsmål i økta ─────────────────────────────────────────────────────
	{
		id: "hopp-over",
		category: "sporsmal",
		question: "Hva skjer når jeg trykker «Hopp over»?",
		answer: [
			"Spørsmålet legges bort, og økta går videre. Et spørsmål du hopper over, teller ikke, verken som riktig eller galt.",
			"Bruk det når spørsmålet ikke passer akkurat nå. Vet du rett og slett ikke svaret, er «Vet ikke» et bedre valg, for da lærer agenten noe om hva du trenger.",
		],
		keywords: ["hopp over", "hoppe over", "skip", "droppe spørsmål", "neste spørsmål"],
		actions: [{ label: "Start veiviseren «Spørsmål i økta»", action: { kind: "tour", id: "sporsmal-i-okta" } }],
	},
	{
		id: "spor-agenten",
		category: "sporsmal",
		question: "Jeg skjønner ikke spørsmålet. Kan jeg spørre tilbake?",
		answer: [
			"Ja. Trykk «Spør agenten». Da settes spørsmålet på vent, og du får skrivefeltet tilbake. Agenten svarer på det du lurer på uten å røpe fasiten, og stiller spørsmålet på nytt etterpå.",
		],
		keywords: ["spør agenten", "spørre tilbake", "skjønner ikke", "forstår ikke spørsmålet", "oppklaring", "på vent", "uklart"],
		actions: [{ label: "Start veiviseren «Spørsmål i økta»", action: { kind: "tour", id: "sporsmal-i-okta" } }],
	},
	{
		id: "vet-ikke",
		category: "sporsmal",
		question: "Er det dumt å svare «Vet ikke»?",
		answer: [
			"Nei, tvert imot. «Vet ikke» er et ærlig svar som hjelper agenten å starte på riktig sted. Gjetter du riktig, kan agenten tro at du kan noe du ikke kan, og bygge videre på et hull.",
		],
		keywords: ["vet ikke", "gjette", "kan ikke svaret", "usikker", "i don't know"],
	},
	{
		id: "forklaringskravet",
		category: "sporsmal",
		question: "Hvorfor må jeg forklare svaret på flervalgsspørsmål?",
		answer: [
			"Fordi et riktig kryss ikke viser at du forstår. På flervalgsspørsmål skriver du en kort forklaring på hvorfor du valgte svaret, og svaret blir bare godkjent når forklaringen holder.",
			"Forklaringen trenger ikke å være lang. Én eller to setninger med din egen begrunnelse er nok. Velger du «Vet ikke», trenger du ingen forklaring.",
		],
		keywords: ["forklare", "forklaring", "flervalg", "godkjent", "begrunnelse", "påkrevd", "hvorfor må jeg", "multiple choice"],
		actions: [{ label: "Start veiviseren «Spørsmål i økta»", action: { kind: "tour", id: "sporsmal-i-okta" } }],
	},
	{
		id: "godkjenning-av-tema",
		category: "sporsmal",
		question: "Når får jeg flervalg, og når må jeg skrive svaret selv?",
		answer: [
			"Underveis får du flervalg med en kort forklaring. Når et tema skal godkjennes, løser du en oppgave med egne ord.",
			"Den oppgaven er merket «Godkjenning». Du skriver hele løsningen slik du ville gjort på eksamen, og agenten vurderer den mot fasiten den skrev ned på forhånd. Holder den ikke, jobber dere videre med temaet før du får en ny.",
			"Kartleggingen bruker bare flervalg. Dette er fast og kan ikke endres i innstillingene.",
		],
		keywords: ["godkjenning", "godkjenne", "godkjent", "egne ord", "fritekst", "fri gjenkalling", "flervalg", "spørsmålsform", "skrive selv", "tema", "grønn"],
		actions: [{ label: "Start veiviseren «Spørsmål i økta»", action: { kind: "tour", id: "sporsmal-i-okta" } }],
	},
	{
		id: "sikkerhet",
		category: "sporsmal",
		question: "Hva brukes «sikkerhet» til når jeg svarer?",
		answer: [
			"På noen spørsmål angir du hvor sikker du er på svaret. Agenten ser både svaret og hvor sikker du var, så den kan skille det du virkelig kan fra det du traff på flaks.",
		],
		keywords: ["sikkerhet", "hvor sikker", "konfidens", "confidence", "skala"],
	},
	{
		id: "tastatur-i-sporsmal",
		category: "sporsmal",
		question: "Kan jeg svare på spørsmål med tastaturet?",
		answer: [
			"Ja. Piltastene opp og ned flytter mellom svarene, mellomrom velger, og Enter sender inn. Tab bytter mellom svarene og tankefeltet. Venstre og høyre pil justerer hvor sikker du er.",
		],
		keywords: ["tastatur", "piltaster", "enter", "mellomrom", "svare", "hurtigtaster", "tab"],
	},

	// ── Kunnskapskartet ─────────────────────────────────────────────────────
	{
		id: "hva-er-kunnskapskartet",
		category: "kunnskapskart",
		question: "Hva er kunnskapskartet?",
		answer: [
			"Kunnskapskartet samler det du har lært i øktene: enkeltpåstander og resonnementskjedene som knytter dem sammen, med lenke tilbake til økta de kom fra.",
			"Fargene viser fag, og hver klynge er et tema i faget. En strek betyr at det ene følger av det andre. Under Kilder ser du alt ordnet etter kilden det kom fra.",
			"Kartet lagrer ideene og sammenhengene, ikke karakterer på deg. Nye økter kan bygge videre på det i stedet for å starte fra null.",
		],
		keywords: ["kunnskapskart", "kart", "graf", "påstander", "kilder", "resonnementskjede", "noder", "fag", "tema", "knowledge graph"],
		actions: [{ label: "Åpne kunnskapskartet", action: { kind: "route", href: "/kart" } }],
	},
	{
		id: "hvordan-bygges-kartet",
		category: "kunnskapskart",
		question: "Hvordan fylles kartet?",
		answer: [
			"På to måter: av seg selv fra det du lærer i øktene, og fra notater du importerer. Du trenger ikke å tegne noe selv.",
		],
		keywords: ["bygges", "fylles", "automatisk", "uttrekk", "hvordan lages kartet"],
	},
	{
		id: "importere-notater",
		category: "kunnskapskart",
		question: "Hvordan importerer jeg egne notater i kartet?",
		answer: [
			"Åpne kunnskapskartet og velg å importere notater. Du kan importere tekstfiler, Markdown-filer og PDF-er. Appen trekker ut påstandene og sammenhengene og legger dem i kartet.",
			"Importen bruker AI-modellene dine, så store dokumenter tar litt tid og kan koste noe hos leverandøren.",
		],
		keywords: ["importere notater", "importer", "notater", "pdf", "markdown", "tekstfil", "uttrekk", "last opp"],
		actions: [{ label: "Åpne kunnskapskartet", action: { kind: "route", href: "/kart" } }],
	},
	{
		id: "kart-eller-kontekst",
		category: "kunnskapskart",
		question: "Hva er forskjellen på kontekst i et fag og notater i kartet?",
		answer: [
			"Kontekst i et fag er råmateriale: filer, notater og lenker som agenten kan slå opp i når den hjelper deg med faget.",
			"Kunnskapskartet er det du selv har lært eller importert, brutt ned i påstander og sammenhenger. Det følger deg på tvers av fag og økter.",
		],
		keywords: ["forskjell", "kontekst", "kart", "notater", "hvor legger jeg"],
	},

	// ── Modeller, nøkler og kostnad ─────────────────────────────────────────
	{
		id: "hvorfor-egne-modeller",
		category: "modeller",
		question: "Hvorfor må jeg koble til en modell selv?",
		answer: [
			"Appen har ingen egen AI-tjeneste. Den bruker modellene du kobler til, og du betaler leverandøren direkte hvis det koster noe. Slik kan appen være gratis, og du velger selv hvilken modell du stoler på.",
		],
		keywords: ["hvorfor", "egen modell", "byok", "koble til", "leverandør", "api-nøkkel"],
		actions: [{ label: "Start veiviseren «Sett opp modeller»", action: { kind: "tour", id: "sett-opp-modeller" } }],
	},
	{
		id: "koble-til-modell",
		category: "modeller",
		question: "Hvilke måter kan jeg koble til en modell på?",
		answer: [
			"Det finnes fire måter. Du trenger bare én:",
			"API-nøkkel: lim inn en nøkkel fra en leverandør, for eksempel Anthropic, OpenAI eller Google.",
			"Abonnement: koble til et abonnement som støttes. Dette finnes i skrivebordsappen.",
			"Claude Code: har du Claude Code installert på maskinen, kan appen bruke det.",
			"Egen adresse: pek på en OpenAI-kompatibel adresse, for eksempel en modell som kjører lokalt på maskinen din.",
		],
		keywords: [
			"koble til", "api-nøkkel", "nøkkel", "abonnement", "claude code", "cli", "lokal modell", "openai-kompatibel", "endepunkt",
			"ollama", "anthropic", "openai", "google", "chatgpt",
		],
		actions: [
			{ label: "Åpne «Koble til AI»", action: { kind: "settings", section: "keys" } },
			{ label: "Vis meg hvordan", action: { kind: "tour", id: "sett-opp-modeller" } },
		],
	},
	{
		id: "sterk-rimelig-bilde",
		category: "modeller",
		question: "Hva betyr «Kraftig modell», «Rask og billig modell» og «Modell som ser bilder»?",
		answer: [
			"Det er de tre modellene appen bruker:",
			"Kraftig modell: brukes av Læreren, den du snakker med i chatten, og Kartleggeren, som finner ut hva du allerede kan. Velg den beste modellen du har tilgang til.",
			"Rask og billig modell: brukes av Kildesøk, Demo-lageren, Notatskriveren og Kvalitetskontrollen, som jobber i bakgrunnen. En billigere og raskere modell passer godt.",
			"Modell som ser bilder: brukes av Figurtegneren og PDF-leseren. Den må kunne lese bilder.",
			"Alle tre må være valgt før du kan starte økter.",
		],
		keywords: ["sterk", "rimelig", "bilde", "kraftig", "rask", "billig", "ser bilder", "modellplass", "slots", "hvilken modell", "velge modell", "strong", "cheap", "vision", "læreren", "kartleggeren", "kildesøk", "notatskriveren"],
		actions: [{ label: "Velg modeller", action: { kind: "settings", section: "agent" } }],
	},
	{
		id: "hva-koster-modellene",
		category: "modeller",
		question: "Hva koster det å bruke modellene?",
		answer: [
			"Det kommer an på leverandøren og modellen. Med API-nøkkel betaler du for det du bruker. Med abonnement eller Claude Code gjelder vilkårene og grensene i avtalen din. En lokal modell koster ingenting utover strøm.",
			"I en økt ser du et anslag på hva økta har kostet. Anslaget gjelder API-bruk med kjente priser. Bruk gjennom abonnement, Claude Code eller egen adresse er ikke med i anslaget.",
		],
		keywords: ["kostnad", "pris", "koster", "dyrt", "forbruk", "regning", "tokens", "kostnadsmåler", "billig"],
	},
	{
		id: "bytte-modell-i-okt",
		category: "modeller",
		question: "Kan jeg bytte modell midt i en økt?",
		answer: [
			"Ja. Åpne modellvelgeren i økta med Ctrl+K (⌘K på Mac) og velg en annen modell. Valget gjelder bare den økta. Med Shift+Tab bytter du hvor mye modellen skal tenke før den svarer.",
		],
		keywords: ["bytte modell", "modellvelger", "tenkenivå", "annen modell", "ctrl k", "thinking level"],
	},
	{
		id: "nokler-lagring",
		category: "modeller",
		question: "Hvor lagres API-nøklene mine?",
		answer: [
			"Nøklene lagres lokalt på maskinen din. De sendes bare til tjenesten de hører til, når appen bruker den.",
		],
		keywords: ["nøkler", "api-nøkkel", "lagres", "sikkerhet", "trygt", "hvor ligger"],
	},

	// ── Personvern og data ──────────────────────────────────────────────────
	{
		id: "hvor-lagres-data",
		category: "personvern",
		question: "Hvor lagres dataene mine?",
		answer: [
			"Alt lagres lokalt på maskinen din: fagene, øktene, kunnskapskartet, innstillingene og nøklene. Det finnes ingen Eksamenshjelp-server som tar vare på dataene dine.",
			"Det du har lært, ligger som vanlige filer du kan åpne og se på selv.",
		],
		keywords: ["lagres", "data", "lokalt", "maskinen", "sky", "server", "hvor ligger", "personvern", "gdpr"],
	},
	{
		id: "importere-fra-learnharness",
		category: "personvern",
		question: "Kan jeg ta med øktene og kunnskapskartet fra den vanlige LearnHarness-appen?",
		answer: [
			"Ja. «Importer fra LearnHarness» henter inn øktene, kunnskapskartet og, hvis du vil, innstillingene, API-nøklene og dine egne systeminstrukser fra en annen LearnHarness-mappe.",
			"Importen legger bare til. Økter og innstillinger du allerede har her, blir aldri overskrevet, og dataene i den andre mappen endres ikke. Før noe skrives, tas en sikkerhetskopi av kunnskapskartet og innstillingene dine.",
			"Alt skjer mellom to mapper på din egen maskin. Ingenting sendes ut. Har du dataene på en annen maskin, kopierer du LearnHarness-mappen over først og velger kopien.",
		],
		steps: [
			"Åpne «Importer fra LearnHarness».",
			"Velg mappen appen fant, eller lim inn stien til en annen mappe.",
			"Se over hva som blir med, og huk av det du vil ha.",
			"Trykk «Importer».",
		],
		keywords: ["importer", "overfør", "flytt", "gammel", "tidligere", "data", "økter", "noder", "kunnskapskart", "migrer", "ta med", "annen maskin", "sikkerhetskopi"],
		actions: [{ label: "Importer fra LearnHarness", action: { kind: "legacy-import" } }],
	},
	{
		id: "hva-sendes-ut",
		category: "personvern",
		question: "Hva sendes ut av maskinen min?",
		answer: [
			"Lokal lagring betyr ikke at alt skjer lokalt. Når agenten jobber, sendes det den trenger til AI-leverandøren du har valgt: det du skriver, og de delene av konteksten som er relevante for oppgaven.",
			"Bruker du diktering, sendes lyden til Deepgram. Bruker du nettsøk, sendes søkene til Tavily eller Brave Search. Fagdata hentes fra NTNUs åpne emnesider.",
			"Vil du at ingenting skal forlate maskinen, må du bruke en lokal modell og la være å bruke diktering og nettsøk.",
		],
		keywords: ["sendes", "deles", "leverandør", "personvern", "tredjepart", "deepgram", "tavily", "brave", "offline", "privat"],
	},
	{
		id: "sensitivt-materiale",
		category: "personvern",
		question: "Kan jeg legge inn materiale som ikke skal deles?",
		answer: [
			"Tenk deg om først. Filer du legger inn som kontekst, kan bli lest av agenten og sendt til AI-leverandøren du bruker. Leverandørens vilkår avgjør hva som skjer med innholdet der.",
			"Er du i tvil, la være å legge det inn, eller bruk en lokal modell.",
		],
		keywords: ["sensitivt", "fortrolig", "konfidensielt", "opphavsrett", "dele", "taushetsplikt", "privat"],
	},
	{
		id: "slette-data",
		category: "personvern",
		question: "Hvordan sletter jeg en økt?",
		answer: [
			"Høyreklikk på økta i sidemenyen og velg å slette den. Økta fjernes fra maskinen din. Det leverandøren eventuelt har lagret hos seg, styres av vilkårene deres.",
		],
		keywords: ["slette økt", "slett", "fjerne", "slette data", "angre", "høyreklikk"],
	},

	// ── Feilsøking ──────────────────────────────────────────────────────────
	{
		id: "kan-ikke-starte-okt",
		category: "feilsoking",
		question: "Jeg får ikke startet en økt. Hva er galt?",
		answer: [
			"Den vanligste årsaken er at modellene ikke er satt opp. Appen trenger en tilkoblet AI og en valgt modell for både «Kraftig modell», «Rask og billig modell» og «Modell som ser bilder».",
		],
		steps: [
			"Åpne innstillingene.",
			"Sjekk at en leverandør er koblet til under «Koble til AI».",
			"Sjekk at alle tre modellene er valgt under «Agent».",
			"Prøv å starte økta på nytt.",
		],
		keywords: ["starter ikke", "får ikke startet", "virker ikke", "ingen modell", "ikke satt opp", "feil", "blokkert"],
		actions: [
			{ label: "Åpne «Koble til AI»", action: { kind: "settings", section: "keys" } },
			{ label: "Velg modeller", action: { kind: "settings", section: "agent" } },
		],
	},
	{
		id: "modellen-svarer-ikke",
		category: "feilsoking",
		question: "Modellen svarer ikke eller gir en feilmelding.",
		answer: [
			"Sjekk dette, i denne rekkefølgen: at du har nett, at nøkkelen er riktig limt inn, og at kontoen hos leverandøren har kreditt eller ikke har nådd en grense. Prøv også en annen modell for å se om feilen følger modellen.",
			"Henger et svar, kan du avbryte det med Esc og sende meldingen på nytt.",
		],
		keywords: ["svarer ikke", "feilmelding", "henger", "treg", "timeout", "ugyldig nøkkel", "kreditt", "rate limit", "kvote", "401", "429"],
		actions: [{ label: "Åpne «Koble til AI»", action: { kind: "settings", section: "keys" } }],
	},
	{
		id: "ntnu-utilgjengelig",
		category: "feilsoking",
		question: "Appen får ikke hentet faget fra NTNU.",
		answer: [
			"Da er enten nettforbindelsen din nede, eller NTNUs nettsider er utilgjengelige akkurat nå. Prøv igjen om litt.",
			"Haster det, kan du legge inn faget manuelt med fagkode og navn, og sette eksamensdatoen selv.",
		],
		keywords: ["ntnu", "henter ikke", "nettfeil", "utilgjengelig", "feil ved henting", "ingen forbindelse", "offline"],
	},
	{
		id: "diktering-virker-ikke",
		category: "feilsoking",
		question: "Dikteringen virker ikke.",
		answer: [
			"Sjekk at du har lagt inn en Deepgram-nøkkel, og at appen har lov til å bruke mikrofonen. Får du en feil om manglende tilgang (403), har nøkkelen for lav rolle hos Deepgram: den må ha rollen «Member» eller høyere.",
		],
		keywords: ["diktering", "mikrofon", "virker ikke", "deepgram", "403", "tillatelse", "ingen lyd"],
		actions: [{ label: "Åpne Deepgram-nøkkelen", action: { kind: "settings", section: "keys", row: "DEEPGRAM_API_KEY" } }],
	},
	{
		id: "veiviser-finner-ikke",
		category: "feilsoking",
		question: "Veiviseren peker ikke på noe. Hvorfor?",
		answer: [
			"Veiviserne peker på ting som finnes på skjermen. Har du for eksempel ikke lagt til et fag ennå, eller venter det ikke noe spørsmål i økta, viser veiviseren forklaringen midt på skjermen i stedet.",
			"Legg til et fag og start veiviseren på nytt for å se alt på ordentlig.",
		],
		keywords: ["veiviser", "omvisning", "peker ikke", "tom", "finner ikke", "tour"],
	},
	{
		id: "oppdatere-appen",
		category: "feilsoking",
		question: "Hvordan oppdaterer jeg appen?",
		answer: [
			"Skrivebordsappen kan oppdatere seg selv. Under «Generelt» i innstillingene ser du hvilken versjon du har, kan se etter oppdateringer og velge om de skal installeres automatisk.",
		],
		keywords: ["oppdatere", "oppdatering", "ny versjon", "versjon", "update"],
		actions: [{ label: "Åpne «Generelt»", action: { kind: "settings", section: "general" } }],
	},
	{
		id: "melde-feil",
		category: "feilsoking",
		question: "Jeg har funnet en feil. Hvor melder jeg fra?",
		answer: [
			"Appen har åpen kildekode, og feil og ønsker meldes som saker («Issues») i prosjektet på GitHub. Skriv hva du gjorde, hva du ventet skulle skje, og hva som skjedde i stedet.",
		],
		keywords: ["feil", "bug", "melde", "rapportere", "github", "issue", "ønske", "tilbakemelding", "kontakt"],
	},
];

export function findArticle(id: string): HelpArticle | undefined {
	return HELP_ARTICLES.find((article) => article.id === id);
}
