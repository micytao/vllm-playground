#!/bin/bash
# Build multi-arch vLLM Playground container image
# Usage: ./build.sh <registry> [version]
# Example: ./build.sh quay.io/yourusername
# Example: ./build.sh quay.io/yourusername 0.3

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REGISTRY=${1:-""}
IMAGE_NAME="vllm-playground"
VERSION=${2:-"0.2"}

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}vLLM Playground Image Build${NC}"
echo -e "${GREEN}========================================${NC}"
echo

# Check if registry is provided
if [ -z "$REGISTRY" ]; then
    echo -e "${RED}Error: Registry not specified${NC}"
    echo "Usage: $0 <registry> [version]"
    echo
    echo "Examples:"
    echo "  $0 quay.io/yourusername"
    echo "  $0 docker.io/yourusername"
    echo "  $0 quay.io/yourusername 0.3"
    exit 1
fi

FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${VERSION}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  Registry: $REGISTRY"
echo "  Image: $IMAGE_NAME"
echo "  Version: $VERSION"
echo "  Full image: $FULL_IMAGE"
echo

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v podman &> /dev/null && ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Neither podman nor docker found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites satisfied${NC}"
echo

# Build multi-arch image
echo -e "${YELLOW}Step 1: Building multi-architecture container images...${NC}"
cd "$(dirname "$0")/.."  # Go to project root

if command -v podman &> /dev/null; then
    echo "Building for multiple architectures (arm64, amd64)..."

    # Remove existing manifest if it exists
    podman manifest rm ${IMAGE_NAME}:${VERSION} 2>/dev/null || true

    # Create a new manifest
    echo "Creating manifest: ${IMAGE_NAME}:${VERSION}"
    podman manifest create ${IMAGE_NAME}:${VERSION}

    # Build for ARM64 (Apple Silicon, ARM servers)
    echo "Building for linux/arm64..."
    podman build \
        --platform linux/arm64 \
        --manifest ${IMAGE_NAME}:${VERSION} \
        -f openshift/Containerfile \
        .

    # Build for AMD64 (x86_64, Intel/AMD)
    echo "Building for linux/amd64..."
    podman build \
        --platform linux/amd64 \
        --manifest ${IMAGE_NAME}:${VERSION} \
        -f openshift/Containerfile \
        .

    # Inspect the manifest
    echo
    echo "Manifest contents:"
    podman manifest inspect ${IMAGE_NAME}:${VERSION} | grep -A 3 "architecture"

else
    # Docker buildx for multi-arch
    echo "Building for multiple architectures using docker buildx..."
    docker buildx create --use --name multiarch-builder 2>/dev/null || docker buildx use multiarch-builder
    docker buildx build \
        --platform linux/arm64,linux/amd64 \
        -t ${IMAGE_NAME}:${VERSION} \
        -f openshift/Containerfile \
        .
fi

echo -e "${GREEN}✓ Multi-arch images built successfully${NC}"
echo

# Push multi-arch image
echo -e "${YELLOW}Step 2: Pushing multi-arch image to registry...${NC}"
echo "Pushing manifest and all architectures to ${FULL_IMAGE}..."

if command -v podman &> /dev/null; then
    # Tag the manifest with the full registry path
    podman tag ${IMAGE_NAME}:${VERSION} ${FULL_IMAGE}

    # Push the manifest (this pushes all architectures)
    podman manifest push ${IMAGE_NAME}:${VERSION} docker://${FULL_IMAGE} --all

    echo
    echo "Pushed architectures:"
    echo "  ✓ linux/arm64 (Apple Silicon, ARM servers)"
    echo "  ✓ linux/amd64 (x86_64, Intel/AMD servers)"
else
    # Docker buildx push
    docker buildx build \
        --platform linux/arm64,linux/amd64 \
        -t ${FULL_IMAGE} \
        -f openshift/Containerfile \
        --push \
        .
fi

echo -e "${GREEN}✓ Multi-arch image pushed successfully${NC}"
echo

# Update Kubernetes manifest with new image
echo -e "${YELLOW}Step 3: Updating Kubernetes manifests...${NC}"

MANIFEST_FILE="openshift/manifests/04-webui-deployment.yaml"
TEMP_FILE=$(mktemp)

# Replace image in manifest (matches both old and new image names)
sed -E "s|image:.*vllm-playground(-webui)?:.*|image: ${FULL_IMAGE}|g" ${MANIFEST_FILE} > ${TEMP_FILE}
mv ${TEMP_FILE} ${MANIFEST_FILE}

echo -e "${GREEN}✓ Manifest updated with image: ${FULL_IMAGE}${NC}"
echo "  Kubernetes will automatically select the correct architecture"
echo

# Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Build Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo
echo -e "${GREEN}Image built and pushed:${NC}"
echo "  ${FULL_IMAGE}"
echo
echo "Architectures:"
echo "  ✓ linux/arm64"
echo "  ✓ linux/amd64"
echo
echo "Next steps:"
echo "  1. Deploy to cluster:"
echo "     ./openshift/deploy.sh"
echo
echo "  2. Or deploy manually:"
echo "     oc apply -f openshift/manifests/"
echo
