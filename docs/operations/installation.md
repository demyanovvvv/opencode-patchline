# Installation

Install `opencode-patchline`, add it to OpenCode's `plugin` array, and restart
OpenCode. Configuration is loaded at startup and is not hot-reloaded.

Run `opencode-patchline doctor` after installation. The initial release targets
OpenCode 1.18.x.

`opencode-patchline install [--global]` delegates package registration to the
installed `opencode plugin` command so Patchline does not implement a competing
configuration writer.
