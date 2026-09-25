# flipbook skill launcher (Windows, PowerShell 5.1 compatible).
#
# The Windows twin of run.sh: identical resolution order, identical JSON
# fields (fix, launcher), identical exit codes. One stable action for the agent ("run
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
$Pinned = '0.3.0'
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

# Split "X.Y.Z[-prerelease][+build]" into Major, Minor, Patch, Pre (empty for a
# release) and Bare (the text without build metadata). $null when the text is
# not exactly three dot-separated numbers.
function ConvertTo-SemVer {
    param([string] $Text)
    if ($null -eq $Text) { return $null }
    $bare = ($Text -split '\+', 2)[0]
    $m = [regex]::Match($bare, '^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-(.*))?$')
    if (-not $m.Success) { return $null }
    return [pscustomobject]@{
        Major = [decimal]$m.Groups[1].Value
        Minor = [decimal]$m.Groups[2].Value
        Patch = [decimal]$m.Groups[3].Value
        Pre   = $m.Groups[4].Value
        Bare  = $bare
    }
}

# The first version printed by `$Bin --version`, anchored at its first digit so
# "10.1.0" stays 10.1.0, suffixes included.
function Get-CliVersion {
    $cli = Find-Program $Bin
    if (-not $cli) { return '' }
    try { $out = Invoke-Native $cli @('--version') 2>$null } catch { return '' }
    if (-not $out) { return '' }
    $line = [string]($out | Select-Object -First 1)
    $m = [regex]::Match($line, '^[^0-9]*([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]*)?)')
    if ($m.Success) { return $m.Groups[1].Value } else { return '' }
}

# Compatible = not older than $Pinned, with the same major.minor while $Pinned is
# 0.x and the same major from 1.0 on. A prerelease on either side counts only
# when it is exactly $Pinned.
function Test-Compatible {
    param([string] $Ver)
    $f = ConvertTo-SemVer $Ver
    $p = ConvertTo-SemVer $Pinned
    if (-not $f -or -not $p) { return $false }
    if ($f.Pre -or $p.Pre) { return ($f.Bare -ceq $p.Bare) }
    if ($f.Major -ne $p.Major) { return $false }
    if ($p.Major -eq 0 -and $f.Minor -ne $p.Minor) { return $false }
    if ($f.Minor -gt $p.Minor) { return $true }
    if ($f.Minor -lt $p.Minor) { return $false }
    return ($f.Patch -ge $p.Patch)
}

# Human wording of the compatible range, e.g. "0.1.x, at or above 0.1.0".
function Get-CompatRange {
    $p = ConvertTo-SemVer $Pinned
    if ($p.Major -eq 0) { return "$($p.Major).$($p.Minor).x, at or above $Pinned" }
    return "major $($p.Major), at or above $Pinned"
}

# npx is usable only when this machine's node meets the CLI's floor.
$NodeFloor = '22.19.0'
function Test-NodeMeetsFloor {
    $node = Find-Program 'node'
    if (-not $node) { return $false }
    try { $nv = ((Invoke-Native $node @('--version') 2>$null) -replace '^v', '') } catch { return $false }
    $n = ConvertTo-SemVer ([string]$nv)
    $f = ConvertTo-SemVer $NodeFloor
    if (-not $n) { return $false }
    if ($n.Major -gt $f.Major) { return $true }
    if ($n.Major -lt $f.Major) { return $false }
    return ($n.Minor -ge $f.Minor)
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

# The launcher's view of this machine, the same fields run.sh prints.
function Get-LauncherInfo {
    return [ordered]@{
        tool          = $Bin
        package       = $Package
        pinnedVersion = $Pinned
        os            = 'windows'
        arch          = $script:Arch
        checked       = [ordered]@{
            pathCli = [ordered]@{ present = $script:CliPresent; path = $script:CliPath; version = $script:CliVer; compatible = $script:CliCompat }
            npx     = [ordered]@{ present = $script:NpxPresent; path = $script:NpxPath; nodeMeetsFloor = $script:NodeFloorOk }
            bunx    = [ordered]@{ present = $script:BunxPresent; path = $script:BunxPath }
            node    = [ordered]@{ present = $script:NodePresent; version = $script:NodeVer }
        }
        selected      = $script:Selected
    }
}

# One JSON report for "nothing can run the CLI": the same top-level fields as a
# failing doctor report (ok, exitCode, error, message, fix) plus the launcher block.
function Get-NoneJson {
    $first = "Install Node 22.19+ from https://nodejs.org so npx can run $Package@$Pinned, then re-run this launcher."
    if ($script:NpxPresent -and (-not $script:NodeFloorOk)) {
        $node = if ($script:NodeVer) { $script:NodeVer } else { 'missing' }
        $first = "npx is present but node $node is below the $NodeFloor floor this CLI needs. Upgrade Node at https://nodejs.org, then re-run this launcher."
    }
    $second = "No JavaScript runtime? Install Bun from https://bun.sh to use bunx, or put a compatible $Bin ($(Get-CompatRange)) on PATH."
    $report = [ordered]@{
        ok       = $false
        exitCode = 78
        error    = 'runtime-missing'
        message  = "No runtime can launch $Bin here: no compatible $Bin on PATH, no usable npx, no bunx."
        fix      = @($first, $second)
        launcher = Get-LauncherInfo
    }
    return (ConvertTo-Json -InputObject $report -Depth 20)
}

# `doctor [extra...]`: one JSON object on stdout, always. With a runnable CLI it
# is the CLI's `doctor --json` report with the launcher block added as its first
# field, and the CLI's exit code. Without one it is the runtime-missing report,
# exit 78. Extra flags pass through to the CLI doctor.
function Invoke-Doctor {
    param([string[]] $DocArgs)
    Collect
    $pass = @($DocArgs | Where-Object { $_ -ne '--json' })
    if ($script:Selected -eq 'none') {
        Write-Output (Get-NoneJson)
        exit 78
    }
    $raw = (Invoke-Cli $script:Selected (@('doctor', '--json') + $pass) | Out-String).Trim()
    $code = $LASTEXITCODE
    $launcher = ConvertTo-Json -InputObject (Get-LauncherInfo) -Depth 20
    if ($raw.StartsWith('{')) {
        Write-Output ("{`n  `"launcher`": " + $launcher + ',' + $raw.Substring(1))
    }
    else {
        if ($code -eq 0) { $code = 1 }
        $report = [ordered]@{
            ok       = $false
            exitCode = $code
            error    = 'doctor-failed'
            message  = "$Bin doctor exited $code without a JSON report. Its stderr is above."
            fix      = @('Report it with the stderr output at https://github.com/liustack/flipbook/issues')
            launcher = Get-LauncherInfo
        }
        Write-Output (ConvertTo-Json -InputObject $report -Depth 20)
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
        [Console]::Error.WriteLine((Get-NoneJson))
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
