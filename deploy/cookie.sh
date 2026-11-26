#!/usr/bin/env bash
# manages the cookies of accounts the api uses, e.g. an instagram account for
# posts instagram only shows to logged-in users (age-limited ones).
#
#   sudo ./cookie.sh login instagram           log in with username & password, once
#   sudo ./cookie.sh import instagram <file>   cookies.txt (or json) from a browser extension
#   sudo ./cookie.sh set instagram             paste a cookie header
#   sudo ./cookie.sh add instagram             paste another account (one is picked at random)
#   sudo ./cookie.sh remove instagram          remove all accounts of a service
#   sudo ./cookie.sh list                      which services have accounts (no values)
#
# passwords and cookies are read from the terminal without showing them,
# never from the command line, so they don't end up in the shell history.
# the password isn't stored: only the cookie that logging in gives.
# see deploy/README.md for more.

set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/fetchr}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COOKIE_FILE="$INSTALL_DIR/cookies/cookies.json"
# services the api reads cookies for (api/src/processing/cookie/manager.js)
SERVICES="instagram instagram_bearer reddit twitter youtube vimeo_bearer"
# image and version used for logging in (cookie.sh login)
LOGIN_IMAGE="python:3.12-slim"
INSTALOADER_VERSION="4.16"

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }

usage() {
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
}

[[ $EUID -eq 0 ]] || die "run this script with sudo"
command -v python3 > /dev/null || die "python3 is needed: apt install python3"
[[ -f "$COOKIE_FILE" ]] || die "$COOKIE_FILE doesn't exist. run install.sh first (it makes it)."

action="${1:-}"
service="${2:-}"

case "$action" in
    set|add|remove|import|login)
        [[ -n "$service" ]] || usage
        [[ " $SERVICES " == *" $service "* ]] || die "unknown service: $service (one of: $SERVICES)"
        ;;
    list) ;;
    *) usage ;;
esac

tmp="$(mktemp -d)"
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT

# the parts the api needs to be logged in
check_cookie() {
    local cookie="$1" needed name
    [[ -n "$cookie" ]] || die "no cookie was given"
    [[ "$cookie" == *=* ]] || die "that doesn't look like a cookie (name=value; name2=value2)"

    case "$service" in
        instagram) needed="sessionid ds_user_id csrftoken" ;;
        twitter) needed="auth_token ct0" ;;
        *) needed="" ;;
    esac
    for name in $needed; do
        [[ "$cookie" =~ (^|;[[:space:]]*)$name= ]] \
            || die "the cookie has no $name. it has to come from a logged-in browser (see deploy/README.md)."
    done
}

# the api keeps cookies in memory and writes them back to the file, so it's
# stopped while the file changes, and started again to read the new file
save_cookie() {
    local mode="$1" cookie="${2:-}"

    (cd "$INSTALL_DIR" && docker compose stop api > /dev/null 2>&1) || true

    COOKIE="$cookie" python3 - "$COOKIE_FILE" "$mode" "$service" <<'EOF'
import json, os, sys
path, mode, service = sys.argv[1:4]
cookies = json.load(open(path))
cookie = os.environ["COOKIE"]

if mode == "set":
    cookies[service] = [cookie]
elif mode == "add":
    current = cookies.get(service) if isinstance(cookies.get(service), list) else []
    if cookie not in current:
        current.append(cookie)
    cookies[service] = current
elif mode == "remove":
    cookies.pop(service, None)

with open(path + ".tmp", "w") as f:
    json.dump(cookies, f, indent=4)
    f.write("\n")
os.replace(path + ".tmp", path)
EOF

    chown 1000:1000 "$COOKIE_FILE"
    chmod 600 "$COOKIE_FILE"

    (cd "$INSTALL_DIR" && docker compose up -d api > /dev/null 2>&1) \
        && ok "the api was restarted with the new cookies" \
        || die "couldn't start the api: cd $INSTALL_DIR && docker compose up -d api"
}

# a cookies.txt (netscape format, like "get cookies.txt locally" makes) or a
# json export (like "cookie-editor" makes) -> a cookie header for the service
cookie_from_file() {
    python3 - "$1" "$service" <<'EOF'
import json, sys
path, service = sys.argv[1:3]
domains = {
    "instagram": ("instagram.com",),
    "twitter": ("twitter.com", "x.com"),
    "reddit": ("reddit.com",),
    "youtube": ("youtube.com",),
}.get(service)
if not domains:
    sys.exit(f"importing a file isn't supported for {service}")

def ours(domain):
    domain = domain.lstrip(".").lower()
    return any(domain == d or domain.endswith("." + d) for d in domains)

text = open(path, encoding="utf-8-sig").read()
cookies = {}

try:
    data = json.loads(text)
    items = data.get("cookies", []) if isinstance(data, dict) else data
    for item in items:
        if isinstance(item, dict) and item.get("name") and ours(item.get("domain", "")):
            cookies[item["name"]] = str(item.get("value", ""))
except ValueError:
    for line in text.splitlines():
        # http-only cookies (like instagram's sessionid) have this prefix
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        elif not line.strip() or line.startswith("#"):
            continue
        fields = line.rstrip("\n").split("\t")
        if len(fields) >= 7 and ours(fields[0]):
            cookies[fields[5]] = fields[6]

if not cookies:
    sys.exit(f"no {service} cookies in this file. export them while logged in on {domains[0]}.")

print("; ".join(f"{name}={value}" for name, value in cookies.items() if value))
EOF
}

