#!/bin/bash
#
# OpenShift Deployment Script for vLLM Playground
# This script deploys the vLLM Playground container with GPU support to OpenShift
#

set -e

# Configuration
IMAGE="quay.io/rh_ee_micyang/vllm-playground-cuda:0.1"
APP_NAME="vllm-playground"
NAMESPACE="${OPENSHIFT_NAMESPACE:-vllm-playground}"
DEPLOYMENT_YAML="openshift-deployment.yaml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if deployment YAML exists
check_yaml_file() {
    log_info "Checking for deployment YAML file..."

    if [ ! -f "${SCRIPT_DIR}/${DEPLOYMENT_YAML}" ]; then
        log_error "Deployment YAML file not found: ${DEPLOYMENT_YAML}"
        log_error "Make sure ${DEPLOYMENT_YAML} exists in the same directory as this script."
        exit 1
    fi

    log_info "Found deployment file: ${DEPLOYMENT_YAML}"
}

# Check if user is logged in to OpenShift
check_login() {
    log_info "Checking OpenShift login status..."
    if ! oc whoami &> /dev/null; then
        log_error "Not logged in to OpenShift. Please run 'oc login' first."
        exit 1
    fi
    log_info "Logged in as: $(oc whoami)"
}

# Deploy using YAML file
deploy_resources() {
    log_info "Deploying vLLM Playground using ${DEPLOYMENT_YAML}..."

    # If custom namespace is specified, apply to that namespace
    if [ "${NAMESPACE}" != "vllm-playground" ]; then
        log_info "Deploying to custom namespace: ${NAMESPACE}"
        log_warn "Note: You may need to edit ${DEPLOYMENT_YAML} to change the namespace from 'vllm-playground' to '${NAMESPACE}'"
        oc apply -f "${SCRIPT_DIR}/${DEPLOYMENT_YAML}" -n "${NAMESPACE}"
    else
        log_info "Deploying to default namespace: vllm-playground"
        oc apply -f "${SCRIPT_DIR}/${DEPLOYMENT_YAML}"
    fi

    log_info "Resources deployed successfully"
}

# Wait for deployment to be ready
wait_for_deployment() {
    log_info "Waiting for deployment to be ready..."

    # Wait up to 2 minutes for deployment to exist
    local max_wait=120
    local waited=0
    while ! oc get deployment "${APP_NAME}" -n "${NAMESPACE}" &> /dev/null; do
        if [ $waited -ge $max_wait ]; then
            log_warn "Deployment not found after ${max_wait} seconds"
            return 1
        fi
        sleep 2
        waited=$((waited + 2))
    done

    log_info "Waiting for pods to be ready (this may take a few minutes)..."
    oc rollout status deployment/"${APP_NAME}" -n "${NAMESPACE}" --timeout=5m || true
}

# Display deployment information
show_info() {
    log_info "Deployment completed successfully!"
    echo ""
    echo "========================================"
    echo "  vLLM Playground Deployment Information"
    echo "========================================"
    echo ""
    echo "Namespace: ${NAMESPACE}"
    echo "Application: ${APP_NAME}"
    echo "Image: ${IMAGE}"
    echo ""

    # Get route URLs
    WEBUI_URL=$(oc get route "${APP_NAME}-webui" -n "${NAMESPACE}" -o jsonpath='{.spec.host}' 2>/dev/null || echo "Not available yet")
    API_URL=$(oc get route "${APP_NAME}-api" -n "${NAMESPACE}" -o jsonpath='{.spec.host}' 2>/dev/null || echo "Not available yet")

    echo "WebUI URL: https://${WEBUI_URL}"
    echo "API URL: https://${API_URL}"
    echo ""
    echo "========================================"
    echo "  Useful Commands"
    echo "========================================"
    echo ""
    echo "View pods:              oc get pods -n ${NAMESPACE}"
    echo "View logs:              oc logs -f deployment/${APP_NAME} -n ${NAMESPACE}"
    echo "View deployment status: oc get deployment ${APP_NAME} -n ${NAMESPACE}"
    echo "View services:          oc get svc -n ${NAMESPACE}"
    echo "View routes:            oc get routes -n ${NAMESPACE}"
    echo "Scale deployment:       oc scale deployment/${APP_NAME} --replicas=<N> -n ${NAMESPACE}"
    echo "Delete deployment:      oc delete -f ${DEPLOYMENT_YAML}"
    echo "Delete by label:        oc delete all -l app=${APP_NAME} -n ${NAMESPACE}"
    echo ""

    # Check pod status
    log_info "Checking pod status..."
    oc get pods -n "${NAMESPACE}" -l app="${APP_NAME}" 2>/dev/null || log_warn "No pods found yet"
    echo ""

    log_info "To watch the deployment progress, run:"
    echo "  oc logs -f deployment/${APP_NAME} -n ${NAMESPACE}"
}

# Optional: Create Secret for HuggingFace token (if needed for gated models)
create_hf_token_prompt() {
    echo ""
    read -p "Do you want to configure HuggingFace token for gated models (Llama, Gemma)? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -sp "Enter your HuggingFace token (will be hidden): " HF_TOKEN
        echo ""
        if [ -n "$HF_TOKEN" ]; then
            log_info "Creating secret for HuggingFace token..."
            oc create secret generic hf-token \
                --from-literal=HF_TOKEN="${HF_TOKEN}" \
                -n "${NAMESPACE}" \
                --dry-run=client -o yaml | oc apply -f -

            # Patch deployment to use the secret
            log_info "Updating deployment to use HuggingFace token..."
            oc set env deployment/"${APP_NAME}" \
                --from=secret/hf-token \
                -n "${NAMESPACE}"

            log_info "HuggingFace token configured successfully"
            log_info "The deployment will automatically restart to apply changes"
        fi
    fi
}

# Main execution
main() {
    log_info "Starting OpenShift deployment for vLLM Playground..."
    echo ""

    check_yaml_file
    check_login
    deploy_resources
    wait_for_deployment
    create_hf_token_prompt
    show_info

    log_info "Deployment process completed!"
    echo ""
    log_info "Next steps:"
    echo "  1. Open the WebUI URL in your browser"
    echo "  2. Select a model (e.g., TinyLlama for testing)"
    echo "  3. Click 'Start Server' and wait 2-3 minutes"
    echo "  4. Start chatting!"
}

# Run main function
main
