#!/usr/bin/env bash
# checks fetchr every few minutes (run by the fetchr-monitor systemd timer),
# fixes what it can and tells the bot's admins in telegram when something
# breaks or works again.
#
#   sudo /opt/fetchr/monitor.sh               run the checks (what the timer does)
#   sudo /opt/fetchr/monitor.sh --report      only show the results, no fixes or alerts
#   sudo /opt/fetchr/monitor.sh --test-alert  send a test message to the admins
#
# checks: the api answers, warp is connected, a youtube video can actually be
# downloaded, all containers run, and the disk isn't full.
# fixes: restarts a stuck api or warp, and when youtube fails, registers warp
# again to get a new ip (at most once an hour).

set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/fetchr}"
STATE_DIR="${STATE_DIR:-/var/lib/fetchr-monitor}"
MODE="${1:-}"

cd "$INSTALL_DIR" || { echo "no fetchr installation in $INSTALL_DIR" >&2; exit 1; }
mkdir -p "$STATE_DIR"

env_get() {
    grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- || true
}

API_PORT="$(env_get API_PORT)"; API_PORT="${API_PORT:-9000}"
ADMIN_IDS="$(env_get BOT_ADMIN_IDS)"
LANGUAGE="$(env_get MONITOR_LANGUAGE)"; LANGUAGE="${LANGUAGE:-fa}"
# a short, old video that's unlikely to disappear ("me at the zoo")
YOUTUBE_URL="$(env_get MONITOR_YOUTUBE_URL)"; YOUTUBE_URL="${YOUTUBE_URL:-https://www.youtube.com/watch?v=jNQXAC9IVRw}"
DISK_LIMIT="${DISK_LIMIT:-90}"

compose() { docker compose "$@"; }
log() { echo "$(date -Is) $*"; }

# ------------------------------------------------------------ messages

text() {
    local key="$1"
    if [[ "$LANGUAGE" == "fa" ]]; then
        case "$key" in
            api.fail) echo "🔴 API پاسخ نمی‌دهد." ;;
            api.ok) echo "🟢 API دوباره کار می‌کند." ;;
            api.fixed) echo "🔧 API پاسخ نمی‌داد و دوباره راه‌اندازی شد. الان کار می‌کند." ;;
            warp.fail) echo "🔴 WARP وصل نیست. دانلود از یوتیوب کار نمی‌کند." ;;
            warp.ok) echo "🟢 WARP دوباره وصل است." ;;
            warp.fixed) echo "🔧 WARP وصل نبود و دوباره راه‌اندازی شد. الان وصل است." ;;
            youtube.fail) echo "🔴 دانلود از یوتیوب کار نمی‌کند." ;;
            youtube.ok) echo "🟢 دانلود از یوتیوب دوباره کار می‌کند." ;;
            youtube.fixed) echo "🔧 یوتیوب IP قبلی WARP را بلاک کرده بود. WARP دوباره ثبت‌نام شد و IP جدید گرفت. دانلود از یوتیوب دوباره کار می‌کند." ;;
            youtube.unfixed) echo "ثبت‌نام دوباره‌ی WARP هم کمکی نکرد. لاگ‌ها را بررسی کنید: docker compose logs api warp yt-session-generator" ;;
            containers.fail) echo "🔴 این کانتینرها اجرا نمی‌شوند:" ;;
            containers.ok) echo "🟢 همه‌ی کانتینرها دوباره اجرا می‌شوند." ;;
            disk.fail) echo "🔴 دیسک سرور تقریباً پر است:" ;;
            disk.ok) echo "🟢 فضای دیسک دوباره کافی است." ;;
            test) echo "✅ پیام آزمایشی نظارت fetchr. هشدارها به همین‌جا فرستاده می‌شوند." ;;
            server) echo "سرور" ;;
        esac
    else
        case "$key" in
            api.fail) echo "🔴 the api doesn't answer." ;;
            api.ok) echo "🟢 the api works again." ;;
            api.fixed) echo "🔧 the api didn't answer and was restarted. it works now." ;;
            warp.fail) echo "🔴 warp isn't connected. youtube downloads don't work." ;;
            warp.ok) echo "🟢 warp is connected again." ;;
            warp.fixed) echo "🔧 warp wasn't connected and was restarted. it's connected now." ;;
            youtube.fail) echo "🔴 youtube downloads don't work." ;;
            youtube.ok) echo "🟢 youtube downloads work again." ;;
            youtube.fixed) echo "🔧 youtube had blocked warp's ip. warp registered again and got a new ip. youtube downloads work again." ;;
            youtube.unfixed) echo "registering warp again didn't help. check the logs: docker compose logs api warp yt-session-generator" ;;
            containers.fail) echo "🔴 these containers aren't running:" ;;
            containers.ok) echo "🟢 all containers are running again." ;;
            disk.fail) echo "🔴 the server's disk is almost full:" ;;
            disk.ok) echo "🟢 there's enough disk space again." ;;
            test) echo "✅ test message from fetchr's monitor. alerts will be sent here." ;;
            server) echo "server" ;;
        esac
    fi
}

