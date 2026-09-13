# PATCHLINE

## Precision Editing Engine for OpenCode

Build a production-grade OpenCode plugin/package named:

**Patchline**

Package / repository name:

`opencode-patchline`

Suggested npm package:

`opencode-patchline`

Tagline:

**Precision code editing for OpenCode.**

Alternative technical description:

**Anchored semantic code editing with minimal context, minimal diffs, and maximum precision.**

---

# 1. MISSION

Design and implement **Patchline**, a precision code-editing engine for OpenCode.

The goal is to make OpenCode significantly better at modifying EXISTING code by optimizing simultaneously for:

1. QUALITY OF WORK
2. EDIT PRECISION
3. SPEED
4. TOKEN EFFICIENCY

The editing behavior should be inspired by the strongest ideas from Oh My Pi / OMP, particularly:

- anchored editing;
- Hashline-style snapshots;
- minimal context reads;
- stale-edit protection;
- precise local patches;
- LSP-assisted semantic navigation;
- structural AST search;
- diagnostics immediately after modification.

However:

DO NOT fork Oh My Pi.

DO NOT turn OpenCode into an OMP clone.

DO NOT replace OpenCode's UX, provider support, agents, sessions, TUI, MCP, skills, or ecosystem.

Instead create a focused **editing engine plugin** that improves how OpenCode discovers, reads, modifies, and validates code.

Target:

# OpenCode  
+  
Patchline

OpenCode ecosystem with OMP-like anchored editing precision.

---

# 2. CORE USER EXPERIENCE

The user should continue using OpenCode normally.

Example:

User:

"Fix refresh token expiration handling. Delete an expired session and return 401. Do not change unrelated logic."

The user should NOT need to manually:

- locate the file;
- specify line numbers;
- highlight code;
- select an editing mode;
- tell the model to use Hashline;
- invoke AST tools;
- invoke LSP manually.

Patchline should make the agent naturally follow:

TASK  
↓  
LOCATE  
↓  
UNDERSTAND  
↓  
READ MINIMAL CONTEXT  
↓  
CREATE SNAPSHOT  
↓  
ANCHORED PATCH  
↓  
VERIFY SNAPSHOT  
↓  
DIAGNOSTICS  
↓  
TARGETED VALIDATION  
↓  
DONE

The interface should remain ordinary OpenCode.

The intelligence should live inside Patchline.

---

# 3. PRIMARY DESIGN PHILOSOPHY

For EXISTING files:

**Locate precisely. Read minimally. Patch exactly. Verify immediately.**

Avoid this:

read 1200-line file  
↓  
regenerate 1200-line file  
↓  
write entire file  
↓  
hope unrelated content remains unchanged

Prefer this:

find relevant symbol  
↓  
read lines 210-260  
↓  
snapshot those observed file contents  
↓  
edit lines 227-233  
↓  
verify current state  
↓  
apply patch  
↓  
diagnostics

An existing source file should almost never be rewritten in full for a local modification.

---

# 4. SUCCESS METRICS

Patchline must optimize all four metrics simultaneously.

## QUALITY OF WORK

Measure:

- functional task success;
- correct understanding of code relationships;
- correct behavior after changes;
- tests passing;
- type correctness;
- diagnostics introduced;
- regression rate.

## EDIT PRECISION

Measure:

- number of intended lines changed;
- number of unrelated lines changed;
- number of unrelated files touched;
- formatting churn;
- import churn;
- accidental renaming;
- stale overwrites;
- unnecessary file rewrites.

## SPEED

Measure:

- time to locate target;
- time to first edit;
- total wall-clock tool time;
- number of agent/tool round trips;
- number of repeated reads;
- number of edit retries;
- diagnostics latency.

## TOKEN EFFICIENCY

Measure:

- provider input tokens when available;
- provider output tokens when available;
- source lines supplied to model;
- tool-result characters;
- tool-result bytes;
- edit payload characters;
- repeated-context percentage.

If actual provider token numbers are unavailable, distinguish estimates/proxies from actual token counts.

Never present estimates as actual provider usage.

---

# 5. HARD REQUIREMENTS

Patchline must satisfy these invariants.

## Existing source files

Local modifications MUST use precision anchored editing.

## New files

Normal file creation is allowed.

## Stale edits

Never silently overwrite code that changed since the model observed it.

## Unrelated code

Do not modify it.

## Formatting

Do not reformat unrelated ranges.

## Line endings

Preserve original line endings.

## BOM

Preserve BOM where present.

## Encoding

Preserve supported source encoding correctly.

## Multi-file operations

Preflight before applying where possible.

Do not leave a task half-applied because the second patch failed after the first was already written.

## Existing-file write bypass

Prevent models from bypassing precision anchored editing by simply using a whole-file `write`.

---

# 6. IMPLEMENT AS AN OPENCODE PLUGIN

Preferred architecture:

`opencode-patchline`

Do NOT create a separate IDE.

Do NOT create a separate coding-agent frontend.

Do NOT fork OpenCode unless absolutely unavoidable.

Implement Patchline primarily as:

