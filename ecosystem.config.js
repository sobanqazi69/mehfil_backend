module.exports = {
  apps: [
    {
      name: 'mehfil_backend',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