# sends a message to every admin through the bot. the bot's container knows
# the token and the telegram api (also a local bot api server), so it's used
# when it runs. otherwise telegram is called directly.
alert() {
    local message="🖥 fetchr · $(hostname)"$'\n\n'"$1"
    log "alert: $1"

    [[ -n "$ADMIN_IDS" ]] || { log "no BOT_ADMIN_IDS in .env, the alert isn't sent"; return; }

    if [[ -n "$(compose ps -q --status running bot 2>/dev/null)" ]]; then
        compose exec -T -e ALERT_TEXT="$message" -e ALERT_CHATS="$ADMIN_IDS" bot node -e '
            const api = (process.env.TELEGRAM_API_URL || "https://api.telegram.org").replace(/\/+$/, "");
            const chats = process.env.ALERT_CHATS.split(/[,\s]+/).filter(Boolean);
            Promise.all(chats.map(chat_id => fetch(`${api}/bot${process.env.BOT_TOKEN}/sendMessage`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ chat_id, text: process.env.ALERT_TEXT }),
            }))).catch(() => process.exit(1));
        ' > /dev/null 2>&1 && return
    fi

    local token
    token="$(env_get BOT_TOKEN)"
    [[ -n "$token" && -z "$(env_get TELEGRAM_API_URL)" ]] || { log "the bot isn't running, the alert isn't sent"; return; }

    for chat in ${ADMIN_IDS//,/ }; do
        curl -s --max-time 20 "https://api.telegram.org/bot$token/sendMessage" \
            --data-urlencode "chat_id=$chat" --data-urlencode "text=$message" > /dev/null || true
    done
}

# ------------------------------------------------------------ checks

check_api() {
    curl -fs --max-time 10 "http://127.0.0.1:$API_PORT/" 2>/dev/null | grep -q '"fetchr"'
}

check_warp() {
    compose exec -T warp curl -s --max-time 15 --socks5-hostname 127.0.0.1:1080 \
        https://www.cloudflare.com/cdn-cgi/trace 2>/dev/null | grep -qE '^warp=(on|plus)'
}

