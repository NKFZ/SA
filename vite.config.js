import { defineConfig } from 'vite';

export default defineConfig(async ({ command }) => {
  const plugins = [];
  if (command === 'serve') {
    try {
      const { dbApiPlugin } = await import('./src/server/dbPlugin.js');
      plugins.push(dbApiPlugin());
    } catch (e) {
      console.warn('dbApiPlugin not loaded:', e.message);
    }
  }

  return {
    plugins,
    server: {
      port: 3000,
      open: true
    }
  };
});
