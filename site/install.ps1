# Eksamenshjelp - installasjon for Windows.
#
#   irm https://eksamenshjelp-one.vercel.app/install.ps1 | iex
#
# Henter siste utgivelse fra GitHub (en anonym API-foresporsel), laster ned
# NSIS-installeren (x64), fjerner nedlastingsmerket (Unblock-File; appen er
# ikke signert med et Windows-sertifikat), installerer stille for brukeren,
# lager %USERPROFILE%\Documents\Eksamenshjelp og starter appen. Kan kjores
# flere ganger: har du nyeste versjon, lastes ingenting ned.
#
# Filen er bevisst ren ASCII: irm dekoder svaret uten tegnsett-informasjon
# fra en webserver, og Windows PowerShell 5.1 ville da odelagt norske tegn.
# Bokstavene ae/oe/aa bygges derfor med [char] under.
#
# Miljovariabler for testing:
#   EKSAMENSHJELP_DRY_RUN=1        vis hva som ville skjedd, endre ingenting
#   EKSAMENSHJELP_RELEASE_JSON=fil  les API-svaret fra en fil, ikke nettet
#   EKSAMENSHJELP_OS / EKSAMENSHJELP_ARCH  overstyr operativsystem / arkitektur

function Install-Eksamenshjelp {
	$ErrorActionPreference = 'Stop'
	# Fremdriftslinjen gjor Invoke-WebRequest svart treg i PowerShell 5.1.
	$ProgressPreference = 'SilentlyContinue'

	$oe = [char]0x00F8
	$aa = [char]0x00E5

	$repo = 'thomas030505/Eksamenshjelp'
	$apiUrl = "https://api.github.com/repos/$repo/releases/latest"
	$appName = 'Eksamenshjelp'
	$coursesDir = Join-Path (Join-Path $env:USERPROFILE 'Documents') 'Eksamenshjelp'
	$dryRun = $env:EKSAMENSHJELP_DRY_RUN -eq '1'

	# Plattform
	$os = $env:EKSAMENSHJELP_OS
	if (-not $os) {
		if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { $os = 'Other' } else { $os = 'Windows' }
	}
	if ($os -ne 'Windows') {
		throw "Dette skriptet er for Windows. P$aa Mac kj${oe}rer du i Terminal: curl -fsSL https://eksamenshjelp-one.vercel.app/install.sh | bash"
	}
	$arch = $env:EKSAMENSHJELP_ARCH
	if (-not $arch) {
		$arch = $env:PROCESSOR_ARCHITEW6432
		if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
	}
	if ($arch -eq 'x86') {
		throw "Denne PC-en har 32-bits Windows. Eksamenshjelp finnes bare for 64-bits Windows."
	}
	if ($arch -eq 'ARM64') {
		Write-Host "Denne PC-en har ARM-prosessor. Eksamenshjelp er bygd for x64 og kj${oe}rer via Windows' emulering."
	}

	# Siste utgivelse: en foresporsel, uten token.
	Write-Host "Henter siste versjon av Eksamenshjelp fra GitHub ..."
	if ($env:EKSAMENSHJELP_RELEASE_JSON) {
		$release = Get-Content -Raw -Path $env:EKSAMENSHJELP_RELEASE_JSON | ConvertFrom-Json
	} else {
		try {
			[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
		} catch { }
		try {
			$release = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -Headers @{
				'Accept' = 'application/vnd.github+json'
				'User-Agent' = 'eksamenshjelp-installer'
			}
		} catch {
			$status = 0
			if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
			if ($status -eq 404) { throw "Det finnes ingen utgivelse av Eksamenshjelp enn$aa. Pr${oe}v igjen senere." }
			if ($status -eq 403 -or $status -eq 429) { throw "GitHub stopper midlertidig foresp${oe}rsler fra nettverket ditt. Vent en time og pr${oe}v igjen, eller bruk et annet nettverk." }
			if ($status -gt 0) { throw "GitHub svarte med feilkode $status. Pr${oe}v igjen om litt." }
			throw "Fikk ikke kontakt med GitHub. Sjekk at du er koblet til internett, og pr${oe}v igjen."
		}
	}

	$version = "$($release.tag_name)" -replace '^v', ''
	$asset = @($release.assets) | Where-Object { $_.name -match "^$appName-.*-x64-setup\.exe$" } | Select-Object -First 1
	if (-not $asset) {
		throw "Den siste utgivelsen ($version) har ingen Windows-fil enn$aa. Pr${oe}v igjen senere."
	}
	$url = $asset.browser_download_url

	$programs = Join-Path $env:LOCALAPPDATA 'Programs'
	# electron-builder legger en per-bruker-installasjon i Programs\<pakkenavn>
	# (learnharness); Eksamenshjelp-mappen er reserven om det endres.
	$exeCandidates = @(
		(Join-Path (Join-Path $programs 'learnharness') "$appName.exe"),
		(Join-Path (Join-Path $programs $appName) "$appName.exe")
	)

	if ($dryRun) {
		Write-Host "T${oe}rrkj${oe}ring: ingenting endres."
		Write-Host "Versjon: $version"
		Write-Host "Ville lastet ned: $url"
		Write-Host "Ville installert til: $($exeCandidates[0])"
		Write-Host "Ville laget mappen: $coursesDir"
		return
	}

	$installed = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
	$current = $null
	if ($installed) { $current = (Get-Item $installed).VersionInfo.ProductVersion }

	if ($current -and ($current -eq $version -or $current -eq "$version.0")) {
		Write-Host "Du har allerede nyeste versjon ($version)."
	} else {
		$setup = Join-Path $env:TEMP $asset.name
		Write-Host "Laster ned $($asset.name) ..."
		try {
			Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing
		} catch {
			throw "Nedlastingen stoppet. Sjekk internettforbindelsen og pr${oe}v igjen."
		}
		# Ikke signert: fjern nedlastingsmerket, saa SmartScreen ikke stopper installeren.
		Unblock-File -Path $setup
		Write-Host "Installerer ... Viser Windows 'Windows beskyttet PC-en din', trykk 'Mer informasjon' og 'Kj${oe}r likevel'."
		$proc = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
		Remove-Item -Path $setup -Force -ErrorAction SilentlyContinue
		if ($proc.ExitCode -ne 0) {
			throw "Installasjonen stoppet (kode $($proc.ExitCode)). Pr${oe}v igjen."
		}
		$installed = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
		if (-not $installed) {
			throw "Fant ikke appen etter installasjonen. Se etter Eksamenshjelp i Start-menyen."
		}
		if ($current) {
			Write-Host "Eksamenshjelp er oppdatert fra $current til $version."
		} else {
			Write-Host "Eksamenshjelp $version er installert."
		}
	}

	New-Item -ItemType Directory -Force -Path $coursesDir | Out-Null
	Write-Host "Fagmappen er klar: $coursesDir"

	Write-Host "Starter Eksamenshjelp ..."
	Start-Process -FilePath $installed
	# Virker fra PowerShell, cmd og Git Bash.
	Write-Host "Ferdig. Start appen igjen senere med: powershell -NoProfile -Command ""Start-Process '$installed'"""
}

try {
	Install-Eksamenshjelp
} catch {
	Write-Host ("Feil: " + $_.Exception.Message) -ForegroundColor Red
}
