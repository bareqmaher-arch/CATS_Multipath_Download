#!/bin/bash
# Builds the testbed inside a privileged container: a server namespace (srv) running nginx and
# a client namespace (cli), joined by three veth pairs, one per network. Network i is
# c<i> 10.<i+1>.0.2 on the client and s<i> 10.<i+1>.0.1 on the server; src/real/shaper.ts shapes
# both ends with netem. Offloads are off so netem's rate sees real packet sizes.
set -euo pipefail

ip netns add srv
ip netns add cli
ip -n srv link set lo up
ip -n cli link set lo up

for i in 0 1 2; do
  ip link add "c$i" type veth peer name "s$i"
  ip link set "c$i" netns cli
  ip link set "s$i" netns srv
  ip -n cli addr add "10.$((i + 1)).0.2/24" dev "c$i"
  ip -n srv addr add "10.$((i + 1)).0.1/24" dev "s$i"
  ip -n cli link set "c$i" up
  ip -n srv link set "s$i" up
  ip netns exec cli ethtool -K "c$i" tso off gso off gro off >/dev/null 2>&1 || true
  ip netns exec srv ethtool -K "s$i" tso off gso off gro off >/dev/null 2>&1 || true
done

# Files are sparse: their content doesn't matter, only their length.
mkdir -p /srv/files
for size in 20 200 1000; do truncate -s "${size}000000" "/srv/files/f$size.bin"; done

ip netns exec srv nginx -c /work/testbed/nginx.conf
for i in 0 1 2; do
  ip netns exec cli bash -c "until (echo > /dev/tcp/10.$((i + 1)).0.1/8080) 2>/dev/null; do sleep 0.1; done"
done
echo "testbed up: $(ip netns exec cli sysctl -n net.ipv4.tcp_congestion_control) congestion control," \
  "slow start after idle $(ip netns exec cli sysctl -n net.ipv4.tcp_slow_start_after_idle)"