# logs in once with instaloader in a throwaway container, see instagram-login.py
cookie_from_login() {
    local username password login_script="$SCRIPT_DIR/instagram-login.py" status=0 tty=()
    [[ "$service" == "instagram" ]] || die "logging in is only supported for instagram"
    [[ -f "$login_script" ]] || login_script="$INSTALL_DIR/instagram-login.py"
    [[ -f "$login_script" ]] || die "instagram-login.py is missing, run install.sh again"
    [[ -t 0 ]] || die "logging in needs a terminal (for the password and a possible 2fa code)"

    read -r -p "instagram username: " username
    read -r -s -p "password (it isn't shown, and isn't stored): " password
    # (this function's output is the cookie, so nothing else goes there)
    echo >&2
    [[ -n "$username" && -n "$password" ]] || die "the username and password are needed"

    # the credentials go to the container in a file only root can read,
    # deleted when this script ends
    USERNAME="$username" PASSWORD="$password" python3 -c '
import json, os, sys
json.dump({"username": os.environ["USERNAME"], "password": os.environ["PASSWORD"]}, open(sys.argv[1], "w"))
' "$tmp/credentials.json"
    chmod 600 "$tmp/credentials.json"
    unset password

    echo "logging in (the first time, this downloads a small python image)..." >&2
    # this function's output is the cookie, so everything the container
    # shows (like the prompt for a 2fa code) goes to the terminal instead
    [[ -t 2 ]] && tty=(-t)
    docker run --rm -i "${tty[@]}" \
        -v "$login_script:/login.py:ro" \
        -v "$tmp:/work" \
        "$LOGIN_IMAGE" sh -c "pip install -q --disable-pip-version-check --root-user-action=ignore instaloader==$INSTALOADER_VERSION > /dev/null && python /login.py /work/credentials.json /work/cookie" \
        >&2 || status=$?
    rm -f "$tmp/credentials.json"

    case "$status" in
        0) ;;
        2) die "instagram says the username or password is wrong" ;;
        3) die "confirm the login in the instagram app (\"this was me\"), then run this again" ;;
        4) die "the 2fa code didn't work" ;;
        *) die "logging in didn't work (see the message above)" ;;
    esac

    [[ -s "$tmp/cookie" ]] || die "logging in didn't give a cookie"
    cat "$tmp/cookie"
}

case "$action" in
    list)
        python3 - "$COOKIE_FILE" <<'EOF'
import json, sys
cookies = json.load(open(sys.argv[1]))
if not cookies:
    print("no cookies yet")
for service, values in cookies.items():
    count = len(values) if isinstance(values, list) else 0
    print(f"{service}: {count} account{'s' if count != 1 else ''}")
EOF
        ;;

    remove)
        save_cookie remove
        ok "$service has no cookies anymore"
        ;;

    set|add)
        if [[ -t 0 ]]; then
            read -r -s -p "paste the cookie for $service (it isn't shown) and press enter: " cookie
            echo
        else
            read -r cookie || true
        fi
        # "cookie: a=1; b=2" as copied from the browser's network tab works too
        cookie="$(printf '%s' "${cookie:-}" | sed -E 's/^[[:space:]]*[Cc]ookie:[[:space:]]*//; s/[[:space:]]+$//')"
        check_cookie "$cookie"
        save_cookie "$action" "$cookie"
        [[ "$action" == "set" ]] && ok "$service now uses this account" || ok "account added to $service"
        ;;

    import)
        file="${3:-}"
        [[ -n "$file" ]] || die "which file? sudo ./cookie.sh import $service cookies.txt"
        [[ -f "$file" ]] || die "$file doesn't exist"
        cookie="$(cookie_from_file "$file")" || exit 1
        check_cookie "$cookie"
        save_cookie set "$cookie"
        ok "$service now uses the account from $file"
        echo "  delete the file, it's as good as the password: rm '$file'"
        ;;

    login)
        cookie="$(cookie_from_login)" || exit 1
        check_cookie "$cookie"
        save_cookie set "$cookie"
        ok "$service now uses this account"
        ;;
esac
