#!/bin/bash
# Sets up the real-network experiments' server on a VPS (Debian/Ubuntu, run as root):
# nginx serving sparse files over HTTP/1.1 on 18080 and HTTP/2 without TLS on 18081, as the
# testbed's server does (testbed/nginx.conf), under a random path so the files aren't found by
# scanners. Prints the path prefix the client needs. Rerunning keeps the existing prefix.
#
# Usage: sudo bash server-setup.sh
set -euo pipefail

apt-get update -qq
apt-get install -y -qq nginx > /dev/null

ROOT=/srv/cats
mkdir -p "$ROOT"
if [ -f "$ROOT/prefix" ]; then
  PREFIX=$(cat "$ROOT/prefix")
else
  PREFIX=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')
  echo "$PREFIX" > "$ROOT/prefix"
fi
mkdir -p "$ROOT/files/$PREFIX"
# Sparse: content doesn't matter, only length (decimal megabytes, as on the testbed).
for size in 20 100 200; do truncate -s "${size}000000" "$ROOT/files/$PREFIX/f$size.bin"; done

cat > /etc/nginx/conf.d/cats.conf <<EOF
server {
  # HTTP/1.1, one request per block (Plexo).
  listen 18080;
  root $ROOT/files;
  access_log off;
  keepalive_timeout 300s;
  keepalive_requests 1000000;
  sendfile on;
  tcp_nopush on;
  location / {}
  # The client's public address, to check each network really leaves by its own interface.
  location = /$PREFIX/ip { default_type text/plain; return 200 "\$remote_addr\n"; }
}
server {
  # HTTP/2 without TLS, by prior knowledge: sub-ranges as streams on one connection.
  listen 18081 http2;
  root $ROOT/files;
  access_log off;
  keepalive_timeout 300s;
  keepalive_requests 1000000;
  sendfile on;
  tcp_nopush on;
  location / {}
}
EOF
grep -q 'worker_connections 4096' /etc/nginx/nginx.conf || \
  sed -i 's/worker_connections [0-9]*;/worker_connections 4096;/' /etc/nginx/nginx.conf

nginx -t
systemctl enable --now nginx > /dev/null 2>&1 || true
systemctl reload nginx

if command -v ufw > /dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 18080/tcp > /dev/null
  ufw allow 18081/tcp > /dev/null
fi

echo "kernel: $(uname -r); congestion control: $(sysctl -n net.ipv4.tcp_congestion_control);" \
  "mptcp: $(sysctl -n net.mptcp.enabled 2>/dev/null || echo unavailable)"
echo "path prefix: $PREFIX"