# asks the api for a youtube video and downloads the start of the file,
# which is where blocks show up (getting the info alone often still works)
check_youtube() {
    local response url
    response="$(curl -s --max-time 60 "http://127.0.0.1:$API_PORT/" \
        -H "accept: application/json" -H "content-type: application/json" \
        -d "{\"url\":\"$YOUTUBE_URL\",\"downloadMode\":\"audio\",\"audioFormat\":\"best\",\"alwaysProxy\":true}" 2>/dev/null)"

    url="$(printf '%s' "$response" | grep -oE '"url":"[^"]+"' | head -n1 | cut -d'"' -f4)"
    if [[ -z "$url" ]]; then
        YOUTUBE_ERROR="$(printf '%s' "$response" | grep -oE '"code":"[^"]+"' | cut -d'"' -f4)"
        return 1
    fi

    # the tunnel is fetched locally instead of through the public domain
    url="http://127.0.0.1:$API_PORT/${url#*://*/}"
    local bytes
    bytes="$(curl -s --max-time 60 "$url" 2>/dev/null | head -c 200000 | wc -c)"
    if (( bytes < 10000 )); then
        YOUTUBE_ERROR="download returned $bytes bytes"
        return 1
    fi
}

check_containers() {
    local expected running missing=()
    expected="$(compose config --services 2>/dev/null)"
    running="$(compose ps --status running --services 2>/dev/null)"
    for service in $expected; do
        grep -qx "$service" <<< "$running" || missing+=("$service")
    done
    MISSING_CONTAINERS="${missing[*]}"
    [[ ${#missing[@]} -eq 0 ]]
}

check_disk() {
    DISK_USAGE="$(df --output=pcent / | tail -n1 | tr -dc '0-9')"
    (( DISK_USAGE < DISK_LIMIT ))
}

# ------------------------------------------------------------ fixes

# true if the fix ran less than $2 seconds ago (fixes are rate limited)
recently() {
    local file="$STATE_DIR/fix-$1"
    [[ -f "$file" ]] && (( $(date +%s) - $(cat "$file") < $2 ))
}

mark_fix() {
    date +%s > "$STATE_DIR/fix-$1"
}

wait_for() {
    # wait_for check seconds
    local deadline=$(( $(date +%s) + $2 ))
    while (( $(date +%s) < deadline )); do
        "$1" && return 0
        sleep 5
    done
    return 1
}

fix_api() {
    recently api 1800 && return 1
    mark_fix api
    log "restarting the api"
    compose restart api > /dev/null 2>&1
    wait_for check_api 60
}

fix_warp() {
    recently warp 1800 && return 1
    mark_fix warp
    log "restarting warp"
    compose restart warp > /dev/null 2>&1
    wait_for check_warp 90
}

# a new warp registration usually comes with a new ip
fix_youtube() {
    recently youtube 3600 && return 1
    mark_fix youtube
    log "registering warp again"
    compose stop warp > /dev/null 2>&1
    find "$INSTALL_DIR/warp-data" -mindepth 1 -delete 2>/dev/null
    compose up -d warp > /dev/null 2>&1
    wait_for check_warp 120 || return 1
    check_youtube
}

# ------------------------------------------------------------ state

# alerts are sent only when a check changes between ok and failing
previous() {
    cat "$STATE_DIR/$1" 2>/dev/null || echo ok
}

report() {
    # report name ok|fail [details] [fixed]
    local name="$1" status="$2" details="${3:-}" fixed="${4:-}"

    if [[ "$MODE" == "--report" ]]; then
        printf '%-11s %s %s\n' "$name" "$status" "$details"
        return
    fi

    local before
    before="$(previous "$name")"
    echo "$status" > "$STATE_DIR/$name"

    if [[ -n "$fixed" ]]; then
        alert "$(text "$name.fixed")"
    elif [[ "$status" == "fail" && "$before" == "ok" ]]; then
        alert "$(text "$name.fail")${details:+ $details}"
    elif [[ "$status" == "ok" && "$before" == "fail" ]]; then
        alert "$(text "$name.ok")"
    fi
}

# ------------------------------------------------------------ run

if [[ "$MODE" == "--test-alert" ]]; then
    alert "$(text test)"
    exit 0
fi

# only one run at a time
exec 9> "$STATE_DIR/lock"
flock -n 9 || exit 0

can_fix() { [[ "$MODE" != "--report" ]]; }

if check_containers; then
    report containers ok
else
    report containers fail "$MISSING_CONTAINERS"
fi

if check_disk; then
    report disk ok "$DISK_USAGE%"
else
    report disk fail "$DISK_USAGE%"
fi

api_ok=0
if check_api; then
    report api ok
    api_ok=1
elif can_fix && fix_api; then
    report api ok "" fixed
    api_ok=1
else
    report api fail
fi

warp_ok=0
if check_warp; then
    report warp ok
    warp_ok=1
elif can_fix && fix_warp; then
    report warp ok "" fixed
    warp_ok=1
else
    report warp fail
fi

# youtube can only work when the api and warp do
if (( api_ok && warp_ok )); then
    YOUTUBE_ERROR=""
    if check_youtube; then
        report youtube ok
    elif can_fix && fix_youtube; then
        report youtube ok "" fixed
    else
        details="${YOUTUBE_ERROR:+($YOUTUBE_ERROR)}"
        if can_fix && [[ "$(previous youtube)" == "ok" ]] && recently youtube 60; then
            details="$details"$'\n'"$(text youtube.unfixed)"
        fi
        report youtube fail "$details"
    fi
fi
