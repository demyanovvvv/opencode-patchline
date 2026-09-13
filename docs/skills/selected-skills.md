# Selected Agent Skills

Selected from skills.sh and installed for this project:

- `obra/superpowers:test-driven-development` for safety invariants;
- `obra/superpowers:verification-before-completion` for evidence-based finish;
- `obra/superpowers:systematic-debugging` for reproducible failure isolation;
- `mattpocock/skills:improve-codebase-architecture` for deep module seams;
- `mattpocock/skills:grill-me` for design stress testing;
- `vercel-labs/skills:find-skills` for later specialized discovery.
- `mcollina/skills:node` for Node.js and TypeScript runtime practices;
- `wshobson/agents:sast-configuration` for SAST setup and security review;
- `yigitkonur/skills-by-yigitkonur:publish-npm-package` for npm package release
  workflows.

Skills guide development and are not Patchline runtime dependencies. They are
installed under `.agents/skills/` and pinned by `skills-lock.json` in this
project. They are excluded from the npm package by the package `files` list.
