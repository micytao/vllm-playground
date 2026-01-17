#!/bin/bash
#
# OpenShift Undeployment Script for vLLM Playground
# This script removes the vLLM Playground deployment and all associated resources from OpenShift
#

set -e

# Configuration
APP_NAME="vllm-playground"
NAMESPACE="${OPENSHIFT_NAMESPACE:-vllm-playground}"
DEPLOYMENT_YAML="openshift-deployment.yaml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
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

# Check if namespace exists
check_namespace() {
    log_info "Checking if namespace '${NAMESPACE}' exists..."
    if ! oc get namespace "${NAMESPACE}" &> /dev/null; then
        log_warn "Namespace '${NAMESPACE}' does not exist."
        echo ""
        log_info "Nothing to undeploy. Exiting."
        exit 0
    fi
    log_info "Found namespace: ${NAMESPACE}"
}

# Show what will be deleted
show_resources() {
    log_info "Checking existing resources in namespace '${NAMESPACE}'..."
    echo ""

    # Check for deployment
    if oc get deployment "${APP_NAME}" -n "${NAMESPACE}" &> /dev/null; then
        echo "Deployment:"
        oc get deployment "${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null || true
        echo ""
    fi

    # Check for pods
    if oc get pods -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null | grep -q "${APP_NAME}"; then
        echo "Pods:"
        oc get pods -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null || true
        echo ""
    fi

    # Check for services
    if oc get svc -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | grep -q .; then
        echo "Services:"
        oc get svc -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null || true
        echo ""
    fi

    # Check for routes
    if oc get routes -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | grep -q .; then
        echo "Routes:"
        oc get routes -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null || true
        echo ""
    fi

    # Check for secrets
    if oc get secret hf-token -n "${NAMESPACE}" &> /dev/null; then
        echo "Secrets:"
        oc get secret hf-token -n "${NAMESPACE}" 2>/dev/null || true
        echo ""
    fi

    # Check for PVCs
    if oc get pvc -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | grep -q .; then
        echo "Persistent Volume Claims:"
        oc get pvc -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null || true
        echo ""
    fi
}

# Confirm deletion
confirm_deletion() {
    echo ""
    echo "========================================"
    log_warn "WARNING: This will delete all vLLM Playground resources!"
    echo "========================================"
    echo ""
    echo "Namespace: ${NAMESPACE}"
    echo "Application: ${APP_NAME}"
    echo ""

    read -p "Are you sure you want to continue? (yes/no): " -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log_info "Undeployment cancelled by user."
        exit 0
    fi
}

# Delete using YAML file
delete_yaml_resources() {
    if [ -f "${SCRIPT_DIR}/${DEPLOYMENT_YAML}" ]; then
        log_step "Deleting resources using ${DEPLOYMENT_YAML}..."
        if oc delete -f "${SCRIPT_DIR}/${DEPLOYMENT_YAML}" -n "${NAMESPACE}" --ignore-not-found=true 2>&1; then
            log_info "Resources from YAML file deleted successfully"
        else
            log_warn "Some resources from YAML may not exist or were already deleted"
        fi
    else
        log_warn "Deployment YAML file not found: ${DEPLOYMENT_YAML}"
        log_info "Will proceed with label-based deletion..."
    fi
}

# Delete resources by label
delete_by_label() {
    log_step "Deleting remaining resources by label (app=${APP_NAME})..."

    # Delete all resources with the app label
    if oc delete all -l app="${APP_NAME}" -n "${NAMESPACE}" --ignore-not-found=true 2>&1; then
        log_info "Label-based resources deleted successfully"
    else
        log_warn "No resources found with label app=${APP_NAME}"
    fi
}

# Delete HuggingFace token secret if it exists
delete_secrets() {
    log_step "Checking for HuggingFace token secret..."
    if oc get secret hf-token -n "${NAMESPACE}" &> /dev/null; then
        log_info "Deleting HuggingFace token secret..."
        oc delete secret hf-token -n "${NAMESPACE}" --ignore-not-found=true
        log_info "Secret deleted successfully"
    else
        log_info "No HuggingFace token secret found"
    fi
}

# Delete PVCs
delete_pvcs() {
    log_step "Checking for Persistent Volume Claims..."
    if oc get pvc -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | grep -q .; then
        log_info "Deleting Persistent Volume Claims..."
        oc delete pvc -l app="${APP_NAME}" -n "${NAMESPACE}" --ignore-not-found=true
        log_info "PVCs deleted successfully"
    else
        log_info "No PVCs found"
    fi
}

# Optional: Delete namespace
delete_namespace_prompt() {
    echo ""
    read -p "Do you want to delete the entire namespace '${NAMESPACE}'? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_warn "Deleting namespace '${NAMESPACE}'..."
        log_warn "This will delete ALL resources in the namespace, not just vLLM Playground!"
        read -p "Are you absolutely sure? Type 'DELETE' to confirm: " -r
        echo ""
        if [[ $REPLY == "DELETE" ]]; then
            oc delete namespace "${NAMESPACE}" --ignore-not-found=true
            log_info "Namespace '${NAMESPACE}' deleted successfully"
        else
            log_info "Namespace deletion cancelled"
        fi
    else
        log_info "Keeping namespace '${NAMESPACE}'"
    fi
}

# Verify cleanup
verify_cleanup() {
    log_step "Verifying cleanup..."
    echo ""

    local resources_found=false

    # Check for remaining resources
    if oc get deployment "${APP_NAME}" -n "${NAMESPACE}" &> /dev/null; then
        log_warn "Deployment still exists"
        resources_found=true
    fi

    if oc get pods -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | grep -q .; then
        log_warn "Pods still exist (may be terminating)"
        oc get pods -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null || true
        resources_found=true
    fi

    if oc get svc -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | grep -q .; then
        log_warn "Services still exist"
        resources_found=true
    fi

    if oc get routes -l app="${APP_NAME}" -n "${NAMESPACE}" 2>/dev/null | tail -n +2 | grep -q .; then
        log_warn "Routes still exist"
        resources_found=true
    fi

    if [ "$resources_found" = false ]; then
        log_info "All vLLM Playground resources have been successfully removed!"
    else
        log_warn "Some resources may still be terminating. Check again in a few moments."
        echo ""
        log_info "To check status, run:"
        echo "  oc get all -l app=${APP_NAME} -n ${NAMESPACE}"
    fi
}

# Show summary
show_summary() {
    echo ""
    echo "========================================"
    echo "  Undeployment Summary"
    echo "========================================"
    echo ""
    echo "Namespace: ${NAMESPACE}"
    echo "Application: ${APP_NAME}"
    echo ""
    log_info "Cleanup completed!"
    echo ""
    log_info "Useful commands to verify:"
    echo "  Check all resources:    oc get all -n ${NAMESPACE}"
    echo "  Check pods:             oc get pods -n ${NAMESPACE}"
    echo "  Check namespaces:       oc get namespaces"
    echo ""
}

# Main execution
main() {
    log_info "Starting OpenShift undeployment for vLLM Playground..."
    echo ""

    check_login
    check_namespace
    show_resources
    confirm_deletion

    echo ""
    log_info "Beginning cleanup process..."
    echo ""

    delete_yaml_resources
    delete_by_label
    delete_secrets
    delete_pvcs
    delete_namespace_prompt
    verify_cleanup
    show_summary

    log_info "Undeployment process completed!"
}

# Run main function
main
