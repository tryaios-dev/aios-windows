; NSIS additions for the per-user installer (electron-builder `nsis.include`).
;
; AC-22: uninstall removes the application and keeps the user's data unless they choose to remove
; it. The question is asked only on a real uninstall, never when an update replaces the program,
; and a silent uninstall keeps the data. The keys in the OS key store are left as they are: the
; data folder can be restored later with the recovery key.
;
; Models are downloaded into <install folder>\models, on the drive the user chose in the installer
; (electron-builder.yml: allowToChangeInstallationDirectory). They count as the user's data: kept
; on update and on uninstall unless the user chooses to remove their data.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove your AIOS data from this computer?$\r$\n$\r$\nThis deletes your projects, conversations, evidence log, downloaded models and logs. Choose No to keep them; a backup can be restored later with your recovery key." /SD IDNO IDNO aios_keep_data
      RMDir /r "$LOCALAPPDATA\AIOS"
      RMDir /r "$INSTDIR\models"
      RMDir "$INSTDIR"
    aios_keep_data:
  ${endIf}
!macroend

; Removing the program (an update, or an uninstall) deletes everything in the install folder
; except the models folder, so an update never downloads a model again. electron-builder runs
; this instead of its own "RMDir /r $INSTDIR"; customUnInstall above removes the models only when
; the user chose to remove their data.
!macro customRemoveFiles
  Push $R0
  Push $R1
  FindFirst $R0 $R1 "$INSTDIR\*.*"
  aios_remove_loop:
    StrCmp $R1 "" aios_remove_done
    StrCmp $R1 "." aios_remove_next
    StrCmp $R1 ".." aios_remove_next
    StrCmp $R1 "models" aios_remove_next
    IfFileExists "$INSTDIR\$R1\*.*" 0 aios_remove_file
      RMDir /r "$INSTDIR\$R1"
      Goto aios_remove_next
    aios_remove_file:
      Delete "$INSTDIR\$R1"
  aios_remove_next:
    FindNext $R0 $R1
    Goto aios_remove_loop
  aios_remove_done:
  FindClose $R0
  RMDir "$INSTDIR" ; only when empty: a kept models folder keeps it
  Pop $R1
  Pop $R0
!macroend
