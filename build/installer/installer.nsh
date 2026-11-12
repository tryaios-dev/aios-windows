; NSIS additions for the per-user installer (electron-builder `nsis.include`).
;
; AC-22: uninstall removes the application and keeps the user's data unless they choose to remove
; it. The question is asked only on a real uninstall, never when an update replaces the program,
; and a silent uninstall keeps the data. The keys in the OS key store are left as they are: the
; data folder can be restored later with the recovery key.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove your AIOS data from this computer?$\r$\n$\r$\nThis deletes your projects, conversations, evidence log, models and logs. Choose No to keep them; a backup can be restored later with your recovery key." /SD IDNO IDNO aios_keep_data
      RMDir /r "$LOCALAPPDATA\AIOS"
    aios_keep_data:
  ${endIf}
!macroend
