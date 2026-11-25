Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include MUI2.nsh
!include nsDialogs.nsh
!addplugindir /x86-unicode "${BUILD_DIR}"
Name "LanDict Setup options preview"
OutFile "${BUILD_DIR}\LanDict-options-preview.exe"
Icon "${ASSET_DIR}\installer.ico"
InstallDir "${BUILD_DIR}\options-extracted"
Var Consent
Var AutoStart
Var KeepInstaller
Var DesktopShortcut
Page custom Prepare LeavePrepare
!define MUI_PAGE_CUSTOMFUNCTION_SHOW ShowArtwork
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\artwork"
  File "${ASSET_DIR}\*.png"
  File /oname=agreement.txt "${AGREEMENT_FILE}"
FunctionEnd
Function ShowArtwork
  landict_installer_ui::Attach "$PLUGINSDIR\artwork" "${BUILD_DIR}\options-preview.log" "" ""
  Pop $0
  StrCmp $0 "ok" +3
    MessageBox MB_ICONSTOP "$0"
    Abort
FunctionEnd
Function Prepare
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateProgressBar} 0 0 100% 12u ""
  Pop $1
  System::Call 'user32::SetWindowLongW(p r1,i -12,i 1004)'
  Call ShowArtwork
  landict_installer_ui::Options "$PLUGINSDIR\artwork\agreement.txt" "0" "1" "1"
  Pop $0
  nsDialogs::Show
FunctionEnd
Function LeavePrepare
  landict_installer_ui::GetOptions
  Pop $DesktopShortcut
  Pop $KeepInstaller
  Pop $AutoStart
  Pop $Consent
  StrCmp $Consent "1" +2
    Abort
  landict_installer_ui::Destroy
FunctionEnd
Section "Real preview extraction only"
  SetOutPath "$INSTDIR"
  File /oname=stardict.db "${PAYLOAD_DIR}\ecdict-sqlite-28\stardict-slim.db"
  IfErrors +2
    Goto done
  Abort "Extraction failed"
  done:
SectionEnd
Function .onGUIEnd
  landict_installer_ui::Destroy
FunctionEnd
