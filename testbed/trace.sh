#!/bin/bash
# Inside the container: testbed up, then traces. Args: scenario factor size seed algorithms
set -euo pipefail
cd /work
bash testbed/setup.sh > /dev/null
ip netns exec cli node --experimental-strip-types --no-warnings src/real/trace-real.ts \
  "results/trace/$1-x$2-$3-$4" "$1" "$2" "$3" "$4" "$5"
