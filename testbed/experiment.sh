#!/bin/bash
# One scenario's share of the real-network experiment, in its own container: 20 and 200 MB at
# the scenario's own RTT, then 20 MB at four times it.
# Usage (inside the container): bash testbed/experiment.sh <scenario> <out.csv> <firstSeed> <seeds>
set -euo pipefail
cd /work
sha256sum -c FROZEN-cats5.sha256 --quiet
bash testbed/setup.sh
run() { ip netns exec cli node --experimental-strip-types --no-warnings src/real/run-real.ts "$@"; }
algorithms=plexo,cats5,plexo-mux3
run "$2" "$1" 1 20,200 "$3" "$4" "$algorithms"
run "$2" "$1" 4 20 "$3" "$4" "$algorithms"
echo "done $1"
