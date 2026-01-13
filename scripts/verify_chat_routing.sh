#!/bin/bash
# Verification script to check if chat requests are routed correctly

set -e

echo "========================================"
echo "vLLM Playground - Chat Routing Verification"
echo "========================================"
echo ""

# Get namespace
NAMESPACE=${NAMESPACE:-vllm-playground}
echo "📍 Using namespace: $NAMESPACE"
echo ""

# Get web UI route
echo "🔍 Finding web UI route..."
WEB_UI_ROUTE=$(oc get route vllm-playground -n $NAMESPACE -o jsonpath='{.spec.host}' 2>/dev/null || echo "")

if [ -z "$WEB_UI_ROUTE" ]; then
    echo "❌ Error: Could not find vllm-playground route in namespace $NAMESPACE"
    echo "   Run: oc get routes -n $NAMESPACE"
    exit 1
fi

WEB_UI_URL="https://$WEB_UI_ROUTE"
echo "✅ Web UI URL: $WEB_UI_URL"
echo ""

# Test 1: Check if web UI is accessible
echo "=== Test 1: Web UI Accessibility ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $WEB_UI_URL)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Web UI is accessible (HTTP $HTTP_CODE)"
else
    echo "⚠️  Web UI returned HTTP $HTTP_CODE"
fi
echo ""

# Test 2: Check connection configuration
echo "=== Test 2: Connection Configuration ==="
CONNECTION_INFO=$(curl -s $WEB_UI_URL/api/debug/connection)
echo "$CONNECTION_INFO" | jq '.'

IS_KUBERNETES=$(echo "$CONNECTION_INFO" | jq -r '.is_kubernetes')
CONNECTION_MODE=$(echo "$CONNECTION_INFO" | jq -r '.connection_mode')
URL_WOULD_USE=$(echo "$CONNECTION_INFO" | jq -r '.url_would_use')

if [ "$IS_KUBERNETES" = "true" ]; then
    echo "✅ Kubernetes mode detected: $IS_KUBERNETES"
else
    echo "❌ Kubernetes mode NOT detected: $IS_KUBERNETES"
fi

if [ "$CONNECTION_MODE" = "kubernetes_service" ]; then
    echo "✅ Connection mode: $CONNECTION_MODE"
else
    echo "⚠️  Connection mode: $CONNECTION_MODE (expected: kubernetes_service)"
fi

if [[ "$URL_WOULD_USE" == *"vllm-service"* ]]; then
    echo "✅ Using vLLM service URL: $URL_WOULD_USE"
else
    echo "⚠️  URL: $URL_WOULD_USE (expected vllm-service)"
fi
echo ""

# Test 3: Check if vLLM service exists
echo "=== Test 3: vLLM Service Status ==="
if oc get service vllm-service -n $NAMESPACE &>/dev/null; then
    echo "✅ vLLM service exists"
    oc get service vllm-service -n $NAMESPACE
else
    echo "⚠️  vLLM service not found (this is OK if server not started)"
fi
echo ""

# Test 4: Check if vLLM pod exists
echo "=== Test 4: vLLM Pod Status ==="
if oc get pod vllm-service -n $NAMESPACE &>/dev/null; then
    echo "✅ vLLM pod exists"
    POD_STATUS=$(oc get pod vllm-service -n $NAMESPACE -o jsonpath='{.status.phase}')
    echo "   Status: $POD_STATUS"
else
    echo "⚠️  vLLM pod not found (this is OK if server not started)"
fi
echo ""

# Test 5: Test vLLM connection (only if vLLM is running)
echo "=== Test 5: vLLM Connection Test ==="
CONNECTION_TEST=$(curl -s $WEB_UI_URL/api/debug/test-vllm-connection)
echo "$CONNECTION_TEST" | jq '.'

SUCCESS=$(echo "$CONNECTION_TEST" | jq -r '.success')
if [ "$SUCCESS" = "true" ]; then
    echo "✅ Successfully connected to vLLM service!"
else
    ERROR=$(echo "$CONNECTION_TEST" | jq -r '.error')
    echo "⚠️  Could not connect to vLLM service: $ERROR"
    echo "   (This is expected if vLLM server is not started)"
fi
echo ""

# Test 6: Check web UI pod environment
echo "=== Test 6: Web UI Pod Environment ==="
WEBUI_POD=$(oc get pod -n $NAMESPACE -l app=vllm-playground-webui -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [ -n "$WEBUI_POD" ]; then
    echo "✅ Web UI pod: $WEBUI_POD"

    # Check service account token
    if oc exec -n $NAMESPACE $WEBUI_POD -- test -f /var/run/secrets/kubernetes.io/serviceaccount/token &>/dev/null; then
        echo "✅ Service account token is mounted"
    else
        echo "❌ Service account token NOT mounted"
    fi

    # Check namespace env var
    K8S_NAMESPACE=$(oc exec -n $NAMESPACE $WEBUI_POD -- printenv KUBERNETES_NAMESPACE 2>/dev/null || echo "")
    if [ -n "$K8S_NAMESPACE" ]; then
        echo "✅ KUBERNETES_NAMESPACE env var set to: $K8S_NAMESPACE"
    else
        echo "⚠️  KUBERNETES_NAMESPACE env var not set"
    fi

    # Check container manager type
    CONTAINER_MGR=$(oc exec -n $NAMESPACE $WEBUI_POD -- head -4 container_manager.py 2>/dev/null | grep -i kubernetes || echo "")
    if [ -n "$CONTAINER_MGR" ]; then
        echo "✅ Using Kubernetes container manager"
    else
        echo "❌ NOT using Kubernetes container manager"
    fi
else
    echo "⚠️  Could not find web UI pod"
fi
echo ""

# Summary
echo "========================================"
echo "Summary"
echo "========================================"
if [ "$IS_KUBERNETES" = "true" ] && [ "$CONNECTION_MODE" = "kubernetes_service" ] && [[ "$URL_WOULD_USE" == *"vllm-service"* ]]; then
    echo "✅ VERIFICATION PASSED"
    echo ""
    echo "Chat requests WILL be sent to:"
    echo "   $URL_WOULD_USE"
    echo ""
    echo "This is the CORRECT endpoint (vllm-service pod)."
else
    echo "⚠️  CONFIGURATION ISSUES DETECTED"
    echo ""
    echo "Please review the test results above."
fi
echo "========================================"
