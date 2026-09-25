#!/bin/sh
# flipbook skill launcher (macOS / Linux).
#
# One stable action for the agent ("run flipbook"); this script picks a working
# way to run it in the current environment. POSIX sh (dash, busybox ash, bash).
# Invoke it as `bash run.sh ...` or `sh run.sh ...`.
#
# Resolution order (kept identical in run.ps1):
#   1. A compatible flipbook already on PATH  -> run it directly.
#   2. npx present                             -> run the pinned npm version.
#   3. bunx present                            -> run the pinned version via Bun.
#   4. Nothing usable                          -> structured diagnosis, exit 78.
#
# It never writes PATH, never needs admin rights, never fetches a second script,
# and has no postinstall step.
set -eu

# --- Version constants: stamped by scripts/release.mjs at release time. --------
# scripts/stamp.test.mjs asserts PINNED equals the package.json version.
PKG="@liustack/flipbook"
BIN="flipbook"
PINNED="0.5.0"
# -------------------------------------------------------------------------------

# Split "X.Y.Z[-prerelease][+build]" into the globals _MAJ, _MIN, _PAT and _PRE
# (empty for a release). Build metadata is dropped. Returns 1 when the text is
# not exactly three dot-separated numbers.
parse_semver() {
  _raw="${1%%+*}"
  case "$_raw" in
    *-*) _PRE="${_raw#*-}"; _core="${_raw%%-*}" ;;
    *) _PRE=""; _core="$_raw" ;;
  esac
  case "$_core" in
    *.*.*.*) return 1 ;;
    *.*.*) ;;
    *) return 1 ;;
  esac
  _MAJ="${_core%%.*}"
  _rest="${_core#*.}"
  _MIN="${_rest%%.*}"
  _PAT="${_rest#*.}"
  for _part in "$_MAJ" "$_MIN" "$_PAT"; do
    case "$_part" in '' | *[!0-9]*) return 1 ;; esac
  done
  return 0
}

# Compatible = not older than PINNED, with the same major.minor while PINNED is
# 0.x and the same major from 1.0 on. A prerelease on either side counts only
# when it is exactly PINNED.
compatible() {
  parse_semver "$1" || return 1
  _f_maj=$_MAJ
  _f_min=$_MIN
  _f_pat=$_PAT
  _f_pre=$_PRE
  parse_semver "$PINNED" || return 1
  if [ -n "$_f_pre" ] || [ -n "$_PRE" ]; then
    [ "${1%%+*}" = "${PINNED%%+*}" ]
    return
  fi
  [ "$_f_maj" = "$_MAJ" ] || return 1
  if [ "$_MAJ" = "0" ] && [ "$_f_min" != "$_MIN" ]; then return 1; fi
  if [ "$_f_min" -gt "$_MIN" ]; then return 0; fi
  if [ "$_f_min" -lt "$_MIN" ]; then return 1; fi
  [ "$_f_pat" -ge "$_PAT" ]
}

# Human wording of the compatible range, e.g. "0.1.x, at or above 0.1.0".
compat_range() {
  parse_semver "$PINNED"
  if [ "$_MAJ" = "0" ]; then
    printf '%s.%s.x, at or above %s' "$_MAJ" "$_MIN" "$PINNED"
  else
    printf 'major %s, at or above %s' "$_MAJ" "$PINNED"
  fi
}

# The first version printed by `$BIN --version`, anchored at its first digit so
# "10.1.0" stays 10.1.0, suffixes included.
cli_version() {
  "$BIN" --version 2>/dev/null | head -n 1 |
    sed -n 's/^[^0-9]*\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\([-+][0-9A-Za-z.+-]*\)\{0,1\}\).*/\1/p'
}

# npx is usable only when this machine's node meets the CLI's floor.
NODE_FLOOR="22.19.0"
node_meets_floor() {
  command -v node >/dev/null 2>&1 || return 1
  _nv="$(node --version 2>/dev/null | sed 's/^v//')"
  [ -n "$_nv" ] || return 1
  parse_semver "$NODE_FLOOR"
  _floor_maj="$_MAJ"
  _floor_min="$_MIN"
  parse_semver "$_nv" || return 1
  if [ "$_MAJ" -gt "$_floor_maj" ]; then return 0; fi
  if [ "$_MAJ" -lt "$_floor_maj" ]; then return 1; fi
  [ "$_MIN" -ge "$_floor_min" ]
}

