# Compatibility Matrix

| Component | Version | Status |
|---|---|---|
| OpenCode | 1.18.30 | verified source and installed CLI |
| `@opencode-ai/plugin` | 1.18.30 | verified |
| `@oh-my-pi/hashline` | 18.1.5 | API verified; Bun-oriented runtime is optional under Node |
| Node.js | 20.x and 22.x | CI matrix; local development uses 22.22.2 |
| Windows | current development host | tested |
| Windows CI | Windows Server 2022, Node.js 20 and 22 | direct plugin registration smoke passes; OpenCode HTTP bootstrap blocked |
| Linux/macOS | GitHub Actions, Node.js 20 and 22 | full CI matrix |
| Release publishing | npm Trusted Publishing, Node.js 24 runner | tag/version/changelog gates and package smoke required |
