const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const TUNNEL_SERVER = process.env.NODE_ENV === 'production' 
  ? 'wss://dfanso.dev:8080'
  : 'ws://localhost:8080';
const LOCAL_PORT = 8000;
const SUBDOMAIN = 'test';

// WebSocket connection with auto-reconnect
function connectWebSocket() {
  const ws = new WebSocket(TUNNEL_SERVER, {
    rejectUnauthorized: false, // Allow self-signed certificates in development
    headers: {
      'Host': 'dfanso.dev'
    }
  });

  ws.on('open', () => {
    console.log('Connected to tunnel server');
    
    // Register tunnel
    ws.send(JSON.stringify({
      type: 'register',
      subdomain: SUBDOMAIN,
      port: LOCAL_PORT
    }));
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received message:', message);

      if (message.type === 'connection') {
        handleTunnelConnection(message, ws);
      }
    } catch (err) {
      console.error('Error parsing message:', err);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  ws.on('close', () => {
    console.log('Disconnected from tunnel server');
    // Attempt to reconnect after 5 seconds
    setTimeout(connectWebSocket, 5000);
  });
}

function handleTunnelConnection(message, ws) {
  const clientId = message.clientId;
  
  // Create HTTP request to local server
  const options = {
    hostname: 'localhost',
    port: LOCAL_PORT,
    path: message.path || '/',
    method: message.method || 'GET',
    headers: message.headers || {}
  };

  const req = http.request(options, (res) => {
    console.log(`Local server responded with status code: ${res.statusCode}`);
    
    // Send ready signal with response headers
    ws.send(JSON.stringify({
      type: 'ready',
      clientId: clientId,
      statusCode: res.statusCode,
      headers: res.headers
    }));

    // Forward response data
    res.on('data', (chunk) => {
      ws.send(JSON.stringify({
        type: 'data',
        clientId: clientId,
        data: chunk.toString('base64')
      }));
    });

    // Forward response end
    res.on('end', () => {
      ws.send(JSON.stringify({
        type: 'end',
        clientId: clientId
      }));
    });
  });

  req.on('error', (err) => {
    console.error('Error connecting to local server:', err);
    ws.send(JSON.stringify({
      type: 'error',
      clientId: clientId,
      error: err.message
    }));
  });

  // Forward request body if any
  if (message.body) {
    req.write(message.body);
  }
  req.end();
}

// Start the connection
connectWebSocket();
