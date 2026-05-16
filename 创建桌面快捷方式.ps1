# 彩虹日记本 - 创建桌面快捷方式
# 右键点击此文件，选择"用 PowerShell 运行"

$exePath = "$PSScriptRoot\dist\win-unpacked\彩虹日记本.exe"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = "$desktop\彩虹日记本.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = "$PSScriptRoot\dist\win-unpacked"
$shortcut.Description = "🌈 彩虹日记本 - 给小学生用的可爱日记软件"
$shortcut.Save()

Write-Host "✅ 桌面快捷方式已创建: $shortcutPath"
