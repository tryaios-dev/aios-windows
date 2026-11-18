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

; Offline package (MVP 10.1): a ZIP or USB folder with Setup.exe and a models folder. The model
; files next to Setup.exe are copied into <install folder>\models\offline. On first start AIOS
; checks each one like an import (size, SHA-256 and review against the catalogue) and installs it,
; or deletes it when it fails (services/backend/aios_backend/apps/models/service.py,
; install_package_file). No network is needed at any point. An update runs from the updater's
; folder, which has no models folder, so it copies nothing.
!macro customInstall
  ${If} ${FileExists} "$EXEDIR\models\*.gguf"
    CreateDirectory "$INSTDIR\models\offline"
    ${If} ${Silent}
      CopyFiles /SILENT "$EXEDIR\models\*.gguf" "$INSTDIR\models\offline"
    ${Else}
      CopyFiles "$EXEDIR\models\*.gguf" "$INSTDIR\models\offline"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also remove your AIOS data from this computer?$\r$\n$\r$\nThis deletes your projects, conversations, evidence log, downloaded models and logs. Choose No to keep them; a backup can be restored later with your recovery key." /SD IDNO IDNO aios_keep_data
      RMDir /r "$LOCALAPPDATA\AIOS"
      RMDir /r "$INSTDIR\models"
      RMDir "$INSTDIR"
    aios_keep_data:
  ${endIf}
!macroend

; Removing the program (an update, or an uninstall) deletes exactly what the installer put in the
; install folder, by name, and never the models folder, so an update never downloads a model again.
; The user may have chosen a folder that already held their own files: nothing else is touched,
; and the folder itself goes only when it is empty. electron-builder runs this instead of its own
; "RMDir /r $INSTDIR"; customUnInstall above removes the models only when the user chose to
; remove their data. The names are the top level of the packaged app (electron-builder output).
!macro customRemoveFiles
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vulkan-1.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  RMDir "$INSTDIR" ; only when empty: a kept models folder or the user's own files keep it
!macroend
