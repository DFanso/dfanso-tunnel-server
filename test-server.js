const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello from test server!');
});

const PORT = 8000;
server.listen(PORT, () => {
    console.log(`Test server running on http://localhost:${PORT}`);
});
