#!/usr/bin/env bash
set -uo pipefail
umask 077
system="${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}"
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1
cd -- "$directory" || exit 1
action="${1:-cli}"
role="${2:-}"
instance="${3:-}"
line='───────────────────────────────────────────────'
quiet=0
export OANISMAJOR_COLOR=0
[[ ! -t 1 ]] || export OANISMAJOR_COLOR=1
declare -A message

finish() {
  local code=$?
  trap - EXIT
  if [[ "$quiet" != 1 && -t 0 && ("$action" != cli || "$code" != 0) ]]; then
    read -r choice || true
  fi
  exit "$code"
}
trap finish EXIT

paint() {
  local tone="$1"
  shift
  local color='110;110;110'
  case "$tone" in success) color='52;199;89' ;; error) color='255;69;58' ;; esac
  if [[ -t 1 ]]; then printf '\r\033[38;2;%sm%s\033[0m\r\n' "$color" "$*"; else printf '%s\n' "$*"; fi
}

banner() {
  cat was/banner.txt
}

load() {
  local language values
  values="$(
    python3 - "$system" << 'PY'
import json, pathlib, sys
p = pathlib.Path('.')
c = json.loads((p / 'servers.json').read_text(encoding='utf-8-sig'))
l = json.loads((p / 'local.json').read_text(encoding='utf-8-sig')) if (p / 'local.json').exists() else {}
c.update(l)
lang = l.get('lang')
if lang not in ('ko', 'en'):
    lang = 'ko' if sys.argv[1].lower().startswith('ko') else 'en'
for value in (lang, c['root'], c['node']):
    if not isinstance(value, str) or '\n' in value or '\t' in value:
        raise ValueError('Invalid configuration')
    print(value)
PY
  )" || return 1
  mapfile -t config <<< "$values"
  language="${config[0]}"
  root="${config[1]}"
  node="${config[2]}"
  export OANISMAJOR_LANG="$language"
  while IFS=$'\t' read -r key value; do message["$key"]="$value"; done < <(
    python3 - "was/i18n/$language.json" << 'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    for key, value in json.load(f).items():
        if isinstance(value, str): print(key + '\t' + value)
        elif key == 'targets':
            for action, label in value.items(): print('target'+action+'\t'+label)
        elif key == 'setup':
            for index, label in enumerate(value, 1): print('setup' + str(index) + '\t' + label)
        elif key == 'progress':
            for name, label in value.items(): print('progress'+name+'\t'+label)
PY
  )
}

ready() {
  [[ -f local.json && -x "$node" && -f "$root/run.js" && -f /etc/systemd/system/was.service ]] || return 1
  python3 - << 'PY'
import json, sys
with open('local.json', encoding='utf-8-sig') as f:
    sys.exit(0 if json.load(f).get('cluster') else 1)
PY
}

