import * as LocalMain from '@getflywheel/local/main';
import { addIpcAsyncListener, formatHomePath } from '@getflywheel/local/main';
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import { IPC_EVENTS } from './constants';
import * as Electron from 'electron';

const { wpCli, localLogger, siteData } = LocalMain.getServiceContainer().cradle;

const logger = localLogger.child({
	thread: "main",
	addon: "repo-plugin-uploader",
});

export default function (context: LocalMain.AddonMainContext): void {
	const logger = localLogger.child({
		thread: "main",
		addon: "repo-plugin-uploader",
	});
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

	addIpcAsyncListener(IPC_EVENTS.SCAFFOLD_PLUGIN, async ({
		pluginName,
		pluginSlug,
		pluginDescription,
		pluginVersion,
		pluginUri,
		requiresWp,
		requiresPhp,
		authorName,
		authorUri,
		license,
		licenseUri,
		textDomain,
		domainPath,
	}) => {
		try {
			const site = await siteData.getSiteByProperty('name', pluginName);

			if (!site) {
				throw new Error(`Site with name ${pluginName} not found`);
			}

			// Use WP-CLI to scaffold the plugin with supported parameters
			const scaffoldCommand = [
				'scaffold',
				'plugin',
				pluginSlug,
				`--plugin_name=${pluginName}`,
				`--plugin_description=${pluginDescription}`,
				`--plugin_author=${authorName}`,
				`--plugin_author_uri=${authorUri}`,
				`--plugin_uri=${pluginUri}`,
				'--activate'
			];

			const scaffoldResult = await wpCli.run(site, scaffoldCommand);
			logger.info('Scaffold result:', scaffoldResult);

			// Define paths
			const pluginDir = path.join(site.paths.webRoot, 'wp-content', 'plugins', pluginSlug);
			const mainPluginFile = path.join(pluginDir, `${pluginSlug}.php`);
			const readmeFile = path.join(pluginDir, 'readme.txt');

			// Copy the upgrader file
			const upgraderSourcePath = path.join(__dirname, '..', 'examples', 'class-example-upgrader.php');
			const upgraderDestPath = path.join(pluginDir, 'class-example-upgrader.php');
			await fs.copy(upgraderSourcePath, upgraderDestPath);

			// Copy the package.js file from the add-on's examples folder to the plugin directory
			const packageJsSourcePath = path.join(__dirname, '..', 'examples', 'package.js');
			const packageJsDestPath = path.join(pluginDir, 'package.js');
			await fs.copy(packageJsSourcePath, packageJsDestPath);

			// Update or create package.json
			const packageJsonPath = path.join(pluginDir, 'package.json');
			let packageJson: any = {};
			if (await fs.exists(packageJsonPath)) {
				packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
			}

			packageJson = {
				...packageJson,
				scripts: {
					...(packageJson.scripts || {}),
					build: "node package.js"
				},
				dependencies: {
					...(packageJson.dependencies || {}),
					"fs-extra": "^10.1.0",
					"adm-zip": "^0.5.9"
				}
			};

			await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });


			// Create plugin-build directory and subdirectories
			const pluginBuildDir = path.join(pluginDir, 'plugin-build');
			await fs.ensureDir(pluginBuildDir);
			await fs.ensureDir(path.join(pluginBuildDir, 'json'));
			await fs.ensureDir(path.join(pluginBuildDir, 'zip'));
			await fs.ensureDir(path.join(pluginBuildDir, 'assets'));

			// Create empty .env file
			await fs.writeFile(path.join(pluginDir, '.env'), '');

			// Read the generated main plugin file
			let mainPluginContent = await fs.readFile(mainPluginFile, 'utf8');

			// check if there is a .gitignore file if there is, add the plugin-build dir and the .env file to the end
			const gitIgnoreFile = path.join(pluginDir, '.gitignore');
			if (await fs.exists(gitIgnoreFile)) {
				let gitIgnoreContent = await fs.readFile(gitIgnoreFile, 'utf8');
				gitIgnoreContent += `\nplugin-build/\n.env\n`;
				await fs.writeFile(gitIgnoreFile, gitIgnoreContent);
			}

			// check for a .distignore file if there is, add the plugin-build dir and the .env file to the end
			const distIgnoreFile = path.join(pluginDir, '.distignore');
			if (await fs.exists(distIgnoreFile)) {
				let distIgnoreContent = await fs.readFile
					(distIgnoreFile, 'utf8');
				distIgnoreContent += `plugin-build\n.env\npackage.js\n`;
				await fs.writeFile(distIgnoreFile, distIgnoreContent);
			}

			// clear the file
			await fs.writeFile(mainPluginFile, '');

			// Update the plugin header with additional information
			const pluginHeader = `<?php
  /**
   * Plugin Name: ${pluginName}
   * Plugin URI: ${pluginUri}
   * Description: ${pluginDescription}
   * Version: ${pluginVersion}
   * Requires at least: ${requiresWp}
   * Requires PHP: ${requiresPhp}
   * Author: ${authorName}
   * Author URI: ${authorUri}
   * License: ${license}
   * License URI: ${licenseUri}
   * Text Domain: ${textDomain}
   * Domain Path: ${domainPath}
   */
  `;

			mainPluginContent = pluginHeader;

			// Append the upgrader class inclusion and initialization code
			const updaterCode = `
  // Include the Upgrader class
  require_once plugin_dir_path(__FILE__) . 'class-example-upgrader.php';
  
  function initialize_Micro_Plugin_Publisher_Updater() {
	  $plugin_slug = '${pluginSlug}';
	  $plugin_name = plugin_basename(__FILE__);
	  $version = '${pluginVersion}';
	  $metadata_url = 'https://plugins.sxp.digital/e188bdf1-1cad-4a40-b8d8-fa2a354beea0/${pluginSlug}/${pluginSlug}.json';
	  $zip_url = 'https://plugins.sxp.digital/e188bdf1-1cad-4a40-b8d8-fa2a354beea0/${pluginSlug}/${pluginSlug}.zip';
	  new microUpgrader\\Micro_Plugin_Publisher_Updater($plugin_slug, $plugin_name, $version, $metadata_url, $zip_url);
  }
  add_action('init', 'initialize_Micro_Plugin_Publisher_Updater');
  `;

			mainPluginContent += updaterCode;

			// Write the updated main plugin file
			await fs.writeFile(mainPluginFile, mainPluginContent);

			// Update readme.txt
			let readmeContent = await fs.readFile(readmeFile, 'utf8');
			readmeContent = readmeContent.replace(
				/=== .+ ===\n/,
				`=== ${pluginName} ===\n`
			);
			readmeContent = readmeContent.replace(
				/Contributors: .+\n/,
				`Contributors: ${authorName.toLowerCase().replace(/\s+/g, '')}\n`
			);
			readmeContent = readmeContent.replace(
				/Requires at least: .+\n/,
				`Requires at least: ${requiresWp}\n`
			);
			readmeContent = readmeContent.replace(
				/Requires PHP: .+\n/,
				`Requires PHP: ${requiresPhp}\n`
			);
			readmeContent = readmeContent.replace(
				/License: .+\n/,
				`License: ${license}\n`
			);
			readmeContent = readmeContent.replace(
				/License URI: .+\n/,
				`License URI: ${licenseUri}\n`
			);
			await fs.writeFile(readmeFile, readmeContent);

			return {
				success: true,
				message: 'Plugin scaffolded successfully with additional setup',
				mainPluginContent,
				readmeContent
			};
		} catch (error) {
			logger.error('Error scaffolding plugin:', error);
			// if error contains the string "Command failed" then the error is from the wp-cli command, let the user know it is likely that they dont have their environment turned on
			if (error.message.includes('Command failed')) {
				return {
					success: false,
					error: 'Failed to scaffold plugin. Make sure your Local environment is running.',
				};
			} else {
				return { success: false, error: error.message };
			}
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
