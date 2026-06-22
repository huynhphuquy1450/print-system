/**
 * PM2 ecosystem config
 * Run: pm2 start ecosystem.config.js
 *      pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'print-service',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};