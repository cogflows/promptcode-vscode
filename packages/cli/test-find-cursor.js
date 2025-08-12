const path = require('path');
const fs = require('fs');

function findCursorFolder(startPath) {
  let currentPath = path.resolve(startPath);
  const root = path.parse(currentPath).root;
  
  console.log('Starting search from:', currentPath);
  console.log('Root is:', root);
  
  while (currentPath \!== root) {
    const cursorPath = path.join(currentPath, '.cursor');
    console.log('Checking:', cursorPath);
    if (fs.existsSync(cursorPath) && fs.statSync(cursorPath).isDirectory()) {
      console.log('Found at:', cursorPath);
      return cursorPath;
    }
    
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }
  
  console.log('Not found');
  return null;
}

const testPath = 'test-cursor-integration';
console.log('Test path:', testPath);
findCursorFolder(testPath);
