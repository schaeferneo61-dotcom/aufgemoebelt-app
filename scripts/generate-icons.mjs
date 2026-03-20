/**
 * Generiert SVG-Icons für die PWA.
 * Ausführen mit: node scripts/generate-icons.mjs
 */

import { writeFileSync } from 'fs'

const svgIcon = (size, rx) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#000000" rx="${rx}"/>
  <circle cx="${size/2}" cy="${size/2}" r="${size*0.43}" stroke="white" stroke-width="${size*0.025}" fill="none"/>
  <text x="${size/2}" y="${size*0.68}" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="${size*0.5}" fill="white">a</text>
</svg>`

writeFileSync('public/icon-192.svg', svgIcon(192, 24))
writeFileSync('public/icon-512.svg', svgIcon(512, 64))

console.log('✓ SVG Icons erstellt: public/icon-192.svg + public/icon-512.svg')
