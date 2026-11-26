; Runs when the NSIS uninstaller finishes: remove the scheduled task Bytemop may have created for this user,
; so it does not keep firing against a program that is no longer there.
; An upgrade runs the old uninstaller too ("isUpdated"): the task must survive that.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec 'schtasks.exe /Delete /TN "\Bytemop\Scheduled Run" /F'
    Pop $0
  ${endIf}
!macroend
