/**
 * Generate logo files from newLogo.png
 * - logo.png  → 512x512 (Linux + in-app)
 * - logo.ico  → multi-size ICO for Windows (16,32,48,64,128,256)
 *
 * Usage: node scripts/generate-icons.mjs
 */

import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const src = path.join(root, 'newLogo.png')

async function squarePng(inputPath, size) {
  // Resize keeping aspect ratio, then extend to square with white background
  return sharp(inputPath)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .png()
    .toBuffer()
}

async function main() {
  // 1. logo.png — 512x512
  const png512 = await squarePng(src, 512)
  fs.writeFileSync(path.join(root, 'logo.png'), png512)
  console.log('✓ logo.png  (512x512)')

  // 2. logo.ico — sizes: 16, 32, 48, 64, 128, 256
  const icoSizes = [16, 32, 48, 64, 128, 256]
  const icoBuffers = await Promise.all(icoSizes.map((s) => squarePng(src, s)))
  const icoBuffer = await pngToIco(icoBuffers)
  fs.writeFileSync(path.join(root, 'logo.ico'), icoBuffer)
  console.log('✓ logo.ico  (16/32/48/64/128/256)')

  console.log('\nDone! logo.png and logo.ico have been updated.')
  console.log('Note: logo.icns (macOS) requires macOS tools (iconutil). Build on Mac or use CI.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
