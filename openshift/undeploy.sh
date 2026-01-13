#!/bin/bash
# Undeploy vLLM Playground from OpenShift/Kubernetes
# Usage: ./undeploy.sh [--force]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
FORCE=false
if [ "$1" = "--force" ] || [ "$1" = "-f" ]; then
    FORCE=true
fi

echo -e "${RED}========================================${NC}"
echo -e "${RED}vLLM Playground Undeployment${NC}"
echo -e "${RED}========================================${NC}"
echo

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v oc &> /dev/null && ! command -v kubectl &> /dev/null; then
    echo -e "${RED}Error: Neither oc nor kubectl found${NC}"
    exit 1
fi

# Use oc if available, otherwise kubectl
if command -v oc &> /dev/null; then
    K8S_CMD="oc"
else
    K8S_CMD="kubectl"
fi

echo -e "${GREEN}✓ Using: ${K8S_CMD}${NC}"
echo

# Check cluster connection
echo -e "${YELLOW}Checking cluster connection...${NC}"

if ! ${K8S_CMD} cluster-info &> /dev/null; then
    echo -e "${RED}Error: Cannot connect to cluster${NC}"
    echo "Please login first:"
    if [ "$K8S_CMD" = "oc" ]; then
        echo "  oc login <cluster-url>"
    else
        echo "  kubectl config use-context <context-name>"
    fi
    exit 1
fi

echo "Connected to cluster: $(${K8S_CMD} config current-context)"
echo -e "${GREEN}✓ Cluster connection verified${NC}"
echo

# Check if namespace exists
if ! ${K8S_CMD} get namespace vllm-playground &> /dev/null; then
    echo -e "${YELLOW}Namespace 'vllm-playground' not found. Nothing to undeploy.${NC}"
    exit 0
fi

# Show what will be deleted
echo -e "${BLUE}Resources in namespace 'vllm-playground':${NC}"
echo
${K8S_CMD} get all -n vllm-playground 2>/dev/null || echo "  No resources found"
echo

# Confirm deletion unless --force
if [ "$FORCE" = false ]; then
    echo -e "${YELLOW}⚠️  WARNING: This will delete ALL resources in the vllm-playground namespace!${NC}"
    echo
    echo "This includes:"
    echo "  • Web UI deployment and pods"
    echo "  • Any running vLLM service pods"
    echo "  • Services and routes"
    echo "  • ConfigMaps and RBAC resources"
    echo "  • The entire namespace"
    echo
    read -p "Are you sure you want to continue? (yes/no): " -r
    echo

    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        echo -e "${GREEN}Undeployment cancelled.${NC}"
        exit 0
    fi
fi

echo -e "${RED}========================================${NC}"
echo -e "${RED}Starting Undeployment${NC}"
echo -e "${RED}========================================${NC}"
echo

# Change to script directory
cd "$(dirname "$0")"

# Option 1: Delete namespace (simplest - removes everything)
echo -e "${YELLOW}Deleting namespace and all resources...${NC}"
${K8S_CMD} delete namespace vllm-playground

echo
echo -e "${YELLOW}Waiting for namespace to be fully deleted...${NC}"

# Wait for namespace to be fully deleted (with timeout)
TIMEOUT=120
ELAPSED=0
while ${K8S_CMD} get namespace vllm-playground &> /dev/null; do
    if [ $ELAPSED -ge $TIMEOUT ]; then
        echo
        echo -e "${YELLOW}⚠️  Namespace deletion is taking longer than expected.${NC}"
        echo "The namespace may have finalizers preventing deletion."
        echo
        echo "Check status with:"
        echo "  ${K8S_CMD} get namespace vllm-playground -o yaml"
        echo
        echo "You may need to manually remove finalizers if stuck."
        exit 1
    fi

    echo -n "."
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

echo
echo -e "${GREEN}✓ Namespace deleted${NC}"
echo

# Success message
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Undeployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo
echo "All vLLM Playground resources have been removed from the cluster."
echo

echo -e "${BLUE}To redeploy, run:${NC}"
echo "  ./deploy.sh"
echo

echo -e "${GREEN}Cleanup successful! 🗑️${NC}"
