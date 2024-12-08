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

    // Forward request to test server
    const options = {
      hostname: 'localhost',
      port: 8000, // Test server port
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: 'localhost:8000'
      }
    };

    const testServerReq = http.request(options, (testServerRes) => {
      // Copy status and headers from test server response
      res.writeHead(testServerRes.statusCode, testServerRes.headers);

      // Forward response body
      testServerRes.on('data', chunk => {
        res.write(chunk);
      });

      testServerRes.on('end', () => {
        res.end();
      });
    });

    testServerReq.on('error', (error) => {
      console.error('Error forwarding to test server:', error);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Error forwarding request to test server' }));
    });

    // Forward request body if present
    if (body) {
      testServerReq.write(body);
    }
    testServerReq.end();
  });
});

const LOCAL_PORT = 3000;
const SUBDOMAIN = 'test';
const SERVER_IP = 'dfanso.dev';
const TUNNEL_SERVER = `wss://${SERVER_IP}:8080`;

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
  const { clientId, method, path, headers, body } = message;
  console.log('Handling tunnel request:', method, path);
  console.log('Request body:', body);

  // Create options for local request
  const options = {
    hostname: 'localhost',
    port: LOCAL_PORT,
    path: path,
    method: method,
    headers: {
      ...headers,
      host: `localhost:${LOCAL_PORT}`
    }
  };

  // Make request to local server
  const req = http.request(options, (res) => {
    let responseBody = '';
    res.on('data', (chunk) => {
      responseBody += chunk;
    });

    res.on('end', () => {
      console.log('Local server response:', responseBody);
      
      // Send response back through tunnel
      ws.send(JSON.stringify({
        type: 'response',
        clientId: clientId,
        statusCode: res.statusCode,
        headers: res.headers,
        data: Buffer.from(responseBody).toString('base64')
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

  // Write request body if present
  if (body) {
    req.write(body);
  }
  req.end();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  localServer.close();
  process.exit(0);
});
