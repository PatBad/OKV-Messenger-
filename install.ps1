<#
.SYNOPSIS
  Installs (or updates) a clinic's messenger app on this PC from the latest GitHub release.

.DESCRIPTION
  Finds the newest release, looks up the installer for the chosen clinic in the release's brands.json,
  downloads it, checks the download against its checksum, and runs it. If that app is already installed
  and up to date it does nothing. Installs for the current user only (no administrator rights); Windows
  asks once for permission to add the firewall rules that let the clinic's PCs talk to each other.

.PARAMETER Brand
  The clinic's short name, e.g. noordhoek or okv. Leave it out to list the clinics available.
  Can also be given in the MESSENGER_BRAND environment variable.

.PARAMETER Force
  Reinstall even if the same or a newer version is already installed.

.PARAMETER Silent
  Install without the installer's window and without the firewall prompt (the app then still works, but
  messages between PCs can take a few seconds longer to arrive). This is what the auto-updater does.

.PARAMETER DryRun
  Download and check the installer but do not run it.

.EXAMPLE
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/PatBad/OKV-Messenger-/main/install.ps1))) noordhoek

.EXAMPLE
  $env:MESSENGER_BRAND = 'noordhoek'; irm https://raw.githubusercontent.com/PatBad/OKV-Messenger-/main/install.ps1 | iex
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)] [string]$Brand = $env:MESSENGER_BRAND,
  [switch]$Force,
  [switch]$Silent,
  [switch]$DryRun,
  [string]$Repo = 'PatBad/OKV-Messenger-',
  [string]$ApiBase = 'https://api.github.com'
)

function Install-Messenger {
  param($Brand, $Force, $Silent, $DryRun, $Repo, $ApiBase)

  $ErrorActionPreference = 'Stop'
  # Older Windows PowerShell defaults to protocols GitHub no longer accepts.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
  $ProgressPreference = 'SilentlyContinue' # the progress bar makes downloads very slow in Windows PowerShell

  function Say($text, $colour = 'White') { Write-Host $text -ForegroundColor $colour }
  function Fail($text) { Write-Host "ERROR: $text" -ForegroundColor Red }

  # Find the installed copy (the installer records it under the current user, or machine-wide).
  function Get-InstalledApp($productName) {
    $keys = @(
      'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
      'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
      'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    $pattern = '^' + [regex]::Escape($productName) + '( [0-9][0-9.]*)?$'
    foreach ($key in $keys) {
      if (-not (Test-Path $key)) { continue }
      foreach ($item in Get-ChildItem $key -ErrorAction SilentlyContinue) {
        $p = Get-ItemProperty $item.PSPath -ErrorAction SilentlyContinue
        if ($p -and $p.DisplayName -match $pattern) { return $p }
      }
    }
    return $null
  }

  function ConvertTo-Version($text) {
    $clean = ([string]$text).Trim().TrimStart('v', 'V')
    $v = $null
    if ([version]::TryParse($clean, [ref]$v)) { return $v }
    return $null
  }

  try {
    # 1. The latest release and its list of clinics.
    Say 'Looking up the latest release...'
    $release = Invoke-RestMethod -Uri "$ApiBase/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'messenger-installer' }
    $manifestAsset = $release.assets | Where-Object { $_.name -eq 'brands.json' } | Select-Object -First 1
    if (-not $manifestAsset) {
      Fail "Release $($release.tag_name) has no brands.json, so this script cannot tell which installer is which. Download the installer from the Releases page instead."
      return
    }
    # GitHub serves release files as generic downloads, so read the text ourselves instead of relying on auto-parsing.
    $raw = (Invoke-WebRequest -UseBasicParsing -Uri $manifestAsset.browser_download_url -Headers @{ 'User-Agent' = 'messenger-installer' }).Content
    if ($raw -is [byte[]]) { $raw = [Text.Encoding]::UTF8.GetString($raw) }
    $manifest = ([string]$raw).TrimStart([char]0xFEFF) | ConvertFrom-Json
    $available = @($manifest.brands)

    # 2. Which clinic?
    if ([string]::IsNullOrWhiteSpace($Brand)) {
      Say 'Which clinic is this for? Run the command again with one of these names:' Yellow
      foreach ($b in $available) { Say ("  {0,-14} {1}" -f $b.id, $b.productName) }
      return
    }
    $entry = $available | Where-Object { $_.id -eq $Brand.Trim() -or $_.productName -eq $Brand.Trim() } | Select-Object -First 1
    if (-not $entry) {
      Fail "There is no clinic called '$Brand'. Available: $((($available | ForEach-Object { $_.id }) -join ', '))"
      return
    }
    $latest = ConvertTo-Version $manifest.version
    Say "$($entry.productName) $($manifest.version) is the latest version."

    # 3. Already installed and current?
    $installed = Get-InstalledApp $entry.productName
    if ($installed) {
      $have = ConvertTo-Version $installed.DisplayVersion
      Say "Installed on this PC: version $($installed.DisplayVersion)."
      if (-not $Force -and $have -and $latest -and $have -ge $latest) {
        Say 'Already up to date. Nothing to do. (Add -Force to reinstall anyway.)' Green
        return
      }
      Say 'Updating it now. If the app is open it will close and restart.'
    } else {
      Say 'Not installed on this PC yet.'
    }

    # 4. Download and check.
    $asset = $release.assets | Where-Object { $_.name -eq $entry.installer } | Select-Object -First 1
    if (-not $asset) { Fail "The release has no file called $($entry.installer)."; return }
    $file = Join-Path ([IO.Path]::GetTempPath()) $entry.installer
    try {
      Say ('Downloading {0} ({1:N0} MB)...' -f $entry.installer, ($entry.size / 1MB))
      Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $file

      if ((Get-Item $file).Length -ne [int64]$entry.size) {
        Fail 'The download is the wrong size (it may have been cut off). Please try again.'
        return
      }
      $hex = (Get-FileHash -Path $file -Algorithm SHA512).Hash
      $actual = [Convert]::ToBase64String([byte[]]($hex -split '(?<=\G..)(?=.)' | ForEach-Object { [Convert]::ToByte($_, 16) }))
      if ($actual -ne $entry.sha512) {
        Fail 'The download does not match its checksum, so it was not installed. Please try again.'
        return
      }
      Say 'Download checked.' Green

      if ($DryRun) { Say "Dry run: would now run $file" Yellow; return }

      # 5. Install. Not silent by default, so Windows can offer to add the firewall rules.
      Say 'Installing...'
      if ($Silent) { $process = Start-Process -FilePath $file -ArgumentList '/S', '--force-run' -Wait -PassThru }
      else { $process = Start-Process -FilePath $file -Wait -PassThru }
      if ($process.ExitCode -ne 0) { Fail "The installer stopped with code $($process.ExitCode)."; return }

      # 6. Confirm.
      $after = Get-InstalledApp $entry.productName
      if ($after -and (ConvertTo-Version $after.DisplayVersion) -eq $latest) {
        Say "$($entry.productName) $($after.DisplayVersion) is installed." Green
        if (-not $installed) { Say 'On first start it asks which department this PC is for.' }
      } else {
        Say 'The installer finished, but this script could not confirm the new version. Check the app opens.' Yellow
      }
    } finally {
      Remove-Item -Path $file -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Fail $_.Exception.Message
  }
}

# A function (not top-level code) so that "return" never closes the user's PowerShell window.
Install-Messenger -Brand $Brand -Force $Force -Silent $Silent -DryRun $DryRun -Repo $Repo -ApiBase $ApiBase
