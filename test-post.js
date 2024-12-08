const https = require('https');

const data = JSON.stringify({
  message: 'Hello from test POST request',
  timestamp: new Date().toISOString()
});

const options = {
  hostname: 'test.dfanso.dev',
  port: 443,
  path: '/api/test',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  },
  rejectUnauthorized: false // Only for testing
};

const req = https.request(options, (res) => {
  console.log('Status Code:', res.statusCode);
  console.log('Headers:', res.headers);

  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('Response:', responseData);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();

console.log('Sending POST request with data:', data);
