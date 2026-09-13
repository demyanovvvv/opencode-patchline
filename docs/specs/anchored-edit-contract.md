# Anchored Edit Contract

Status: Accepted

Existing source files require a snapshot obtained from `read`. Exact edits must
match a unique `oldString` within observed lines unless explicitly replacing
all observed matches. Hashline patches must carry the same observed tag and
pass Hashline preflight. Candidate content is constructed before any write.
