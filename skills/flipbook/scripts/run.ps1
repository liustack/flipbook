# flipbook skill launcher (Windows, PowerShell 5.1 compatible).
#
# The Windows twin of run.sh: identical resolution order, identical diagnostic
# fields, identical exit codes. One stable action for the agent ("run
# flipbook"); this script picks a working way to run it here.
#
# Invoke it per process:
#   powershell -NoProfile -ExecutionPolicy Bypass -File run.ps1 doctor
#   powershell -NoProfile -ExecutionPolicy Bypass -File run.ps1 check <dir>
#
# Resolution order (kept identical in run.sh):
#   1. A compatible flipbook already on PATH  -> run it directly.
#   2. npx present                             -> run the pinned npm version.
#   3. bunx present                            -> run the pinned version via Bun.
#   4. Nothing usable                          -> structured diagnosis, exit 78.
#
# It never writes PATH, never needs admin rights, never fetches a second script,
# and has no postinstall step.

$ErrorActionPreference = 'Stop'

# The CLI writes UTF-8. Read and re-emit its output as UTF-8 instead of the
# console code page, which would garble non-ASCII text in the JSON reports.
try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $OutputEncoding = [Console]::OutputEncoding
}
catch { }

# --- Version constants: stamped by scripts/release.mjs at release time. --------
# scripts/stamp.test.mjs asserts $Pinned equals the package.json version.
$Package = '@liustack/flipbook'
$Bin = 'flipbook'
$Pinned = '0.1.0'
# -------------------------------------------------------------------------------

# Environment snapshot, filled by Collect and read by the emitters.
$script:Arch = ''
$script:CliPresent = $false
$script:CliPath = $null
$script:CliVer = $null
$script:CliCompat = $false
$script:NpxPresent = $false
$script:NpxPath = $null
$script:BunxPresent = $false
$script:BunxPath = $null
$script:NodePresent = $false
$script:NodeVer = $null
$script:NodeFloorOk = $false
$script:Selected = 'none'

# The full path of an executable or .cmd shim on PATH, or $null. npm also
# installs .ps1 shims, which an execution policy can refuse to run; the .cmd
# twin next to each one runs under any policy.
function Find-Program {
    param([string] $Name)
    $found = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Source }
    return $null
}

# Run a native program. Windows PowerShell 5.1 turns its stderr lines into
# errors when stderr is redirected, and 'Stop' would end the script on the
# first one and lose the exit code, so this scope uses 'Continue'. The exit
# code stays in $LASTEXITCODE.
function Invoke-Native {
    param([string] $Program, [string[]] $NativeArgs)
    $ErrorActionPreference = 'Continue'
    & $Program @NativeArgs
}

# First "X.Y.Z" token printed by `$Bin --version`.
function Get-CliVersion {
    $cli = Find-Program $Bin
    if (-not $cli) { return '' }
    try { $out = Invoke-Native $cli @('--version') 2>$null } catch { return '' }
    if (-not $out) { return '' }
    $line = [string]($out | Select-Object -First 1)
    $m = [regex]::Match($line, '[0-9]+\.[0-9]+\.[0-9]+')
    if ($m.Success) { return $m.Value } else { return '' }
}

# Compatible = not older than $Pinned, with the same major.minor while $Pinned is
# 0.x and the same major from 1.0 on.
function Test-Compatible {
    param([string] $Ver)
    $f = $Ver -split '\.'
    $p = $Pinned -split '\.'
    if ($f.Count -lt 3 -or $p.Count -lt 3) { return $false }
    $fMaj = [int]$f[0]; $fMin = [int]$f[1]; $fPat = [int]$f[2]
    $pMaj = [int]$p[0]; $pMin = [int]$p[1]; $pPat = [int]$p[2]
    if ($fMaj -ne $pMaj) { return $false }
    if ($pMaj -eq 0 -and $fMin -ne $pMin) { return $false }
    if ($fMin -gt $pMin) { return $true }
    if ($fMin -lt $pMin) { return $false }
    return ($fPat -ge $pPat)
}

