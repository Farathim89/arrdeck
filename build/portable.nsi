# ArrDeck: electron-builder 25.1.8 portable.nsi plus a "bring the running ArrDeck back" shortcut in
# .onInit. Put in place before building by scripts/prepare-portable.js (npm run dist).
!include "common.nsh"
!include "extractAppPackage.nsh"

# https://github.com/electron-userland/electron-builder/issues/3972#issuecomment-505171582
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Function .onInit
  !ifndef SPLASH_IMAGE
    SetSilent silent
  !endif

  !insertmacro check64BitAndSetRegView

  # ArrDeck: already running from this .exe (e.g. hidden in the tray)? Bring its window back and
  # stop, instead of unpacking the whole app again first (that took ~10 s with the virus scanner).
  # ArrDeck keeps its window's handle in ArrDeck-data\window.txt while it runs.
  # (not when Windows starts it in the tray with --hidden)
  ${StdUtils.GetAllParameters} $R1 0
  StrCpy $R2 0
  StrCpy $R9 ""
  arrdeck_scan:
    StrCpy $R8 $R1 8 $R2
    StrCmp $R8 "" arrdeck_scanned
    StrCmp $R8 "--hidden" 0 +3
      StrCpy $R9 "hidden"
      Goto arrdeck_scanned
    IntOp $R2 $R2 + 1
    Goto arrdeck_scan
  arrdeck_scanned:
  ${If} $R9 == ""
    ClearErrors
    FileOpen $R3 "$EXEDIR\ArrDeck-data\window.txt" r
    ${IfNot} ${Errors}
      FileRead $R3 $R4
      FileClose $R3
      IntOp $R4 $R4 + 0
      ${If} $R4 <> 0
        System::Call 'user32::IsWindow(p R4) i .R5'
        ${If} $R5 <> 0
          System::Call 'user32::GetWindowText(p R4, t .R6, i 64) i'
          ${If} $R6 == "ArrDeck"
            System::Call 'user32::ShowWindow(p R4, i 9)'
            System::Call 'user32::SetForegroundWindow(p R4)'
            Quit
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

Function .onGUIInit
  InitPluginsDir

  !ifdef SPLASH_IMAGE
    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    BgImage::SetBg $PLUGINSDIR\splash.bmp
    BgImage::Redraw
  !endif
FunctionEnd

Section
  !ifdef SPLASH_IMAGE
    HideWindow
  !endif

  StrCpy $INSTDIR "$PLUGINSDIR\app"
  !ifdef UNPACK_DIR_NAME
    StrCpy $INSTDIR "$TEMP\${UNPACK_DIR_NAME}"
  !endif

  RMDir /r $INSTDIR
  SetOutPath $INSTDIR

  !ifdef APP_DIR_64
    !ifdef APP_DIR_ARM64
      !ifdef APP_DIR_32
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${elseif} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${else}
          File /r "${APP_DIR_64}\*.*"
        {endIf}
      !endif
    !else
      !ifdef APP_DIR_32
        ${if} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        File /r "${APP_DIR_64}\*.*"
      !endif
    !endif
  !else
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif
  !endif

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  !ifdef SPLASH_IMAGE
    BgImage::Destroy
  !endif

	ExecWait "$INSTDIR\${APP_EXECUTABLE_FILENAME} $R0" $0
  SetErrorLevel $0

  SetOutPath $EXEDIR
	RMDir /r $INSTDIR
SectionEnd
