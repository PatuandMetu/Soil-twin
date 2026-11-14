import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages(프로젝트 페이지)에 올릴 때: BASE_PATH=/<repo이름>/ npm run build
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
