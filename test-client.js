const WebSocket = require('ws');
const http = require('http');

// Create a local HTTP server to tunnel
const localServer = http.createServer((req, res) => {
  console.log('Local server received request:', req.method, req.url);
  
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    console.log('Request body:', body);

    if (req.url === '/api/test' && req.method === 'POST') {
      try {
        const jsonData = JSON.parse(body);
        console.log('Received JSON data:', jsonData);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'success',
          message: 'POST request received',
          receivedData: jsonData
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON data' }));
      }
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Hello from local server!');
    }
  });
});

// Configuration
const SERVER_IP = 'dfanso.dev';  // Your domain
const LOCAL_PORT = 3000;
const SUBDOMAIN = 'test';
const TUNNEL_SERVER = `wss://${SERVER_IP}:8080`;  // Using secure WebSocket

localServer.listen(LOCAL_PORT, () => {
  console.log(`Local server listening on port ${LOCAL_PORT}`);
  
  // Connect to tunnel server
  const ws = new WebSocket(TUNNEL_SERVER, {
    rejectUnauthorized: false // Only for testing, remove in production
  });

  ws.on('open', () => {
    console.log('Connected to tunnel server');
    
    // Register the tunnel
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

      if (message.type === 'request') {
        handleTunnelRequest(message, ws);
      }
    } catch (err) {
      console.error('Error parsing message:', err);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('Connection closed');
    process.exit(1);
  });
});

function handleTunnelRequest(message, ws) {
  const { clientId, method, path, headers } = message;
  console.log('Handling tunnel request:', method, path);

  // Create options for local request
  const options = {
    hostname: 'localhost',
    port: LOCAL_PORT,
    path: path,
    method: method,
    headers: headers
  };

  // Make request to local server
  const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });

    res.on('end', () => {
      // Send response back through tunnel
      ws.send(JSON.stringify({
        type: 'response',
        clientId: clientId,
        statusCode: res.statusCode,
        headers: res.headers,
        data: Buffer.from(body).toString('base64')
      }));
    });
  });

  req.on('error', (error) => {
    console.error('Error making local request:', error);
    ws.send(JSON.stringify({
      type: 'error',
      clientId: clientId,
      error: error.message
    }));
  });

  // End the request
  req.end();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  localServer.close();
  process.exit(0);
});
