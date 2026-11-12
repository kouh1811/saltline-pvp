#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo '请先安装 Node.js 22 或更新版本：https://nodejs.org/'
  read '?按回车关闭…'
  exit 1
fi
if [[ ! -d node_modules/ws ]]; then
  npm ci --omit=dev || exit 1
fi
echo '打开浏览器：http://localhost:18453'
echo '关闭本窗口或按 Ctrl+C 可停止服务器。'
npm start