- OpenCode plugin;
- custom tools;
- tool overrides;
- hooks where reliable;
- compact instruction policy;
- supporting libraries.

The final user experience should be approximately:

install Patchline  
↓  
configure OpenCode  
↓  
run `opencode`  
↓  
use OpenCode normally

---

# 7. INSPECT CURRENT OPENCODE BEFORE CODING

Before implementation, inspect the CURRENT installed/project version of OpenCode.

Do not assume an API from memory.

Determine:

- OpenCode version;
- plugin API;
- custom tool API;
- tool shadowing/overriding behavior;
- permission system;
- available lifecycle hooks;
- session identifiers;
- workspace/worktree identifiers;
- built-in `read`;
- built-in `edit`;
- built-in `write`;
- `apply_patch`;
- `grep`;
- `glob`;
- LSP support;
- diagnostics support.

OpenCode APIs may differ across versions.

Feature-detect capabilities.

If installed source contradicts documentation, trust installed source/runtime.

Do not build against imaginary APIs.

---

# 8. TARGET ARCHITECTURE

Implement something conceptually similar to:

```
                OpenCode
                   │
                   ▼
             Patchline Router
                   │
   ┌───────────────┼────────────────┐
   │               │                │
   ▼               ▼                ▼
  LSP             GREP          AST SEARCH
semantic          textual        structural
   │               │                │
   └───────────────┼────────────────┘
                   ▼
            Target Resolver
                   ▼
            Minimal Read
                   ▼
           Snapshot Store
                   ▼
           Anchored Edit
                   ▼
          Stale Verification
                   ▼
             Apply Patch
                   ▼
             Diagnostics
                   ▼
        Targeted Validation
                   ▼
                 DONE

```

---

# 9. SEARCH MUST BE ROUTED INTELLIGENTLY

Do NOT mechanically call:

LSP  
→ grep  
→ AST

for every task.

That wastes time and context.

Instead choose the cheapest reliable search mechanism.

---

# 10. LSP — SEMANTIC SEARCH

Prefer LSP for questions involving symbols and relationships.

Examples:

- where is `createOrder` defined?
- who references `createOrder`?
- what implements `PaymentProvider`?
- where is this type defined?
- what calls this method?
- what is the inferred type?
- what implementations belong to this interface?

Useful operations where available:

- workspaceSymbol;
- documentSymbol;
- goToDefinition;
- findReferences;
- goToImplementation;
- hover;
- call hierarchy;
- type hierarchy;
- diagnostics.

LSP should help locate the correct code WITHOUT loading large files into model context.

Example:

User:

"Change calculateOrderTotal."

Preferred:

workspaceSymbol(calculateOrderTotal)  
→ src/order/pricing.ts:183

Not:

grep entire repository  
→ 87 textual matches  
→ read 10 files.

---

# 11. LSP FEATURE DETECTION

Do NOT assume callable LSP exists.

Determine what the current OpenCode runtime exposes.

If callable LSP exists:

use it.

If OpenCode has diagnostics integration but no agent-callable navigation API:

reuse diagnostics and implement only the navigation bridge required.

If OpenCode currently lacks suitable LSP runtime functionality:

implement a lightweight modular LSP adapter only if beneficial.

Fallback hierarchy:

1. native OpenCode LSP;
2. existing OpenCode language-server integration;
3. lightweight Patchline LSP bridge;
4. AST;
5. grep.

Do not eagerly start every language server.

Start language servers lazily.

Reuse them during the session.

Stop/cleanup correctly.

---

# 12. GREP — TEXTUAL SEARCH

Use grep/ripgrep for literal textual discovery.

Examples:

- environment variable names;
- error strings;
- configuration keys;
- template strings;
- CSS class names;
- comments;
- literal API routes.

Prefer structured ripgrep output such as JSON when practical.

Avoid parsing decorative CLI output.

Return concise results.

Do not expose 500 results to the model if the first 20 high-quality matches are sufficient.

Result should contain:

- path;
- line number;
- relevant matching line;
- limited context;
- snapshot compatibility information where appropriate.

---

# 13. AST — STRUCTURAL SEARCH

Add structural search.

Preferred engine:

`@ast-grep/napi`

or the most appropriate current ast-grep programmatic library.

Create a tool conceptually named:

`ast_search`

Use it for structural requests such as:

- find every empty catch block;
- find function calls matching a particular argument structure;
- find unsafe API usage;
- locate React component patterns;
- locate declarations matching structural rules;
- locate imports of a particular syntactic shape.

AST search is NOT required for simple literal searches.

AST search is NOT a replacement for LSP.

The three discovery modes should complement one another:

LSP = semantics

grep = text

AST = syntax / structure

---

# 14. HASHLINE / ANCHORED EDITING

Use the current upstream:

`@oh-my-pi/hashline`

when technically appropriate and compatible.

Do NOT unnecessarily rebuild Hashline logic.

Inspect its CURRENT API before implementation.

Use upstream primitives when available for:

