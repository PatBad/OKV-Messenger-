; TEMPLATE: scripts/apply-brand.js fills in the double-brace placeholders from brands/<id>/brand.json and writes build/installer.nsh.
; Extra installer steps for {{productName}} (included by electron-builder).
;
; {{productName}} computers talk to each other directly over the clinic network,
; so Windows Firewall must let them in. On the first (interactive) install we
; add allow rules, limited to the local subnet, with a single admin prompt.
; Silent auto-updates skip this, so staff never see a prompt after that.
; If the prompt is declined the app still works: it can always reach out to
; other computers itself, messages just arrive a few seconds later.

!macro customInstall
  ${IfNot} ${Silent}
    nsExec::ExecToStack 'netsh advfirewall firewall show rule name="{{productName}}"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      ExecShellWait "runas" "$SYSDIR\cmd.exe" '/c netsh advfirewall firewall add rule name="{{productName}}" dir=in action=allow protocol=TCP localport={{tcpPorts}} remoteip=localsubnet profile=any & netsh advfirewall firewall add rule name="{{productName}}" dir=in action=allow protocol=UDP localport={{udpPort}} remoteip=localsubnet profile=any & netsh advfirewall firewall add rule name="{{productName}}" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" remoteip=localsubnet profile=any' SW_HIDE
    ${EndIf}
  ${EndIf}
!macroend
