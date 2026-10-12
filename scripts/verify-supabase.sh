#!/usr/bin/env bash
# Verifies both services against the live Supabase instance.
# Run from the repo root once .env is filled in:  bash scripts/verify-supabase.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example to .env and fill it in."
  exit 1
fi
# Detect the unquoted-'&' trap BEFORE sourcing. An unquoted URL containing '&' is
# truncated by the shell at the first one, so the variable comes out empty and
# every check below misreports it as "not set" rather than "badly quoted".
for var in JAVA_DB_URL PYTHON_DB_URL MIGRATION_DB_URL; do
  line=$(grep -m1 "^${var}=" .env || true)
  value=${line#*=}
  case "$value" in
    \"*\"|\'*\') ;;                        # quoted, safe
    *\&*) echo "  FAIL  ${var} in .env contains '&' but is not quoted -"
          echo "        the shell will truncate it at the first '&'. Wrap the value in \"quotes\"."
          fail=$((fail+1)) ;;
  esac
done

set -a; . ./.env; set +a

echo
echo "=== 1. DNS and reachability ==="
for var in JAVA_DB_URL PYTHON_DB_URL MIGRATION_DB_URL; do
  val="${!var:-}"
  if [ -z "$val" ]; then bad "$var is not set"; continue; fi
  host=$(printf '%s' "$val" | sed -E 's#^[a-z+]*:?//?##; s#^jdbc:postgresql://##; s#^postgresql://##; s#^[^@]*@##; s#[:/?].*$##')
  port=$(printf '%s' "$val" | sed -nE 's#.*:([0-9]{4,5})[/?].*#\1#p')
  if getent hosts "$host" >/dev/null 2>&1 || nslookup "$host" >/dev/null 2>&1; then
    ok "$var -> $host:$port resolves"
  else
    bad "$var -> $host does not resolve"
  fi
done

echo
echo "=== 2. Connection role sanity ==="
case "${JAVA_DB_URL:-}" in
  *:6543*) ok "JAVA_DB_URL uses the transaction pooler (6543)" ;;
  *)       bad "JAVA_DB_URL should use the transaction pooler on port 6543" ;;
esac
case "${JAVA_DB_URL:-}" in
  *prepareThreshold=0*) ok "JAVA_DB_URL disables server-side prepared statements" ;;
  *) bad "JAVA_DB_URL is missing prepareThreshold=0 (required for transaction pooling)" ;;
esac
case "${PYTHON_DB_URL:-}" in
  *:5432*) ok "PYTHON_DB_URL uses a session connection (5432)" ;;
  *)       bad "PYTHON_DB_URL should use port 5432, not the transaction pooler" ;;
esac
# An unencoded '@' in the password leaves the URL ambiguous about where the
# credentials end. Two '@' before the host is the signature.
case "$(printf '%s' "${PYTHON_DB_URL:-}" | sed 's#\(.*\)/postgres.*#\1#' | tr -cd '@' )" in
  @)  ok "PYTHON_DB_URL credentials are unambiguous" ;;
  "") bad "PYTHON_DB_URL has no '@' - credentials missing from the URL" ;;
  *)  bad "PYTHON_DB_URL has more than one '@' before the host - percent-encode the password (@ -> %40)" ;;
esac
case "${MIGRATION_DB_URL:-}" in
  jdbc:*) ok "MIGRATION_DB_URL is a JDBC URL" ;;
  "")     bad "MIGRATION_DB_URL is unset - Flyway will use the runtime pooler" ;;
  *)      bad "MIGRATION_DB_URL must start with jdbc:postgresql://" ;;
esac
[ -n "${INTERNAL_API_TOKEN:-}" ] && ok "INTERNAL_API_TOKEN is set" \
  || bad "INTERNAL_API_TOKEN is empty - the AI service will reject every call"

echo
echo "=== 3. siddhamind-core health ==="
CORE_URL="http://localhost:8080/siddhamind/internal/health"
body=$(curl -s -m 20 "$CORE_URL" 2>/dev/null || true)
if [ -z "$body" ]; then
  bad "no response from $CORE_URL (is the service running?)"
else
  echo "$body" | python -m json.tool 2>/dev/null || echo "$body"
  case "$body" in
    *'"status":"UP"'*)             ok "core reports UP" ;;
    *)                             bad "core is not UP" ;;
  esac
  case "$body" in
    *'"installed":true'*)          ok "pgvector installed" ;;
    *)                             bad "pgvector not detected" ;;
  esac
  case "$body" in
    *'"embeddingDimension":1024'*) ok "doc_chunks.embedding is vector(1024)" ;;
    *)                             bad "embedding dimension is not 1024 - check EMBEDDING_MODEL" ;;
  esac
  case "$body" in
    *'"seeded":true'*)             ok "reference data is seeded" ;;
    *)                             echo "  NOTE  not seeded yet - run: java -jar target/siddhamind-core.jar --seed" ;;
  esac
fi

echo
echo "=== 4. siddhamind-ai health ==="
AI_URL="http://localhost:8000/health"
body=$(curl -s -m 20 "$AI_URL" 2>/dev/null || true)
if [ -z "$body" ]; then
  bad "no response from $AI_URL (is the service running?)"
else
  echo "$body" | python -m json.tool 2>/dev/null || echo "$body"
  case "$body" in
    *'"status":"UP"'*)     ok "ai reports UP" ;;
    *)                     bad "ai is not UP" ;;
  esac
  case "$body" in
    *'"ok":true'*)         ok "ai schema check passed" ;;
    *)                     bad "ai schema check failed" ;;
  esac
fi

echo
echo "=== 5. service-to-service auth ==="
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 http://localhost:8000/internal/ping 2>/dev/null) || true
code=${code:-000}
[ "$code" = "401" ] && ok "unauthenticated /internal/ping rejected (401)" \
  || bad "unauthenticated /internal/ping returned $code, expected 401"

code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 \
  -H "Authorization: Bearer ${INTERNAL_API_TOKEN:-}" http://localhost:8000/internal/ping 2>/dev/null) || true
code=${code:-000}
[ "$code" = "200" ] && ok "authenticated /internal/ping accepted (200)" \
  || bad "authenticated /internal/ping returned $code, expected 200"

echo
echo "================================"
echo "  passed: $pass   failed: $fail"
echo "================================"
[ "$fail" -eq 0 ]