- filesystem abstraction;
- SnapshotStore;
- snapshot identifiers/tags;
- anchored ranges;
- patching;
- preflight;
- stale-state validation;
- recovery.

The critical rule:

**The patch must be linked to the same file state that the model actually observed.**

---

# 15. SNAPSHOT MODEL

When a model reads existing code through Patchline:

1. obtain current file content;
2. capture its content state;
3. store it in a session/workspace-isolated SnapshotStore;
4. return an identifier/tag associated with that observed state;
5. expose stable edit anchors.

Conceptually:

`src/auth/session.ts #A74F`

Then relevant lines might look conceptually like:

120#K7 ...  
121#P4 ...  
122#R1 ...

Do NOT invent your own incompatible syntax if upstream Hashline already defines the representation.

Use the actual supported format.

---

# 16. READ TOOL

Create or override `read` so normal agent reads automatically participate in the snapshot system.

Preferred behavior:

`read(existing source file)`  
→ minimal file range  
→ snapshot captured  
→ anchored output

The agent should not need to remember to call a separate `hash_read`.

Ideally the standard tool name remains:

`read`

because models are already strongly trained to use it.

If safe overriding is unsupported, provide a dedicated Patchline read tool and disable/reroute ordinary source-file reads as necessary.

---

# 17. MINIMAL READ POLICY

Start with narrow context.

Adaptive philosophy:

small local function:  
20–80 lines

medium component:  
40–150 lines

larger control-flow region:  
expand as needed

These are guidance ranges, not hard-coded limits.

Expand context only when necessary because:

- function extends outside range;
- relevant type is missing;
- control flow escapes;
- diagnostic requires dependency;
- nearby state is required;
- edit cannot be determined safely.

Never load a 3000-line file simply because the target symbol is inside it.

---

# 18. READ OUTPUT

Return only useful information:

- path;
- snapshot identifier;
- requested relevant code;
- anchored lines;
- indication that more lines are available when useful.

Do not attach:

- whole file unnecessarily;
- duplicate metadata;
- verbose explanations;
- giant diagnostics dump;
- irrelevant neighboring sections.

Token economy starts at tool output.

---

# 19. EDIT TOOL

Patchline's core tool should preferably appear to the model as:

`edit`

not:

`hashline_super_precision_edit_v2`

The complexity belongs inside the engine.

For existing files:

`edit`  
→ snapshot verification  
→ anchored patch resolution  
→ preflight  
→ safe application  
→ concise result

The agent should provide:

- file;
- snapshot/tag;
- anchored edit instructions;
- replacement/new content.

It should NOT need to repeat hundreds of unchanged old lines.

---

# 20. EDIT MINIMALITY

Make the smallest semantically correct change.

Before applying an edit, prefer:

+1 / -1

over:

+70 / -70

when both produce the same correct behavior.

Do not modify:

- unrelated spacing;
- unrelated imports;
- quote styles;
- comments;
- ordering;
- naming;
- neighboring functions;
- unrelated types;
- unrelated CSS;
- file-wide formatting.

No opportunistic cleanup unless explicitly requested.

---

# 21. WRITE PROTECTION

Existing-file `write` is one of the biggest threats to precision.

Implement a hard guard.

Desired:

`write(new file)`  
→ ALLOW

`write(existing source file)`  
→ DENY

Return something concise such as:

`Existing source file. Use snapshot-anchored edit.`

Do NOT rely solely on the system prompt to prevent rewriting.

Enforce this through tools/permissions/plugin behavior.

Possible exceptions:

- generated artifacts;
- lockfiles regenerated by canonical tools;
- files explicitly requested to be recreated;
- genuinely complete file replacement operations.

Exceptions must be narrow and intentional.

---

# 22. GENERATED FILES

Detect common generated artifacts.

Examples:

- lockfiles;
- dist;
- build;
- generated clients;
- minified bundles;
- vendored files;
- codegen output.

Prefer running the canonical generator instead of asking the model to directly patch generated output.

Example:

wrong:  
edit package-lock.json manually

better:  
change package.json  
→ run package manager  
→ package-lock regenerated

---

# 23. STALE EDIT PROTECTION

This is a P0 feature.

Example:

Model reads:

snapshot A

Then file changes externally.

Current:

snapshot B

Model attempts patch using A.

Patchline MUST NOT silently apply a stale patch to B.

Expected:

edit rejected  
↓  
read fresh minimal range  
↓  
new snapshot  
↓  
re-evaluate  
↓  
new anchored edit

No force-overwrite by default.

---

# 24. SAFE RECOVERY

If upstream Hashline provides safe anchor recovery, use it conservatively.

Examples:

Content outside target region changed:  
potentially recover safely.

Target line itself changed:  
usually reject and reread.

Never prioritize convenience over preserving external/user changes.

Log when recovery occurred.

---

# 25. MULTI-FILE EDITING

Support tasks spanning several files.

Example:

- change function signature;
- update caller;
- update type.

Desired:

prepare patches  
↓  
validate snapshots  
↓  
preflight all  
↓  
apply safely

If one edit is invalid, avoid partially corrupting the working tree.