# npx is usable only when this machine's node meets the CLI's floor.
$NodeFloor = '22.19.0'
function Test-NodeMeetsFloor {
    $node = Find-Program 'node'
    if (-not $node) { return $false }
    try { $nv = ((Invoke-Native $node @('--version') 2>$null) -replace '^v', '') } catch { return $false }
    if (-not $nv) { return $false }
    $n = $nv -split '\.'
    $f = $NodeFloor -split '\.'
    if ($n.Count -lt 2) { return $false }
    $nMaj = [int]$n[0]; $nMin = [int]$n[1]
    $fMaj = [int]$f[0]; $fMin = [int]$f[1]
    if ($nMaj -gt $fMaj) { return $true }
    if ($nMaj -lt $fMaj) { return $false }
    return ($nMin -ge $fMin)
}

# Return exactly one word: the chosen launch path.
function Resolve-LaunchKind {
    if (Find-Program $Bin) {
        $v = Get-CliVersion
        if ($v -and (Test-Compatible $v)) { return 'path' }
    }
    if ((Find-Program 'npx') -and (Test-NodeMeetsFloor)) { return 'npx' }
    if (Find-Program 'bunx') { return 'bunx' }
    return 'none'
}

# Run the CLI the way `$Kind` says, passing every argument through untouched.
# Its exit code is left in $LASTEXITCODE.
function Invoke-Cli {
    param([string] $Kind, [string[]] $CliArgs)
    switch ($Kind) {
        'path' { Invoke-Native (Find-Program $Bin) $CliArgs }
        'npx' { Invoke-Native (Find-Program 'npx') (@('--yes', '--package', "$Package@$Pinned", $Bin) + $CliArgs) }
        'bunx' { Invoke-Native (Find-Program 'bunx') (@('--bun', "$Package@$Pinned") + $CliArgs) }
    }
}

function Get-Arch {
    # A 32-bit PowerShell on 64-bit Windows sees x86 here; the real one is in PROCESSOR_ARCHITEW6432.
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    switch ($arch) {
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        'x86' { return 'x86' }
        default { return $arch }
    }
}

# Probe the environment once into the $script:* snapshot.
function Collect {
    $script:Arch = Get-Arch

    $cli = Find-Program $Bin
    if ($cli) {
        $script:CliPresent = $true
        $script:CliPath = $cli
        $script:CliVer = Get-CliVersion
        $script:CliCompat = [bool]($script:CliVer -and (Test-Compatible $script:CliVer))
    }

    $npx = Find-Program 'npx'
    if ($npx) { $script:NpxPresent = $true; $script:NpxPath = $npx }

    $bunx = Find-Program 'bunx'
    if ($bunx) { $script:BunxPresent = $true; $script:BunxPath = $bunx }

    $node = Find-Program 'node'
    if ($node) {
        $script:NodePresent = $true
        try { $script:NodeVer = ((Invoke-Native $node @('--version') 2>$null) -replace '^v', '') } catch { $script:NodeVer = $null }
        $script:NodeFloorOk = Test-NodeMeetsFloor
    }

    $script:Selected = Resolve-LaunchKind
}

# Assemble the structured diagnosis. $Chained, when a parsed object, becomes
# cliDoctor; otherwise cliDoctor is null.
function Build-DiagnosisJson {
    param($Chained)
    $checked = [ordered]@{
        pathCli = [ordered]@{ present = $script:CliPresent; path = $script:CliPath; version = $script:CliVer; compatible = $script:CliCompat }
        npx     = [ordered]@{ present = $script:NpxPresent; path = $script:NpxPath; nodeMeetsFloor = $script:NodeFloorOk }
        bunx    = [ordered]@{ present = $script:BunxPresent; path = $script:BunxPath }
        node    = [ordered]@{ present = $script:NodePresent; version = $script:NodeVer }
    }
    $steps = @()
    if ($script:Selected -eq 'none') {
        $parts = $Pinned.Split('.')
        $range = if ($parts[0] -eq '0') { "$($parts[0]).$($parts[1]).x, at or above $Pinned" } else { "major $($parts[0]), at or above $Pinned" }
        $first = "Install Node 22.19+ from https://nodejs.org so npx can run $Package@$Pinned, then re-run this launcher."
        if ($script:NpxPresent -and (-not $script:NodeFloorOk)) {
            $first = "npx is present but node $(if ($script:NodeVer) { $script:NodeVer } else { 'missing' }) is below the $NodeFloor floor this CLI needs. Upgrade Node at https://nodejs.org, then re-run this launcher."
        }
        $steps = @(
            $first,
            "No JavaScript runtime? Install Bun from https://bun.sh to use bunx, or put a compatible $Bin ($range) on PATH."
        )
    }
    $obj = [ordered]@{
        tool           = $Bin
        package        = $Package
        pinnedVersion  = $Pinned
        os             = 'windows'
        arch           = $script:Arch
        checked        = $checked
        selected       = $script:Selected
        nextSteps      = @($steps)
        cliDoctor      = $Chained
    }
    return ($obj | ConvertTo-Json -Depth 20)
}

