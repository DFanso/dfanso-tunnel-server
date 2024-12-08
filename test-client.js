const WebSocket = require('ws');
const net = require('net');
const http = require('http');

// Use localhost for testing
const TUNNEL_SERVER = 'ws://localhost:8080';
const LOCAL_PORT = 8000;
const SUBDOMAIN = 'test';

const ws = new WebSocket(TUNNEL_SERVER);

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
            handleTunnelConnection(message);
        }
    } catch (err) {
        console.error('Error parsing message:', err);
    }
});

function handleTunnelConnection(message) {
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
        
        // Send ready signal
        ws.send(JSON.stringify({
            type: 'ready',
            clientId: clientId
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

ws.on('error', (err) => {
    console.error('WebSocket error:', err);
});

ws.on('close', () => {
    console.log('Disconnected from tunnel server');
});
