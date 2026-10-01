# Anchored Edit Contract

Status: Accepted

Existing source files require a snapshot obtained from `read`. Exact edits must
match a unique `oldString` within observed lines unless explicitly replacing
all observed matches. Hashline patches must carry the same observed tag and
pass Hashline preflight. Candidate content is constructed before any write.

Snapshot IDs are exact-content identifiers. Four-character Hashline tags are
display anchors only: if a tag maps to more than one recorded content version,
Patchline rejects the edit instead of selecting a candidate. Live content must
also retain the recorded raw digest and file identity through commit.
