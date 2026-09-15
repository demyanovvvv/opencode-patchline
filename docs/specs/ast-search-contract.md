# AST Search Contract

Status: Accepted

AST search is reserved for syntactic structure. It uses `@ast-grep/napi`,
loads language support on demand, caps results, and reports parser failures.
Literal text belongs to grep; symbol relationships belong to LSP.

Source input is limited to 8 MiB before UTF-8 decoding or native parsing,
including growth detected while the opened file is read. Oversized input is
rejected with `INVALID_ARGUMENT`. Each returned node preview is capped at 2,000
characters while retaining its file and line range.
