#!/bin/bash

# Navigate to the script's directory
cd "$(dirname "$0")"/..

echo "Running LibrixAI via PM2."

export NVM_DIR=~/.nvm
source ~/.nvm/nvm.sh
nvm install 23.3.0
nvm use 23.3.0
npm install -g pm2 pnpm@9.12.3
pnpm install
pnpm build

# Start the PM2 process manager
pm2 start ecosystem.config.js

