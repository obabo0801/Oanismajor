#!/usr/bin/env bash
set -euo pipefail
umask 077

source=$(realpath "${1:?Project path is required}")
mode="${2:-install}"
[[ $mode == install || $mode == update ]] || exit 1
[[ $EUID == 0 ]] || {
  echo 'Run as root.' >&2
  exit 1
}
[[ $(ps -p 1 -o comm=) == systemd ]] || {
  echo 'Enable systemd and restart Ubuntu.' >&2
  exit 1
}
[[ -f "$source/local.json" ]] || {
  echo 'Prepare local.json.' >&2
  exit 1
}

mapfile -t settings < <(
  python3 - "$source" << 'PY'
import ipaddress, json, pathlib, sys
p = pathlib.Path(sys.argv[1])
c = json.loads((p / 'servers.json').read_text(encoding='utf-8-sig'))
c.update(json.loads((p / 'local.json').read_text(encoding='utf-8-sig')))
if c['root'] != '/srv/oanismajor' or c['node'] != '/opt/node24/bin/node':
    sys.exit('Use /srv/oanismajor for the install path and /opt/node24/bin/node for Node.js.')
if any(d['version'] != 18 for d in c['db']):
    sys.exit('Use PostgreSQL 18.')
network = ipaddress.ip_network('100.64.0.0/10')
if ipaddress.ip_address(c['cluster']['address']) not in network:
    sys.exit('Check the Tailscale IP.')
host, path = c['cluster']['storage'].split(':')
if ipaddress.ip_address(host) not in network or path != '/srv/oanismajor/storage':
    sys.exit('Check the shared storage address.')
print(c['root'])
print('yes' if c.get('https') else 'no')
print('yes' if c['db'] else 'no')
print('yes' if c['was'] else 'no')
print('yes' if any(d['role'] == 'primary' for d in c['db']) else 'no')
print('yes' if host == c['cluster']['address'] else 'no')
PY
)

