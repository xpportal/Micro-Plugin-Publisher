import * as LocalMain from '@getflywheel/local/main';
import { addIpcAsyncListener, formatHomePath } from '@getflywheel/local/main';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { IPC_EVENTS } from './constants';
import * as Electron from 'electron';

const { localLogger } = LocalMain.getServiceContainer().cradle;

const logger = localLogger.child({
  thread: "main",
  addon: "repo-plugin-uploader",
});

export default function (context: LocalMain.AddonMainContext): void {
  const { electron } = context;
  const { ipcMain } = electron;

  logger.info('Starting initialization of Repo Plugin Uploader addon');

  const makeApiCall = async (endpoint: string, method: string, data: any = null) => {
    const url = `${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${data.apiKey}`,
    };
 
    try {
      let response;
      switch (method.toUpperCase()) {
        case 'GET':
          response = await axios.get(url, { headers, params: data });
          break;
        case 'POST':
          response = await axios.post(url, data, { headers });
          break;
        case 'PUT':
          response = await axios.put(url, data, { headers });
          break;
        case 'DELETE':
          response = await axios.delete(url, { headers, data });
          break;
        default:
          throw new Error(`Unsupported HTTP method: ${method}`);
      }
      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Server responded with ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        throw new Error('No response received from server');
      } else {
        logger.info(`Error setting up request: ${error.message} ${data.apiUrl} ${data.apiKey}`);
        throw new Error(`Error setting up request: ${error.message}`);
      }
    }
  };
	  
  addIpcAsyncListener(IPC_EVENTS.VALIDATE_JSON, async ({ pluginName, jsonPath }) => {
    logger.info(`Fetching JSON content for plugin: ${pluginName} and json path: ${jsonPath}`);
    const sitePath = formatHomePath('~/Local Sites');
    try {
      const jsonFilePath = path.join(sitePath, pluginName, 'app', 'public', 'wp-content', 'plugins', pluginName, jsonPath);

      if (!fs.existsSync(jsonFilePath)) {
        throw new Error(`JSON file not found: ${jsonFilePath}`);
      }

      const fileContent = await fs.readFile(jsonFilePath, 'utf8');
      logger.info('JSON content fetched successfully');
      return { success: true, content: fileContent };
    } catch (error) {
      logger.error(`Error fetching JSON content: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        jsonFilePath: path.join(sitePath, 'app', 'public', 'wp-content', 'plugins', pluginName, jsonPath),
      };
    }
  });

  addIpcAsyncListener(IPC_EVENTS.UPLOAD_CHUNK, async ({ pluginName, fileData, chunkNumber, totalChunks, apiKey, apiUrl }) => {
    try {
      const response = await makeApiCall('/plugin-upload-chunk', 'POST', {
			pluginName,
			fileData,
			chunkNumber,
			totalChunks,
			apiUrl,
			apiKey,
		});

      if (!response.success) {
        throw new Error(response.error || 'Failed to upload chunk');
      }

      return { success: true, message: 'Chunk uploaded successfully' };
    } catch (error) {
      logger.error('Chunk upload error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  addIpcAsyncListener(IPC_EVENTS.READ_ZIP_FILE, async ({ zipPath }) => {
	try {
  logger.info(`Attempting to read ZIP file from: ${zipPath}`);
  const zipContent = await fs.readFile(zipPath);
  logger.info(`Successfully read ZIP file of size: ${zipContent.length} bytes`);
  return { success: true, content: zipContent.toString('base64') };
	} catch (error) {
  logger.error(`Error reading ZIP file from ${zipPath}:`, error);
  return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			details: {
	  path: zipPath,
	  exists: await fs.exists(zipPath),
	  isFile: await fs.exists(zipPath) ? (await fs.stat(zipPath)).isFile() : false,
			},
  };
	}
});

addIpcAsyncListener(IPC_EVENTS.READ_JSON_FILE, async ({ jsonPath }) => {
	try {
  logger.info(`Attempting to read JSON file from: ${jsonPath}`);
  const jsonContent = await fs.readFile(jsonPath, 'utf8');
  logger.info(`Successfully read JSON file of length: ${jsonContent.length} characters`);
  return { success: true, content: jsonContent };
	} catch (error) {
  logger.error(`Error reading JSON file from ${jsonPath}:`, error);
  return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
			details: {
	  path: jsonPath,
	  exists: await fs.exists(jsonPath),
	  isFile: await fs.exists(jsonPath) ? (await fs.stat(jsonPath)).isFile() : false,
			},
  };
	}
});

addIpcAsyncListener(IPC_EVENTS.UPDATE_JSON_FILE, async ({ pluginName, jsonFilePath, userId, BUCKET_URL }) => {
	try {
	  const sitePath = formatHomePath('~/Local Sites');
	  const fullJsonPath = path.join(sitePath, pluginName, 'app', 'public', 'wp-content', 'plugins', pluginName, jsonFilePath);
	  
	  logger.info(`Updating JSON file at: ${fullJsonPath}`);
  
	  // Read the current JSON file
	  const currentJsonContent = await fs.readFile(fullJsonPath, 'utf8');
	  let jsonData = JSON.parse(currentJsonContent);
  
	  if (!Array.isArray(jsonData) || jsonData.length === 0) {
		throw new Error('Invalid JSON structure: expected a non-empty array');
	  }
  
	  // Update only the necessary fields in the first object of the array
	  jsonData[0] = {
		...jsonData[0],
		download_link: `${BUCKET_URL}/${userId}/${pluginName}/${pluginName}.zip`,
		banner: `${BUCKET_URL}/${userId}/${pluginName}/banner-1500x620.jpg`,
		icons: {
		  "1x": `${BUCKET_URL}/${userId}/${pluginName}/icon-256x256.jpg`,
		  "2x": `${BUCKET_URL}/${userId}/${pluginName}/icon-256x256.jpg`
		},
		author_profile: `https://app.xr.foundation/plugins/${userId}`,
		contributors: {
		  [jsonData[0].author]: {
			profile: `https://app.xr.foundation/plugins/${userId}`,
			avatar: jsonData[0].contributors?.[jsonData[0].author]?.avatar || '',
			display_name: jsonData[0].author
		  }
		},
		last_updated: new Date().toISOString(),
		added: jsonData[0].added || new Date().toISOString().split('T')[0]
	  };
  
	  // Write the updated JSON data back to the file
	  await fs.writeJson(fullJsonPath, jsonData, { spaces: 2 });
	  logger.info('JSON file updated successfully');
	  return { success: true, updatedData: jsonData[0] };
	} catch (error) {
	  logger.error(`Error updating JSON file: ${error}`);
	  return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
  });
	
addIpcAsyncListener(IPC_EVENTS.UPLOAD_PLUGIN, async ({ userId, pluginName, zipFile, jsonFile, metadata, assetsPath, authorData, apiKey, apiUrl }) => {
    try {
      // Step 1: Upload ZIP file in chunks
      const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
      const totalChunks = Math.ceil(zipFile.length / CHUNK_SIZE);

      for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
        const start = (chunkNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, zipFile.length);
        const chunk = zipFile.slice(start, end);

        const base64Chunk = chunk.toString('base64');
        logger.info(`Uploading chunk ${chunkNumber} of ${totalChunks} for plugin ${pluginName}`);
        const chunkResponse = await makeApiCall(`${apiUrl}/plugin-upload-chunk`, 'POST', {
          userId,
          pluginName,
          fileData: base64Chunk,
          chunkNumber,
          totalChunks,
          apiUrl,
          apiKey,
        });

        if (!chunkResponse.success) {
          throw new Error(`Failed to upload zip chunk ${chunkNumber}: ${chunkResponse.error || 'Unknown error'}`);
        }

        Electron.BrowserWindow.getAllWindows()[0].webContents.send('upload-progress', {
          step: 1,
          totalSteps: 5,
          chunkNumber,
          totalChunks,
        });
      }
	  logger.info(`Json file: ${jsonFile}`);
      // Step 2: Upload JSON file
      const jsonResponse = await makeApiCall(`${apiUrl}/plugin-upload-json`, 'POST', {
        userId,
        pluginName,
        jsonData: jsonFile,
        apiUrl,
        apiKey,
      });

      if (!jsonResponse.success) {
        throw new Error('Failed to upload JSON file: ' + (jsonResponse.error || 'Unknown error'));
      }

      Electron.BrowserWindow.getAllWindows()[0].webContents.send('upload-progress', {
        step: 2,
        totalSteps: 5,
      });

      // Step 3: Update author info
      const authorInfoResponse = await makeApiCall(`${apiUrl}/update-author-info`, 'POST', {
        userId,
        pluginName,
        authorData,
        apiUrl,
        apiKey,
      });

      if (!authorInfoResponse.success) {
        throw new Error('Failed to update author info: ' + (authorInfoResponse.error || 'Unknown error'));
      }

      Electron.BrowserWindow.getAllWindows()[0].webContents.send('upload-progress', {
        step: 3,
        totalSteps: 5,
      });

      // Step 4: Upload assets
      const assetFiles = ['banner-1500x620.jpg', 'icon-256x256.jpg'];
      const uploadedAssets = [];
	  logger.info(`Assets path: ${assetsPath}`);
      for (let i = 0; i < assetFiles.length; i++) {
        const assetFile = assetFiles[i];
        const filePath = path.join(assetsPath, assetFile);

        if (!fs.existsSync(filePath)) {
          continue;
        }

        const fileContent = await fs.readFile(filePath);
        const base64Content = fileContent.toString('base64');

        const assetResponse = await makeApiCall(`${apiUrl}/plugin-upload-assets`, 'POST', {
          userId,
          pluginName,
          fileName: assetFile,
          fileData: base64Content,
          apiUrl,
          apiKey,
        });

        if (!assetResponse.success) {
          throw new Error(`Failed to upload asset ${assetFile}: ${assetResponse.error || 'Unknown error'}`);
        }

        uploadedAssets.push(assetResponse.assetUrl);

        Electron.BrowserWindow.getAllWindows()[0].webContents.send('upload-progress', {
          step: 4,
          totalSteps: 5,
          chunkNumber: i + 1,
          totalChunks: assetFiles.length,
        });
      }

      // Step 5: Finalize upload
      const finalizeResponse = await makeApiCall(`${apiUrl}/plugin-upload-complete`, 'POST', {
        userId,
        pluginName,
        zipFileSize: zipFile.length,
        metadata,
        apiUrl,
        apiKey,
      });

      Electron.BrowserWindow.getAllWindows()[0].webContents.send('upload-progress', {
        step: 5,
        totalSteps: 5,
      });

      if (finalizeResponse.success) {
        return {
          success: true,
          zipUrl: finalizeResponse.zipUrl,
          metadataUrl: finalizeResponse.metadataUrl,
          assetsUrl: uploadedAssets,
        };
      }
      throw new Error('Failed to finalize plugin upload: ' + (finalizeResponse.error || 'Unknown error'));

    } catch (error) {
      logger.error('Plugin upload error:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  logger.info('Repo Plugin Uploader addon initialized');
}