Use transactional/atomic behavior where practical.

At minimum:

preflight all patches before writing any file.

---

# 26. EDIT RESULT

After editing, keep output compact.

Example:

Changed:  
`src/auth/session.ts`  
+4 -2

Snapshot verified.  
No stale conflict.

Diagnostics:  
0 new errors.

Do not return the entire edited file.

Do not repeat the entire patch if the model already supplied it unless necessary for verification.

---

# 27. DIAGNOSTICS

After successful source edits:

run cheap relevant diagnostics.

Preferred:

edit  
↓  
LSP diagnostics for changed file  
↓  
detect NEW errors

Distinguish:

existing diagnostics

from:

new diagnostics caused by current edit.

Avoid filling model context with hundreds of unrelated pre-existing warnings.

---

# 28. PROGRESSIVE VALIDATION

Validation should be proportional to risk.

## LEVEL 1

After normal edit:

- snapshot verification;
- syntax sanity;
- LSP diagnostics.

## LEVEL 2

When appropriate:

- lint changed file;
- targeted type check;
- targeted unit test.

## LEVEL 3

At completion of meaningful larger task:

- affected package tests;
- broader typecheck;
- build when justified.

Do NOT run a 10-minute monorepo test suite after every two-line change.

---

# 29. VALIDATION ROUTING

Examples:

TypeScript local function edit:

LSP diagnostics  
→ targeted `tsc` or package typecheck if necessary

React component:

diagnostics  
→ relevant component tests

Rust:

rust-analyzer diagnostics  
→ targeted cargo check/test

Python:

language diagnostics  
→ relevant pytest subset

Do not hard-code behavior only for JavaScript.

Design extensibly.

---

# 30. TOOL ECONOMY

Expose as few model-facing tools as practical.

Ideal visible conceptual set:

- read
- edit
- grep
- ast_search
- lsp
- glob
- bash/write as controlled utilities

Avoid adding 20 overlapping tools.

More tools increase:

- system prompt size;
- tool-schema tokens;
- model confusion;
- wrong tool selection.

Prefer powerful coherent tools.

---

# 31. SMART SEARCH ROUTER

Optionally implement a lightweight routing layer.

But do not hide useful deterministic tools unnecessarily.

The agent should understand:

symbol/refactoring request  
→ LSP

literal/config request  
→ grep

syntactic-pattern request  
→ AST

If a result is already conclusive, stop searching.

Do not run redundant discovery for confidence theater.

---

# 32. TOKEN EFFICIENCY STRATEGY

Token efficiency must be designed end-to-end.

## INPUT ECONOMY

Minimize:

- file lines returned;
- repeated code;
- huge grep results;
- giant diagnostics;
- repeated unchanged context;
- verbose tool metadata.

## OUTPUT ECONOMY

Minimize:

- old code repetition;
- unchanged surrounding code;
- giant SEARCH/REPLACE payloads;
- full-file reconstruction;
- verbose tool success explanations.

Use anchored patches so model output focuses on new/modified code.

---

# 33. SESSION CACHE

Use safe caching for:

- file metadata;
- snapshots;
- symbol query results;
- LSP process/session;
- parsed AST where beneficial.

Invalidate correctly after edits.

Never allow cache optimization to bypass stale-state validation.

Correctness &gt; caching speed.

---

# 34. SESSION ISOLATION

Snapshot keys should account for:

- OpenCode session;
- workspace;
- worktree;
- absolute/canonical file identity;
- file content snapshot.

Never allow:

workspace A snapshot  
→ edit workspace B

Never allow:

session A stale state  
→ authorize session B edit.

Clean up expired state.

---

# 35. MULTIPLE WORKTREES

OpenCode users may operate across Git worktrees.

Patchline must distinguish them correctly.

Do not key state by relative filename alone.

`src/index.ts` in worktree A and B are different states.

---

# 36. CROSS-PLATFORM REQUIREMENTS

Support:

- Windows;
- Linux;
- macOS.

Handle:

- `C:\...`;
- `/home/...`;
- path normalization;
- case sensitivity;
- CRLF;
- LF;
- BOM;
- Unicode names;
- spaces in paths;
- symlinks;
- Git worktrees.

No POSIX-only assumptions.

---

# 37. SECURITY

Editing must stay inside permitted workspace boundaries unless explicitly configured otherwise.

Protect against:

- `../` path escape;
- symlink traversal;
- `.git` internals;
- editing arbitrary user filesystem paths;
- malformed patch paths.

Preserve OpenCode's existing permission model.

Do not weaken OpenCode security to implement Patchline.

---

# 38. MODEL POLICY

Ship a short instruction policy with Patchline.

Keep it compact to save tokens.

Example:

PATCHLINE EDITING POLICY

- Locate relevant code before broad reads.
- Use LSP for semantic symbol navigation.
- Use grep for textual search.
- Use AST search for structural patterns.
- Read the smallest useful source range.
- Existing files must be modified with anchored `edit`.
- Never rewrite an existing source file for a local modification.
- Make the smallest semantically correct diff.
- Preserve unrelated formatting and code exactly.
- After edit, inspect relevant diagnostics.
- If snapshot is stale, reread and retry.
- Use broad tests only when targeted validation is insufficient.