[[ ${#settings[@]} == 6 ]] || {
  echo 'Check the server configuration.' >&2
  exit 1
}

target=${settings[0]}
secure=${settings[1]}
database=${settings[2]}
application=${settings[3]}
primary=${settings[4]}
storage=${settings[5]}

if [[ $secure == yes ]] && systemctl is-active --quiet nginx.service; then
  echo 'nginx.service is running. Check ports 80 and 443.' >&2
  exit 1
fi

[[ -f "$target/.env" || -f "$source/.env" || $primary == yes ]] || {
  echo 'Copy .env from the primary server.' >&2
  exit 1
}

[[ $primary == yes || $application == yes || -d "$source/web/dist" || -d "$target/web/dist" ]] || {
  echo 'Copy web/dist from the primary server.' >&2
  exit 1
}

if [[ $mode == update ]]; then
  python3 - "$source" "$target" << 'PYTHON'
import json, pathlib, sys
configs = []
for folder in sys.argv[1:]:
    root = pathlib.Path(folder)
    config = json.loads((root / 'servers.json').read_text(encoding='utf-8-sig'))
    config.update(json.loads((root / 'local.json').read_text(encoding='utf-8-sig')))
    configs.append(config)
if any(configs[0].get(key) != configs[1].get(key) for key in ('was', 'web', 'db', 'https', 'cluster', 'root', 'node')):
    sys.exit('Server configuration changed. Run installation to apply it.')
PYTHON
  /usr/bin/flock --nonblock /run/lock/oanismajor-update.lock \
    /opt/node24/bin/node "$source/was/service/release.js" "$source" "$target"
  exit $?
fi

active=()
if [[ $mode == update ]]; then
  units=$(systemctl list-units --all --plain --no-legend \
    discovery.service 'was@*.service' 'web@*.service')
  while read -r unit state; do
    case "$state" in
      active | activating | reloading) active+=("$unit") ;;
    esac
  done < <(awk '{print $1, $3}' <<< "$units")
fi

echo '@oanismajor:packages'
export DEBIAN_FRONTEND=noninteractive
updated=no

ensure() {
  local missing=()

  for package in "$@"; do
    dpkg-query -W -f='${Status}' "$package" 2> /dev/null \
      | grep -q '^install ok installed$' || missing+=("$package")
  done

  ((${#missing[@]})) || return 0

  if [[ $updated == no ]]; then
    apt-get update
    updated=yes
  fi

  apt-get install -y --no-remove "${missing[@]}"
}

work=$(mktemp -d /tmp/oanismajor-install.XXXXXXXX)
policy=no
cluster=no
temporary=()

release() {
  local item version name
  for item in "${temporary[@]}"; do
    IFS=/ read -r version name <<< "$item"
    if pg_ctlcluster "$version" "$name" status > /dev/null 2>&1; then
      pg_ctlcluster "$version" "$name" stop || return 1
    fi
  done
  temporary=()
}

cleanup() {
  release || true
  if [[ $policy == yes ]]; then
    rm -f /usr/sbin/policy-rc.d
  fi

  if [[ $cluster == yes ]]; then
    cp "$work/createcluster.conf" /etc/postgresql-common/createcluster.conf
  fi

  [[ $work == /tmp/oanismajor-install.* && -d $work ]] \
    && rm -rf -- "$work"
}

trap cleanup EXIT

if [[ ! -e /usr/sbin/policy-rc.d ]]; then
  printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d
  chmod 755 /usr/sbin/policy-rc.d
  policy=yes
fi

ensure ca-certificates curl gnupg rsync xz-utils
ensure ffmpeg

if [[ $application == yes ]] && ! command -v gcloud > /dev/null 2>&1; then
  curl --fail --silent --show-error --location \
    https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --batch --yes --dearmor -o /usr/share/keyrings/cloud.google.gpg
  chmod 644 /usr/share/keyrings/cloud.google.gpg
  printf '%s\n' \
    'deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main' \
    > /etc/apt/sources.list.d/google-cloud-sdk.list
  chmod 644 /etc/apt/sources.list.d/google-cloud-sdk.list
  apt-get update
  apt-get install -y --no-install-recommends google-cloud-cli
fi

if [[ ! -x /opt/node24/bin/node ]] \
  || [[ $(/opt/node24/bin/node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
  [[ ! -e /opt/node24 ]] || {
    echo 'Existing /opt/node24 is not Node.js 24. Existing files were preserved.' >&2
    exit 1
  }

  case $(uname -m) in
    x86_64) arch=x64 ;;
    aarch64) arch=arm64 ;;
    *)
      echo 'Unsupported CPU architecture.' >&2
      exit 1
      ;;
  esac

  curl -fsSL --retry 3 \
    https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt \
    -o "$work/SHASUMS256.txt"

  archive=$(
    awk -v suffix="-linux-$arch.tar.xz" \
      '$2 ~ (suffix "$") {print $2}' \
      "$work/SHASUMS256.txt"
  )

  [[ $archive =~ ^node-v24\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] \
    || exit 1

  curl -fsSL --retry 3 \
    "https://nodejs.org/dist/latest-v24.x/$archive" \
    -o "$work/$archive"

  (
    cd "$work"
    grep "  $archive$" SHASUMS256.txt | sha256sum -c -
  )

  mkdir "$work/node"
  tar -xJf "$work/$archive" --strip-components=1 -C "$work/node"
  chmod -R a+rX "$work/node"
  mkdir -p /opt
  mv "$work/node" /opt/node24
fi

export PATH="/opt/node24/bin:$PATH"

. /etc/os-release

[[ $ID == ubuntu ]] || {
  echo 'Run this installer on Ubuntu.' >&2
  exit 1
}

fresh=no
command -v nginx > /dev/null || fresh=yes

if [[ $fresh == yes ]] \
  || [[ $secure == yes && ! -f /usr/lib/nginx/modules/ngx_http_acme_module.so ]]; then
  curl -fsSL --retry 3 \
    https://nginx.org/keys/nginx_signing.key \
    -o "$work/nginx.key"

  gpg --show-keys --with-colons "$work/nginx.key" \
    | grep -q '573BFD6B3D8FBC641079A6ABABF5BD827BD9BF62'

  gpg --batch --yes --dearmor \
    -o /usr/share/keyrings/oanismajor-nginx.gpg \
    "$work/nginx.key"

  printf \
    'deb [signed-by=/usr/share/keyrings/oanismajor-nginx.gpg] https://nginx.org/packages/ubuntu %s nginx\n' \
    "$VERSION_CODENAME" \
    > /etc/apt/sources.list.d/oanismajor-nginx.list

  printf \
    'Package: *\nPin: origin nginx.org\nPin-Priority: 900\n' \
    > /etc/apt/preferences.d/oanismajor-nginx

  chmod 644 \
    /usr/share/keyrings/oanismajor-nginx.gpg \
    /etc/apt/sources.list.d/oanismajor-nginx.list \
    /etc/apt/preferences.d/oanismajor-nginx

  apt-get update
  updated=yes

  packages=(nginx)
  [[ $secure != yes ]] || packages+=(nginx-module-acme)

  apt-get install -y --no-remove "${packages[@]}"

  [[ $fresh != yes ]] || systemctl disable nginx.service
fi

if [[ $mode == install || $application == yes || $storage == yes ]]; then
  packages=(nfs-common)

  [[ $mode != install && $storage != yes && $database != yes ]] || packages+=(nfs-kernel-server)

  if ! nginx -V 2>&1 | grep -q -- '--with-stream' \
    || nginx -V 2>&1 | grep -q -- '--with-stream=dynamic'; then
    packages+=(libnginx-mod-stream)
  fi

  ensure "${packages[@]}"
fi

if [[ ($mode == install || $database == yes) && ! -x /usr/lib/postgresql/18/bin/postgres ]]; then
  ensure postgresql-common
  cp /etc/postgresql-common/createcluster.conf "$work/createcluster.conf"
  cluster=yes

  printf '\ncreate_main_cluster = false\n' \
    >> /etc/postgresql-common/createcluster.conf

  if ! apt-cache show postgresql-18 > /dev/null 2>&1; then
    curl -fsSL --retry 3 \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/keyrings/oanismajor-postgresql.asc

    printf \
      'deb [signed-by=/usr/share/keyrings/oanismajor-postgresql.asc] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' \
      "$VERSION_CODENAME" \
      > /etc/apt/sources.list.d/oanismajor-postgresql.list

    chmod 644 \
      /usr/share/keyrings/oanismajor-postgresql.asc \
      /etc/apt/sources.list.d/oanismajor-postgresql.list

    apt-get update
    updated=yes
  fi

  apt-get install -y --no-remove postgresql-18
fi

echo '@oanismajor:project'
install -d -m 755 "$target"
if [[ $application == yes ]]; then
  install -d -m 700 "$target/.config/gcloud"
  credential=application_default_credentials.json
  if [[ ! -f "$target/.config/gcloud/$credential" && -f "/root/.config/gcloud/$credential" ]]; then
    install -m 600 "/root/.config/gcloud/$credential" "$target/.config/gcloud/$credential"
  fi
fi
seed=no

if [[ $source != "$target" ]]; then
  rsync -a --delete \
    --exclude=node_modules \
    --exclude=storage \
    --exclude=replica \
    --exclude=dist \
    --exclude=.git \
    --exclude=.env \
    --exclude=local.json \
    --exclude='.codex*' \
    --exclude=.config \
    "$source/" "$target/"

  backup="/var/backups/oanismajor/config-$(date +%s%N)"
  install -d -m 700 "$backup"
  for file in .env local.json; do
    [[ ! -f "$target/$file" ]] || cp -a "$target/$file" "$backup/"
  done
  install -m 600 "$source/local.json" "$target/local.json"

  if [[ -f "$source/.env" ]]; then
    [[ -f "$target/.env" ]] || seed=yes
    install -m 600 "$source/.env" "$target/.env"
  fi

  if [[ $primary != yes && $application != yes && -d "$source/web/dist" ]]; then
    mkdir -p "$target/web/dist"
    rsync -a --delete "$source/web/dist/" "$target/web/dist/"
  fi
fi

cd "$target"
chmod 755 . was web db lib

lock=$(sha256sum package.json package-lock.json | sha256sum | cut -d' ' -f1)
stamp=node_modules/.oanismajor-lock
current=""

[[ ! -f "$stamp" ]] || current=$(< "$stamp")

if [[ ! -d node_modules || $current != "$lock" ]]; then
  echo '@oanismajor:dependencies'
  npm ci --prefer-offline --no-audit --no-fund
  printf '%s\n' "$lock" > "$stamp"
fi

if [[ $mode == install ]]; then
  while read -r version name; do
    if ! pg_ctlcluster "$version" "$name" status > /dev/null 2>&1; then
      temporary+=("$version/$name")
    fi
  done < <(node --input-type=module -e '
    import fs from "node:fs";
    const config = JSON.parse(fs.readFileSync("servers.json", "utf8"));
    Object.assign(config, JSON.parse(fs.readFileSync("local.json", "utf8")));
    for (const item of config.db)
      if (item.role === "primary") console.log(item.version, item.name);
  ')
  OANISMAJOR_SEED="$seed" node was/service/install.js
fi
if [[ $source != "$target" ]]; then
  install -m 600 "$target/.env" "$source/.env"
fi

if [[ $mode == install || $application == yes ]]; then
  echo '@oanismajor:build'
  npm run build
fi

[[ ! -d web/dist ]] || chmod -R a+rX web/dist

if [[ $policy == yes ]]; then
  rm /usr/sbin/policy-rc.d
  policy=no
fi

echo '@oanismajor:services'
if [[ $mode == update ]]; then
  node run.js setup web
  for group in discovery was web; do
    for unit in "${active[@]}"; do
      if [[ $unit == "$group.service" || $unit == "$group@"*.service ]]; then
        if [[ $group == web ]]; then
          systemctl reload-or-restart "$unit"
        else
          systemctl restart "$unit"
        fi
        if [[ $group != discovery ]]; then
          instance=${unit#*@}
          node run.js check "$group" "${instance%.service}"
        fi
      fi
    done
  done
  node run.js status
  exit 0
fi

node run.js setup
release
node run.js status
