const WebSocket = require('ws');
const net = require('net');

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
    const message = JSON.parse(data);
    console.log('Received message:', message);

    if (message.type === 'connection') {
        const clientId = message.clientId;
        
        // Create connection to local server
        const localConnection = net.createConnection({ port: LOCAL_PORT }, () => {
            console.log('Connected to local service');
            
            // Notify tunnel server that we're ready
            ws.send(JSON.stringify({
                type: 'ready',
                clientId: clientId
            }));
        });

        // Handle data from local server
        localConnection.on('data', (data) => {
            ws.send(JSON.stringify({
                type: 'data',
                clientId: clientId,
                data: data.toString('base64')
            }));
        });

        // Handle data from tunnel server
        ws.on('message', (msg) => {
            const tunnelMessage = JSON.parse(msg);
            if (tunnelMessage.type === 'data' && tunnelMessage.clientId === clientId) {
                localConnection.write(Buffer.from(tunnelMessage.data, 'base64'));
            }
        });
    }
});

ws.on('error', console.error);
ws.on('close', () => console.log('Disconnected from tunnel server'));
