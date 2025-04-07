const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Create cache directory
const cacheDir = path.join(__dirname, '.cache', 'puppeteer');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

console.log('Installing Chrome for Puppeteer...');
try {
  // Install Chrome browser for Puppeteer
  execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
  console.log('Chrome installation successful!');
} catch (error) {
  console.error('Chrome installation failed:', error);
  // Continue even if installation fails, as we have fallback options in the code
}

console.log('Build process completed!'); 