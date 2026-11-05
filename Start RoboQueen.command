#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print 'Please install Node.js 22 or newer from https://nodejs.org, then open this file again.'
  read -k 1 '?Press any key to close.'
  exit 1
fi
if [[ ! -d node_modules/ws ]]; then
  npm ci || exit 1
fi
print 'Open http://localhost:8787 in your browser. Keep this window open while playing.'
npm start
