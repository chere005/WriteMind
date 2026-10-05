/**
 * What the Mac sets on its text view (`MarkdownTextView.makeNSView`):
 *
 *     isAutomaticQuoteSubstitutionEnabled      = false   // markdown wants straight quotes
 *     isAutomaticDashSubstitutionEnabled       = false   // "--" stays "--"
 *     isAutomaticTextReplacementEnabled        = false
 *     isAutomaticSpellingCorrectionEnabled     = false   // nothing is corrected behind the writer's back
 *     isContinuousSpellCheckingEnabled         = true    // but misspellings are underlined: it is prose
 *     isGrammarCheckingEnabled                 = false
 *
 * Chromium never substitutes quotes or dashes in a contenteditable, and CodeMirror
 * turns `autocorrect` and `autocapitalize` off already; what it also turns off is the
 * spell check, which the Mac leaves on. So it is switched on here, and put away again
 * where the words are not words: a fenced block and a code span.
 */

import { EditorView } from "@codemirror/view"
import type { Extension } from "@codemirror/state"

export const textConventions: Extension = EditorView.contentAttributes.of({
  spellcheck: "true",
  autocorrect: "off",
  autocapitalize: "off",
})
