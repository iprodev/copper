#!/usr/bin/env bash
# installs or updates fetchr on this server, next to whatever already runs here.
#
#   sudo ./install.sh          install, or update an existing installation
#
# what it does, and what it doesn't:
# - fetchr runs in docker containers in /opt/fetchr. the api only listens on
#   127.0.0.1, warp and the youtube session generator aren't reachable at all.
# - nginx gets two new files (fetchr-web.conf, fetchr-api.conf). existing
#   nginx configs are never changed. if the new config doesn't pass
#   `nginx -t`, it's removed again and nginx isn't reloaded.
# - the web app goes to /var/www/fetchr.
# - nothing is installed without asking first.

set -Eeuo pipefail

REPO="iprodev/fetchr"
INSTALL_DIR="${INSTALL_DIR:-/opt/fetchr}"
WEB_ROOT="/var/www/fetchr"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# questions are read from the terminal. without one, defaults are used
# and anything that needs a "yes" is skipped.
ask() {
    # ask "question" default -> answer
    local answer=""
    { read -r -p "  $1 [$2]: " answer < /dev/tty; } 2> /dev/null || true
    printf '%s' "${answer:-$2}"
}

confirm() {
    local answer=""
    { read -r -p "  $1 [y/N]: " answer < /dev/tty; } 2> /dev/null || true
    [[ "$answer" =~ ^[Yy]$ ]]
}

env_get() {
    # value of a key in .env, empty if missing
    [[ -f "$INSTALL_DIR/.env" ]] || return 0
    grep -E "^$1=" "$INSTALL_DIR/.env" | tail -n1 | cut -d= -f2- || true
}

env_set() {
    local key="$1" value="$2" file="$INSTALL_DIR/.env"
    if grep -qE "^$key=" "$file"; then
        # values are written with a temporary file, no sed escaping issues
        awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$file" > "$file.tmp"
        cat "$file.tmp" > "$file" && rm -f "$file.tmp"
    else
        printf '%s=%s\n' "$key" "$value" >> "$file"
    fi
}

[[ $EUID -eq 0 ]] || die "run this script with sudo: sudo ./install.sh"

bold "fetchr installer"
echo

# ---------------------------------------------------------------- checks
bold "1. checking the server"

command -v curl > /dev/null || die "curl is missing: apt install curl"

if ! command -v docker > /dev/null; then
    warn "docker isn't installed."
    if confirm "install docker with its official script (get.docker.com)?"; then
        curl -fsSL https://get.docker.com | sh
    else
        die "docker is needed. install it and run this script again."
    fi
fi
docker compose version > /dev/null 2>&1 || die "docker compose is missing: apt install docker-compose-plugin"
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?')"

if ! command -v nginx > /dev/null; then
    warn "nginx isn't installed."
    if confirm "install nginx with apt?"; then
        apt-get update && apt-get install -y nginx
    else
        die "nginx is needed. install it and run this script again."
    fi
fi
nginx -t > /dev/null 2>&1 || die "the current nginx config has errors (nginx -t). fix them first, this script won't touch a broken config."
ok "nginx, current config is valid"

[[ -e /dev/net/tun ]] || die "/dev/net/tun is missing, warp can't run. the server needs kvm virtualization (not openvz/lxc)."
ok "/dev/net/tun (needed by warp)"

# ---------------------------------------------------------------- settings
echo
bold "2. settings"

mkdir -p "$INSTALL_DIR"
chmod 700 "$INSTALL_DIR"
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$INSTALL_DIR/.env"
    chmod 600 "$INSTALL_DIR/.env"
    FIRST_INSTALL=1
else
    FIRST_INSTALL=0
    ok "using the existing settings in $INSTALL_DIR/.env"
fi

WEB_DOMAIN="$(env_get WEB_DOMAIN)"
API_DOMAIN="$(env_get API_DOMAIN)"
API_PORT="$(env_get API_PORT)"

if [[ $FIRST_INSTALL -eq 1 ]]; then
    WEB_DOMAIN="$(ask "domain of the website" "${WEB_DOMAIN:-fetchr.download}")"
    API_DOMAIN="$(ask "domain of the api" "api.$WEB_DOMAIN")"
fi

domain_re='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
[[ "$WEB_DOMAIN" =~ $domain_re && "$API_DOMAIN" =~ $domain_re ]] || die "invalid domain: $WEB_DOMAIN / $API_DOMAIN"
[[ "$WEB_DOMAIN" != "$API_DOMAIN" ]] || die "the website and the api need different domains"

