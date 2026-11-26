#!/usr/bin/env bash
# manages the cookies of accounts the api uses, e.g. an instagram account for
# posts instagram only shows to logged-in users (age-limited ones).
#
#   sudo ./cookie.sh set instagram     replace the account(s) with one account
#   sudo ./cookie.sh add instagram     add another account (one is picked at random)
#   sudo ./cookie.sh remove instagram  remove all accounts of a service
#   sudo ./cookie.sh list              which services have accounts (no values)
#
# the cookie is read from the terminal without showing it (or from a pipe),
# never from the command line, so it doesn't end up in the shell history.
# see deploy/README.md for where to get it.

set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/fetchr}"
COOKIE_FILE="$INSTALL_DIR/cookies/cookies.json"
# services the api reads cookies for (api/src/processing/cookie/manager.js)
SERVICES="instagram instagram_bearer reddit twitter youtube vimeo_bearer"

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }

usage() {
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
}

[[ $EUID -eq 0 ]] || die "run this script with sudo"
command -v python3 > /dev/null || die "python3 is needed: apt install python3"
[[ -f "$COOKIE_FILE" ]] || die "$COOKIE_FILE doesn't exist. run install.sh first (it makes it)."

action="${1:-}"
service="${2:-}"

case "$action" in
    set|add|remove)
        [[ -n "$service" ]] || usage
        [[ " $SERVICES " == *" $service "* ]] || die "unknown service: $service (one of: $SERVICES)"
        ;;
    list) ;;
    *) usage ;;
esac

# the api keeps cookies in memory and writes them back to the file, so it's
# stopped while the file changes, and started again to read the new file
restart_api() {
    (cd "$INSTALL_DIR" && docker compose up -d api > /dev/null 2>&1) \
        && ok "the api was restarted with the new cookies" \
        || die "couldn't start the api: cd $INSTALL_DIR && docker compose up -d api"
}

if [[ "$action" == "list" ]]; then
    python3 - "$COOKIE_FILE" <<'EOF'
import json, sys
cookies = json.load(open(sys.argv[1]))
if not cookies:
    print("no cookies yet")
for service, values in cookies.items():
    count = len(values) if isinstance(values, list) else 0
    print(f"{service}: {count} account{'s' if count != 1 else ''}")
EOF
    exit 0
fi

cookie=""
if [[ "$action" != "remove" ]]; then
    if [[ -t 0 ]]; then
        read -r -s -p "paste the cookie for $service (it isn't shown) and press enter: " cookie
        echo
    else
        read -r cookie || true
    fi

    # "cookie: a=1; b=2" as copied from the browser's network tab works too
    cookie="$(printf '%s' "$cookie" | sed -E 's/^[[:space:]]*[Cc]ookie:[[:space:]]*//; s/[[:space:]]+$//')"
    [[ -n "$cookie" ]] || die "no cookie was given"
    [[ "$cookie" == *=* ]] || die "that doesn't look like a cookie (name=value; name2=value2)"

    # the parts the api needs to be logged in
    case "$service" in
        instagram) needed="sessionid ds_user_id csrftoken" ;;
        twitter) needed="auth_token ct0" ;;
        *) needed="" ;;
    esac
    for name in $needed; do
        [[ "$cookie" =~ (^|;[[:space:]]*)$name= ]] || die "the cookie has no $name. copy it again while logged in (see deploy/README.md)."
    done
fi

(cd "$INSTALL_DIR" && docker compose stop api > /dev/null 2>&1) || true

COOKIE="$cookie" python3 - "$COOKIE_FILE" "$action" "$service" <<'EOF'
import json, os, sys
path, action, service = sys.argv[1:4]
cookies = json.load(open(path))
cookie = os.environ["COOKIE"]

if action == "set":
    cookies[service] = [cookie]
elif action == "add":
    current = cookies.get(service) if isinstance(cookies.get(service), list) else []
    if cookie not in current:
        current.append(cookie)
    cookies[service] = current
elif action == "remove":
    cookies.pop(service, None)

with open(path + ".tmp", "w") as f:
    json.dump(cookies, f, indent=4)
    f.write("\n")
os.replace(path + ".tmp", path)
EOF

chown 1000:1000 "$COOKIE_FILE"
chmod 600 "$COOKIE_FILE"

case "$action" in
    set) ok "$service now uses this account" ;;
    add) ok "account added to $service" ;;
    remove) ok "$service has no cookies anymore" ;;
esac

restart_api
