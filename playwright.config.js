import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', workers: 1, use: { baseURL: 'http://127.0.0.1:5173' }, webServer: { command: 'npm.cmd run dev -- --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: true } });
