#!/bin/bash
set -euo pipefail

REGISTRY="${REGISTRY:-docker.io/andpra70}"
IMAGE_NAME="${IMAGE_NAME:-crawler}"
TAG="${TAG:-latest}"
CONTAINER_NAME="${CONTAINER_NAME:-crawler}"
HOST_PORT="${HOST_PORT:-6064}"
CONTAINER_PORT="${CONTAINER_PORT:-80}"
DATA_DIR="${DATA_DIR:-$(pwd)/data}"
DNS_SERVERS="${DNS_SERVERS:-1.1.1.1,8.8.8.8}"

FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

mkdir -p "$DATA_DIR"

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  echo "Stopping existing container: $CONTAINER_NAME"
  docker stop "$CONTAINER_NAME" >/dev/null
  docker rm "$CONTAINER_NAME" >/dev/null
fi

if [[ -n "$REGISTRY" ]]; then
  echo "Pulling image: $FULL_IMAGE"
  docker pull "$FULL_IMAGE"
fi

DNS_ARGS=()
IFS=',' read -r -a dns_list <<< "$DNS_SERVERS"
for dns_server in "${dns_list[@]}"; do
  dns_server="$(echo "$dns_server" | xargs)"
  if [[ -n "$dns_server" ]]; then
    DNS_ARGS+=(--dns "$dns_server")
  fi
done

docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -v "${DATA_DIR}:/app/data" \
  -e API_PORT=6065 \
  "${DNS_ARGS[@]}" \
  --restart unless-stopped \
  "$FULL_IMAGE"

echo "Container started successfully."
echo "Image: $FULL_IMAGE"
echo "Container: $CONTAINER_NAME"
echo "URL: http://localhost:${HOST_PORT}"
echo "DNS: ${DNS_SERVERS}"
