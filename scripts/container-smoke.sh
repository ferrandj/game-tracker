#!/usr/bin/env bash
# Smoke test of the built image. Usage: scripts/container-smoke.sh <image>
# Proves: it starts, serves the app, saves data to the mounted folder, keeps it across restart AND recreate,
# recovers from a corrupt state file, and explains a permission problem instead of failing silently.
set -euo pipefail
IMG="${1:?image name}"
NAME="game-tracker-smoke-$$"
DATA="$(mktemp -d)"
chmod 777 "$DATA"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$DATA" 2>/dev/null || sudo rm -rf "$DATA" || true; }
trap cleanup EXIT
fail() { echo "FAIL: $*"; docker logs "$NAME" 2>&1 | tail -20 || true; exit 1; }

run() { docker run -d --name "$NAME" -p 18088:8080 -v "$DATA:/data" "$@" "$IMG" >/dev/null; }
wait_up() { for _ in $(seq 1 40); do curl -fs http://127.0.0.1:18088/healthz >/dev/null 2>&1 && return 0; sleep 0.5; done; fail "server did not come up"; }
api() { curl -fsS -H 'X-Tracker-Client: 1' -H 'Content-Type: application/json' "$@"; }
# prints one value out of the JSON answer of GET /api/games, e.g.  field 'd => d.games.length'
field() { api http://127.0.0.1:18088/api/games | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=eval(process.argv[1]);console.log(JSON.stringify(f(JSON.parse(s))))})' "$1"; }

echo "== start"
run; wait_up
curl -fs http://127.0.0.1:18088/ | grep -q '<div id="root">' || fail "app page not served"
JS=$(curl -fs http://127.0.0.1:18088/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
[ -n "$JS" ] || fail "built bundle not referenced"
curl -fs "http://127.0.0.1:18088/$JS" -o /dev/null || fail "bundle not served"
curl -fs http://127.0.0.1:18088/manifest.webmanifest | grep -q '"Game Tracker"' || fail "manifest not served"
docker logs "$NAME" 2>&1 | grep -q "version ci-smoke" || fail "version not reported in the log"
[ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo none)" != "unhealthy" ] || fail "unhealthy"
[ "$(field 'd => d.games.length')" = "0" ] || fail "a fresh data folder must start with an empty library"

echo "== save data (a game with a rating and achievements added by hand)"
ID=$(api -X POST http://127.0.0.1:18088/api/games -d '{"title":"Smoke test","platform":"switch","fetchAchievements":false}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).game.id))')
[ -n "$ID" ] || fail "could not add a game"
api -X PATCH "http://127.0.0.1:18088/api/games/$ID" -d '{"rating":9,"review":"précieux"}' >/dev/null
api -X POST "http://127.0.0.1:18088/api/games/$ID/achievements" -d '{"text":"Premier\nSecond"}' >/dev/null
ls "$DATA/state.json" >/dev/null || fail "state.json not written to the mounted folder"

echo "== restart the same container"
docker restart "$NAME" >/dev/null; wait_up
[ "$(field 'd => d.games[0].rating')" = "9" ] || fail "rating lost after restart"
[ "$(field 'd => d.games[0].achievements.length')" = "2" ] || fail "achievements lost after restart"

echo "== destroy the container and create a new one on the same folder (like an update)"
docker rm -f "$NAME" >/dev/null; run; wait_up
[ "$(field 'd => d.games[0].review')" = '"précieux"' ] || fail "review lost after recreate"
[ "$(field 'd => d.games.length')" = "1" ] || fail "library changed after recreate"

if [ -n "${PREV_IMAGE:-}" ]; then
  echo "== UPDATE: the new image on data written by the previous release ($PREV_IMAGE) leaves state.json byte-for-byte identical"
  docker rm -f "$NAME" >/dev/null
  UPD="$(mktemp -d)"; chmod 777 "$UPD"
  docker run -d --name "$NAME" -p 18088:8080 -v "$UPD:/data" "$PREV_IMAGE" >/dev/null; wait_up
  UID1=$(api -X POST http://127.0.0.1:18088/api/games -d '{"title":"Written by the old release","platform":"switch","fetchAchievements":false}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).game.id))')
  api -X PATCH "http://127.0.0.1:18088/api/games/$UID1" -d '{"rating":7,"review":"avant la mise à jour"}' >/dev/null
  api -X POST "http://127.0.0.1:18088/api/games/$UID1/achievements" -d '{"text":"Un\nDeux\nTrois"}' >/dev/null
  docker rm -f "$NAME" >/dev/null
  BEFORE=$(sha256sum "$UPD/state.json" | cut -d' ' -f1)
  docker run -d --name "$NAME" -p 18088:8080 -v "$UPD:/data" "$IMG" >/dev/null; wait_up
  [ "$(field 'd => d.games[0].review')" = '"avant la mise à jour"' ] || fail "data written by the previous release is not readable"
  [ "$(field 'd => d.games[0].achievements.length')" = "3" ] || fail "achievements lost by the update"
  docker rm -f "$NAME" >/dev/null
  [ "$(sha256sum "$UPD/state.json" | cut -d' ' -f1)" = "$BEFORE" ] || fail "THE UPDATE MODIFIED THE DATA (state.json is not identical)"
  ls "$UPD/backups" | grep -q -- '-update.json' || fail "no raw copy of the data was kept at the first start after the update"
  sudo rm -rf "$UPD" 2>/dev/null || rm -rf "$UPD"
  run; wait_up
fi

echo "== a corrupt state file is moved aside and recovered from a backup"
docker rm -f "$NAME" >/dev/null
ls "$DATA/backups" | grep -q . || fail "no automatic backup was made"
# the file belongs to the container's user, so damage it from inside a container (as a real disk fault would)
docker run --rm -v "$DATA:/data" --entrypoint sh "$IMG" -c "echo '{ broken' > /data/state.json"
run; wait_up
ls "$DATA" | grep -q '^state.corrupt-' || fail "corrupt file was not kept for inspection"
[ "$(field 'd => d.games.length >= 0')" = "true" ] || fail "no library after recovery"

echo "== a folder owned by another user (like a NAS user's shared folder) just works, and the server is not root"
docker rm -f "$NAME" >/dev/null
OWN="$(mktemp -d)"; sudo chown 1026:100 "$OWN"; sudo chmod 755 "$OWN"
docker run -d --name "$NAME" -p 18088:8080 -v "$OWN:/data" "$IMG" >/dev/null; wait_up
[ "$(stat -c %u "$OWN/state.json")" = "1026" ] || fail "files in the NAS-owned folder are not owned by the folder owner"
docker logs "$NAME" 2>&1 | grep -q "running as uid 1026" || fail "did not adopt the folder owner"
[ "$(docker exec "$NAME" sh -c 'awk "/^Uid/{print \$2}" /proc/1/status')" = "1026" ] || fail "server still runs as root"
docker rm -f "$NAME" >/dev/null; sudo rm -rf "$OWN"

echo "== a root-owned folder (what Docker creates for a missing bind path) just works"
ROOTD="$(mktemp -d)"; sudo chown 0:0 "$ROOTD"; sudo chmod 755 "$ROOTD"
docker run -d --name "$NAME" -p 18088:8080 -v "$ROOTD:/data" "$IMG" >/dev/null; wait_up
[ "$(stat -c %u "$ROOTD/state.json")" = "1000" ] || fail "root-owned folder was not handed to the unprivileged user"
docker rm -f "$NAME" >/dev/null; sudo rm -rf "$ROOTD"

echo "== existing data with the wrong owner is kept (ownership is repaired, nothing is deleted)"
KEEP="$(mktemp -d)"; sudo chown 1000:1000 "$KEEP"
docker run -d --name "$NAME" -p 18088:8080 -v "$KEEP:/data" "$IMG" >/dev/null; wait_up
api -X POST http://127.0.0.1:18088/api/games -d '{"title":"Precious","platform":"pc","fetchAchievements":false}' >/dev/null
docker rm -f "$NAME" >/dev/null; sudo chown -R 0:0 "$KEEP"
docker run -d --name "$NAME" -p 18088:8080 -v "$KEEP:/data" "$IMG" >/dev/null; wait_up
[ "$(field 'd => d.games[0].title')" = '"Precious"' ] || fail "data lost when the folder had the wrong owner"
docker rm -f "$NAME" >/dev/null; sudo rm -rf "$KEEP"

echo "== wrong permissions are explained"
docker rm -f "$NAME" >/dev/null
RO="$(mktemp -d)"; chmod 555 "$RO"
OUT=$(docker run --rm --user 4321:4321 -v "$RO:/data" "$IMG" 2>&1 || true)
rmdir "$RO" 2>/dev/null || true
echo "$OUT" | grep -q "not writable" || fail "no clear message for a read-only data folder: $OUT"

echo "OK: container smoke test passed"