# Echo exactly one word: the chosen launch path.
resolve() {
  if command -v "$BIN" >/dev/null 2>&1; then
    _v="$(cli_version)"
    if [ -n "$_v" ] && compatible "$_v"; then
      echo "path"
      return
    fi
  fi
  if command -v npx >/dev/null 2>&1 && node_meets_floor; then
    echo "npx"
    return
  fi
  if command -v bunx >/dev/null 2>&1; then
    echo "bunx"
    return
  fi
  echo "none"
}

# Run the resolved CLI without exec and pass every argument through untouched.
run_cli() {
  case "$G_SEL" in
    path) "$BIN" "$@" ;;
    npx) npx --yes --package "$PKG@$PINNED" "$BIN" "$@" ;;
    bunx) bunx --bun "$PKG@$PINNED" "$@" ;;
  esac
}

detect_os() { uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]'; }

detect_arch() {
  _a="$(uname -m 2>/dev/null)"
  case "$_a" in
    x86_64 | amd64) echo "x64" ;;
    aarch64 | arm64) echo "arm64" ;;
    *) echo "$_a" ;;
  esac
}

# Escape a value for a JSON string literal (backslash and double quote).
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# Render "null" for an empty value, else an escaped JSON string.
jstr() {
  if [ -z "$1" ]; then printf 'null'; else printf '"%s"' "$(json_escape "$1")"; fi
}

# 1 -> true, anything else -> false.
jbool() { if [ "$1" = "1" ]; then printf 'true'; else printf 'false'; fi; }

# Probe the environment once into G_* globals shared by the emitters.
collect() {
  G_OS="$(detect_os)"
  G_ARCH="$(detect_arch)"

  G_CLI_PRESENT=0
  G_CLI_PATH=""
  G_CLI_VER=""
  G_CLI_COMPAT=0
  if command -v "$BIN" >/dev/null 2>&1; then
    G_CLI_PRESENT=1
    G_CLI_PATH="$(command -v "$BIN")"
    G_CLI_VER="$(cli_version)"
    if [ -n "$G_CLI_VER" ] && compatible "$G_CLI_VER"; then G_CLI_COMPAT=1; fi
  fi

  G_NPX_PRESENT=0
  G_NPX_PATH=""
  if command -v npx >/dev/null 2>&1; then
    G_NPX_PRESENT=1
    G_NPX_PATH="$(command -v npx)"
  fi

  G_BUNX_PRESENT=0
  G_BUNX_PATH=""
  if command -v bunx >/dev/null 2>&1; then
    G_BUNX_PRESENT=1
    G_BUNX_PATH="$(command -v bunx)"
  fi

  G_NODE_PRESENT=0
  G_NODE_VER=""
  if command -v node >/dev/null 2>&1; then
    G_NODE_PRESENT=1
    G_NODE_VER="$(node --version 2>/dev/null | sed 's/^v//')"
  fi

  G_NODE_FLOOR_OK=0
  if node_meets_floor; then G_NODE_FLOOR_OK=1; fi

  G_SEL="$(resolve)"
}

# The launcher's view of this machine, as one JSON object.
launcher_json() {
  printf '{\n'
  printf '    "tool": %s,\n' "$(jstr "$BIN")"
  printf '    "package": %s,\n' "$(jstr "$PKG")"
  printf '    "pinnedVersion": %s,\n' "$(jstr "$PINNED")"
  printf '    "os": %s,\n' "$(jstr "$G_OS")"
  printf '    "arch": %s,\n' "$(jstr "$G_ARCH")"
  printf '    "checked": {\n'
  printf '      "pathCli": { "present": %s, "path": %s, "version": %s, "compatible": %s },\n' \
    "$(jbool "$G_CLI_PRESENT")" "$(jstr "$G_CLI_PATH")" "$(jstr "$G_CLI_VER")" "$(jbool "$G_CLI_COMPAT")"
  printf '      "npx": { "present": %s, "path": %s, "nodeMeetsFloor": %s },\n' "$(jbool "$G_NPX_PRESENT")" "$(jstr "$G_NPX_PATH")" "$(jbool "$G_NODE_FLOOR_OK")"
  printf '      "bunx": { "present": %s, "path": %s },\n' "$(jbool "$G_BUNX_PRESENT")" "$(jstr "$G_BUNX_PATH")"
  printf '      "node": { "present": %s, "version": %s }\n' "$(jbool "$G_NODE_PRESENT")" "$(jstr "$G_NODE_VER")"
  printf '    },\n'
  printf '    "selected": %s\n' "$(jstr "$G_SEL")"
  printf '  }'
}

