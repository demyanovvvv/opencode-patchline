# Architecture

Status: Accepted

```text
OpenCode
  -> Patchline plugin
  -> guarded read/edit/write tools
  -> workspace resolver
  -> session-scoped snapshots
  -> anchored patch engine
  -> stale verification
  -> diagnostics and targeted validation
```

Patchline exposes a small model-facing surface. `read` records exactly the file
state shown to the model. `edit` verifies that state and applies either an
exact replacement or Hashline patch. `write` creates files but refuses to
replace existing source. Search providers are selected by intent: semantic
queries use native OpenCode LSP when enabled, text queries use grep, and syntax
queries use AST search.

Correctness is enforced below the model policy. Path boundaries, raw-content
digests, scope binding, and write protection remain active even if a model
uses the wrong tool.
