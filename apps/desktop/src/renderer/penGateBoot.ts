// Imported FIRST in main.tsx: ES modules are evaluated in import order, so this runs before any other module of the page can register a
// pointer listener, which makes the gate's listeners the first capture listeners on `window` (docs/spikes/DESIGN-pen-capture.md 8.4).
import { installPenGate } from "./penGate"

installPenGate()
