import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        electron([
            {
                entry: 'electron/main.ts',
                onstart(args) {
                    args.startup()
                },
                vite: {
                    build: {
                        rollupOptions: {
                            external: ['electron', 'better-sqlite3'],
                        },
                    },
                },
            },
            {
                entry: 'electron/preload.ts',
                onstart(args) {
                    args.reload()
                },
            },
        ]),
    ],
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        outDir: 'dist',
    },
})
