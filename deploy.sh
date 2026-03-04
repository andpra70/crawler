#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

REGISTRY="${REGISTRY:-docker.io/andpra70}"
IMAGE_NAME="${IMAGE_NAME:-crawler}"
TAG="${TAG:-latest}"

FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

docker build -t "$FULL_IMAGE" .
docker push "$FULL_IMAGE"

echo "Image published: $FULL_IMAGE"
