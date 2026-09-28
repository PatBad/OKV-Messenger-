; Extra installer steps for OKV Messenger (included by electron-builder).
;
; OKV Messenger computers talk to each other directly over the clinic network,
; so Windows Firewall must let them in. On the first (interactive) install we
; add allow rules, limited to the local subnet, with a single admin prompt.
; Silent auto-updates skip this, so staff never see a prompt after that.
; If the prompt is declined the app still works: it can always reach out to
; other computers itself, messages just arrive a few seconds later.

!macro customInstall
  ${IfNot} ${Silent}
    nsExec::ExecToStack 'netsh advfirewall firewall show rule name="OKV Messenger"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      ExecShellWait "runas" "$SYSDIR\cmd.exe" '/c netsh advfirewall firewall add rule name="OKV Messenger" dir=in action=allow protocol=TCP localport=41235-41239 remoteip=localsubnet profile=any & netsh advfirewall firewall add rule name="OKV Messenger" dir=in action=allow protocol=UDP localport=41234 remoteip=localsubnet profile=any & netsh advfirewall firewall add rule name="OKV Messenger" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" remoteip=localsubnet profile=any' SW_HIDE
    ${EndIf}
  ${EndIf}
!macroend
