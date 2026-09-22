; インストーラに「デスクトップにショートカットを作る」の選択を足す。
;
; electron-builder 側の自動生成は package.json の nsis.createDesktopShortcut: false で止めてあり、
; ここでチェックが入ったときだけ作る。無人インストール（/S。自動更新はこれを使う）では
; ページが出ないので作らない。
;
; このファイルはインストーラとアンインストーラの両方に読み込まれる。ページ用の関数を素で置くと
; アンインストーラ側で「未参照」の警告になり、electron-builder は警告をエラーとして扱うため、
; インストーラ専用の部分は BUILD_UNINSTALLER で囲んでおく。

!include nsDialogs.nsh
!include LogicLib.nsh
!include WinMessages.nsh

!ifndef BUILD_UNINSTALLER

Var DesktopCheckbox
Var MakeDesktopShortcut

; インストール先を決めたあとに1ページ挟む
!macro customPageAfterChangeDir
  Page custom desktopShortcutPageShow desktopShortcutPageLeave
!macroend

Function desktopShortcutPageShow
  ; 自動更新は無人実行（/S）なのでこのページは出ない。聞くのは人が入れるときだけになる。
  ; 見出しは MUI のマクロが使えない（この include は MUI2 より前に読まれる）ので直接書き込む
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:ショートカット"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:デスクトップにショートカットを作るか選べます。"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "スタートメニューには必ず登録されます。デスクトップにも置くかどうかを選んでください。"
  Pop $1
  ${NSD_CreateCheckbox} 0 30u 100% 12u "デスクトップにショートカットを作る"
  Pop $DesktopCheckbox
  ${If} $MakeDesktopShortcut == "1"
    ${NSD_Check} $DesktopCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function desktopShortcutPageLeave
  ${NSD_GetState} $DesktopCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $MakeDesktopShortcut "1"
  ${Else}
    StrCpy $MakeDesktopShortcut "0"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $MakeDesktopShortcut == "1"
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" \
      "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER

; 作ったものは自分で片づける（electron-builder 側は createDesktopShortcut: false なので消さない）
!macro customUnInstall
  ${ifNot} ${isKeepShortcuts}
    WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endIf}
!macroend
