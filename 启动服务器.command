#!/bin/bash
cd "$(dirname "$0")"

echo "============================================"
echo " 🌈 彩虹日记本 - 局域网模式启动器 (macOS)"
echo "============================================"
echo ""

# Get local IP
IP=$(ipconfig getifaddr en0 2>/dev/null || ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)

echo "[1/2] 正在启动日记本服务器..."
node server.js &
SERVER_PID=$!

sleep 3

if kill -0 $SERVER_PID 2>/dev/null; then
    echo ""
    echo "============================================"
    echo " ✅ 服务器已成功启动！"
    echo ""
    echo "  本机访问:   http://localhost:3000"
    if [ -n "$IP" ]; then
        echo "  局域网访问: http://$IP:3000"
    fi
    echo ""
    echo "  提示: 其他设备请在浏览器输入上面的局域网地址"
    echo "  关闭此窗口请按 Ctrl+C"
    echo "============================================"
else
    echo " ❌ 服务器启动失败，请检查输出信息"
fi

wait $SERVER_PID
