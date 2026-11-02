; Picked up by electron-builder (buildResources/installer.nsh).
; Windows' "Installed apps" page skips per-user entries without an install location,
; so record it (and the install date) in VISION's uninstall entry.
!include "FileFunc.nsh"

!macro customInstall
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "InstallDate" "$2$1$0"
!macroend
