import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// PWA service worker registration (vite-plugin-pwa)
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // App update available
    const ok = window.confirm('Nova versão disponível. Atualizar agora?')
    if (ok) updateSW(true)
  },
  onOfflineReady() {
    // Cached for offline usage
    console.log('App pronto para uso offline.')
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
