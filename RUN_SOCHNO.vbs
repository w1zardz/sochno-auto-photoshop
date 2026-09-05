' SOCHNO AUTO: double-click to process the active Photoshop document.
Option Explicit
Dim ps, fso, scriptPath
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "SOCHNO_AUTO.jsx")
If Not fso.FileExists(scriptPath) Then
    MsgBox "Keep RUN_SOCHNO.vbs next to SOCHNO_AUTO.jsx.", 16, "SOCHNO AUTO"
    WScript.Quit 1
End If
On Error Resume Next
Set ps = GetObject(, "Photoshop.Application")
If Err.Number <> 0 Then
    Err.Clear
    Set ps = CreateObject("Photoshop.Application")
End If
If Err.Number <> 0 Then
    MsgBox "Could not connect to Photoshop. Open Photoshop and use File > Scripts > Browse > SOCHNO_AUTO.jsx.", 16, "SOCHNO AUTO"
    WScript.Quit 1
End If
Err.Clear
ps.DoJavaScriptFile scriptPath
If Err.Number <> 0 Then MsgBox Err.Description, 16, "SOCHNO AUTO"
