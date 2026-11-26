#!/usr/bin/env bash
# Eksamenshjelp – installasjon for Mac.
#
#   curl -fsSL https://eksamenshjelp-one.vercel.app/install.sh | bash
#
# Henter siste utgivelse fra GitHub (én anonym API-forespørsel), laster ned
# den ferdige appen (arm64-zip, ellers dmg), legger den i /Applications
# (eller ~/Applications hvis /Applications ikke er skrivbar), fjerner
# karantenemerket (appen er ikke signert med Apple Developer ID), lager
# ~/Documents/Eksamenshjelp og starter appen. Kan kjøres flere ganger: har du
# nyeste versjon, lastes ingenting ned; ellers oppdateres appen.
#
# Miljøvariabler for testing:
#   EKSAMENSHJELP_DRY_RUN=1        vis hva som ville skjedd, endre ingenting
#   EKSAMENSHJELP_RELEASE_JSON=fil  les API-svaret fra en fil, ikke nettet
#   EKSAMENSHJELP_OS / EKSAMENSHJELP_ARCH  overstyr uname / arkitektur

set -euo pipefail

REPO="thomas-schlytter/Eksamenshjelp"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
APP_NAME="Eksamenshjelp"
COURSES_DIR="${HOME}/Documents/Eksamenshjelp"

say() { printf '%s\n' "$*"; }
fail() {
	printf 'Feil: %s\n' "$*" >&2
	exit 1
}

detect_arch() {
	if [ -n "${EKSAMENSHJELP_ARCH:-}" ]; then
		printf '%s\n' "$EKSAMENSHJELP_ARCH"
	elif [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then
		# Riktig også når skallet kjører under Rosetta (uname -m sier da x86_64).
		printf 'arm64\n'
	else
		uname -m
	fi
}

# Skriver API-svaret til stdout. Én forespørsel, uten token.
fetch_release() {
	if [ -n "${EKSAMENSHJELP_RELEASE_JSON:-}" ]; then
		cat "$EKSAMENSHJELP_RELEASE_JSON"
		return
	fi
	local body status
	body="$(mktemp)"
	if ! status="$(curl -sS -L -o "$body" -w '%{http_code}' \
		-H 'Accept: application/vnd.github+json' \
		-H 'User-Agent: eksamenshjelp-installer' \
		"$API_URL")"; then
		rm -f "$body"
		fail "Fikk ikke kontakt med GitHub. Sjekk at du er koblet til internett, og prøv igjen."
	fi
	case "$status" in
		200) cat "$body"; rm -f "$body" ;;
		404) rm -f "$body"; fail "Det finnes ingen utgivelse av Eksamenshjelp ennå. Prøv igjen senere." ;;
		403 | 429) rm -f "$body"; fail "GitHub stopper midlertidig forespørsler fra nettverket ditt. Vent en time og prøv igjen, eller bruk et annet nettverk." ;;
		*) rm -f "$body"; fail "GitHub svarte med feilkode ${status}. Prøv igjen om litt." ;;
	esac
}

# Alle nedlastingslenker i API-svaret, én per linje.
asset_urls() {
	grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\(https[^"]*\)"$/\1/'
}

# Velger Mac-filen: arm64-zip først, ellers arm64-dmg.
pick_mac_asset() {
	local urls="$1" url
	url="$(printf '%s\n' "$urls" | grep -E -- "/${APP_NAME}-[^/]*-arm64-mac\.zip$" | head -n 1 || true)"
	if [ -z "$url" ]; then
		url="$(printf '%s\n' "$urls" | grep -E -- "/${APP_NAME}-[^/]*-arm64\.dmg$" | head -n 1 || true)"
	fi
	printf '%s\n' "$url"
}

release_version() {
	grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"v\{0,1\}\([^"]*\)"$/\1/'
}

installed_version() {
	local plist="$1/Contents/Info.plist"
	[ -f "$plist" ] || return 0
	/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null || true
}

quit_running_app() {
	if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
		say "Lukker Eksamenshjelp før oppdateringen …"
		osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
		local i
		for i in 1 2 3 4 5 6 7 8 9 10; do
			pgrep -x "$APP_NAME" >/dev/null 2>&1 || return 0
			sleep 1
		done
		pkill -x "$APP_NAME" 2>/dev/null || true
		sleep 1
	fi
}

