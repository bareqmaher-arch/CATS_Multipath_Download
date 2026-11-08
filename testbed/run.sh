#!/bin/bash
# Entry point inside the container: build the testbed, then run src/real/run-real.ts in the
# client namespace with the arguments given.
set -euo pipefail
cd /work
sha256sum -c FROZEN-cats5.sha256 --quiet
bash testbed/setup.sh
exec ip netns exec cli node --experimental-strip-types --no-warnings src/real/run-real.ts "$@"
