import * as LocalMain from '@getflywheel/local/main';
import { addIpcAsyncListener } from '@getflywheel/local/main';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { IPC_EVENTS, STORE_KEYS } from './constants';
import * as Electron from 'electron';
import os from 'os';

interface StoreSchema {
  apiKey?: string;
  token?: string;
  userID?: string;
  access_token?: string;
  refresh_token?: string;
  tokenExpiryTime?: string;
}

class SimpleStore {
  private data: Partial<StoreSchema> = {};
  
  get(key: string): any {
    return this.data[key as keyof StoreSchema];
  }
  
  set(key: string, value: any): void {
    this.data[key as keyof StoreSchema] = value;
  }
  
  delete(key: string): void {
    delete this.data[key as keyof StoreSchema];
  }
}

const store = new SimpleStore();

export default function (context: LocalMain.AddonMainContext): void {
  const { electron } = context;
  const { ipcMain } = electron;

  console.log('[MAIN] Starting initialization of JSON Validator and Plugin Uploader addon');

  const isTokenExpired = () => {
    const expiryTime = store.get(STORE_KEYS.TOKEN_EXPIRY_TIME);
    if (!expiryTime) return true;
    const expires = new Date(expiryTime).getTime();
    return new Date().getTime() > expires;
  };

  const refreshToken = async () => {
    try {
      const refreshToken = store.get(STORE_KEYS.REFRESH_TOKEN);
      if (!refreshToken) throw new Error('No refresh token available');

      const response = await axios.post('https://cfdb.sxpdigital.workers.dev/refresh', { 
        refresh_token: refreshToken,
        apiKey: store.get(STORE_KEYS.API_KEY)
      });

      if (response.data.token) {
        store.set(STORE_KEYS.TOKEN, response.data.token);
        store.set(STORE_KEYS.ACCESS_TOKEN, response.data.access_token);
        store.set(STORE_KEYS.REFRESH_TOKEN, response.data.refresh_token);
        const expiryTime = new Date(new Date().getTime() + 60 * 60 * 1000).toString(); // 1 hour from now
        store.set(STORE_KEYS.TOKEN_EXPIRY_TIME, expiryTime);
        return true;
      } else {
        throw new Error('Token refresh failed');
      }
    } catch (error) {
      console.error(`Token refresh error: ${error}`);
      return false;
    }
  };


const unslashit = (string: string): string => {
	if (typeof string !== 'string') {
		return string;
	}

	return string.replace(/\/+$/, '').replace(/\\+$/, '');
};


	const formatHomePath = (string: string, untrailingslashit = true): string => {
		if (typeof string !== 'string') {
			return string;
		}

		const homedir = os.homedir();

		let output = string.replace(/^~\//, `${homedir}/`).replace(/^~\\/, `${homedir}\\`);

		if (untrailingslashit) {
			output = unslashit(output);
		}

		return output;
	};


  addIpcAsyncListener(IPC_EVENTS.VALIDATE_JSON, async ({ pluginName, jsonPath }) => {
    console.log(`Fetching JSON content for plugin: ${pluginName} and json path: ${jsonPath}`);
    const sitePath = formatHomePath('~/Local Sites');
    try {
      const jsonFilePath = path.join(sitePath, pluginName, 'app', 'public', 'wp-content', 'plugins', pluginName, jsonPath);
      
      if (!fs.existsSync(jsonFilePath)) {
        throw new Error(`JSON file not found: ${jsonFilePath}`);
      }
    
      const fileContent = await fs.readFile(jsonFilePath, 'utf8');
      console.log('JSON content fetched successfully');
      return { success: true, content: fileContent };
    } catch (error) {
      console.error(`Error fetching JSON content: ${error}`);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error), 
        jsonFilePath: path.join(sitePath, 'app', 'public', 'wp-content', 'plugins', pluginName, jsonPath)
      };
    }
  });

