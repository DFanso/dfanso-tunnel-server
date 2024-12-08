module.exports = {
  apps: [{
    name: 'dfanso-tunnel',
    script: './dist/index.js',
    instances: 2,
    autorestart: true,
    watch: true,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      DOMAIN: 'dfanso.dev',
      WS_PORT: '8080',
      HTTP_PORT: '80',
      HTTPS_PORT: '443',
      SSL_DIR: '/etc/letsencrypt/live/dfanso.dev'
    }
  }]
};