# Development Plan

## P0: editing safety

- Verify current OpenCode and Hashline APIs.
- Implement canonical paths and UTF-8 preservation.
- Implement session/worktree snapshots and minimal reads.
- Implement exact and Hashline edits with stale rejection.
- Block whole-file replacement and preflight multi-file edits.
- Prove preservation with raw-byte and canonical diff tests.

## P1: discovery and validation

- Add bounded textual search.
- Reuse OpenCode LSP through native tool or CLI bridge.
- Add AST structural search.
- Add diagnostic command routing and compact output.

## P2: performance and measurement

- Keep bounded session caches with correct invalidation.
- Collect local content-free metrics.
- Run reproducible benchmark fixtures and emit raw JSON plus Markdown.
- Optimize only after stale-safety tests stay green.

## P3: operations

- Add doctor self-tests and OpenCode-delegated installer.
- Validate package exports and clean installation.
- Maintain compatibility matrix, upgrade policy, changelog, and release gates.

## Release gate

Run `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`,
`npm run bench`, `npm run doctor`, `npm run smoke:plugin`, package smoke
installation, and OpenCode plugin load. Inspect the final package contents and
audit dependencies.
