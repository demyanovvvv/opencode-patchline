# Stale Edit Contract

Status: Accepted

Immediately before preflight, Patchline reads current raw bytes and compares
their SHA-256 digest with the snapshot. A mismatch returns `STALE_SNAPSHOT`,
sets `rereadRequired` to true, and performs zero writes. There is no force
overwrite default. Recovery is allowed only when the current target bytes are
unchanged.
