"""Makes ``openshift/kubernetes_container_manager.py`` importable as a plain
module for tests. It lives outside the installable ``vllm_playground``
package (it's deployed standalone into the OpenShift/K8s container image),
so it isn't reachable via a normal package import path.
"""

import sys
from pathlib import Path

_OPENSHIFT_DIR = Path(__file__).resolve().parents[2] / "openshift"
if str(_OPENSHIFT_DIR) not in sys.path:
    sys.path.insert(0, str(_OPENSHIFT_DIR))