addIpcAsyncListener(IPC_EVENTS.LOGIN, async ({ email, password }) => {
  console.log('[MAIN] Received login event');
  try {
    const response = await axios.post('https://cfdb.sxpdigital.workers.dev/login', { 
      email, 
      password,
      apiKey: store.get(STORE_KEYS.API_KEY)
    });

    if (response.data.access_token) {
      store.set(STORE_KEYS.ACCESS_TOKEN, response.data.access_token);
      store.set(STORE_KEYS.USER_ID, response.data.userID);
      store.set(STORE_KEYS.REFRESH_TOKEN, response.data.refresh_token);
      const expiryTime = new Date(new Date().getTime() + 60 * 60 * 1000).toString(); // 1 hour from now
      store.set(STORE_KEYS.TOKEN_EXPIRY_TIME, expiryTime);
      console.log('[MAIN] Login successful');
      return { success: true };
    } else {
      throw new Error('Login failed: No access token received');
    }
  } catch (error) {
    console.error('[MAIN] Login error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

  addIpcAsyncListener(IPC_EVENTS.LOGOUT, () => {
    console.log('Logging out user');
    store.delete(STORE_KEYS.TOKEN);
    store.delete(STORE_KEYS.USER_ID);
    store.delete(STORE_KEYS.ACCESS_TOKEN);
    store.delete(STORE_KEYS.REFRESH_TOKEN);
    store.delete(STORE_KEYS.TOKEN_EXPIRY_TIME);
    return { success: true };
  });

  addIpcAsyncListener(IPC_EVENTS.GET_AUTH_STATUS, () => {
    const isLoggedIn = !!store.get(STORE_KEYS.TOKEN) && !isTokenExpired();
    console.log(`Getting auth status. Is logged in: ${isLoggedIn}`);
    return {
      isLoggedIn,
      userID: store.get(STORE_KEYS.USER_ID)
    };
  });

  addIpcAsyncListener(IPC_EVENTS.READ_ZIP_FILE, async ({ zipPath }) => {
	try {
	  console.log(`Attempting to read ZIP file from: ${zipPath}`);
	  const zipContent = await fs.readFile(zipPath);
	  console.log(`Successfully read ZIP file of size: ${zipContent.length} bytes`);
	  return { success: true, content: zipContent.toString('base64') };
	} catch (error) {
	  console.error(`Error reading ZIP file from ${zipPath}:`, error);
	  return { 
		success: false, 
		error: error instanceof Error ? error.message : String(error),
		details: {
		  path: zipPath,
		  exists: await fs.exists(zipPath),
		  isFile: await fs.exists(zipPath) ? (await fs.stat(zipPath)).isFile() : false
		}
	  };
	}
  });
  
  addIpcAsyncListener(IPC_EVENTS.READ_JSON_FILE, async ({ jsonPath }) => {
	try {
	  console.log(`Attempting to read JSON file from: ${jsonPath}`);
	  const jsonContent = await fs.readFile(jsonPath, 'utf8');
	  console.log(`Successfully read JSON file of length: ${jsonContent.length} characters`);
	  return { success: true, content: jsonContent };
	} catch (error) {
	  console.error(`Error reading JSON file from ${jsonPath}:`, error);
	  return { 
		success: false, 
		error: error instanceof Error ? error.message : String(error),
		details: {
		  path: jsonPath,
		  exists: await fs.exists(jsonPath),
		  isFile: await fs.exists(jsonPath) ? (await fs.stat(jsonPath)).isFile() : false
		}
	  };
	}
  });

  addIpcAsyncListener(IPC_EVENTS.UPLOAD_PLUGIN, async ({ pluginName, zipFile, jsonFile, metadata }) => {
	try {
	  console.log('Received upload request for plugin:', pluginName);
	  console.log('ZIP file size:', zipFile ? zipFile.length : 'undefined');
	  console.log('JSON file size:', jsonFile ? jsonFile.length : 'undefined');
	  console.log('Metadata:', metadata);
  
	  const token = store.get(STORE_KEYS.ACCESS_TOKEN);
	  if (!token) {
		throw new Error('Not authenticated');
	  }
  
	  if (!pluginName || !zipFile || !jsonFile || !metadata) {
		throw new Error('Missing required upload data');
	  }
  
	  // Upload ZIP file in chunks
	  const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
	  const totalChunks = Math.ceil(zipFile.length / CHUNK_SIZE);
	  
	  console.log(`Total chunks calculated: ${totalChunks}`);
	  
	  for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
		const start = (chunkNumber - 1) * CHUNK_SIZE;
		const end = Math.min(start + CHUNK_SIZE, zipFile.length);
		const chunk = zipFile.slice(start, end);
	
		console.log(`Preparing ZIP chunk ${chunkNumber}/${totalChunks}, start: ${start}, end: ${end}, size: ${chunk.length} bytes`);
		const base64Chunk = chunk.toString('base64');
	
		console.log(`Uploading ZIP chunk ${chunkNumber}/${totalChunks}`);
		const zipResponse = await axios.post('https://cfdb.sxpdigital.workers.dev/plugin-upload-chunk', {
		  pluginName,
		  fileData: base64Chunk,
		  chunkNumber,
		  totalChunks,
		  isJson: false
		}, {
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${token}`,
		  }
		});
	
		console.log(`ZIP chunk ${chunkNumber} upload response:`, zipResponse.data);
	
		if (!zipResponse.data.success) {
		  throw new Error(`Failed to upload zip chunk ${chunkNumber}: ${zipResponse.data.error || 'Unknown error'}`);
		}
  
		// Send progress update to renderer
		Electron.BrowserWindow.getAllWindows()[0].webContents.send('upload-progress', {
		  step: 4,
		  totalSteps: 4,
		  chunkNumber,
		  totalChunks
		});
	  }
  
	  // Upload JSON file
	  console.log('Uploading JSON file...');
	  const jsonResponse = await axios.post('https://cfdb.sxpdigital.workers.dev/plugin-upload-json', {
		pluginName,
		jsonData: jsonFile,
	  }, {
		headers: {
		  'Content-Type': 'application/json',
		  'Authorization': `Bearer ${token}`,
		}
	  });
  
	  console.log('JSON upload response:', jsonResponse.data);
  
	  if (!jsonResponse.data.success) {
		throw new Error('Failed to upload JSON file: ' + (jsonResponse.data.error || 'Unknown error'));
	  }
  
	  // Finalize upload
	  console.log('Finalizing upload...');
	  const finalizeResponse = await axios.post('https://cfdb.sxpdigital.workers.dev/plugin-upload-complete', {
		pluginName,
		zipFileSize: zipFile.length,
		metadata,
	  }, {
		headers: {
		  'Content-Type': 'application/json',
		  'Authorization': `Bearer ${token}`,
		}
	  });
  
	  console.log('Finalize response:', finalizeResponse.data);
  
	  if (finalizeResponse.data.success) {
		return { 
		  success: true, 
		  zipUrl: finalizeResponse.data.zipUrl, 
		  metadataUrl: finalizeResponse.data.metadataUrl 
		};
	  } else {
		throw new Error('Failed to finalize plugin upload: ' + (finalizeResponse.data.error || 'Unknown error'));
	  }
	} catch (error) {
	  console.error('Plugin upload error:', error);
	  if (axios.isAxiosError(error)) {
		console.error('Axios error details:', error.response?.data);
	  }
	  return { success: false, error: error instanceof Error ? error.message : String(error) };
	}
  });
	
  console.log('[MAIN] JSON Validator and Plugin Uploader addon initialized');
}
