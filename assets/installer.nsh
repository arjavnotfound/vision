; Picked up by electron-builder (buildResources/installer.nsh).
;
; Windows' "Installed apps" page skips per-user entries without an install location,
; so record it (and the install date) in VISION's uninstall entry.
;
; Windows Firewall: the voice assistant's media connection (LiveKit WebRTC) is opened by
; the bundled agent-runtime\python.exe. Without an allow rule Windows asks the user at the
; first voice session, a prompt someone without hands cannot answer. The helper who runs
; the install answers one UAC prompt here instead.
;   - The install is per-user (no admin), so netsh runs through ShellExecute "runas".
;   - Declined: the install still completes; Windows asks once at the first voice session.
;   - Scoped to private networks, inbound, this one program.
;   - Updates skip it (the rule is already there); uninstall removes it.
;
; Dry run: tests compile this file with VISION_FIREWALL_DRYRUN_ONLY defined. The netsh
; command lines are then appended to the file named by the VISION_FIREWALL_DRYRUN
; environment variable and nothing is executed.

!include "FileFunc.nsh"

!define VISION_FW_RULE "VISION voice assistant"
!define VISION_FW_PROGRAM "$INSTDIR\resources\agent-runtime\python.exe"
; Delete first: a reinstall must not leave two rules.
!define VISION_FW_DELETE 'advfirewall firewall delete rule name="${VISION_FW_RULE}"'
!define VISION_FW_ADD 'advfirewall firewall add rule name="${VISION_FW_RULE}" dir=in action=allow program="${VISION_FW_PROGRAM}" profile=private enable=yes'

!macro visionNetsh ARGS
  !ifdef VISION_FIREWALL_DRYRUN_ONLY
    Push $R9
    Push $R8
    ReadEnvStr $R9 VISION_FIREWALL_DRYRUN
    FileOpen $R8 "$R9" a
    FileSeek $R8 0 END
    FileWrite $R8 `$SYSDIR\cmd.exe /c ${ARGS}$\r$\n`
    FileClose $R8
    Pop $R8
    Pop $R9
  !else
    ; One UAC prompt for both commands. Errors (declined prompt) are ignored on purpose.
    ExecShell "runas" "$SYSDIR\cmd.exe" `/c ${ARGS}` SW_HIDE
  !endif
!macroend

!macro customInstall
  !ifndef VISION_FIREWALL_DRYRUN_ONLY
    WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
    ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
    WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "InstallDate" "$2$1$0"
  !endif
  ${ifNot} ${isUpdated}
    !insertmacro visionNetsh `netsh ${VISION_FW_DELETE} >nul 2>&1 & netsh ${VISION_FW_ADD}`
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro visionNetsh `netsh ${VISION_FW_DELETE}`
  ${endIf}
!macroend
