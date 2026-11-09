; =============================================================================
; Kekenik Pixel — Custom NSIS Installer & Uninstaller Script (build/installer.nsh)
; Owning Milestone: Agent 7B (B16, B17, B12)
;
; Responsibilities:
;   1. Branding header & sidebar bitmaps (build/installerHeader.bmp, build/installerSidebar.bmp)
;   2. Register `.kpx` file association for current user or machine (`SHCTX`)
;   3. Opt-in `.aseprite` and `.ase` file association (default OFF — never hijacks existing editor)
;   4. Register Windows Explorer "Open with" (`OpenWithProgids` & `Applications\KekenikPixel.exe`)
;   5. Refresh Windows Shell Icon Cache via `SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0)`
;   6. Clean uninstall: remove ONLY keys created by Kekenik Pixel + offer "Keep settings" prompt
; =============================================================================

!ifndef SHCNE_ASSOCCHANGED
  !define SHCNE_ASSOCCHANGED 0x08000000
!endif
!ifndef SHCNF_IDLIST
  !define SHCNF_IDLIST 0x0000
!endif

; -----------------------------------------------------------------------------
; IMPORTANT (build-critical):
; electron-builder compiles this file twice — once for the installer and once for the
; uninstaller (`BUILD_UNINSTALLER`). The uninstaller pass does not insert `customInstall`,
; so any `Var` declared unconditionally here would be flagged as
;   "warning 6001: Variable ... not referenced or never set, wasting memory!"
; and electron-builder treats NSIS warnings as errors (`-WX`), aborting the build with
;   "Error: warning treated as error".
; Declaring installer-only globals behind `!ifndef BUILD_UNINSTALLER` keeps both passes clean.
; -----------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER
  Var REGISTER_ASEPRITE_ASSOC
!endif

!macro customInit
  ; Default opt-in .ase/.aseprite association to OFF ("0") unless /ASEASSOC=1 is passed or checked
  !ifndef BUILD_UNINSTALLER
    StrCpy $REGISTER_ASEPRITE_ASSOC "0"
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/ASEASSOC=" $R1
    IfErrors +2 0
      StrCpy $REGISTER_ASEPRITE_ASSOC $R1
  !endif
!macroend

!macro customInstall
  ; ---------------------------------------------------------------------------
  ; 1. Register `.kpx` (Kekenik Pixel Project) association under SHCTX (HKCU or HKLM)
  ; ---------------------------------------------------------------------------
  WriteRegStr SHCTX "Software\Classes\.kpx" "" "KekenikPixel.kpx"
  WriteRegStr SHCTX "Software\Classes\.kpx" "Content Type" "application/x-kekenik-pixel"
  WriteRegStr SHCTX "Software\Classes\.kpx" "KekenikPixelCreated" "1"
  WriteRegStr SHCTX "Software\Classes\.kpx\OpenWithProgids" "KekenikPixel.kpx" ""

  WriteRegStr SHCTX "Software\Classes\KekenikPixel.kpx" "" "Kekenik Pixel Project"
  WriteRegStr SHCTX "Software\Classes\KekenikPixel.kpx" "KekenikPixelCreated" "1"
  WriteRegStr SHCTX "Software\Classes\KekenikPixel.kpx\DefaultIcon" "" "$INSTDIR\resources\file-kpx.ico,0"
  WriteRegStr SHCTX "Software\Classes\KekenikPixel.kpx\shell\open" "" "Open with Kekenik Pixel"
  WriteRegStr SHCTX "Software\Classes\KekenikPixel.kpx\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; ---------------------------------------------------------------------------
  ; 2. Register Explorer "Open with" support (`Applications\KekenikPixel.exe` & `OpenWithProgids`)
  ; ---------------------------------------------------------------------------
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Kekenik Pixel"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".kpx" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".aseprite" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".ase" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".png" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".gif" ""

  ; Register ProgID for .ase/.aseprite so "Open with" always lists Kekenik Pixel
  WriteRegStr SHCTX "Software\Classes\KekenikPixel.aseprite" "" "Aseprite Sprite Document"
  WriteRegStr SHCTX "Software\Classes\KekenikPixel.aseprite" "KekenikPixelCreated" "1"
  WriteRegStr SHCTX "Software\Classes\KekenikPixel.aseprite\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\KekenikPixel.aseprite\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\.aseprite\OpenWithProgids" "KekenikPixel.aseprite" ""
  WriteRegStr SHCTX "Software\Classes\.ase\OpenWithProgids" "KekenikPixel.aseprite" ""

  ; ---------------------------------------------------------------------------
  ; 3. Opt-in default handler for `.aseprite` and `.ase` (only if user opted in)
  ; ---------------------------------------------------------------------------
  StrCmp $REGISTER_ASEPRITE_ASSOC "1" 0 SkipAsepriteDefaultAssoc
    WriteRegStr SHCTX "Software\Classes\.aseprite" "" "KekenikPixel.aseprite"
    WriteRegStr SHCTX "Software\Classes\.aseprite" "KekenikPixelCreated" "1"
    WriteRegStr SHCTX "Software\Classes\.ase" "" "KekenikPixel.aseprite"
    WriteRegStr SHCTX "Software\Classes\.ase" "KekenikPixelCreated" "1"
  SkipAsepriteDefaultAssoc:

  ; ---------------------------------------------------------------------------
  ; 4. Refresh Windows Explorer Shell Icon Cache: SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0)
  ; ---------------------------------------------------------------------------
  System::Call 'Shell32::SHChangeNotify(i ${SHCNE_ASSOCCHANGED}, i ${SHCNF_IDLIST}, i 0, i 0)'
