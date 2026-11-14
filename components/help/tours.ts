/**
 * The guided tours (NTNU round). Pure data: the tour engine
 * (tour-machine.ts + tour-overlay.tsx) walks these steps. Anchors are the
 * `data-tour` names from the shared contract; a step whose element is not on
 * screen (no course yet, no question waiting) shows `fallback` centred
 * instead, so a tour never dead-ends.
 */

import type { Tour } from "./types.ts";

/** Dynamic route placeholder: resolves to the learner's first course. */
export const COURSE_ROUTE = "/fag/[code]";

/** The tour offered on first launch. */
export const WELCOME_TOUR_ID = "kom-i-gang";

export const TOURS: readonly Tour[] = [
	{
		id: "kom-i-gang",
		title: "Kom i gang",
		description: "En rask omvisning: legg til fag, start en økt og finn fram i sidemenyen.",
		minutes: 1,
		keywords: ["omvisning", "start", "ny her", "intro", "første gang", "onboarding", "tour", "begynne"],
		featured: true,
		steps: [
			{
				id: "velkommen",
				route: "/",
				title: "Velkommen til LearnHarness",
				text: "Her får du en omvisning på omtrent ett minutt. Gå videre med «Neste» eller piltastene. Esc avslutter når som helst.",
			},
			{
				id: "legg-til-fag",
				route: "/",
				anchor: "add-course",
				title: "Start med å legge til et fag",
				text: "Søk på fagkode eller navn, for eksempel TTK4100. Appen henter emnebeskrivelse, læringsutbytte og eksamensdato fra NTNUs åpne emnesider.",
				fallback: "På Hjem finner du knappen «Legg til fag». Søk på fagkode eller navn, så henter appen emnebeskrivelse og eksamensdato fra NTNUs åpne emnesider.",
			},
			{
				id: "fagkort",
				route: "/",
				anchor: "course-card",
				title: "Fagene dine",
				text: "Hvert fag får et kort med dager til eksamen og en fargestripe som viser hvor mye du kan. Trykk på kortet for å åpne faget.",
				fallback: "Når du har lagt til et fag, vises det som et kort på Hjem med dager til eksamen og en fargestripe som viser hvor mye du kan.",
			},
			{
				id: "start-boks",
				route: "/",
				anchor: "home-composer",
				title: "Start en fri økt",
				text: "Vil du bare forstå noe med en gang? Skriv hva du lurer på her, så starter en økt som ikke er knyttet til et fag.",
				fallback: "Nederst på Hjem finner du start-boksen. Skriv hva du vil forstå, så starter en økt som ikke er knyttet til et fag.",
			},
			{
				id: "sidemeny-fag",
				route: "/",
				anchor: "sidebar-courses",
				needsSidebar: true,
				title: "Sidemenyen",
				text: "Fagene dine og de siste øktene ligger alltid i sidemenyen, så du kommer raskt tilbake dit du var.",
				fallback: "I sidemenyen til venstre finner du fagene dine og de siste øktene. Vis eller skjul den med Ctrl+B (⌘B på Mac).",
			},
			{
				id: "sidemeny-hjelp",
				anchor: "sidebar-help",
				needsSidebar: true,
				title: "Hjelp og søk",
				text: "Står du fast? Hjelpesenteret har svar og veivisere. Søket finner både funksjoner, fag og økter: trykk Ctrl+P (⌘P på Mac).",
				fallback: "Hjelpesenteret ligger i sidemenyen. Du kan også søke etter funksjoner, fag og økter med Ctrl+P (⌘P på Mac).",
			},
			{
				id: "sidemeny-innstillinger",
				anchor: "sidebar-settings",
				needsSidebar: true,
				title: "Innstillinger",
				text: "Her velger du modeller, legger inn API-nøkler og bytter mellom lys og mørk modus.",
				fallback: "Innstillingene åpner du fra sidemenyen eller med Ctrl+, (⌘, på Mac). Der velger du modeller, legger inn API-nøkler og bytter mellom lys og mørk modus.",
			},
			{
				id: "ferdig",
				title: "Det var alt",
				text: "Legg til ditt første fag for å komme i gang. Flere veivisere finner du i hjelpesenteret.",
			},
		],
	},
	{
		id: "eksamensmodus",
		title: "Eksamensmodus",
		description: "Fra eksamensdato til ferdig plan: kartlegg temaene og følg planen dag for dag.",
		minutes: 2,
		keywords: ["eksamen", "plan", "eksamensplan", "kartlegging", "farger", "temaer", "lese", "eksamenslesing"],
		featured: true,
		steps: [
			{
				id: "fagsiden",
				route: COURSE_ROUTE,
				title: "Fagsiden",
				text: "Dette er fagsiden. Her samles alt om ett fag: eksamensplanen, temaene og konteksten appen bruker når den hjelper deg.",
				fallback: "Hvert fag har sin egen side. Der samles eksamensplanen, temaene og konteksten appen bruker når den hjelper deg.",
			},
			{
				id: "eksamensdato",
				route: COURSE_ROUTE,
				anchor: "exam-date",
				title: "Sjekk eksamensdatoen",
				text: "Datoen hentes fra NTNU når den finnes. Stemmer den ikke, eller mangler den, retter du den her. Planen regnes ut fra denne datoen.",
				fallback: "På fagsiden står eksamensdatoen. Den hentes fra NTNU når den finnes, og du kan rette den selv. Planen regnes ut fra denne datoen.",
			},
			{
				id: "faner",
				route: COURSE_ROUTE,
				anchor: "course-tabs",
				title: "Tre faner",
				text: "«Eksamensplan» viser hva du bør gjøre hver dag. «Temaer» viser hva du kan. «Kontekst» er materialet appen bruker.",
				fallback: "Fagsiden har tre faner: «Eksamensplan» viser hva du bør gjøre hver dag, «Temaer» viser hva du kan, og «Kontekst» er materialet appen bruker.",
			},
			{
				id: "temaer",
				route: COURSE_ROUTE,
				anchor: "topic-board",
				openTab: "Temaer",
				title: "Kartlegg temaene",
				text: "Hvert tema har en farge: grå «Ikke kartlagt», rød «Kan ikke ennå», gul «Usikker» og grønn «Kan dette». Sett fargen selv, eller la appen kartlegge deg med noen spørsmål.",
				fallback: "Under «Temaer» har hvert tema en farge: grå «Ikke kartlagt», rød «Kan ikke ennå», gul «Usikker» og grønn «Kan dette». Du kan sette fargen selv eller la appen kartlegge deg med noen spørsmål.",
			},
			{
				id: "plan",
				route: COURSE_ROUTE,
				anchor: "exam-plan",
				openTab: "Eksamensplan",
				title: "Planen dag for dag",
				text: "Planen fordeler temaene på dagene fram til eksamen. Det du ikke kan og det som er viktigst til eksamen, kommer først.",
				fallback: "Under «Eksamensplan» fordeles temaene på dagene fram til eksamen. Det du ikke kan og det som er viktigst til eksamen, kommer først.",
			},
			{
				id: "start-okt",
				route: COURSE_ROUTE,
				anchor: "exam-plan",
				openTab: "Eksamensplan",
				title: "Start en økt fra planen",
				text: "Start dagens punkter rett fra planen. «Lær» går gjennom temaet steg for steg, «Øv» gir deg oppgaver. Huk av når du er ferdig, så ser du hvor langt du har kommet.",
				fallback: "Du starter økter rett fra planen. «Lær» går gjennom temaet steg for steg, «Øv» gir deg oppgaver. Huk av punktene etter hvert som du blir ferdig.",
			},
			{
				id: "eksamensokt",
				route: COURSE_ROUTE,
				anchor: "exam-session",
				openTab: "Eksamensplan",
				title: "Eller ta alt i én eksamensøkt",
				text: "En eksamensøkt er ett sammenhengende løp: agenten kartlegger hele pensum fra tidligere eksamener og følger deg tema for tema med et fargekart.",
				fallback: "Under «Eksamensplan» kan du også starte en eksamensøkt: ett sammenhengende løp der agenten kartlegger hele pensum fra tidligere eksamener og følger deg tema for tema med et fargekart.",
			},
		],
	},
	{
		id: "egen-kontekst",
		title: "Legg inn egen kontekst",
		description: "Gi appen tidligere eksamener, notater og lenker, så blir hjelpen treffsikker.",
		minutes: 1,
		keywords: ["kontekst", "filer", "mappe", "notat", "lenke", "tidligere eksamener", "pensum", "canvas", "blackboard", "pdf", "last opp"],
		featured: true,
		steps: [
			{
				id: "kontekst-fanen",
				route: COURSE_ROUTE,
				anchor: "course-tabs",
				title: "Åpne fanen «Kontekst»",
				text: "Kontekst er materialet appen leser når den lager temaer, forklarer og lager oppgaver for deg.",
				fallback: "På fagsiden finner du fanen «Kontekst». Det er materialet appen leser når den lager temaer, forklarer og lager oppgaver for deg.",
			},
			{
				id: "kilder",
				route: COURSE_ROUTE,
				anchor: "course-sources",
				openTab: "Kontekst",
				title: "Kildene til faget",
				text: "Øverst ligger det appen har hentet selv fra NTNUs emneside. Under legger du til ditt eget.",
				fallback: "Under «Kontekst» ser du det appen har hentet selv fra NTNUs emneside, og det du har lagt til selv.",
			},
			{
				id: "filer",
				route: COURSE_ROUTE,
				anchor: "course-sources",
				openTab: "Kontekst",
				title: "Dra inn mappe eller filer",
				text: "Dra inn en mappe eller enkeltfiler, for eksempel tidligere eksamener, øvinger og forelesningsnotater. Appen kan ikke logge inn i Canvas eller Blackboard, så last ned filene først.",
				fallback: "Under «Kontekst» kan du dra inn en mappe eller enkeltfiler, for eksempel tidligere eksamener. Appen kan ikke logge inn i Canvas eller Blackboard, så last ned filene først.",
			},
			{
				id: "notat",
				route: COURSE_ROUTE,
				anchor: "course-sources",
				openTab: "Kontekst",
				title: "Lim inn et notat",
				text: "Har du beskjeder fra faglærer, en pensumliste eller egne notater? Lim teksten inn som et notat.",
				fallback: "Du kan også lime inn tekst som et notat, for eksempel beskjeder fra faglærer eller en pensumliste.",
			},
			{
				id: "lenke",
				route: COURSE_ROUTE,
				anchor: "course-sources",
				openTab: "Kontekst",
				title: "Legg til en lenke",
				text: "Lenker til åpne nettsider kan også være kontekst, for eksempel en kursside eller en forelesningsplan.",
				fallback: "Lenker til åpne nettsider kan også legges til som kontekst, for eksempel en kursside eller en forelesningsplan.",
			},
		],
	},
	{
		id: "sporsmal-i-okta",
		title: "Spørsmål i økta",
		description: "Hva du kan gjøre når appen stiller deg et spørsmål: hopp over, spør tilbake eller si «Vet ikke».",
		minutes: 1,
		keywords: ["spørsmål", "hopp over", "spør agenten", "vet ikke", "forklaring", "quiz", "flervalg", "godkjent", "svar"],
		featured: true,
		steps: [
			{
				id: "intro",
				title: "Når appen spør deg",
				text: "I en økt stiller appen deg spørsmål for å finne ut hva du kan. Spørsmålet dukker opp nederst i økta. Du har alltid flere valg enn å svare.",
			},
			{
				id: "hopp-over",
				anchor: "question-skip",
				title: "Hopp over",
				text: "Passer ikke spørsmålet akkurat nå? «Hopp over» går videre. Et spørsmål du hopper over, teller verken for eller mot deg.",
				fallback: "Ved hvert spørsmål finner du «Hopp over». Da går økta videre, og spørsmålet teller verken for eller mot deg.",
			},
			{
				id: "spor-agenten",
				anchor: "question-hold",
				title: "Spør agenten",
				text: "Skjønner du ikke spørsmålet, eller trenger du en oppklaring først? «Spør agenten» setter spørsmålet på vent og åpner skrivefeltet. Spørsmålet kommer tilbake etterpå.",
				fallback: "Med «Spør agenten» setter du spørsmålet på vent og får skrivefeltet tilbake. Appen svarer uten å røpe fasiten og stiller spørsmålet på nytt etterpå.",
			},
			{
				id: "vet-ikke",
				title: "Vet ikke",
				text: "«Vet ikke» er et ærlig og nyttig svar. Appen tilpasser seg det du faktisk kan, så det er bedre å si fra enn å gjette.",
			},
			{
				id: "forklar",
				anchor: "question-explain",
				title: "Forklar for å få godkjent",
				text: "På flervalgsspørsmål må du skrive en kort forklaring på hvorfor du valgte svaret. Riktig kryss uten forklaring holder ikke, for målet er at du forstår.",
				fallback: "På flervalgsspørsmål må du skrive en kort forklaring på hvorfor du valgte svaret. Svaret blir bare godkjent når forklaringen viser at du forstår.",
			},
		],
	},
	{
		id: "sett-opp-modeller",
		title: "Sett opp modeller",
		description: "Koble til en AI-leverandør og velg hvilke modeller appen skal bruke.",
		minutes: 2,
		keywords: ["modell", "modeller", "api", "api-nøkkel", "nøkkel", "leverandør", "abonnement", "claude", "chatgpt", "openai", "lokal modell", "oppsett"],
		featured: false,
		steps: [
			{
				id: "seksjoner",
				before: { kind: "settings", section: "keys" },
				selector: '[data-testid="settings-nav"]',
				title: "Innstillingene",
				text: "Appen bruker dine egne AI-modeller. Oppsettet gjør du i to seksjoner: «Leverandører» og «Agent».",
				fallback: "Appen bruker dine egne AI-modeller. Oppsettet gjør du i innstillingene, i seksjonene «Leverandører» og «Agent».",
			},
			{
				id: "leverandor",
				before: { kind: "settings", section: "keys" },
				selector: '[data-testid="section-keys"]',
				title: "Koble til en leverandør",
				text: "Velg én måte: lim inn en API-nøkkel, koble til et abonnement (i skrivebordsappen), bruk Claude Code hvis du har det installert, eller pek på en egen OpenAI-kompatibel adresse, for eksempel en lokal modell.",
				fallback: "Under «Leverandører» kobler du til på én av fire måter: API-nøkkel, abonnement (i skrivebordsappen), Claude Code eller en egen OpenAI-kompatibel adresse, for eksempel en lokal modell.",
			},
			{
				id: "modeller",
				before: { kind: "settings", section: "agent" },
				selector: '[data-testid="section-agent"]',
				title: "Velg modeller",
				text: "Appen bruker tre modellplasser: «Sterk» er hovedmodellen i øktene, «Rimelig» gjør bakgrunnsarbeid, og «Bilde» tegner og leser PDF-er. Velg en modell for hver.",
				fallback: "Under «Agent» velger du tre modeller: «Sterk» er hovedmodellen i øktene, «Rimelig» gjør bakgrunnsarbeid, og «Bilde» tegner og leser PDF-er.",
			},
			{
				id: "valgfritt",
				before: { kind: "settings", section: "keys" },
				selector: '[data-testid="section-keys"]',
				title: "Valgfritt: diktering og nettsøk",
				text: "Vil du snakke i stedet for å skrive, legger du inn en Deepgram-nøkkel. Vil du at appen skal kunne søke på nettet, legger du inn en nøkkel fra Tavily eller Brave Search.",
				fallback: "Under «Leverandører» kan du også legge inn en Deepgram-nøkkel for diktering og en nøkkel fra Tavily eller Brave Search for nettsøk. Begge deler er valgfritt.",
			},
			{
				id: "ferdig",
				title: "Klart til bruk",
				text: "Når en leverandør er koblet til og modellene er valgt, kan du starte økter. Lukk innstillingene med Esc.",
			},
		],
	},
];

export function findTour(id: string): Tour | undefined {
	return TOURS.find((tour) => tour.id === id);
}
