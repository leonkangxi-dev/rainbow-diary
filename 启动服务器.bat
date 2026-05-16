@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo  🌈 彩虹日记本 - 局域网模式启动器
echo ============================================
echo.

:check_admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [1/3] 正在请求管理员权限添加防火墙规则...
    powershell -Command "Start-Process '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)

echo [1/3] 正在添加防火墙规则...
netsh advfirewall firewall add rule name="彩虹日记本 3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo       ✅ 防火墙规则已添加

echo [2/3] 正在启动日记本服务器...
start "彩虹日记本" /MIN node server.js

echo [3/3] 正在检测...
timeout /t 3 /nobreak >nul
netstat -ano | findstr ":3000.*LISTENING" >nul
if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo  ✅ 服务器已成功启动！
    echo.
    echo  本机访问: http://localhost:3000
    for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /c:"IPv4"') do (
        for /f "tokens=1 delims= " %%j in ("%%i") do (
            echo  局域网访问: http://%%j:3000
        )
    )
    echo.
    echo  提示: 其他设备请在浏览器输入上面的局域网地址
    echo  关闭此窗口不会影响服务器运行
    echo ============================================
) else (
    echo  ❌ 服务器启动失败，请检查 error.log
)

timeout /t 10 >nul
