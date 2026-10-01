# Write Guard Contract

Status: Accepted

New files may be created. Existing source files must be changed through
snapshot-anchored `edit`. Existing generated files require their canonical
generator. Explicit full replacement is an opt-in allowlist exception and does
not bypass path safety. Missing parent directories are created component by
component with canonical and identity checks; only operation-owned empty
directories may be cleaned up after a failed create.
