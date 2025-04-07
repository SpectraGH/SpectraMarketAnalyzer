/**
 * @type {import('puppeteer').Configuration}
 */
module.exports = {
  // Changes the cache location for Puppeteer
  cacheDirectory: './.cache/puppeteer',
  
  // Use system chrome installation if available
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  
  // Configure browser installation
  browserRevision: '134.0.6998.165'
}; 