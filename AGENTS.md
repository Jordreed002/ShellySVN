# Agent Directions

## Performance and process separation

- Keep frontend and backend work asynchronous and independently responsive. The Electron renderer must never perform backend, filesystem, network, or SVN work directly; send it through the preload IPC boundary.
- Never block the renderer or Electron main event loop with synchronous process or filesystem APIs on an interactive code path. In particular, do not use `spawnSync`, `execSync`, `readFileSync`, `statSync`, or similar synchronous APIs while opening dialogs, handling IPC, or running SVN operations. Use asynchronous APIs and await them instead.
- Run expensive CPU-bound work in a worker thread or separate process. Promises only make I/O non-blocking; they do not move CPU work off the current thread.
- Open UI immediately and show loading/progress state while backend work continues. Do not make rendering a modal or responding to input depend on diagnostics or repository probes finishing.
- Keep independent backend probes concurrent with `Promise.all` or `Promise.allSettled` when ordering is not required, and preserve cancellation and timeouts for long-running work.
- Treat responsiveness as a regression requirement: changes to diagnostics, repository scans, or modal-opening flows must include coverage that prevents synchronous child-process work from returning to the event-loop path.
