#!/bin/bash

# Exit on any error
set -e

# Install dependencies
npm install

# Build TypeScript code
npm run build

# Create production directory
sudo mkdir -p /opt/dfanso-tunnel-server

# Copy files to production directory
sudo cp -r dist package.json package-lock.json .env.production /opt/dfanso-tunnel-server/
cd /opt/dfanso-tunnel-server
sudo mv .env.production .env

# Install production dependencies
sudo npm install --production

# Copy systemd service file
sudo cp tunnel-server.service /etc/systemd/system/

# Reload systemd and start service
sudo systemctl daemon-reload
sudo systemctl enable tunnel-server
sudo systemctl restart tunnel-server

# Show service status
sudo systemctl status tunnel-server