Do not repeat this policy in every tool description.

---

# 39. MODEL COMPATIBILITY

Patchline should work well with multiple coding models.

Examples:

- OpenAI;
- Anthropic;
- Google;
- DeepSeek;
- GLM;
- other OpenCode-compatible providers.

Do not design the patch schema around only one model's quirks.

Test tool usability across several strong coding models if credentials/environment permit.

---

# 40. FALLBACK STRATEGY

Primary:

anchored Hashline/Patchline edit

On failure:

1. reread minimal current context;
2. obtain new snapshot;
3. retry anchored edit.

If the desired operation genuinely cannot be expressed:

4. use normal `apply_patch` as controlled fallback.

Only in exceptional justified cases:

5. full-file replacement.

Never:

Hashline failure  
→ immediately overwrite entire file.

---

# 41. APPLY_PATCH FALLBACK

Keep `apply_patch` available internally or with restricted visibility.

Reasons it may be useful:

- new file structure;
- uncommon patch operation;
- unsupported Hashline edge case;
- migration where anchored editing cannot safely represent the operation.

Track fallback usage.

A high fallback rate indicates Patchline needs improvement.

---

# 42. OBSERVABILITY

Add optional telemetry/debug information locally.

Do not send data remotely by default.

Track:

- search mechanism used;
- files searched;
- source lines returned;
- snapshot creation;
- edit ranges;
- lines added/deleted;
- stale conflicts;
- recovery events;
- retries;
- diagnostics;
- tool durations;
- bytes supplied to model;
- edit payload bytes;
- full writes prevented;
- apply_patch fallbacks.

Normal user mode should remain concise.

---

# 43. USER-FACING TASK SUMMARY

At the end of a task, optionally show a compact Patchline summary.

Example:

Patchline  
Files changed: 2  
Diff: +7 / -3  
Context read: 96 lines  
Full rewrites: 0  
Stale conflicts: 0  
Diagnostics: clean  
Validation: 3 tests passed

Make this optional/configurable.

Do not flood normal OpenCode UI.

---

# 44. CONFIGURATION

Provide good defaults.

Example conceptual config:

{  
"mode": "precision",  
"hashline": true,  
"lsp": "auto",  
"ast": true,  
"diagnostics": true,  
"protectExistingWrites": true,  
"protectGeneratedFiles": true,  
"applyPatchFallback": true,  
"maxInitialReadLines": 120,  
"maxSearchResults": 30,  
"telemetry": false,  
"summary": true  
}

Actual configuration format must follow CURRENT OpenCode plugin capabilities.

Do not force this exact schema if a cleaner integration exists.

---

# 45. INSTALLATION EXPERIENCE

Aim for a very simple install.

Example goal:

`npm install opencode-patchline`

Then configure OpenCode plugin:

`opencode-patchline`

Or provide:

`opencode-patchline install`

The installer may:

- detect OpenCode;
- detect version;
- install dependencies;
- register plugin;
- configure permissions;
- check LSP availability;
- validate Patchline.

Do not make installation destructive.

Back up or minimally modify user config when necessary.

---

# 46. DOCTOR COMMAND

Provide optional:

`opencode-patchline doctor`

Example:

Patchline Doctor

OpenCode ✓  
Plugin API ✓  
Hashline ✓  
Snapshot Store ✓  
Anchored Edit ✓  
Existing Write Guard ✓  
AST Search ✓  
LSP ✓ TypeScript  
Diagnostics ✓  
CRLF preservation ✓

Mode: PRECISION

This will simplify support and debugging.

---

# 47. BENCHMARK SYSTEM

Build benchmarks instead of claiming improvement subjectively.

Compare:

A. stock OpenCode editing

B. OpenCode normal edit/apply_patch

C. OpenCode + Patchline

Optionally:

D. Oh My Pi / OMP

when available and reasonably comparable.

Use same:

- repository;
- initial Git state;
- task;
- model;
- temperature/reasoning settings where configurable;
- provider;
- context.

Reset repository before each benchmark.

---

# 48. BENCHMARK TASKS

Include realistic tasks.

## TASK 1

Change one boolean condition in a 1500-line source file.

## TASK 2

Modify a function signature and update exactly two callers.

## TASK 3

Add validation to one HTTP handler.

## TASK 4

Fix one TypeScript type error.

## TASK 5

Find and modify an implementation based on interface usage.

## TASK 6

Change behavior in one React component.

## TASK 7

Modify behavior spanning three files.

## TASK 8

Find structural anti-pattern using AST.

## TASK 9

Simulate external file modification after model read.

## TASK 10

Perform three sequential edits to the same file.

## TASK 11

Large monorepo symbol lookup.

## TASK 12

Modify a function while preserving CRLF.

## TASK 13

Unicode source/path test.

## TASK 14

Multi-file stale patch test.

---

# 49. BENCHMARK PRECISION METRICS

Track:

`intended_changed_lines`

