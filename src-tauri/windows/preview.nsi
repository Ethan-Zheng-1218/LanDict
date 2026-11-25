Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include MUI2.nsh
!include FileFunc.nsh
!include nsDialogs.nsh
!addplugindir /x86-unicode "${BUILD_DIR}"

Name "LanDict Setup"
Caption "LanDict Setup"
OutFile "${BUILD_DIR}\LanDict-native-preview.exe"
Icon "${ASSET_DIR}\installer.ico"
InstallDir "${PREVIEW_DIR}"
ShowInstDetails nevershow
AutoCloseWindow false
!define MUI_PAGE_CUSTOMFUNCTION_SHOW ShowArtwork
Page custom PrepareArtwork LeavePrepareArtwork
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Var TestFailure
Var HoldPreview
Var PreviewScale
Var PreviewRecord

Function .onInit
  StrCpy $INSTDIR "${PREVIEW_DIR}"
  Delete "${BUILD_DIR}\native-preview.log"
  Delete "$INSTDIR\preview-complete.txt"
  ${GetParameters} $0
  ${GetOptions} $0 "/TESTFAILURE" $TestFailure
  IfErrors +2
    StrCpy $TestFailure "yes"
  ClearErrors
  ${GetOptions} $0 "/SCALE=" $PreviewScale
  ClearErrors
  ${GetOptions} $0 "/RECORD" $PreviewRecord
  IfErrors +2
    StrCpy $PreviewRecord "yes"
  ClearErrors
  ${GetOptions} $0 "/HOLD" $HoldPreview
  IfErrors +2
    StrCpy $HoldPreview "yes"
  ClearErrors
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\artwork"
  File "${ASSET_DIR}\*.png"
FunctionEnd

Function PrepareArtwork
  StrCmp $HoldPreview "yes" +2
    Abort
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateProgressBar} 0 0 100% 12u ""
  Pop $1
  System::Call 'user32::SetWindowLongW(p r1,i -12,i 1004)'
  Call ShowArtwork
  nsDialogs::Show
FunctionEnd

Function LeavePrepareArtwork
  landict_installer_ui::Destroy
FunctionEnd

Function ShowArtwork
  landict_installer_ui::Attach "$PLUGINSDIR\artwork" "${BUILD_DIR}\native-preview.log" "$PreviewScale" "$PreviewRecord"
  Pop $0
  StrCmp $0 "ok" +3
    MessageBox MB_ICONSTOP "$0"
    Abort
FunctionEnd

Section "Actual preview payload"
  SetOutPath "$INSTDIR"
  ; These are real files and the engine's own progress. No timed percentage.
  File /oname=stardict.db "${PAYLOAD_DIR}\ecdict-sqlite-28\stardict-slim.db"
  File /oname=landict-oxford.db "${PAYLOAD_DIR}\oxford-sqlite\landict-oxford.db"
  File /oname=landict-cedict.db "${PAYLOAD_DIR}\cedict-sqlite\landict-cedict.db"
  IfErrors failed
  StrCmp $TestFailure "yes" 0 +4
    ; This deliberately requests a child of an existing file: a real OS error.
    FileOpen $1 "$INSTDIR\stardict.db\cannot-write.txt" w
    IfErrors failed
    FileClose $1
  FileOpen $1 "$INSTDIR\preview-complete.txt" w
  FileWrite $1 "Native NSIS preview extracted the three real dictionary files. No product installation was performed."
  FileClose $1
  IfErrors failed
  Goto done
  failed:
    SetErrorLevel 1
    Abort "Preview file extraction failed."
  done:
SectionEnd

Function .onGUIEnd
  landict_installer_ui::Destroy
FunctionEnd