# a free local port for the api
API_PORT="${API_PORT:-9000}"
port_used() { ss -Hltn "sport = :$1" 2>/dev/null | grep -q .; }
# (when updating, the port is taken by fetchr's own api)
if port_used "$API_PORT" && [[ -z "$(docker compose -f "$INSTALL_DIR/docker-compose.yml" ps -q api 2>/dev/null)" ]]; then
    for candidate in $(seq 9001 9099); do
        if ! port_used "$candidate"; then API_PORT="$candidate"; break; fi
    done
    warn "port 9000 is taken, the api will use 127.0.0.1:$API_PORT"
fi

# the domains must not be used by another site on this server
domain_in_use() {
    # exact match against server_name entries of nginx configs other than fetchr's
    nginx -T 2>/dev/null | awk -v domain="$1" '
        /^# configuration file / { file = $4 }
        $1 == "server_name" && file !~ /fetchr-(web|api)\.conf/ {
            for (i = 2; i <= NF; i++) {
                name = $i
                sub(/;$/, "", name)
                if (name == domain) found = 1
            }
        }
        END { exit !found }'
}
for domain in "$WEB_DOMAIN" "$API_DOMAIN"; do
    if domain_in_use "$domain"; then
        die "$domain is already used by another nginx site on this server. choose another domain."
    fi
done

env_set WEB_DOMAIN "$WEB_DOMAIN"
env_set API_DOMAIN "$API_DOMAIN"
env_set API_PORT "$API_PORT"

# api key of the telegram bot
if [[ ! -f "$INSTALL_DIR/keys.json" ]]; then
    BOT_API_KEY="$(cat /proc/sys/kernel/random/uuid)"
    printf '{\n    "%s": {\n        "name": "telegram bot",\n        "limit": "unlimited"\n    }\n}\n' "$BOT_API_KEY" > "$INSTALL_DIR/keys.json"
    env_set BOT_API_KEY "$BOT_API_KEY"
fi
# the api runs as an unprivileged user and only needs to read it
chmod 644 "$INSTALL_DIR/keys.json"