prepare() {
  local address primary choice host='' email='' environment
  if [[ -f local.json ]]; then
    if python3 - << 'PY'; then return 0; fi
import json, sys
with open('local.json', encoding='utf-8-sig') as f:
    sys.exit(0 if json.load(f).get('cluster') else 1)
PY
  fi
  printf '%s\n' "${message[install]}"
  read -r -p "${message[address]}: " address || return 1
  for choice in 1 2; do printf '%s. %s\n' "$choice" "${message[setup$choice]}"; done
  read -r -p "${message[select]}: " choice || return 1
  [[ "$choice" =~ ^[1-2]$ ]] || {
    paint error "${message[invalid]}"
    return 1
  }
  primary="$address"
  if [[ "$choice" == 1 ]]; then
    read -r -p "${message[host]}: " host || return 1
    read -r -p "${message[email]}: " email || return 1
  else
    read -r -p "${message[primary]}: " primary || return 1
    if [[ ! -f .env ]]; then
      read -r -p "${message[env]}: " environment || return 1
      cp -- "$environment" .env || return 1
    fi
  fi
  python3 - "$address" "$primary" "$choice" "$host" "$email" << 'PY'
import ipaddress, json, pathlib, re, sys
address, primary, choice, host, email = sys.argv[1:]
network = ipaddress.ip_network('100.64.0.0/10')
if any(ipaddress.ip_address(v) not in network for v in (address, primary)):
    raise ValueError('Invalid Tailscale IP')
if choice != '1' and address == primary:
    raise ValueError('Use different server addresses')
p = pathlib.Path('local.json')
c = json.loads(p.read_text(encoding='utf-8-sig')) if p.exists() else {}
c.update(was=[3001], web=[8081], db=[],
         https=True if choice == '1' else None,
         cluster=dict(address=address, network=str(network), storage=primary+':/srv/oanismajor/storage'))
if choice in ('1','2'):
    c['db'] = [dict(name='main' if choice=='1' else 'replica', version=18,
                    port=5432, role='primary' if choice=='1' else 'replica')]
if choice == '1':
    if not re.fullmatch(r'[a-zA-Z0-9.-]+', host) or not re.fullmatch(r'[a-zA-Z0-9.+_-]+@[a-zA-Z0-9.-]+', email):
        raise ValueError('Invalid HTTPS address or email')
    env = pathlib.Path('.env')
    content = env.read_text(encoding='utf-8-sig') if env.exists() else ''
    for key,value in [('HTTPS_HOST',host),('HTTPS_EMAIL',email)]:
        pattern = r'(?m)^(?:export\s+)?'+key+r'\s*=.*$'
        content = re.sub(pattern, key+'='+value, content) if re.search(pattern, content) else content+'\n'+key+'='+value+'\n'
    env.write_text(content, encoding='utf-8')
p.write_text(json.dumps(c, indent=2)+'\n', encoding='utf-8')
PY
}

install() {
  local log="$2"
  if bash was/install.sh "$directory" "$1" 2>&1 | while IFS= read -r value; do
    printf '%s\n' "$value" >> "$log"
    if [[ "$value" == @oanismajor:* ]]; then
      paint success "${message[progress${value#@oanismajor:}]}"
    fi
  done; then
    load || return 1
    ready
  else
    return 1
  fi
}

settings() {
  local choice language
  while true; do
    printf '%s\n%s\n1. %s\n0. %s\n' "$line" "${message[settings]}" "${message[language]}" "${message[back]}"
    read -r -p "${message[select]}: " choice || return 0
    case "$choice" in
      0) return 0 ;;
      1)
        printf '1. %s\n2. 한국어\n3. English\n0. %s\n' "${message[auto]}" "${message[back]}"
        read -r -p "${message[select]}: " choice || return 0
        case "$choice" in
          0) continue ;;
          1) language=auto ;; 2) language=ko ;; 3) language=en ;;
          *)
            paint error "${message[invalid]}"
            continue
            ;;
        esac
        python3 - "$language" << 'PY'
import json, pathlib, sys
p = pathlib.Path('local.json')
c = json.loads(p.read_text(encoding='utf-8-sig'))
c['lang'] = sys.argv[1]
p.write_text(json.dumps(c, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
PY
        load || return 1
        paint success "${message[saved]}"
        ;;
      *) paint error "${message[invalid]}" ;;
    esac
  done
}

available() {
  local query=starting
  [[ "$1" != stop ]] || query=stopping
  (cd -- "$root" && "$node" "$root/run.js" "$query")
}

