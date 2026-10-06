; WriteMind's own additions to electron-builder's assisted NSIS installer (electron-builder picks this file up from
; the build resources folder, packaging/, by its name).
;
; ONE EXTRA PAGE, after the folder page: three tick boxes for the tools Python and Wolfram cells run with.
;   [ ] Install Python (for Python cells)                 winget Python.Python.3.14, per-user, the py launcher too
;                                                         (no administrator: installer-tools.ps1 $PythonSwitches)
;   [ ] Install Wolfram Engine (for Wolfram cells; ...)   winget WolframResearch.WolframEngine; ticking it accepts
;                                                         Wolfram's licence (the page links to it)
;   [ ] Activate the Wolfram Engine after install         a PowerShell window running  & "...\wolframscript.exe" -activate
;                                                         where the person signs in with THEIR OWN Wolfram ID
; What is already on the computer is shown as "already installed" / "already activated" and cannot be ticked
; (packaging/installer-tools.ps1 -Detect looks where WriteMind's own lookup looks, eval/tools.ts).
;
; WHEN. The ticked tools are installed AFTER WriteMind's files are in place (customInstall), in a visible console of
; their own that shows winget's progress. A missing winget or a failed install never fails WriteMind's install: the
; console says so, the installer says so at the end (with the docs link) and the log is $INSTDIR\tools-setup.log.
;
; SILENT installs (/S, which the updater uses, with --updated) skip the page and install NOTHING extra. A scripted
; install may ask for them explicitly:  /WM-PYTHON /WM-WOLFRAM /WM-ACTIVATE, and /WM-DRYRUN says what it would run
; (in the log) and runs nothing. /D=<folder> must stay the LAST argument, as NSIS wants.
;
; FOR THIS WINDOWS USER ONLY (Sean, 2026-10-05): no "for all users" choice and no administrator prompt. The assisted
; installer's install-mode page asks "only for me / anyone"; this answers "only for me" before it shows (installer and
; uninstaller both), so it never does.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; THE LICENCE PAGE (electron-builder.yml nsis.license: the repo's LICENSE) is the first page. With this it asks for a
; tick in "I accept the terms of the License Agreement" (Next stays greyed until then) instead of an "I Agree" button.
; Defined here, before electron-builder's script includes MUI2 and inserts the page; MUI forgets it after that page.
!define MUI_LICENSEPAGE_CHECKBOX

; NOTHING LEFT BEHIND but the person's own data. electron-builder's installer keeps a copy of itself in
; %LOCALAPPDATA%\<name>-updater\installer.exe (the updater's base for differential downloads, ~100 MB), and the
; updater downloads into the same folder; its uninstaller leaves both. An uninstall that is not part of an update
; takes the folder away. (The notes and %APPDATA%\@writemind\desktop stay: nsis.deleteAppDataOnUninstall is false.)
!macro customUnInstall
  !ifdef APP_INSTALLER_STORE_FILE
    ${ifNot} ${isUpdated}
      Push $R0
      ${GetParent} "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}" $R0
      ${if} $R0 != ""
      ${andIf} $R0 != "$LOCALAPPDATA"
        RMDir /r "$R0"
      ${endIf}
      Pop $R0
    ${endIf}
  !endif
!macroend

; Everything below is installer-only: electron-builder compiles this file a second time for the uninstaller
; (BUILD_UNINSTALLER), where none of it may appear (unused functions and variables are errors, -WX).

!ifndef BUILD_UNINSTALLER

!include nsDialogs.nsh
!include LogicLib.nsh
!include x64.nsh
!include FileFunc.nsh

!define WM_DOCS "https://github.com/chere005/WriteMind/blob/main/docs/INSTALL-WINDOWS.md#optional-tools-python-and-wolfram"
!define WM_WOLFRAM_TERMS "https://www.wolfram.com/legal/terms/wolfram-engine.html"

Var wmPowerShell
Var wmDetected
Var wmFoundPython
Var wmFoundWolfram
Var wmActivated
Var wmWantPython
Var wmWantWolfram
Var wmWantActivate
Var wmDryRun
Var wmUpdated
Var wmBoxPython
Var wmBoxWolfram
Var wmBoxActivate

!macro customInit
  StrCpy $wmDetected "0"
  StrCpy $wmWantPython "0"
  StrCpy $wmWantWolfram "0"
  StrCpy $wmWantActivate "0"
  StrCpy $wmDryRun "0"
  StrCpy $wmUpdated "0"
  Push $R0
  Push $R1
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/WM-PYTHON" $R1
  ${IfNot} ${Errors}
    StrCpy $wmWantPython "1"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/WM-WOLFRAM" $R1
  ${IfNot} ${Errors}
    StrCpy $wmWantWolfram "1"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/WM-ACTIVATE" $R1
  ${IfNot} ${Errors}
    StrCpy $wmWantActivate "1"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/WM-DRYRUN" $R1
  ${IfNot} ${Errors}
    StrCpy $wmDryRun "1"
  ${EndIf}
  ; The updater runs the new installer with /S --updated. (${isUpdated} is StdUtils', whose plugin folder is not
  ; declared yet where this file is included.)
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    StrCpy $wmUpdated "1"
  ${EndIf}
  ClearErrors
  Pop $R1
  Pop $R0
!macroend

; The 64-bit PowerShell when there is one: the installer is a 32-bit program, and a 32-bit PowerShell sees
; "Program Files (x86)" as Program Files.
Function wmFindPowerShell
  StrCpy $wmPowerShell "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${RunningX64}
  ${AndIf} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy $wmPowerShell "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
FunctionEnd

; What is already here, once: the helper writes an INI the page reads.
; It runs from the page's create callback, so a detection that never ends would freeze Next for good: it starts other
; programs (py -3 --version, the Store's python.exe alias), and nsExec gives the script a stdin pipe nobody closes.
; The helper gives each of those ten seconds and a closed stdin (Works); this is the backstop. nsExec's /TIMEOUT
; counts from the last output, and -Detect prints only at its end, so it is the whole run: after 60 s PowerShell is
; stopped, Pop gives "timeout", no INI is there to read, and the page offers every box (the install step looks
; again, probe by probe, before it installs anything).
Function wmDetect
  ${If} $wmDetected == "1"
    Return
  ${EndIf}
  StrCpy $wmDetected "1"
  Push $0
  Call wmFindPowerShell
  InitPluginsDir
  File "/oname=$PLUGINSDIR\wm-tools.ps1" "${BUILD_RESOURCES_DIR}\installer-tools.ps1"
  nsExec::Exec /TIMEOUT=60000 '"$wmPowerShell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\wm-tools.ps1" -Detect -Out "$PLUGINSDIR\wm-detect.ini"'
  Pop $0
  ReadINIStr $wmFoundPython "$PLUGINSDIR\wm-detect.ini" tools python
  ReadINIStr $wmFoundWolfram "$PLUGINSDIR\wm-detect.ini" tools wolfram
  ReadINIStr $wmActivated "$PLUGINSDIR\wm-detect.ini" tools activated
  ClearErrors
  Pop $0
FunctionEnd

!macro customPageAfterChangeDir
  Page custom wmToolsPageCreate wmToolsPageLeave

  Function wmToolsPageCreate
    ${If} $wmUpdated == "1"
      Abort
    ${EndIf}
    Call wmDetect
    !insertmacro MUI_HEADER_TEXT "Tools for runnable cells (optional)" "Python and Wolfram cells run with tools installed on this computer."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 18u "WriteMind is installed first. Then what you tick here is installed with winget, in a window of its own that shows the progress. Leave it all unticked to skip: you can add these later."
    Pop $0

    ; Python
    ${NSD_CreateCheckbox} 0 22u 100% 10u "Install &Python (for Python cells)"
    Pop $wmBoxPython
    ${NSD_CreateLabel} 12u 33u -12u 10u ""
    Pop $1
    ${If} $wmFoundPython != ""
      ${NSD_SetText} $wmBoxPython "Install &Python (for Python cells) - already installed"
      EnableWindow $wmBoxPython 0
      ${NSD_SetText} $1 "Found: $wmFoundPython"
    ${Else}
      ${NSD_SetText} $1 "Python 3.14 from python.org, for this Windows user only (no administrator needed)."
      ${If} $wmWantPython == "1"
        ${NSD_Check} $wmBoxPython
      ${EndIf}
    ${EndIf}

    ; Wolfram Engine
    ${NSD_CreateCheckbox} 0 48u 100% 10u "Install &Wolfram Engine (for Wolfram cells; free for developers, about 3 GB download)"
    Pop $wmBoxWolfram
    ${NSD_CreateLabel} 12u 59u 128u 10u "Ticking it accepts Wolfram's licence:"
    Pop $0
    ${NSD_CreateLink} 142u 59u -142u 10u "wolfram.com/legal/terms/wolfram-engine.html"
    Pop $0
    ${NSD_OnClick} $0 wmOpenTerms
    ${NSD_CreateLabel} 12u 70u -12u 10u ""
    Pop $1
    ${If} $wmFoundWolfram != ""
      ${NSD_SetText} $wmBoxWolfram "Install &Wolfram Engine (for Wolfram cells) - already installed"
      EnableWindow $wmBoxWolfram 0
      ${NSD_SetText} $1 "Found: $wmFoundWolfram"
    ${Else}
      ${NSD_SetText} $1 "Windows asks to allow it: the engine goes in Program Files for everyone on this computer."
      ${If} $wmWantWolfram == "1"
        ${NSD_Check} $wmBoxWolfram
      ${EndIf}
    ${EndIf}
    ${NSD_OnClick} $wmBoxWolfram wmWolframClicked

    ; Activation
    ${NSD_CreateCheckbox} 0 86u 100% 10u "&Activate the Wolfram Engine after install"
    Pop $wmBoxActivate
    ${NSD_CreateLabel} 12u 97u -12u 18u "Opens a PowerShell window running wolframscript -activate, where you sign in with your own Wolfram ID (a free account at wolfram.com). The installer never sees it."
    Pop $0
    ${If} $wmWantActivate == "1"
      ${NSD_Check} $wmBoxActivate
    ${EndIf}

    ${NSD_CreateLabel} 0 122u 100% 18u "Needs winget (App Installer, part of Windows 10 and 11). If an install fails, WriteMind is still installed, and the installer says what to do."
    Pop $0

    Call wmSyncActivate
    nsDialogs::Show
  FunctionEnd

  ; Activation needs an engine: one that is here, or one about to be installed; and not one already activated.
  Function wmSyncActivate
    Push $0
    ${If} $wmActivated == "1"
    ${AndIf} $wmFoundWolfram != ""
      ${NSD_Uncheck} $wmBoxActivate
      EnableWindow $wmBoxActivate 0
      ${NSD_SetText} $wmBoxActivate "&Activate the Wolfram Engine after install - already activated"
    ${ElseIf} $wmFoundWolfram != ""
      EnableWindow $wmBoxActivate 1
    ${Else}
      ${NSD_GetState} $wmBoxWolfram $0
      ${If} $0 == ${BST_CHECKED}
        EnableWindow $wmBoxActivate 1
      ${Else}
        ${NSD_Uncheck} $wmBoxActivate
        EnableWindow $wmBoxActivate 0
      ${EndIf}
    ${EndIf}
    Pop $0
  FunctionEnd

  ; Ticking the engine ticks its activation too (an engine that is not activated runs nothing); both can be unticked.
  Function wmWolframClicked
    Pop $0
    ${NSD_GetState} $wmBoxWolfram $0
    ${If} $0 == ${BST_CHECKED}
      ${NSD_Check} $wmBoxActivate
    ${EndIf}
    Call wmSyncActivate
  FunctionEnd

  Function wmOpenTerms
    Pop $0
    ExecShell "open" "${WM_WOLFRAM_TERMS}"
  FunctionEnd

  Function wmToolsPageLeave
    StrCpy $wmWantPython "0"
    StrCpy $wmWantWolfram "0"
    StrCpy $wmWantActivate "0"
    ${NSD_GetState} $wmBoxPython $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $wmWantPython "1"
    ${EndIf}
    ${NSD_GetState} $wmBoxWolfram $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $wmWantWolfram "1"
    ${EndIf}
    ${NSD_GetState} $wmBoxActivate $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $wmWantActivate "1"
    ${EndIf}
  FunctionEnd
!macroend

; After WriteMind's files, shortcuts and registry entries are in place.
Function wmRunTools
  ${If} $wmUpdated == "1"
    Return
  ${EndIf}
  ${If} $wmWantPython$wmWantWolfram$wmWantActivate == "000"
    Return
  ${EndIf}
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Call wmDetect
  StrCpy $1 ""
  ${If} $wmWantPython == "1"
    StrCpy $1 "$1 -Python"
  ${EndIf}
  ${If} $wmWantWolfram == "1"
    StrCpy $1 "$1 -Wolfram"
  ${EndIf}
  ${If} $wmWantActivate == "1"
    StrCpy $1 "$1 -Activate"
  ${EndIf}
  ${If} $wmDryRun == "1"
    StrCpy $1 "$1 -DryRun"
  ${EndIf}
  ${If} $wmDryRun == "1"
  ${OrIf} ${Silent}
    StrCpy $1 "$1 -NoWait"
  ${EndIf}
  SetDetailsPrint both
  DetailPrint "Installing the optional tools in a window of their own:$1"
  ClearErrors
  ExecWait '"$wmPowerShell" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\wm-tools.ps1"$1 -Log "$INSTDIR\tools-setup.log" -Result "$PLUGINSDIR\wm-result.ini"' $0
  ${If} ${Errors}
    StrCpy $0 "PowerShell did not start"
  ${EndIf}
  ; Each value is one short status ("installed", "failed: <why> (<code>)"), never winget's own output: the helper
  ; keeps that in its console.
  ClearErrors
  ReadINIStr $2 "$PLUGINSDIR\wm-result.ini" result python
  ReadINIStr $3 "$PLUGINSDIR\wm-result.ini" result wolfram
  ReadINIStr $4 "$PLUGINSDIR\wm-result.ini" result activate
  ${If} ${Errors}
    ; NO RESULT: the helper writes every key, so a missing one means it stopped before its last step - its console
    ; closed with the X, a Group Policy execution policy that -ExecutionPolicy Bypass does not override, Constrained
    ; Language Mode refusing its .NET calls. Blank values ("Python: . Wolfram Engine: .") would say nothing; this says
    ; what is known.
    ClearErrors
    DetailPrint "The optional tools step did not finish (exit $0); see $INSTDIR\tools-setup.log"
    MessageBox MB_OK|MB_ICONEXCLAMATION "WriteMind is installed, but the step that installs the tools you ticked did not finish (exit $0), so what it did is not known.$\r$\n$\r$\nWriteMind works without them; a Python or Wolfram cell says what it needs when it runs. How to add them by hand:$\r$\n${WM_DOCS}$\r$\n$\r$\nWhat it got to is in $INSTDIR\tools-setup.log" /SD IDOK
  ${Else}
    DetailPrint "Python: $2. Wolfram Engine: $3. Activation: $4. (exit $0)"
    ${If} $0 != "0"
      MessageBox MB_OK|MB_ICONEXCLAMATION "WriteMind is installed, but not everything you ticked could be done:$\r$\n$\r$\n    Python: $2$\r$\n    Wolfram Engine: $3$\r$\n    Activation: $4$\r$\n$\r$\nWriteMind works without them; a Python or Wolfram cell says what it needs when it runs. How to add them by hand:$\r$\n${WM_DOCS}$\r$\n$\r$\nThe details are in $INSTDIR\tools-setup.log" /SD IDOK
    ${EndIf}
  ${EndIf}
  SetDetailsPrint lastused
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro customInstall
  Call wmRunTools
!macroend

!endif
