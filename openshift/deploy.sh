#!/bin/bash
# Deploy vLLM Playground to OpenShift/Kubernetes
# Usage: ./deploy.sh [--cpu|--gpu] [--pvc]
# Default: GPU deployment, no PVC
# Note: Run build.sh first to build and push the container image

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default deployment mode
DEPLOYMENT_MODE="gpu"
CREATE_PVC=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --cpu)
            DEPLOYMENT_MODE="cpu"
            shift
            ;;
        --gpu)
            DEPLOYMENT_MODE="gpu"
            shift
            ;;
        --pvc|--persistent-cache)
            CREATE_PVC=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --gpu                  Deploy in GPU mode (default)"
            echo "  --cpu                  Deploy in CPU mode"
            echo "  --pvc                  Create PVC for persistent model cache"
            echo "  --persistent-cache     Alias for --pvc"
            echo "  --help, -h             Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --gpu               # GPU mode without PVC"
            echo "  $0 --gpu --pvc         # GPU mode with persistent cache"
            echo "  $0 --cpu --pvc         # CPU mode with persistent cache"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [--cpu|--gpu] [--pvc]"
            echo "Run '$0 --help' for more information"
            exit 1
            ;;
    esac
done

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}vLLM Playground Deployment${NC}"
echo -e "${GREEN}========================================${NC}"
echo
# Convert to uppercase for display
DEPLOYMENT_MODE_UPPER=$(echo "${DEPLOYMENT_MODE}" | tr '[:lower:]' '[:upper:]')
echo -e "${BLUE}Deployment Mode: ${DEPLOYMENT_MODE_UPPER}${NC}"
if [ "$DEPLOYMENT_MODE" = "gpu" ]; then
    echo -e "${BLUE}vLLM Image: vllm/vllm-openai:v0.12.0 (official)${NC}"
else
    echo -e "${BLUE}vLLM Image: quay.io/rh_ee_micyang/vllm-cpu:v0.11.0 (self-built, public)${NC}"
fi
if [ "$CREATE_PVC" = true ]; then
    echo -e "${BLUE}Persistent Cache: Enabled (PVC)${NC}"
else
    echo -e "${BLUE}Persistent Cache: Disabled (emptyDir)${NC}"
fi
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
echo -e "${YELLOW}Step 1: Checking cluster connection...${NC}"

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

# Deploy to cluster
echo -e "${YELLOW}Step 2: Deploying resources to cluster...${NC}"
echo

# Change to script directory to ensure relative paths work
cd "$(dirname "$0")"

# Apply manifests
echo "Creating namespace..."
${K8S_CMD} apply -f manifests/01-namespace.yaml

echo "Creating RBAC resources..."
${K8S_CMD} apply -f manifests/02-rbac.yaml

echo "Creating ConfigMaps..."
${K8S_CMD} apply -f manifests/03-configmap.yaml

if [ "$CREATE_PVC" = true ]; then
    echo "Creating Persistent Volume Claim for model cache..."
    ${K8S_CMD} apply -f manifests/05-pvc-optional.yaml
    echo -e "${GREEN}✓ PVC created${NC}"
else
    echo "Skipping PVC creation (use --pvc flag to enable persistent cache)"
fi

echo "Deploying Web UI..."
${K8S_CMD} apply -f manifests/04-webui-deployment.yaml

echo
echo -e "${GREEN}✓ Resources deployed${NC}"
echo

# Scale deployments based on mode
echo -e "${YELLOW}Step 3: Configuring deployment mode...${NC}"

if [ "$DEPLOYMENT_MODE" = "gpu" ]; then
    echo "Scaling GPU deployment to 1 replica..."
    ${K8S_CMD} scale deployment/vllm-playground-gpu --replicas=1 -n vllm-playground
    echo "Scaling CPU deployment to 0 replicas..."
    ${K8S_CMD} scale deployment/vllm-playground-cpu --replicas=0 -n vllm-playground
    ACTIVE_DEPLOYMENT="vllm-playground-gpu"
else
    echo "Scaling CPU deployment to 1 replica..."
    ${K8S_CMD} scale deployment/vllm-playground-cpu --replicas=1 -n vllm-playground
    echo "Scaling GPU deployment to 0 replicas..."
    ${K8S_CMD} scale deployment/vllm-playground-gpu --replicas=0 -n vllm-playground
    ACTIVE_DEPLOYMENT="vllm-playground-cpu"
fi

echo -e "${GREEN}✓ Deployment mode configured${NC}"
echo

# Wait for deployment
echo -e "${YELLOW}Step 4: Waiting for deployment to be ready...${NC}"
${K8S_CMD} wait --for=condition=available --timeout=300s deployment/${ACTIVE_DEPLOYMENT} -n vllm-playground

echo -e "${GREEN}✓ Deployment is ready${NC}"
echo

# Get access URL
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo
echo -e "${BLUE}Deployment Mode: ${DEPLOYMENT_MODE_UPPER}${NC}"
if [ "$CREATE_PVC" = true ]; then
    echo -e "${BLUE}Persistent Cache: Enabled${NC}"
else
    echo -e "${BLUE}Persistent Cache: Disabled${NC}"
fi
echo

if [ "$K8S_CMD" = "oc" ]; then
    ROUTE_URL=$(${K8S_CMD} get route vllm-playground -n vllm-playground -o jsonpath='{.spec.host}' 2>/dev/null || echo "")
    if [ -n "$ROUTE_URL" ]; then
        echo -e "${GREEN}Web UI URL:${NC} https://${ROUTE_URL}"
        echo
        echo "Open this URL in your browser to access the vLLM Playground!"
    else
        echo -e "${YELLOW}Route not found. Use port-forward to access:${NC}"
        echo "  ${K8S_CMD} port-forward -n vllm-playground svc/vllm-playground 7860:7860"
        echo "Then visit: http://localhost:7860"
    fi
else
    echo "Service created. To access the Web UI, use port-forward:"
    echo "  ${K8S_CMD} port-forward -n vllm-playground svc/vllm-playground 7860:7860"
    echo "Then visit: http://localhost:7860"
    echo
    echo "Or create an Ingress resource for external access"
fi

echo
echo -e "${YELLOW}Useful commands:${NC}"
echo "  # View all resources"
echo "  ${K8S_CMD} get all -n vllm-playground"
echo
echo "  # View pods"
echo "  ${K8S_CMD} get pods -n vllm-playground"
echo
echo "  # View Web UI logs"
echo "  ${K8S_CMD} logs -f -n vllm-playground deployment/${ACTIVE_DEPLOYMENT}"
echo
echo "  # View vLLM service logs (when running)"
echo "  ${K8S_CMD} logs -f vllm-service -n vllm-playground"
echo
echo "  # Switch to CPU mode (if currently GPU)"
echo "  ${K8S_CMD} scale deployment/vllm-playground-gpu --replicas=0 -n vllm-playground"
echo "  ${K8S_CMD} scale deployment/vllm-playground-cpu --replicas=1 -n vllm-playground"
echo
echo "  # Switch to GPU mode (if currently CPU)"
echo "  ${K8S_CMD} scale deployment/vllm-playground-cpu --replicas=0 -n vllm-playground"
echo "  ${K8S_CMD} scale deployment/vllm-playground-gpu --replicas=1 -n vllm-playground"
echo
echo "  # Delete deployment"
echo "  ${K8S_CMD} delete namespace vllm-playground"
echo
echo -e "${GREEN}Happy vLLM-ing! 🚀${NC}"

