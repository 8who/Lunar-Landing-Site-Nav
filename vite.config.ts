import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: false },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // `three` is ~600 kB and changes on its own schedule; keeping it in a
        // separate chunk lets repeat visits reuse it while app code updates.
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
})
