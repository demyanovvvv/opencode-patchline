# Generated File Specification

Status: Accepted

Known build output, vendored content, minified bundles, generated clients, and
lockfiles are protected. Patchline recommends the canonical generator or
package manager. Generated detection is conservative and configurable. The
same protection applies to new-file batches: a batch is rejected during
preflight if any requested target is a known generated path, and no file is
created.

The common edit preflight enforces this protection for exact edits, exact batches,
single-file Hashline and whole-patch Hashline, including move destinations.