# Human-readable diagnosis for `doctor` without --json.
function Write-DiagnosisText {
    Write-Output "$Bin launcher diagnosis"
    Write-Output ''
    Write-Output ("  os / arch:      windows / {0}" -f $script:Arch)
    Write-Output ("  pinned version: {0} ({1})" -f $Pinned, $Package)
    if ($script:CliPresent) {
        $verdict = if ($script:CliCompat) { 'compatible' } else { 'incompatible' }
        Write-Output ("  {0} on PATH:  {1} (version {2}, {3})" -f $Bin, $script:CliPath, $script:CliVer, $verdict)
    }
    else {
        Write-Output ("  {0} on PATH:  no" -f $Bin)
    }
    $npxDesc = 'no'
    if ($script:NpxPresent) {
        if ($script:NodeFloorOk) { $npxDesc = $script:NpxPath }
        else { $npxDesc = "$($script:NpxPath) (unusable: node $(if ($script:NodeVer) { $script:NodeVer } else { 'missing' }) is below $NodeFloor)" }
    }
    Write-Output ("  npx:            {0}" -f $npxDesc)
    Write-Output ("  bunx:           {0}" -f $(if ($script:BunxPresent) { $script:BunxPath } else { 'no' }))
    Write-Output ("  node:           {0}" -f $(if ($script:NodePresent) { $script:NodeVer } else { 'no' }))
    Write-Output ("  selected path:  {0}" -f $script:Selected)
    if ($script:Selected -eq 'none') {
        Write-Output ''
        Write-Output ("No runtime can launch {0} here." -f $Bin)
        Write-Output 'Next steps:'
        Write-Output '  - Install Node 22.19+ from https://nodejs.org, then re-run this launcher.'
        Write-Output ("  - Or install Bun from https://bun.sh, or put a compatible {0} on PATH." -f $Bin)
    }
}

# `doctor [--json] [extra...]`: launcher selection diagnosis, followed by the
# CLI's own doctor when a CLI is resolvable. Extra flags pass through to it.
function Invoke-Doctor {
    param([string[]] $DocArgs)
    Collect
    $json = $false
    foreach ($a in $DocArgs) { if ($a -eq '--json') { $json = $true } }
    $code = 0
    if ($script:Selected -eq 'none') { $code = 78 }
    if ($json) {
        $chained = $null
        if ($script:Selected -ne 'none') {
            $raw = (Invoke-Cli $script:Selected (@('doctor') + $DocArgs) 2>$null | Out-String).Trim()
            $code = $LASTEXITCODE
            if ($raw.StartsWith('{')) {
                try { $chained = ($raw | ConvertFrom-Json) } catch { $chained = $null }
            }
        }
        Write-Output (Build-DiagnosisJson $chained)
    }
    else {
        Write-DiagnosisText
        if ($script:Selected -ne 'none') {
            Write-Output ''
            Write-Output "--- $Bin doctor ---"
            Invoke-Cli $script:Selected (@('doctor') + $DocArgs)
            $code = $LASTEXITCODE
        }
    }
    exit $code
}

# Default action: forward every argument to the resolved CLI and exit with its
# code. No usable runtime -> structured diagnosis on stderr, exit 78.
function Invoke-Run {
    param([string[]] $CliArgs)
    $sel = Resolve-LaunchKind
    if ($sel -eq 'none') {
        Collect
        [Console]::Error.WriteLine((Build-DiagnosisJson $null))
        exit 78
    }
    Invoke-Cli $sel $CliArgs
    exit $LASTEXITCODE
}

$Command = ''
if ($args.Count -ge 1) { $Command = [string]$args[0] }
$Rest = @()
if ($args.Count -gt 1) { $Rest = $args[1..($args.Count - 1)] }

switch ($Command) {
    'doctor' { Invoke-Doctor -DocArgs $Rest }
    'where' { Collect; Write-Output $script:Selected }
    default { Invoke-Run -CliArgs $args }
}