!macroend

!macro customUnInstall
  ; ---------------------------------------------------------------------------
  ; 1. Cleanly remove ONLY the registry keys/values that Kekenik Pixel created
  ; ---------------------------------------------------------------------------
  ReadRegStr $0 SHCTX "Software\Classes\.kpx" ""
  StrCmp $0 "KekenikPixel.kpx" 0 SkipDeleteKpxExt
    DeleteRegValue SHCTX "Software\Classes\.kpx" ""
    DeleteRegValue SHCTX "Software\Classes\.kpx" "Content Type"
    DeleteRegValue SHCTX "Software\Classes\.kpx" "KekenikPixelCreated"
  SkipDeleteKpxExt:
  DeleteRegValue SHCTX "Software\Classes\.kpx\OpenWithProgids" "KekenikPixel.kpx"
  DeleteRegKey SHCTX "Software\Classes\KekenikPixel.kpx"

  ; Only remove .aseprite / .ase default handler if it still points to KekenikPixel.aseprite
  ReadRegStr $1 SHCTX "Software\Classes\.aseprite" ""
  StrCmp $1 "KekenikPixel.aseprite" 0 SkipDeleteAsepriteExt
    DeleteRegValue SHCTX "Software\Classes\.aseprite" ""
    DeleteRegValue SHCTX "Software\Classes\.aseprite" "KekenikPixelCreated"
  SkipDeleteAsepriteExt:

  ReadRegStr $2 SHCTX "Software\Classes\.ase" ""
  StrCmp $2 "KekenikPixel.aseprite" 0 SkipDeleteAseExt
    DeleteRegValue SHCTX "Software\Classes\.ase" ""
    DeleteRegValue SHCTX "Software\Classes\.ase" "KekenikPixelCreated"
  SkipDeleteAseExt:

  DeleteRegValue SHCTX "Software\Classes\.aseprite\OpenWithProgids" "KekenikPixel.aseprite"
  DeleteRegValue SHCTX "Software\Classes\.ase\OpenWithProgids" "KekenikPixel.aseprite"
  DeleteRegKey SHCTX "Software\Classes\KekenikPixel.aseprite"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"

  ; ---------------------------------------------------------------------------
  ; 2. Uninstaller "Keep settings" option (defaults to YES in silent mode)
  ; ---------------------------------------------------------------------------
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to keep your Kekenik Pixel user settings, custom workspaces, and autosave recovery snapshots?" \
    /SD IDYES IDYES KeepUserSettings
    RMDir /r "$APPDATA\Kekenik Pixel"
    RMDir /r "$LOCALAPPDATA\Kekenik Pixel"
  KeepUserSettings:

  ; ---------------------------------------------------------------------------
  ; 3. Refresh Windows Explorer Shell Icon Cache after uninstall
  ; ---------------------------------------------------------------------------
  System::Call 'Shell32::SHChangeNotify(i ${SHCNE_ASSOCCHANGED}, i ${SHCNF_IDLIST}, i 0, i 0)'
!macroend
