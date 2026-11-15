# Changelog

## 0.7.0 — dsh 0.2.2-rc.3 适配

Fork of [lehhair/dsh-split-panes](https://github.com/lehhair/dsh-split-panes) v0.6.5. Core baseline moved from `0.1.5-alpha.2` to `0.2.2-rc.3` (`core-pin.json`).

### Fixed
- **Blank conversation on rc.3.** The vendored slot renderer was the 0.1.5-alpha.2 copy; re-vendored from rc.3 (adds `errors.ts`).
- **Pane host on the rc.3 `SlotRendererHost`.** rc.3 added Factory members bound to the registry's private store and Factory axes (`conversation.content` is a Factory). The pane host is now an overlay over the registry's own host face. Every pane gets a copy of each Factory definition with a wrapped inject, mapped back to the originals by identity.
- **Pane election matches the core's.** It skips entries the core has abdicated (read from the core's own set, so it survives a plugin reload) as well as pane-local abdications.
- **Sessions on the rc.3 controller.** The main session is the one retained by `mainView`. Each pane retains its own `SessionReference` (`source: 'splitPane'`) and releases it on unbind. Opening goes through `uiWorkspace.openSession`.
- **New conversation inside a pane.** Picking a workspace in a pane's hero binds the opened session to that pane, including when ui-workspace reuses a blank session. The capture uses `openWorkspace`'s `beforeOpen`, so cancelled or superseded requests bind nothing.
- **Icons.** Extracted verbatim from rc.3's dockkit / right-side-bar glyphs. The close icon is renamed `IconCloseOutlineRegular`.

### Changed
- `peerDependencies` add `@deepseek-ai/cordis`; dev-only `@deepseek-ai/dsh-client-ui-context-menu` link for harness tests.
- CI: new `check.yml` runs the full gate on every push and pull request.

### Removed
- `root-binding.ts`, `pane-store.ts`, and the pre-rc.3 session-selection path.