choose() {
  local command="$1" output choice index previous
  local -a names
  quiet=1
  if ! output="$(available "$command")"; then
    quiet=0
    paint error "${message[target$command]} ${message[failed]}"
    return 1
  fi
  [[ -n "$output" && -t 0 ]] || return 0
  mapfile -t names <<< "$output"
  while true; do
    paint mute "1. ${message[all]}"
    for index in "${!names[@]}"; do paint mute "$((index + 2)). ${names[$index]^^}"; done
    paint mute "0. ${message[back]}"
    read -r -p "${message[select]}: " choice || return 0
    [[ "$choice" != 0 ]] || return 0
    if [[ "$choice" == 1 ]]; then
      run "$command"
      return $?
    fi
    if [[ "$choice" =~ ^[2-4]$ ]] && ((choice <= ${#names[@]} + 1)); then
      previous="$role"
      role="${names[$((choice - 2))]}"
      run "$command"
      local result=$?
      role="$previous"
      return "$result"
    fi
    paint error "${message[invalid]}"
  done
}

run() {
  local command="$1" log result=1
  local -a arguments
  if { [[ "$command" == install ]] && ready; } || { [[ "$command" == uninstall ]] && ! ready; }; then
    quiet=1
    return 0
  fi
  log="$(mktemp /tmp/oanismajor.XXXXXXXX.log)" || return 1
  quiet=0
  [[ "$command" == stop ]] || paint mute "$line"
  if [[ "$command" == install ]] || ready; then
    if [[ "$command" == install ]]; then
      if prepare && install install "$log"; then result=0; fi
    elif [[ "$command" == update ]]; then
      if install update "$log"; then result=0; fi
    else
      arguments=("$node" "$root/run.js" "$command")
      [[ -z "$role" ]] || arguments+=("$role")
      [[ -z "$instance" ]] || arguments+=("$instance")
      if [[ "$command" == status || "$command" == logs ]]; then
        if (cd -- "$root" && "${arguments[@]}"); then result=0; fi
      elif (cd -- "$root" && "${arguments[@]}") 2>&1 | tee "$log"; then
        result=0
        if [[ "$command" == stop && ! -s "$log" ]]; then quiet=1; fi
      fi
    fi
  else
    paint error "${message[missing]}" >> "$log"
  fi
  if ((result == 0)); then
    if [[ "$command" == start || "$command" == stop || "$command" == restart || "$command" == update ]]; then quiet=1; fi
    rm -f -- "$log"
  else
    paint error "${message[target$command]} ${message[failed]}"
    paint mute "${message[detail]}: $log"
  fi
  return "$result"
}

if ! command -v python3 > /dev/null; then
  printf '%s\n' 'Python 3: python3'
  exit 1
fi
load || exit 1
if { [[ "$action" == install ]] && ready; } || { [[ "$action" == uninstall ]] && ! ready; }; then
  quiet=1
  exit 0
fi
[[ "$action" == start || "$action" == stop ]] || banner
if ((EUID != 0)); then
  paint error "${message[sudo]}"
  exit 1
fi
case "$action" in
  cli | start | stop | restart | status | logs | update | install | uninstall) ;;
  *)
    paint error "${message[invalid]}"
    exit 1
    ;;
esac
case "$role" in '' | was | web | db) ;; *)
  paint error "${message[invalid]}"
  exit 1
  ;;
esac
if [[ "$action" != cli ]]; then
  if [[ ("$action" == start || "$action" == stop) && -z "$role" ]]; then choose "$action"; else run "$action"; fi
  exit $?
fi
if ! ready; then
  run install || exit 1
fi
commands=(start stop restart status logs update)
while true; do
  if [[ -t 1 ]]; then printf '\033[2J\033[H'; fi
  banner
  if ! run status; then
    read -r choice || break
  fi
  paint mute "$line"
  starting="$(available start)" || exit 1
  stopping="$(available stop)" || exit 1
  for index in "${!commands[@]}"; do
    [[ "$index" != 0 || -n "$starting" ]] || continue
    [[ "$index" != 1 || -n "$stopping" ]] || continue
    label="${commands[$index]}"
    [[ "$label" != status ]] || label=refresh
    paint mute "$((index + 1)). ${message[$label]}"
  done
  paint mute "7. ${message[settings]}"
  paint mute "0. ${message[exit]}"
  read -r -p "${message[select]}: " choice || break
  case "$choice" in
    0) break ;;
    7) settings ;;
    4) continue ;;
    [1-6])
      [[ "$choice" != 1 || -n "$starting" ]] || continue
      [[ "$choice" != 2 || -n "$stopping" ]] || continue
      command="${commands[$((choice - 1))]}"
      if [[ "$command" == start || "$command" == stop ]]; then choose "$command"; else run "$command"; fi
      if [[ "$quiet" != 1 ]]; then read -r choice || break; fi
      ;;
    *) paint error "${message[invalid]}" ;;
  esac
done