`actual_changed_lines`

`unrelated_changed_lines`

`files_touched`

`unnecessary_files_touched`

`formatting_only_changes`

`whole_file_rewrites`

`stale_overwrites`

`edit_retries`

Calculate a useful metric such as:

precision =  
intended relevant changed lines  
/  
all changed lines

But do not oversimplify correctness into one number.

Report raw data too.

---

# 50. BENCHMARK TOKEN METRICS

Track when available:

- input tokens;
- cached input tokens;
- output tokens;
- reasoning tokens if provider exposes them;
- total tokens.

Additionally always track:

- source characters returned;
- source lines returned;
- tool-result bytes;
- edit argument bytes.

This provides a provider-independent comparison.

---

# 51. REQUIRED AUTOMATED TESTS

Implement comprehensive tests.

## SNAPSHOT TESTS

- create snapshot;
- retrieve snapshot;
- session isolation;
- workspace isolation;
- worktree isolation;
- expiration/cleanup.

## READ TESTS

- partial read;
- line anchors;
- UTF-8;
- Unicode;
- CRLF;
- LF;
- BOM;
- large file.

## EDIT TESTS

- single-line replacement;
- block replacement;
- insertion;
- deletion;
- multi-block edit;
- sequential edits;
- multi-file edit.

## STALE TESTS

- unchanged source;
- change before target;
- change after target;
- change inside target;
- target deletion;
- file deletion;
- file rename;
- concurrent edit.

## WRITE GUARD

- new file allowed;
- existing source rejected;
- generated exception handling;
- explicit permitted replacement.

## AST

- TS;
- JS;
- Python/Rust/etc where supported by selected parser.

## LSP

Mock where needed and integration-test at least one real language server.

## PRESERVATION

Verify unchanged code stays unchanged.

Verify line endings do not change.

---

# 52. CRITICAL STALE TEST

Explicitly test:

1. Model reads:

```
const timeout = 5000

```

2. Snapshot captured.
3. External process changes it to:

```
const timeout = getTimeout()

```

4. Model submits stale patch expecting:

```
const timeout = 5000

```

5. Patchline must NOT overwrite:

```
getTimeout()

```

with model's stale assumption.

Expected:

REJECT  
→ reread required.

This behavior is mandatory.

---

# 53. DIFF PRESERVATION TEST

Given a 3000-line file and task:

"Change timeout from 5000 to 10000."

Expected Git diff:

```
- const timeout = 5000
+ const timeout = 10000

```

No other changed line.

This should be a canonical benchmark.

---

# 54. PERFORMANCE ENGINEERING

Optimize deterministic tooling.

Prefer:

- persistent LSP connections;
- native/programmatic AST bindings;
- efficient file hashing;
- incremental caching;
- narrow reads;
- batched preflight.

Avoid:

- spawning unnecessary processes;
- parsing huge command output;
- rereading entire files;
- rebuilding entire AST repeatedly when safe cache exists.

But never trade stale-safety for microseconds.

---

# 55. HASHING PERFORMANCE

If files are large, evaluate efficient hashing strategies.

However:

Snapshot correctness must reflect actual observed file state.

Do not use timestamps alone as proof of unchanged content.

mtime may be used as optimization hint, not sole correctness guarantee when applying potentially stale edits.

---

# 56. LARGE FILE STRATEGY

For very large files:

Do not automatically return entire content.

Use:

symbol location  
→ narrow range  
→ expand on demand.

Allow adaptive reading around:

- function boundaries;
- class boundaries;
- AST node boundaries.

An AST-aware read range may be more useful than arbitrary ±50 lines.

---

# 57. IMPORT MODIFICATIONS

Imports commonly cause unnecessary churn.

When adding/removing an import:

modify only the minimum import statement/range.

Do not reorder all imports unless required by formatter/project policy.

If a formatter automatically reorders imports, determine whether running it is justified.

Avoid unrelated formatting changes.

---

# 58. FORMATTERS

Do NOT automatically run project-wide formatting.

If formatting is necessary:

prefer changed-file or changed-range formatting where supported.

Before/after diff should be inspected for unrelated churn.

If formatter creates excessive unrelated diff:

do not automatically accept it.

---

# 59. GIT AWARENESS

Use Git as a safety/measurement mechanism where available.

Potential uses:

- inspect current diff;
- determine files already modified by user;
- measure Patchline changes;
- avoid overwriting user edits;
- benchmark reset.

Do NOT automatically reset, checkout, stash, or discard user changes.

Never destroy uncommitted changes.

---

# 60. USER CHANGES HAVE PRIORITY

If a file contains existing user modifications:

preserve them.

Patchline must not assume the Git HEAD version is the desired source.

The current working tree is authoritative.

Snapshots must represent current observed working-tree content.

---

# 61. ERROR MESSAGES

Make errors actionable and concise.

Bad:

`Error 0x3921 patch failure`

Good:

`Edit rejected: src/auth.ts changed since snapshot A74F. Re-read the affected range before retrying.`

Bad:

`Write denied`

Better:

`Existing source file cannot be rewritten. Use Patchline edit.`

---

# 62. DO NOT OVER-PROMPT THE MODEL

The strength of Patchline must come primarily from tooling.

Do not attempt to solve all behavior with a huge system prompt.

Reasons:

- consumes tokens;
- models forget;
- models may ignore it;
- behavior varies across providers.

Use hard enforcement for:

- write protection;
- snapshot validation;
- path safety.

Use model instructions only for strategy/preferences.

---

# 63. OMP INSPIRATION

Study CURRENT Oh My Pi behavior where useful.

Focus specifically on:

- Hashline;
- anchored reads;
- anchored writes;
- snapshot logic;
- stale protection;
- context economy;
- search tools;
- LSP integration;
- diagnostics;
- edit ergonomics.

Do not blindly duplicate source.

Respect licensing.

Prefer documented/public library interfaces.

Goal:

reproduce useful behavior,  
not copy implementation unnecessarily.

---

# 64. PATCHLINE SHOULD IMPROVE ON OMP WHERE POSSIBLE

Do not treat OMP behavior as an untouchable ceiling.

OpenCode has its own strengths.

Patchline should leverage them.

Potential improvements:

- automatic search routing;
- OpenCode provider ecosystem;
- cleaner plugin installation;
- per-session telemetry;
- smarter targeted validation;
- better model-neutral tool schemas;
- configurable write guard;
- benchmarkable precision metrics;
- native OpenCode permissions;
- OpenCode agents/skills compatibility.

Goal:

OMP-like edit quality  
+  
OpenCode strengths  
+  
lower unnecessary context.

---

# 65. MODEL-FACING EXPERIENCE

Ideally models interact with familiar tools:

`read`

`edit`

`grep`

`lsp`

`ast_search`

rather than remembering an exotic tool protocol.

Patchline should augment the semantics of those tools.

Example:

MODEL:

`read src/auth.ts around refreshToken`

PATCHLINE:

- reads targeted range;
- creates snapshot;
- returns anchors.

MODEL:

`edit src/auth.ts snapshot=A74F ...`

PATCHLINE:

- validates snapshot;
- patches exact target;
- returns diagnostics.

---

# 66. EXAMPLE IDEAL SESSION

User:

"Trim the registration email before validation. Do not alter anything else."

Agent:

`lsp.workspaceSymbol(registerUser)`

Result:

`src/users/register.ts:74`

Agent:

`read src/users/register.ts:65-105`

Patchline internally creates:

snapshot `F31C`

Agent sees anchored relevant code.

Agent:

`edit`

Change:

```
- const email = input.email
+ const email = input.email.trim()

```

Patchline:

- snapshot matches;
- edit applies;
- only one line changed.

Diagnostics:

0 new errors.

Relevant test:

8 passed.

Final UI:

Patchline  
Files: 1  
Diff: +1 / -1  
Context: 41 lines  
Full rewrites: 0  
Diagnostics: clean

This is the desired normal experience.

---

# 67. EXAMPLE STALE SESSION

Agent reads:

snapshot `A100`

User manually changes file in editor.

Agent submits edit using `A100`.

Patchline:

`STALE SNAPSHOT`

No write occurs.

Agent reads current 20-line region.

Snapshot:

`B202`

Agent reevaluates patch.

New edit applies.

User modification remains preserved.

---

# 68. PACKAGE STRUCTURE

A reasonable architecture may resemble:

```
opencode-patchline/
├── package.json
├── README.md
├── src/
│   ├── index.ts
│   ├── plugin.ts
│   │
│   ├── tools/
│   │   ├── read.ts
│   │   ├── edit.ts
│   │   ├── write.ts
│   │   ├── grep.ts
│   │   ├── ast-search.ts
│   │   └── diagnostics.ts
│   │
│   ├── snapshot/
│   │   ├── store.ts
│   │   ├── session.ts
│   │   └── hashline.ts
│   │
│   ├── search/
│   │   ├── router.ts
│   │   ├── lsp.ts
│   │   ├── grep.ts
│   │   └── ast.ts
│   │
│   ├── editing/
│   │   ├── patcher.ts
│   │   ├── preflight.ts
│   │   └── fallback.ts
│   │
│   ├── validation/
│   │   ├── diagnostics.ts
│   │   └── targeted.ts
│   │
│   ├── guards/
│   │   ├── write-guard.ts
│   │   ├── generated.ts
│   │   └── paths.ts
│   │
│   ├── telemetry/
│   │   └── metrics.ts
│   │
│   └── config.ts
│
├── tests/
│
└── benchmark/

```

This is guidance.

Adapt to repository conventions and current OpenCode plugin architecture.

Do not create needless abstraction layers.

---

# 69. DEPENDENCIES

Prefer minimal dependencies.

Likely categories:

- OpenCode plugin SDK/API;
- `@oh-my-pi/hashline`;
- `@ast-grep/napi`;
- existing Node/Bun APIs;
- optional lightweight LSP client only if native OpenCode LSP is insufficient.

Do not add large frameworks for trivial utilities.

