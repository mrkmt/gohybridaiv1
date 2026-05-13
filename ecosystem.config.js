module.exports = {
  apps: [
    {
      name: 'gohybrid-v1-backend',
      script: 'npm',
      args: 'run dev',
      cwd: './backend',
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'gohybrid-v1-frontend',
      script: 'npm',
      args: 'run dev',
      cwd: './frontend',
      env: {
        NODE_ENV: 'development'
      }
    }
  ]
};
