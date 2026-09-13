# Encoding Preservation

Status: Accepted

Patchline supports UTF-8 with or without BOM and preserves LF or CRLF. Invalid
UTF-8 is rejected instead of decoded with replacement characters by read, edit,
literal grep, and AST search. Mixed line endings are preserved for unchanged
text by exact editing; Hashline batch edits use the file's detected dominant
shape and are reported by doctor/tests.