---

# 70. README

Document:

## What is Patchline?

A precision editing engine for OpenCode.

## Why?

Traditional agent edits can:

- read excessive context;
- repeat old code;
- rewrite full files;
- apply stale patches;
- change unrelated formatting.

Patchline uses:

- semantic search;
- structural search;
- anchored reads;
- snapshot-aware patches;
- stale protection;
- diagnostics.

## Installation

Provide exact current installation steps.

## Configuration

Minimal config.

## Architecture

Simple diagram.

## Troubleshooting

Common cases:

- LSP missing;
- unsupported language;
- stale snapshot;
- edit fallback;
- Windows issues.

---

# 71. BRAND / PRESENTATION

Project name:

**Patchline**

Technical package:

**opencode-patchline**

Tagline:

**Precision code editing for OpenCode.**

Short description:

**Patchline gives OpenCode snapshot-anchored, minimal-diff code editing with semantic search, structural navigation, stale-edit protection, and targeted diagnostics.**

README hero concept:

```
Patchline
Precision code editing for OpenCode.

Find less.
Read less.
Change less.
Break less.

```

Do not over-brand the implementation.

Quality matters more than marketing.

---

# 72. IMPLEMENTATION PRIORITIES

## P0 — MUST WORK FIRST

- current OpenCode compatibility detection;
- SnapshotStore;
- snapshot-aware read;
- anchored edit;
- stale-state rejection;
- existing-file write protection;
- preservation tests;
- minimal diff correctness.

## P1

- grep integration;
- LSP integration;
- diagnostics;
- session/worktree isolation;
- targeted validation.

## P2

- AST search;
- performance;
- caching;
- benchmark system;
- telemetry.

## P3

- installer;
- doctor command;
- UI polish;
- optional summary metrics.

Do not build the benchmark dashboard before edit safety works.

---

# 73. DEVELOPMENT PROCESS

Do not merely produce an architectural proposal.

IMPLEMENT IT.

Workflow:

1. inspect repository;
2. inspect current OpenCode APIs;
3. inspect current Hashline API;
4. define minimal architecture;
5. implement P0;
6. test P0;
7. fix failures;
8. implement P1;
9. benchmark;
10. optimize;
11. document.

At every stage:

- run tests;
- inspect Git diff;
- avoid unrelated refactors.

---

# 74. DO NOT ASK FOR ORDINARY CONFIRMATION

Make reasonable engineering decisions autonomously.

Do not stop to ask:

"Should I create file X?"

"Should I use TypeScript?"

"Should I add tests?"

Infer from repository conventions.

Ask only when there is an unavoidable decision requiring external information that cannot be determined from the codebase.

---

# 75. QUALITY PRIORITY ORDER

When goals conflict, prioritize:

1. user code preservation;
2. correctness;
3. no stale overwrites;
4. minimal relevant diff;
5. correct semantic understanding;
6. token efficiency;
7. speed;
8. implementation elegance;
9. convenience.

However:

Do not add enormous amounts of verification that materially reduce speed for negligible safety benefit.

Aim for the Pareto frontier:

maximum safety with minimal overhead.

---

# 76. TARGET PERFORMANCE CHARACTERISTICS

For a typical localized modification, target approximately:

one discovery path

- 

one narrow read

- 

one anchored edit

- 

one diagnostic check

- 

zero whole-file rewrites

- 

zero unnecessary broad tests

The architecture should actively try to minimize repeated:

read  
→ failed edit  
→ read  
→ edit  
→ read

loops.

---

# 77. FINAL ACCEPTANCE CRITERIA

Patchline is successful when a user can run ordinary OpenCode and say:

"Fix this bug."

And OpenCode + Patchline reliably does:

find exact implementation  
↓  
read minimal relevant context  
↓  
capture snapshot  
↓  
understand dependencies  
↓  
modify exact required lines  
↓  
preserve everything else  
↓  
detect stale conflicts  
↓  
run diagnostics  
↓  
validate affected behavior  
↓  
finish

WITHOUT:

- rewriting entire existing source files;
- repeating hundreds of unchanged lines;
- touching unrelated files;
- applying stale edits;
- unnecessary formatting churn;
- unnecessarily reading the repository;
- running oversized validation;
- wasting model tokens.

---

# 78. FINAL PRODUCT GOAL

The finished system should feel like:

**OpenCode with a precision editing engine.**

Not:

"OpenCode with another optional patch command."

Patchline must change the DEFAULT editing behavior of the agent for existing code.

Desired combination:

OpenCode  
+  
OMP-inspired anchored editing  
+  
Hashline  
+  
LSP semantic navigation  
+  
AST structural search  
+  
minimal context  
+  
stale-state safety  
+  
targeted diagnostics  
+  
hard write protection  
+  
measured token efficiency

=

**Patchline**

**Precision code editing for OpenCode.**

Proceed with implementation now.

First inspect the actual current repository, OpenCode integration points, current plugin APIs, and the current `@oh-my-pi/hashline` API.

Then implement the strongest reliable version supported by the environment.

Do not stop at planning.