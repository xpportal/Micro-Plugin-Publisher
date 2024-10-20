const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');

const sourceDirectory = process.cwd();
const buildDirectory = path.join(sourceDirectory, 'plugin-build', 'zip');
const distignorePath = path.join(sourceDirectory, '.distignore');

// Ensure the build directory exists
fs.ensureDirSync(buildDirectory);

// Read .distignore file
let ignorePatterns = [];
if (fs.existsSync(distignorePath)) {
    ignorePatterns = fs.readFileSync(distignorePath, 'utf8')
        .split('\n')
        .filter(line => line.trim() !== '' && !line.startsWith('#'));
}

// Function to check if a file should be ignored
function shouldIgnore(filePath) {
    const relativePath = path.relative(sourceDirectory, filePath);
    return ignorePatterns.some(pattern => {
        if (pattern.endsWith('/')) {
            return relativePath.startsWith(pattern);
        }
        return relativePath === pattern || relativePath.startsWith(pattern + path.sep);
    });
}

// Function to recursively add files to zip
function addFilesToZip(zip, currentPath) {
    const files = fs.readdirSync(currentPath);
    for (const file of files) {
        const filePath = path.join(currentPath, file);
        const stat = fs.statSync(filePath);

        if (shouldIgnore(filePath)) {
            continue;
        }

        if (stat.isDirectory()) {
            addFilesToZip(zip, filePath);
        } else {
            const relativePath = path.relative(sourceDirectory, filePath);
            zip.addLocalFile(filePath, path.dirname(relativePath));
        }
    }
}

// Create a new zip file
const pluginName = path.basename(sourceDirectory);
const zipFileName = `${pluginName}.zip`;
const zip = new AdmZip();

// Add files to zip
addFilesToZip(zip, sourceDirectory);

// Write the zip file
const zipFilePath = path.join(buildDirectory, zipFileName);
zip.writeZip(zipFilePath);

console.log(`Plugin packaged successfully: ${zipFilePath}`);