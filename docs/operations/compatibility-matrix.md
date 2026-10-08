# Compatibility Matrix

| Component | Version | Status |
|---|---|---|
| OpenCode | 1.18.35 | release baseline; integrated version 1.18.35+patchline.1.2.1 |
| `@opencode-ai/plugin` | 1.18.30 | verified |
| `@oh-my-pi/hashline` | 18.1.5 | Full upstream runtime verified under OpenCode/Bun; Node keeps guarded linear fallback |
| Node.js | 20.x and 22.x | CI matrix; local development uses 22.22.2 |
| Windows | current development host | tested |
| Windows CI | Windows Server 2022, Node.js 20 and 22 | direct plugin registration smoke passes; OpenCode HTTP bootstrap blocked |
| Linux/macOS | GitHub Actions, Node.js 20 and 22 | full CI matrix |
| Release publishing | GitHub Releases, Node.js 24 runner | package archive, SHA-256 checksum, bilingual notes and release gates |
