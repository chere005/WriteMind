# e2e

The end-to-end harness for the real app. Everything about it is in [`docs/TESTING.md`](../docs/TESTING.md).

```
npm run build && npm run e2e            all suites, isolated offscreen instances, report in e2e/.results/
npm run e2e -- --suite cells --snapshot one suite, against a copy of the build taken now
npm run e2e:list                        what there is
npm run e2e:selftest                    the runner's own test
```

| Path | What |
|---|---|
| `run.mjs` | the runner (instances, timeouts, retries, reports, exit code) |
| `instance.mjs` | start / stop one instance by hand (`--hold` keeps it up) |
| `lib/cdp.mjs` | the CDP client |
| `lib/instance.mjs` | start / stop / snapshot isolated offscreen instances |
| `lib/harness.mjs` | what a script imports: checks, real input, synthetic pen, editor and app helpers |
| `lib/compat.mjs` | the old `agents/cdp.mjs` API on top of the harness (for moving older scripts in) |
| `lib/fixtures.mjs` | the synthetic camera feeds (`.y4m`) |
| `lib/desktop.mjs`, `lib/inject.ps1` | OS-level pen / mouse injection for the desktop suites |
| `suites/<area>/` | the scripts, run in name order; optional `suite.json` |
| `known-issues.json` | checks that fail for a bug tracked elsewhere (shown as KNOWN, not FAIL) |
| `.results/`, `.snapshot/`, `.scratch/` | run output, build copies, throw-away scripts (git-ignored) |
