# Third-party software

Generated from `package-lock.json` by `node tools/third-party.mjs`; do not edit by hand.

WriteMind's own code is BSD 3-Clause ([LICENSE](../LICENSE)). The app also ships the packages below, all
under permissive licences, and Electron's runtime (Chromium and Node.js), whose notices are in
`LICENSES.chromium.html` inside every installed copy. The README says what each main package is used for.

## Shipped inside the app (50)

Packages marked *optional* are platform-specific builds; only the one for the machine is installed.

| Package | Version | Licence |
| --- | --- | --- |
| @codemirror/commands | 6.11.1 | MIT |
| @codemirror/language | 6.12.4 | MIT |
| @codemirror/state | 6.7.5 | MIT |
| @codemirror/view | 6.43.12 | MIT |
| @koromix/koffi-android-arm64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-android-x64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-darwin-arm64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-darwin-x64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-freebsd-arm64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-freebsd-ia32 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-freebsd-x64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-linux-arm *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-linux-arm64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-linux-ia32 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-linux-loong64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-linux-ppc64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-linux-riscv64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-linux-x64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-openbsd-arm64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-openbsd-ia32 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-openbsd-x64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-win32-arm64 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-win32-ia32 *(optional)* | 3.3.2 | MIT |
| @koromix/koffi-win32-x64 *(optional)* | 3.3.2 | MIT |
| @lezer/common | 1.5.2 | MIT |
| @lezer/highlight | 1.2.3 | MIT |
| @lezer/lr | 1.4.10 | MIT |
| @marijn/find-cluster-break | 1.0.4 | MIT |
| argparse | 2.0.1 | Python-2.0 |
| builder-util-runtime | 9.7.0 | MIT |
| crelt | 1.0.7 | MIT |
| debug | 4.4.3 | MIT |
| electron-updater | 6.8.9 | MIT |
| fs-extra | 10.1.0 | MIT |
| graceful-fs | 4.2.11 | ISC |
| js-yaml | 4.3.2 | MIT |
| jsonfile | 6.2.1 | MIT |
| koffi | 3.3.2 | MIT |
| lazy-val | 1.0.5 | MIT |
| lodash.escaperegexp | 4.1.2 | MIT |
| lodash.isequal | 4.5.0 | MIT |
| ms | 2.1.3 | MIT |
| react | 19.3.0 | MIT |
| react-dom | 19.3.0 | MIT |
| sax | 1.6.1 | BlueOak-1.0.0 |
| scheduler | 0.28.0 | MIT |
| style-mod | 4.1.4 | MIT |
| tiny-typed-emitter | 2.1.0 | MIT |
| universalify | 2.0.1 | MIT |
| w3c-keyname | 2.2.8 | MIT |

## Build and test tools only, never shipped (401)

These include Electron's npm package (its runtime is listed above), electron-builder, TypeScript, Vite,
esbuild and Vitest, and everything they depend on.

| Licence | Packages |
| --- | --- |
| MIT | 326 |
| ISC | 37 |
| BSD-3-Clause | 10 |
| Apache-2.0 | 9 |
| BlueOak-1.0.0 | 7 |
| BSD-2-Clause | 6 |
| CC-BY-4.0 | 1 |
| WTFPL OR ISC | 1 |
| WTFPL | 1 |
| 0BSD | 1 |
| (MIT OR CC0-1.0) | 1 |
| (WTFPL OR MIT) | 1 |
