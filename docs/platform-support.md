# Platform support

coco is currently a **macOS/Linux-first local CLI + MCP tool**.

## Supported path

The supported daily path is:

- macOS, especially Codex.app.
- Linux CI and Linux developer shells.
- Node.js 20 or newer.
- Git available on `PATH`.
- POSIX shell available as `/bin/sh` for coco-owned verify runs.
- `ps` available for local lock-holder identity checks.

GitHub Actions runs the verification gate on Ubuntu and macOS.

## Best-effort / not yet guaranteed

Windows native shells are not yet a guaranteed target. Several implementation details are intentionally POSIX-oriented today:

- `verifyStart` runs the configured command through `/bin/sh` and uses process-group termination for timeouts.
- `lock.ts` uses `ps` to distinguish a live lock holder from a stale PID.
- Hook installation paths are tailored to Codex/Claude local config layouts.
- Path/secret checks normalize common separators but have not been validated as a full Windows support contract.

Windows users should run coco through WSL until a Windows adapter is implemented and tested.

## Portability roadmap

To support Windows natively, add adapters before changing behavior in place:

1. `ProcessRunner` for shell/process-group differences.
2. `LockIdentity` for platform-specific PID/start-time checks.
3. `PathPolicy` tests for Windows drive letters, UNC paths, and case folding.
4. CI on `windows-latest`.
5. A documented verify timeout strategy that can terminate process trees reliably.

## Review checklist

For platform-sensitive changes, confirm:

- No new hard dependency on a shell/tool without doctor coverage.
- New paths use repo-relative or realpath-normalized checks at trust boundaries.
- CI covers the intended platform before the README claims support.
