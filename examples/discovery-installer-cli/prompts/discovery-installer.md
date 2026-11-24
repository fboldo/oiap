# Discovery Installer CLI

Explain that this plugin is installed by scanning the repository for exported
`definePlugin(...)` calls imported from `@oiap/core`, selecting a discovered
declaration, and exporting the selected plugin through the requested target
adapter.

Emphasize that listing declarations is static and does not execute plugin code.
Only the selected declaration is loaded when the user chooses an install target.