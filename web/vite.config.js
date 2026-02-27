const path = require('node:path');
const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');

module.exports = defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 6064,
    proxy: {
      '/api': 'http://localhost:6065',
      '/images': 'http://localhost:6065'
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 6064
  }
});