if [[ $FIRST_INSTALL -eq 1 ]] && confirm "set up the telegram bot now? (it can be done later too)"; then
    BOT_TOKEN="$(ask "bot token from @BotFather" "")"
    if [[ "$BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
        env_set BOT_TOKEN "$BOT_TOKEN"
        env_set COMPOSE_PROFILES "bot"
        admin_id="$(ask "your numeric telegram id, for the admin panel (find it with @userinfobot)" "")"
        [[ "$admin_id" =~ ^[0-9]+$ ]] && env_set BOT_ADMIN_IDS "$admin_id"
    else
        warn "that doesn't look like a bot token, skipping the bot"
    fi
fi

# a local telegram bot api server lets the bot send files up to 2000 MB
# instead of 50 MB. asked once, when the bot is set up.
if [[ -n "$(env_get BOT_TOKEN)" && -z "$(env_get TELEGRAM_API_URL)" && "$(env_get LOCAL_BOT_API)" != "no" ]]; then
    echo
    info "the bot can send files up to 50 MB. with a local bot api server, up to 2000 MB."
    info "it needs an api_id and api_hash from https://my.telegram.org (\"API development tools\")."
    if confirm "set up the local bot api server now?"; then
        api_id="$(ask "api_id" "")"
        api_hash="$(ask "api_hash" "")"

        if [[ "$api_id" =~ ^[0-9]+$ && "$api_hash" =~ ^[0-9a-f]{32}$ ]]; then
            env_set TELEGRAM_API_ID "$api_id"
            env_set TELEGRAM_API_HASH "$api_hash"
            env_set TELEGRAM_API_URL "http://telegram-bot-api:8081"
            env_set COMPOSE_PROFILES "bot,bot-api-server"

            # a bot has to log out of telegram's own servers once before a
            # local server can use it (it can't log back in there for 10 minutes)
            if curl -s --max-time 20 "https://api.telegram.org/bot$(env_get BOT_TOKEN)/logOut" | grep -q '"ok":true'; then
                ok "the bot logged out of telegram's servers, the local server takes over"
            else
                warn "couldn't log the bot out of telegram's servers (maybe it already was). if the bot doesn't answer, open https://api.telegram.org/bot<token>/logOut once."
            fi
            ok "local bot api server: files up to 2000 MB"
        else
            warn "the api_id must be a number and the api_hash 32 characters (0-9, a-f), skipping"
        fi
    else
        env_set LOCAL_BOT_API "no"
        info "skipped, the limit stays at 50 MB. to set it up later, remove LOCAL_BOT_API=no from .env and run this script again."
    fi
fi

cp "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
mkdir -p "$INSTALL_DIR/warp-data" "$INSTALL_DIR/bot-data"
# the bot runs as an unprivileged user (uid 1000) and keeps its database here
chown 1000:1000 "$INSTALL_DIR/bot-data"
ok "settings saved in $INSTALL_DIR"

# ---------------------------------------------------------------- web app
echo
bold "3. website files"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [[ -n "${WEB_ARCHIVE:-}" ]]; then
    cp "$WEB_ARCHIVE" "$tmp/web.tar.gz"
else
    curl -fsSL "https://github.com/$REPO/releases/latest/download/fetchr-web.tar.gz" -o "$tmp/web.tar.gz" \
        || die "couldn't download the website from the latest github release of $REPO. is there a release yet?"
fi

release="$WEB_ROOT/releases/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$release"
tar -xzf "$tmp/web.tar.gz" -C "$release"
[[ -f "$release/index.html" ]] || die "the website archive doesn't contain index.html"

# switch atomically, then keep only the last 3 versions
ln -sfn "$release" "$WEB_ROOT/current.new"
mv -Tf "$WEB_ROOT/current.new" "$WEB_ROOT/current"
ls -1dt "$WEB_ROOT"/releases/* | tail -n +4 | xargs -r rm -rf
chmod -R a+rX "$WEB_ROOT"
ok "website in $WEB_ROOT/current"

if ! grep -rqF "https://$API_DOMAIN" "$release/_app" 2>/dev/null; then
    warn "this build of the website uses a different api than https://$API_DOMAIN/."
    warn "set the WEB_DEFAULT_API repository variable on github and make a new release, see deploy/README.md."
fi

# ---------------------------------------------------------------- nginx
echo
bold "4. nginx"

if [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]]; then
    available=/etc/nginx/sites-available
    enabled=/etc/nginx/sites-enabled
else
    available=/etc/nginx/conf.d
    enabled=""
fi

written=()
backups=()
rollback() {
    for file in "${written[@]}"; do rm -f "$file"; done
    for backup in "${backups[@]}"; do mv -f "$backup" "${backup%.fetchr-backup}"; done
}

for name in fetchr-web fetchr-api; do
    target="$available/$name.conf"
    # certbot adds https to these files, so an existing file is kept as is
    if [[ -f "$target" ]]; then
        ok "$target already exists, keeping it"
        continue
    fi

    sed -e "s/__WEB_DOMAIN__/$WEB_DOMAIN/g" \
        -e "s/__API_DOMAIN__/$API_DOMAIN/g" \
        -e "s/__API_PORT__/$API_PORT/g" \
        "$SCRIPT_DIR/nginx/$name.conf" > "$target"
    written+=("$target")

    if [[ -n "$enabled" ]]; then
        ln -sf "$target" "$enabled/$name.conf"
        written+=("$enabled/$name.conf")
    fi
done

# the port of an existing api config follows the settings
api_conf="$available/fetchr-api.conf"
if ! grep -qF "127.0.0.1:$API_PORT;" "$api_conf"; then
    cp "$api_conf" "$api_conf.fetchr-backup"
    backups+=("$api_conf.fetchr-backup")
    sed -i -E "s#proxy_pass http://127\.0\.0\.1:[0-9]+;#proxy_pass http://127.0.0.1:$API_PORT;#" "$api_conf"
fi

# web configs from older versions don't send .mjs files (ffmpeg in the
# browser) as javascript, so on-device processing always failed. the block is
# added to each server block of the site (certbot may have made more than one).
web_conf="$available/fetchr-web.conf"
if ! grep -qF "fetchr-mjs" "$web_conf"; then
    cp "$web_conf" "$web_conf.fetchr-backup"
    backups+=("$web_conf.fetchr-backup")
    awk '
        { print }
        /^[[:space:]]*root \/var\/www\/fetchr\/current;/ {
            print ""
            print "    # fetchr-mjs: javascript modules (ffmpeg in the browser). nginx versions"
            print "    # that don'"'"'t know the .mjs extension send it as application/octet-stream,"
            print "    # and browsers refuse to run that as a module."
            print "    location ~* \\.mjs$ {"
            print "        default_type text/javascript;"
            print "    }"
        }
    ' "$web_conf.fetchr-backup" > "$web_conf"
    ok "javascript modules (.mjs) are sent with the right type now"
fi

if ! nginx -t > "$tmp/nginx-test" 2>&1; then
    cat "$tmp/nginx-test" >&2
    rollback
    die "the new nginx config didn't pass nginx -t, so it was removed again. nothing else was changed."
fi
for backup in "${backups[@]}"; do rm -f "$backup"; done

systemctl reload nginx
ok "nginx reloaded with $WEB_DOMAIN and $API_DOMAIN"

# ---------------------------------------------------------------- containers
echo
bold "5. containers"

cd "$INSTALL_DIR"
docker compose pull
docker compose up -d --remove-orphans
ok "containers are running"

info "waiting for the api..."
for _ in $(seq 1 30); do
    if curl -fs "http://127.0.0.1:$API_PORT/" > "$tmp/info" 2>/dev/null; then break; fi
    sleep 2
done
grep -q '"fetchr"' "$tmp/info" 2>/dev/null && ok "api answers on 127.0.0.1:$API_PORT" || warn "the api doesn't answer yet, check: docker compose -f $INSTALL_DIR/docker-compose.yml logs api"

info "checking warp..."
warp_status=""
for _ in $(seq 1 15); do
    warp_status="$(docker compose exec -T warp curl -s --max-time 10 --socks5-hostname 127.0.0.1:1080 https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null | grep '^warp=' || true)"
    [[ "$warp_status" == "warp=on" || "$warp_status" == "warp=plus" ]] && break
    sleep 4
done
[[ "$warp_status" == "warp=on" || "$warp_status" == "warp=plus" ]] && ok "warp is connected ($warp_status)" || warn "warp isn't connected yet ($warp_status), check: docker compose -f $INSTALL_DIR/docker-compose.yml logs warp"

# ---------------------------------------------------------------- monitor
echo
bold "6. monitoring"

cp "$SCRIPT_DIR/monitor.sh" "$INSTALL_DIR/monitor.sh"
chmod 755 "$INSTALL_DIR/monitor.sh"

if systemctl list-unit-files fetchr-monitor.timer > /dev/null 2>&1 && [[ -f /etc/systemd/system/fetchr-monitor.timer ]]; then
    ok "monitoring is on (updated)"
elif confirm "check fetchr every 10 minutes, fix what's possible and alert the bot's admins in telegram?"; then
    sed "s#__INSTALL_DIR__#$INSTALL_DIR#g" "$SCRIPT_DIR/systemd/fetchr-monitor.service" > /etc/systemd/system/fetchr-monitor.service
    cp "$SCRIPT_DIR/systemd/fetchr-monitor.timer" /etc/systemd/system/fetchr-monitor.timer
    systemctl daemon-reload
    systemctl enable --now fetchr-monitor.timer > /dev/null 2>&1
    ok "monitoring is on"
    [[ -n "$(env_get BOT_ADMIN_IDS)" ]] || warn "alerts go to the bot's admins: set BOT_TOKEN and BOT_ADMIN_IDS in $INSTALL_DIR/.env"
else
    info "monitoring is off. turn it on later by running this script again."
fi

# ---------------------------------------------------------------- https
echo
bold "7. https"

if grep -q "listen 443" "$available/fetchr-web.conf" && grep -q "listen 443" "$available/fetchr-api.conf"; then
    ok "https is already set up"
else
    server_ip="$(curl -4 -fs --max-time 5 https://api.ipify.org || true)"
    for domain in "$WEB_DOMAIN" "$API_DOMAIN"; do
        resolved="$(getent ahostsv4 "$domain" | awk 'NR == 1 { print $1 }')"
        if [[ -z "$resolved" ]]; then
            warn "$domain doesn't resolve yet. add an A record pointing to ${server_ip:-this server}."
        elif [[ -n "$server_ip" && "$resolved" != "$server_ip" ]]; then
            warn "$domain points to $resolved, but this server is $server_ip."
        fi
    done

    if ! command -v certbot > /dev/null; then
        if confirm "install certbot (free https certificates from let's encrypt) with apt?"; then
            apt-get update && apt-get install -y certbot python3-certbot-nginx
        fi
    fi

    if command -v certbot > /dev/null && confirm "get https certificates for $WEB_DOMAIN and $API_DOMAIN now? (dns must already point here)"; then
        email="$(ask "email for certificate expiry notices" "")"
        email_args=(--register-unsafely-without-email)
        [[ -n "$email" ]] && email_args=(-m "$email")
        # certbot only edits the server blocks of these two domains
        certbot --nginx --non-interactive --agree-tos --redirect "${email_args[@]}" \
            -d "$WEB_DOMAIN" -d "$API_DOMAIN" \
            && ok "https is set up" \
            || warn "certbot failed. once dns points here, run: certbot --nginx -d $WEB_DOMAIN -d $API_DOMAIN"
    else
        warn "no https yet. later run: certbot --nginx -d $WEB_DOMAIN -d $API_DOMAIN"
    fi
fi

# ---------------------------------------------------------------- done
echo
bold "done!"
info "website: https://$WEB_DOMAIN"
info "api:     https://$API_DOMAIN"
info "settings: $INSTALL_DIR/.env (after changing it: cd $INSTALL_DIR && docker compose up -d)"
[[ "$(env_get COMPOSE_PROFILES)" == *bot* ]] && info "telegram bot is on" || info "telegram bot is off (see deploy/README.md to turn it on)"
info "to update later, run this script again."
info "status of everything: sudo $INSTALL_DIR/monitor.sh --report"