# One JSON report for "nothing can run the CLI": the same top-level fields as a
# failing doctor report (ok, exitCode, error, message, fix) plus the launcher block.
emit_none() {
  if [ "$G_NPX_PRESENT" = 1 ] && [ "$G_NODE_FLOOR_OK" = 0 ]; then
    _s1="npx is present but node ${G_NODE_VER:-missing} is below the $NODE_FLOOR floor this CLI needs. Upgrade Node at https://nodejs.org, then re-run this launcher."
  else
    _s1="Install Node 22.19+ from https://nodejs.org so npx can run $PKG@$PINNED, then re-run this launcher."
  fi
  _s2="No JavaScript runtime? Install Bun from https://bun.sh to use bunx, or put a compatible $BIN ($(compat_range)) on PATH."
  printf '{\n'
  printf '  "ok": false,\n'
  printf '  "exitCode": 78,\n'
  printf '  "error": "runtime-missing",\n'
  printf '  "message": %s,\n' "$(jstr "No runtime can launch $BIN here: no compatible $BIN on PATH, no usable npx, no bunx.")"
  printf '  "fix": [%s, %s],\n' "$(jstr "$_s1")" "$(jstr "$_s2")"
  printf '  "launcher": %s\n' "$(launcher_json)"
  printf '}\n'
}

# `doctor [extra...]`: one JSON object on stdout, always. With a runnable CLI it
# is the CLI's `doctor --json` report with the launcher block added as its first
# field, and the CLI's exit code. Without one it is emit_none, exit 78. Extra
# flags pass through to the CLI doctor.
doctor() {
  collect
  for _a do
    shift
    [ "$_a" = "--json" ] || set -- "$@" "$_a"
  done
  if [ "$G_SEL" = "none" ]; then
    emit_none
    exit 78
  fi
  _code=0
  _out="$(run_cli doctor --json "$@")" || _code=$?
  _first="${_out%"${_out#?}"}"
  if [ "$_first" = "{" ]; then
    printf '{\n  "launcher": %s,%s\n' "$(launcher_json)" "${_out#?}"
  else
    if [ "$_code" = 0 ]; then _code=1; fi
    printf '{\n'
    printf '  "ok": false,\n'
    printf '  "exitCode": %s,\n' "$_code"
    printf '  "error": "doctor-failed",\n'
    printf '  "message": %s,\n' "$(jstr "$BIN doctor exited $_code without a JSON report. Its stderr is above.")"
    printf '  "fix": [%s],\n' "$(jstr "Report it with the stderr output at https://github.com/liustack/flipbook/issues")"
    printf '  "launcher": %s\n' "$(launcher_json)"
    printf '}\n'
  fi
  exit "$_code"
}

# Default action: forward every argument to the resolved CLI, inheriting stdio
# and exit code. No usable runtime -> structured diagnosis on stderr, exit 78.
run() {
  _sel="$(resolve)"
  case "$_sel" in
    path) exec "$BIN" "$@" ;;
    npx) exec npx --yes --package "$PKG@$PINNED" "$BIN" "$@" ;;
    bunx) exec bunx --bun "$PKG@$PINNED" "$@" ;;
    none)
      collect
      emit_none >&2
      exit 78
      ;;
  esac
}

case "${1:-}" in
  doctor)
    shift
    doctor "$@"
    ;;
  where)
    resolve
    ;;
  *)
    run "$@"
    ;;
esac
