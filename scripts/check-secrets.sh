#!/usr/bin/env bash
# Bloquea pushes que contengan archivos sensibles o patrones de claves.
#
# Uso:
#   scripts/check-secrets.sh                 # revisa el arbol de HEAD + el indice
#   scripts/check-secrets.sh <rango>         # revisa los commits de un rango (ej. origin/main..HEAD)
#   scripts/check-secrets.sh --pre-push      # modo hook: lee las refs a subir desde stdin
#
# Instalar el hook (local, no se versiona), creando .git/hooks/pre-push con:
#   #!/bin/sh
#   exec "$(git rev-parse --show-toplevel)/scripts/check-secrets.sh" --pre-push "$@"
#
# Nunca imprime el valor encontrado: solo archivo, commit y tipo de secreto.

set -u
# grep con locale UTF-8 es extremadamente lento en Git for Windows
export LC_ALL=C

TMP_BLOB=$(mktemp)
trap 'rm -f "$TMP_BLOB"' EXIT

ZERO=0000000000000000000000000000000000000000
SELF=scripts/check-secrets.sh

FORBIDDEN_PATHS='(^|/)\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$|(^|/)id_(rsa|ed25519|ecdsa)$|(^|/)\.npmrc$|(^|/)\.netrc$|service[-_]?account.*\.json$|credentials?\.json$|(^|/)supabase/\.temp/|(^|/)\.supabase/|(^|/)node_modules/|(^|/)\.claude/|(^|/)CLAUDE\.local\.md$'
ALLOWED_PATHS='(^|/)\.env\.example$'

PATTERNS=(
  'private_key|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'jwt|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  'github_token|(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}'
  'supabase_key|sb_(secret|publishable)_[A-Za-z0-9_-]{10,}'
  'aws_access_key|AKIA[0-9A-Z]{16}'
  'google_api_key|AIza[0-9A-Za-z_-]{35}'
  'stripe_key|sk_(live|test)_[0-9a-zA-Z]{20,}'
  'llm_api_key|sk-(proj-|ant-)?[A-Za-z0-9_-]{30,}'
  'slack_token|xox[baprs]-[A-Za-z0-9-]{10,}'
  'db_url_with_password|(postgres|postgresql|mysql|mongodb(\+srv)?)://[^:/[:space:]]+:[^@[:space:]]+@'
  'hardcoded_secret|(api[_-]?key|secret|password|passwd|token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{8,}["'"'"']'
)

found=0

report() {
  echo "  [BLOQUEADO] $1" >&2
  found=1
}

# check_content <donde> <ruta> <objeto-blob>
check_content() {
  local where=$1 path=$2 obj=$3 entry name regex
  [ "$path" = "$SELF" ] && return
  git cat-file blob "$obj" > "$TMP_BLOB" 2>/dev/null || return
  # Omitir binarios
  grep -qI . "$TMP_BLOB" || return
  for entry in "${PATTERNS[@]}"; do
    name=${entry%%|*}
    regex=${entry#*|}
    if grep -qiE -- "$regex" "$TMP_BLOB"; then
      report "$where:$path -> posible secreto ($name)"
    fi
  done
}

check_path() {
  local where=$1 path=$2
  if echo "$path" | grep -qE "$FORBIDDEN_PATHS" && ! echo "$path" | grep -qE "$ALLOWED_PATHS"; then
    report "$where:$path -> archivo que no debe versionarse"
  fi
}

# Revisa los archivos agregados/modificados en cada commit del rango
scan_range() {
  local commit path obj rest commits
  if ! commits=$(git rev-list "$@"); then
    report "no se pudo resolver el rango: $*"
    return
  fi
  for commit in $commits; do
    while IFS=$'\t' read -r rest path; do
      [ -z "$path" ] && continue
      obj=$(echo "$rest" | awk '{print $4}')
      [ "$obj" = "$ZERO" ] && continue
      check_path "${commit:0:7}" "$path"
      check_content "${commit:0:7}" "$path" "$obj"
    done < <(git diff-tree --root -r --no-commit-id --diff-filter=ACMR --no-renames "$commit")
  done
}

# Revisa un arbol completo (HEAD) y lo que este en el indice
scan_tree_and_index() {
  local obj path rest
  if git rev-parse -q --verify HEAD >/dev/null; then
    while IFS=$'\t' read -r rest path; do
      obj=$(echo "$rest" | awk '{print $3}')
      check_path HEAD "$path"
      check_content HEAD "$path" "$obj"
    done < <(git ls-tree -r HEAD)
  fi
  while IFS=$'\t' read -r rest path; do
    obj=$(echo "$rest" | awk '{print $2}')
    check_path index "$path"
    check_content index "$path" "$obj"
  done < <(git ls-files -s)
}

if [ "${1:-}" = "--pre-push" ]; then
  # git envia por stdin: <local ref> <local sha> <remote ref> <remote sha>
  echo "pre-push: revisando secretos en lo que se va a subir a ${2:-remoto} ..." >&2
  while read -r local_ref local_sha remote_ref remote_sha; do
    [ "$local_sha" = "$ZERO" ] && continue
    if [ "$remote_sha" = "$ZERO" ]; then
      # Rama nueva en el remoto: todo lo que no exista ya en algun remoto
      scan_range "$local_sha" --not --remotes
    else
      scan_range "$remote_sha..$local_sha"
    fi
  done
elif [ $# -ge 1 ]; then
  echo "Revisando rango $* ..." >&2
  scan_range "$@"
else
  echo "Revisando HEAD e indice ..." >&2
  scan_tree_and_index
fi

if [ $found -ne 0 ]; then
  echo "Push bloqueado: quita los archivos/secretos señalados (y rota cualquier clave real)." >&2
  exit 1
fi
echo "Sin secretos detectados." >&2
exit 0
