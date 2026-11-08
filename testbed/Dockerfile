FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends iproute2 nginx-light ethtool procps \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
