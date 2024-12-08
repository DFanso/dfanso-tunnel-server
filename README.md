# DFanso Tunnel Server

A secure tunneling solution that allows you to expose your local servers to the internet through custom subdomains. Built with Node.js, WebSocket, and SSL support.

## Features

- 🔒 Secure SSL tunneling with Let's Encrypt
- 🌐 Custom subdomain support (*.dfanso.dev)
- 🚀 HTTP/2 support
- 🔄 WebSocket-based tunneling
- 📦 Easy-to-use client library
- 🛡️ Production-ready with error handling

## Architecture

```
Internet (HTTPS) -> Tunnel Server (dfanso.dev) -> WebSocket -> Local Server
```

## Server Setup

### Prerequisites

- Node.js 16+
- Let's Encrypt SSL certificate
- Domain with wildcard DNS (*.dfanso.dev)

### Installation

```bash
git clone https://github.com/dfanso/tunnel-server.git
cd tunnel-server
npm install
```

### Configuration

Create a `.env` file:

```env
NODE_ENV=production
DOMAIN=dfanso.dev
HTTP_PORT=80
HTTPS_PORT=443
WS_PORT=8080
SSL_DIR=/etc/letsencrypt/live/dfanso.dev
```

### SSL Certificate Setup

1. Install certbot:
```bash
sudo apt-get install certbot
```

2. Generate wildcard certificate:
```bash
sudo certbot certonly --manual --preferred-challenges dns -d *.dfanso.dev -d dfanso.dev
```

3. Follow certbot instructions to add DNS TXT records

### Running the Server

Development:
```bash
npm run dev
```

Production:
```bash
npm run build
npm start
```

## Client Library

### Installation

```bash
npm install dfanso-tunnel-client
```

### Basic Usage

```javascript
const TunnelClient = require('dfanso-tunnel-client');

// Create a tunnel
const tunnel = new TunnelClient({
    subdomain: 'myapp',     // Will be myapp.dfanso.dev
    targetPort: 3000,       // Your local server port
});

// Connect to tunnel server
tunnel.connect()
    .then(({ url }) => {
        console.log(`Server is accessible at: ${url}`);
    })
    .catch(console.error);
```

### Express Example

```javascript
const TunnelClient = require('dfanso-tunnel-client');
const express = require('express');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Hello from tunneled server!');
});

const server = app.listen(3000, () => {
    const tunnel = new TunnelClient({
        subdomain: 'myapp',
        targetPort: 3000
    });

    tunnel.on('error', console.error);
    tunnel.on('disconnect', () => {
        console.log('Tunnel disconnected');
    });

    tunnel.connect()
        .then(({ url }) => {
            console.log(`Server is accessible at: ${url}`);
        })
        .catch(console.error);
});
```

### Client Options

```javascript
{
    tunnelServer: 'wss://dfanso.dev:8080', // Tunnel server URL
    subdomain: 'myapp',                     // Your subdomain
    targetPort: 3000,                       // Your local server port
    localPort: 0,                           // Random port (optional)
    rejectUnauthorized: true                // Verify SSL (recommended)
}
```

### Events

- `error`: Emitted when an error occurs
- `disconnect`: Emitted when tunnel disconnects

## Security

- All traffic is encrypted with SSL
- Automatic HTTP to HTTPS redirection
- WebSocket connections are secured
- Client verification through SSL

## Development

### Project Structure

```
├── src/
│   ├── index.ts              # Server entry point
│   ├── server/
│   │   ├── HttpServer.ts     # HTTP/HTTPS server
│   │   └── WebSocketServer.ts# WebSocket handling
│   └── services/
│       └── TunnelService.ts  # Tunnel management
├── lib/
│   └── tunnel-client.js      # Client library
└── examples/
    └── example.js            # Usage examples
```

### Building

```bash
npm run build   # Builds TypeScript
npm run lint    # Runs ESLint
npm run format  # Formats code
```

## Testing

Start the test server:
```bash
node test-server.js
```

Connect with test client:
```bash
node test-client.js
```

Test endpoints:
```bash
curl https://test.dfanso.dev/
curl -X POST https://test.dfanso.dev/api/data -d '{"hello":"world"}'
```

## Production Deployment

1. Set up SSL certificates
2. Configure environment variables
3. Start with process manager:
```bash
npm install -g pm2
pm2 start npm --name "tunnel-server" -- start
```

## License

MIT

## Author

DFanso (https://github.com/dfanso)