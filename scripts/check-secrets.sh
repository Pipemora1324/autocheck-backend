#!/usr/bin/env bash
# Bloquea pushes que contengan archivos sensibles o patrones de claves.
#
# Uso:
#   scripts/check-secrets.sh                 # revisa el arbol de HEAD + el indice
#   scripts/check-secrets.sh <rango>         # revisa los commits de un rango (ej. origin/main..HEAD)
#   Como hook pre-push: lee las refs a subir desde stdin (lo hace git automaticamente).
#
# Instalar el hook (local, no se versiona):
#   ln -sf ../../scripts/check-secrets.sh .git/hooks/pre-push
#
# Nunca imprime el valor encontrado: solo archivo, commit y tipo de secreto.

set -u

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
  # Omitir binarios
  if git cat-file -p "$obj" | grep -qI . 2>/dev/null; then :; else return; fi
  for entry in "${PATTERNS[@]}"; do
    name=${entry%%|*}
    regex=${entry#*|}
    if git cat-file -p "$obj" | grep -qiE -- "$regex"; then
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
  local commit path obj rest
  for commit in $(git rev-list "$@"); do
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

# Como hook, git pasa <nombre-remoto> <url> como argumentos
if [ $# -ge 1 ] && ! git remote | grep -qx -- "$1"; then
  echo "Revisando rango $1 ..." >&2
  scan_range "$1"
elif [ ! -t 0 ]; then
  # Modo hook pre-push: <local ref> <local sha> <remote ref> <remote sha>
  echo "pre-push: revisando secretos en lo que se va a subir ..." >&2
  while read -r local_ref local_sha remote_ref remote_sha; do
    [ "$local_sha" = "$ZERO" ] && continue
    if [ "$remote_sha" = "$ZERO" ]; then
      # Rama nueva en el remoto: todo lo que no exista ya en algun remoto
      scan_range "$local_sha" --not --remotes
    else
      scan_range "$remote_sha..$local_sha"
    fi
  done
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
