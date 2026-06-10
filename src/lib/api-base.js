// In packaged Electron the page is loaded from file:// — relative /api/* fetches won't work.
// In Vite dev (http://localhost:5173) relative paths work fine via Vite's middleware.
export const API_BASE =
  typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? 'http://localhost:3847'
    : ''
