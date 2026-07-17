import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    watch: {
      // Dropping image files into /static intermittently locks them on Windows
      // and crashes Vite's file watcher (EBUSY). Static assets are still served
      // on request, so we just exclude the folder from watching.
      ignored: ['**/static/**']
    }
  }
});

