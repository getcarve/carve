import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './copilot.css'

const root = document.querySelector('#root')
if (!root) throw new Error('Carve root element is missing')
if (window.stewardDesktop) document.body.classList.add('desktop')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
