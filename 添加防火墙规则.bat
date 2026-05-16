@echo off
cd /d "%~dp0"

:: Check if running as admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 请求管理员权限中...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo ================================
echo  🌈 彩虹日记本 - 添加防火墙规则
echo ================================
echo.
echo 正在添加防火墙规则...
netsh advfirewall firewall add rule name="彩虹日记本 3000" dir=in action=allow protocol=TCP localport=3000
echo.
echo ✅ 成功！其他设备可通过 http://本机IP:3000 访问
echo.
pause
