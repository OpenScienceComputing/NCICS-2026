#!/usr/bin/env bash
# setup-kernels.sh — Install all NCICS-2026 Jupyter kernels
#
# Usage:
#   bash ~/repos/NCICS-2026/scripts/setup-kernels.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "${SCRIPT_DIR}/setup-kernel.sh" \
    "protocoast-notebook" \
    "protocoast-notebook (py3.12)" \
    "${SCRIPT_DIR}/protocoast-notebook-requirements.txt"

bash "${SCRIPT_DIR}/setup-kernel.sh" \
    "eopf-notebook" \
    "eopf-notebook (py3.12)" \
    "${SCRIPT_DIR}/eopf-notebook-requirements.txt"