# Pakker ut zip eller dmg til mappen $2 og skriver stien til .app-en.
unpack() {
	local file="$1" dir="$2"
	case "$file" in
		*.zip)
			ditto -x -k "$file" "$dir" || fail "Kunne ikke pakke ut nedlastingen. Prøv igjen."
			;;
		*.dmg)
			local mount="${dir}/mnt"
			mkdir -p "$mount"
			hdiutil attach -nobrowse -readonly -quiet -mountpoint "$mount" "$file" || fail "Kunne ikke åpne dmg-filen. Prøv igjen."
			ditto "${mount}/${APP_NAME}.app" "${dir}/${APP_NAME}.app" || {
				hdiutil detach -quiet "$mount" || true
				fail "Fant ikke appen i dmg-filen."
			}
			hdiutil detach -quiet "$mount" || true
			;;
	esac
	[ -d "${dir}/${APP_NAME}.app" ] || fail "Fant ikke ${APP_NAME}.app i nedlastingen."
	printf '%s\n' "${dir}/${APP_NAME}.app"
}

main() {
	local os arch
	os="${EKSAMENSHJELP_OS:-$(uname -s)}"
	if [ "$os" != "Darwin" ]; then
		fail "Dette skriptet er for Mac. På Windows kjører du i PowerShell: irm https://eksamenshjelp-one.vercel.app/install.ps1 | iex"
	fi
	arch="$(detect_arch)"
	if [ "$arch" != "arm64" ]; then
		fail "Denne Macen har Intel-prosessor. Eksamenshjelp bygges foreløpig bare for Mac med Apple-brikke (M1 eller nyere), så det finnes ingen versjon for denne maskinen ennå."
	fi

	say "Henter siste versjon av Eksamenshjelp fra GitHub …"
	local release urls url version
	release="$(fetch_release)"
	urls="$(printf '%s\n' "$release" | asset_urls || true)"
	url="$(pick_mac_asset "$urls")"
	version="$(printf '%s\n' "$release" | release_version || true)"
	if [ -z "$url" ]; then
		fail "Den siste utgivelsen (${version:-ukjent versjon}) har ingen Mac-fil ennå. Prøv igjen senere."
	fi

	local dest_dir="/Applications"
	if [ ! -w "$dest_dir" ]; then
		dest_dir="${HOME}/Applications"
	fi
	local app="${dest_dir}/${APP_NAME}.app"
	# Ligger appen alt i ~/Applications fra før, oppdaterer vi den der.
	if [ ! -d "$app" ] && [ -d "${HOME}/Applications/${APP_NAME}.app" ]; then
		app="${HOME}/Applications/${APP_NAME}.app"
		dest_dir="${HOME}/Applications"
	fi

	if [ "${EKSAMENSHJELP_DRY_RUN:-0}" = "1" ]; then
		say "Tørrkjøring: ingenting endres."
		say "Versjon: ${version}"
		say "Ville lastet ned: ${url}"
		say "Ville installert til: ${app}"
		say "Ville laget mappen: ${COURSES_DIR}"
		return 0
	fi

	local current
	current="$(installed_version "$app")"
	if [ -n "$current" ] && [ "$current" = "$version" ]; then
		say "Du har allerede nyeste versjon (${version})."
	else
		local tmp file
		tmp="$(mktemp -d)"
		# shellcheck disable=SC2064  # $tmp skal utvides nå.
		trap "rm -rf '$tmp'" EXIT
		file="${tmp}/${url##*/}"
		say "Laster ned ${url##*/} …"
		curl -fL --retry 2 --progress-bar -o "$file" "$url" || fail "Nedlastingen stoppet. Sjekk internettforbindelsen og prøv igjen."
		local unpacked
		unpacked="$(unpack "$file" "${tmp}/ut")"
		quit_running_app
		mkdir -p "$dest_dir"
		rm -rf "$app"
		ditto "$unpacked" "$app" || fail "Kunne ikke kopiere appen til ${dest_dir}."
		if [ -n "$current" ]; then
			say "Eksamenshjelp er oppdatert fra ${current} til ${version}."
		else
			say "Eksamenshjelp ${version} er installert i ${dest_dir}."
		fi
	fi

	# Appen er ikke signert med Apple Developer ID: fjern karantenemerket så
	# macOS ikke stopper den ved første åpning.
	xattr -dr com.apple.quarantine "$app" 2>/dev/null || true

	mkdir -p "$COURSES_DIR"
	say "Fagmappen er klar: ${COURSES_DIR}"

	say "Starter Eksamenshjelp …"
	open "$app" || fail "Kunne ikke starte appen. Åpne Eksamenshjelp fra Programmer-mappen."
	say "Ferdig. Start appen igjen senere med: open -a ${APP_NAME}"
}

main "$@"
