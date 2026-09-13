# Diagnostics Contract

Status: Accepted

Diagnostics are proportional to risk and bounded. Patchline distinguishes tool
execution success from validation success. Native OpenCode diagnostics are
preferred; configured commands provide a deterministic fallback. A diagnostics
failure does not conceal a successful write and is reported separately.
