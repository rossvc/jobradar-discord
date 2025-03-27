module.exports = {
  apps: [
    {
      name: "jobradar-discord-bot",
      script: "./index.js",
      watch: false,
      env: {
        NODE_ENV: "production",
      },
      time: true,
    },
  ],
};
