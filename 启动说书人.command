#!/bin/bash
cd -- "$(dirname -- "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 24 LTS，然后重新打开本文件。"
  read -r -p "按回车关闭…"
  exit 1
fi
node scripts/launch.mjs
result=$?
if [ "$result" -ne 0 ]; then read -r -p "启动失败，请查看上方提示。按回车关闭…"; fi
exit "$result"
