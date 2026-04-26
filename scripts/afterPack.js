const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function (context) {
  const appOutDir = context.appOutDir;
  const resourcesPath = path.join(appOutDir, 'resources');
  const appPath = path.join(resourcesPath, 'app');
  
  console.log('afterPack: Rebuilding native modules for', context.targetPlatform);
  
  try {
    // Rebuild better-sqlite3 for the target platform
    execSync(
      `electron-rebuild -f -w better-sqlite3 -a x64 -p "${appPath}"`,
      { 
        stdio: 'inherit',
        cwd: appPath 
      }
    );
    console.log('afterPack: Native modules rebuilt successfully');
  } catch (error) {
    console.error('afterPack: Failed to rebuild native modules:', error.message);
    // Don't fail the entire build, just warn
  }
};
