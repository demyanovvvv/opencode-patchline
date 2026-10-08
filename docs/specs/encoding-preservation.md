# Encoding Preservation

Status: Accepted

Exact input line separators normalize to LF before matching and analysis.
Candidate bytes must decode to the analyzed normalized text. Literal replacement
does not expand JavaScript dollar patterns. Mixed-ending files preserve unchanged
line chunks between separate edits; new/changed chunks use the preferred ending.

Patchline supports UTF-8 with or without BOM and preserves LF or CRLF. Invalid
UTF-8 is rejected instead of decoded with replacement characters by read, edit,
literal grep, and AST search. Mixed line endings are preserved for unchanged
text by exact editing; Hashline batch edits use the file's detected dominant
shape and are reported by doctor/tests.
