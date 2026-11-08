#!/bin/bash
# The published baselines on the testbed, for one scenario, on the same cells as experiment.sh:
# 20 and 200 MB at the scenario's RTT, then 20 MB at four times it.
# Usage (inside the container): bash testbed/baselines.sh <scenario> <out.csv> <firstSeed> <seeds> [algorithms]
set -euo pipefail
cd /work
sha256sum -c FROZEN-cats5.sha256 --quiet
bash testbed/setup.sh
run() { ip netns exec cli node --experimental-strip-types --no-warnings src/real/run-real.ts "$@"; }
algorithms=${5:-mph2,mph2-eq}
run "$2" "$1" 1 20,200 "$3" "$4" "$algorithms"
run "$2" "$1" 4 20 "$3" "$4" "$algorithms"
echo "done $1"
