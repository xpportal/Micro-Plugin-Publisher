import React, { useState, useCallback, useEffect } from 'react';
import * as Local from '@getflywheel/local';
import { ipcAsync } from '@getflywheel/local/renderer';
import { Button, Title, Text, BasicInput, Divider, CopyInput, ProgressBar, FlyModal, FlyTooltip, Checkbox } from '@getflywheel/local-components';
import { IPC_EVENTS } from './constants';
import path from 'path';
import fs from 'fs-extra';
import ScaffoldModal from './ScaffoldModal';
import JSONEditorModal from './JSONEditorModal';
import dotenv from 'dotenv';
import os from 'os';

// Add this utility function at the top level of your component
const expandHomeDir = (filepath) => {
	if (!filepath) return filepath;
	if (filepath.startsWith('~/') || filepath === '~') {
		return filepath.replace('~', os.homedir());
	}
	return filepath;
};


const { ipcRenderer } = window.require('electron');

const RepoPluginUploader = (data) => {
	console.log("MY SITE", data);
	const [uploadProgress, setUploadProgress] = useState({ step: 0, totalSteps: 5, chunkNumber: 0, totalChunks: 0 });
	// @todo Add author pages.
	// const [pluginPageUrl, setPluginPageUrl] = useState('');
	// const [authorPageUrl, setAuthorPageUrl] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [apiUrl, setApiUrl] = useState('');
	const [bucketUrl, setBucketUrl] = useState('');
	const [jsonUpdateStatus, setJsonUpdateStatus] = useState('');
	const [showJsonEditorModal, setShowJsonEditorModal] = useState(false);
	const [forceUpload, setForceUpload] = useState(false);

	const [showScaffoldModal, setShowScaffoldModal] = useState(false);
	// console.log("this is the site object", data.site);
	const [scaffoldData, setScaffoldData] = useState({
		pluginName: data.site.name,
		pluginDescription: '',
		authorName: '',
		authorSite: '',
		site: data.site.name,
	});
	const [scaffoldError, setScaffoldError] = useState('');

	const toggleScaffoldModal = useCallback(() => {
		setShowScaffoldModal(prevState => !prevState);
		setScaffoldError('');
	}, []);

	const handleScaffoldInputChange = useCallback((e, key) => {
		const value = e.target.value;
		setScaffoldData(prevState => ({
			...prevState,
			[key]: value,
		}));
	}, []);

	const handleScaffoldSuccess = (scaffoldData) => {
		console.log('Plugin scaffolded successfully:', scaffoldData);
		// You can add any additional logic here, such as refreshing the plugin list
	};


	const handleScaffoldPlugin = useCallback(async () => {
		try {
			const result = await ipcAsync(IPC_EVENTS.SCAFFOLD_PLUGIN, scaffoldData);
			if (result.success) {
				console.log('Plugin scaffolded successfully');
				setShowScaffoldModal(false);
				// Update state or show success message
			} else {
				setScaffoldError(result.error || 'Failed to scaffold plugin');
			}
		} catch (error) {
			console.error('Error scaffolding plugin:', error);
			setScaffoldError('An error occurred while scaffolding the plugin');
		}
	}, [scaffoldData]);

	const getDefaultPaths = useCallback((siteName) => {
		console.log('siteName:', siteName, 'site:', data.site);
		// slugify the siteName
		const slug = siteName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
		const pluginName = slug ? slug : 'xr-chess-block';
		return {
			pluginName,
			zipPath: `plugin-build/zip/${pluginName}.zip`,
			jsonPath: `plugin-build/json/${pluginName}.json`,
			assetsPath: 'plugin-build/assets',
			authorInfoPath: `plugin-build/json/author_info.json`,
		};
	}, []);

	const [state, setState] = useState(() => {
		const defaults = getDefaultPaths(data.site.name);
		return {
			siteId: data.site.id || '',
			sitePath: data.site.path || '',
			userId: '', // New field for userId/organization
			subDirectory: '',
			pluginName: defaults.pluginName,
			zipFilePath: defaults.zipPath,
			jsonFilePath: defaults.jsonPath,
			authorInfoPath: defaults.authorInfoPath,
			assetsPath: defaults.assetsPath,
			isJsonValid: false,
			jsonData: {},
			uploadStatus: '',
			zipUrl: '',
			metadataUrl: '',
			assetsUrl: '',
		};
	});

	useEffect(() => {
		const loadEnvironmentVariables = async () => {
			try {
				// Normalize path and handle spaces correctly
				const expandedPath = expandHomeDir(data.site.path);
				const normalizedPath = path.normalize(expandedPath);

				const pluginPath = path.join(
					normalizedPath,
					'app',
					'public',
					'wp-content',
					'plugins',
					state.pluginName
				);
				const envPath = path.join(pluginPath, '.env');

				console.log("Checking .env path:", envPath);

				if (await fs.pathExists(envPath)) {
					console.log(".env file exists");
					const envContent = await fs.readFile(envPath, 'utf8');
					console.log("ENV content:", envContent);

					// Parse the env content manually to handle potential formatting issues
					const envVars = {};
					envContent.split('\n').forEach(line => {
						const [key, ...valueParts] = line.split('=');
						if (key && valueParts.length > 0) {
							envVars[key.trim()] = valueParts.join('=').trim();
						}
					});

					console.log("Parsed ENV vars:", envVars);

					if (envVars.API_KEY) setApiKey(envVars.API_KEY);
					if (envVars.PLUGIN_API_URL) setApiUrl(envVars.PLUGIN_API_URL);
					if (envVars.BUCKET_URL) setBucketUrl(envVars.BUCKET_URL);
				} else {
					console.error(".env file not found at:", envPath);
				}
			} catch (error) {
				console.error("Error loading environment variables:", error);
			}
		};

		loadEnvironmentVariables();
	}, [data.site.path, state.pluginName]);

	const validateJson = useCallback(async () => {
		if (!state.jsonFilePath || !state.pluginName) {
			console.error('[RENDERER] JSON file path or plugin name is not set');
			return false;
		}
		try {
			const result = await ipcAsync(IPC_EVENTS.VALIDATE_JSON, {
				pluginName: state.pluginName,
				jsonPath: state.jsonFilePath,
				sitePath: data.site.path
			});
			console.log('[RENDERER] Validation result:', result);
			if (result.success) {
				const parsedJson = JSON.parse(result.content);
				setState(prevState => ({
					...prevState,
					isJsonValid: true,
					jsonData: parsedJson
				}));
			} else {
				setState(prevState => ({
					...prevState,
					isJsonValid: false,
					jsonData: {}
				}));
			}
			return result.success;
		} catch (error) {
			console.error('[RENDERER] Error validating JSON:', error);
			setState(prevState => ({
				...prevState,
				isJsonValid: false,
				jsonData: {}
			}));
			return false;
		}
	}, [state.jsonFilePath, state.pluginName]);

	const updateJsonFile = async () => {
		try {
			let basePath = data.site.path;
			if (!basePath) {
				console.warn('site.path is undefined, using a fallback path');
				basePath = process.env.HOME || process.env.USERPROFILE || '/';
			}
			const normalizedPath = formatHomePath(basePath);


			const pluginPath = path.join(normalizedPath, 'app', 'public', 'wp-content', 'plugins', state.pluginName);

			// use the env from the pluginPath/.env file
			const envPath = path.join(pluginPath, '.env');
			console.log('Reading .env file:', envPath);
			if (fs.existsSync(envPath)) {
				const env = fs.readFileSync(envPath, 'utf8');
				const envLines = env.split('\n');
				envLines.forEach((line) => {
					const [key, value] = line.split('=');
					process.env[key] = value;
				});
			}

			const { PLUGIN_API_URL, API_KEY, BUCKET_URL } = process.env;

			setJsonUpdateStatus('Updating JSON file...');

			const result = await ipcAsync(IPC_EVENTS.UPDATE_JSON_FILE, {
				pluginName: state.pluginName,
				jsonFilePath: state.jsonFilePath,
				userId: state.subDirectory,
				BUCKET_URL: process.env.BUCKET_URL
			});

			if (!result.success) {
				throw new Error(result.error || 'Failed to update JSON file');
			}

			setJsonUpdateStatus('JSON file updated successfully');
			setState(prevState => ({ ...prevState, jsonData: result.updatedData }));
			return result.updatedData;
		} catch (error) {
			console.error('Error updating JSON file:', error);
			setJsonUpdateStatus(`Failed to update JSON: ${error.message}`);
			return null;
		}
	};

	const handleInputChange = useCallback((e, key) => {
		let value = e.target.value;
		setState(prevState => {
			const newState = { ...prevState, [key]: value };

			if (key === 'pluginName') {
				const defaults = getDefaultPaths(value);
				newState.zipFilePath = defaults.zipPath;
				newState.jsonFilePath = defaults.jsonPath;
				newState.assetsPath = defaults.assetsPath;
			}

			return newState;
		});
	}, [getDefaultPaths]);

	useEffect(() => {
		const handleProgressUpdate = (event, progress) => {
			setUploadProgress(progress);
			setState(prevState => {
				let newStatus = prevState.uploadStatus;
				switch (progress.step) {
					case 1:
						newStatus = `Uploading ZIP file... (${progress.chunkNumber}/${progress.totalChunks})`;
						break;
					case 2:
						newStatus = 'Uploading JSON file...';
						break;
					case 3:
						newStatus = `Uploading assets... (${progress.chunkNumber}/${progress.totalChunks})`;
						break;
					case 4:
						newStatus = 'Finalizing upload...';
						break;
					case 5:
						newStatus = 'Upload complete';
						break;
				}
				return { ...prevState, uploadStatus: newStatus };
			});
		};

		ipcRenderer.on('upload-progress', handleProgressUpdate);

		return () => {
			ipcRenderer.removeListener('upload-progress', handleProgressUpdate);
		};
	}, []);

	const handleUpload = useCallback(async () => {
		try {
			setState(prevState => ({ ...prevState, uploadStatus: 'Preparing files...' }));
			setUploadProgress({ step: 0, totalSteps: 5, chunkNumber: 0, totalChunks: 0 });

			// Verify environment variables
			if (!apiKey || !apiUrl || !bucketUrl) {
				throw new Error('Required environment variables are missing. Please check your .env file.');
			}

			// Expand and normalize the base path
			const expandedPath = expandHomeDir(data.site.path);
			const normalizedPath = path.normalize(expandedPath);
			console.log('Normalized path:', normalizedPath);

			const pluginPath = path.join(normalizedPath, 'app', 'public', 'wp-content', 'plugins', state.pluginName);

			// Construct full paths
			const fullZipPath = path.join(pluginPath, state.zipFilePath);
			const fullJsonPath = path.join(pluginPath, state.jsonFilePath);
			const fullAssetsPath = path.join(pluginPath, state.assetsPath);
			const fullAuthorInfoPath = path.join(pluginPath, state.authorInfoPath);

			// Validate all required paths exist
			const pathsToCheck = [
				{ path: fullZipPath, name: 'ZIP file' },
				{ path: fullJsonPath, name: 'JSON file' },
				{ path: fullAssetsPath, name: 'Assets directory' },
				{ path: fullAuthorInfoPath, name: 'Author info file' }
			];

			for (const { path: pathToCheck, name } of pathsToCheck) {
				const exists = await fs.pathExists(pathToCheck);
				if (!exists) {
					throw new Error(`${name} not found at: ${pathToCheck}`);
				}
			}

			console.log('File paths validated:', {
				zipPath: fullZipPath,
				jsonPath: fullJsonPath,
				assetsPath: fullAssetsPath,
				authorInfoPath: fullAuthorInfoPath
			});

			// Read and upload ZIP file
			setState(prevState => ({ ...prevState, uploadStatus: 'Reading ZIP file...' }));
			const zipFileResult = await ipcAsync(IPC_EVENTS.READ_ZIP_FILE, { zipPath: fullZipPath });
			if (!zipFileResult.success) {
				throw new Error(zipFileResult.error || 'Failed to read ZIP file');
			}

			// Read and upload JSON file
			setState(prevState => ({ ...prevState, uploadStatus: 'Reading JSON file...' }));
			const jsonFileResult = await ipcAsync(IPC_EVENTS.READ_JSON_FILE, { jsonPath: fullJsonPath });
			if (!jsonFileResult.success) {
				throw new Error(jsonFileResult.error || 'Failed to read JSON file');
			}

			// Read author info file
			setState(prevState => ({ ...prevState, uploadStatus: 'Reading author info file...' }));
			const authorInfoResult = await ipcAsync(IPC_EVENTS.READ_JSON_FILE, { jsonPath: fullAuthorInfoPath });
			if (!authorInfoResult.success) {
				throw new Error(authorInfoResult.error || 'Failed to read author info file');
			}

			// Parse author info
			let authorData;
			try {
				authorData = JSON.parse(authorInfoResult.content);
			} catch (error) {
				console.error('Error parsing author info JSON content:', error);
				throw new Error('Failed to parse author info JSON content');
			}

			// Prepare metadata
			setState(prevState => ({ ...prevState, uploadStatus: 'Preparing metadata...' }));
			let metadata;
			try {
				metadata = {
					pluginName: state.pluginName,
					...JSON.parse(jsonFileResult.content)
				};
			} catch (error) {
				console.error('Error parsing JSON content:', error);
				throw new Error('Failed to parse JSON content');
			}

			// Upload plugin
			setState(prevState => ({ ...prevState, uploadStatus: 'Uploading plugin...' }));
			console.log('Using API credentials:', { apiKey, apiUrl, bucketUrl });
			console.log("zip", zipFileResult);
			// Upload plugin with forceUpload parameter
			const uploadResult = await ipcAsync(IPC_EVENTS.UPLOAD_PLUGIN, {
				userId: state.subDirectory,
				pluginName: state.pluginName,
				zipFile: zipFileResult.content,
				jsonFile: jsonFileResult.content,
				assetsPath: fullAssetsPath,
				authorData: JSON.stringify(authorData),
				metadata: metadata,
				apiKey: apiKey,
				apiUrl: apiUrl,
				bucketUrl: bucketUrl,
				forceUpload: forceUpload
			});

			if (!uploadResult.success) {
				throw new Error(uploadResult.error || 'Failed to upload plugin');
			}

			let userId = state.subDirectory;
			console.log('Using userId:', userId);

			setState(prevState => ({
				...prevState,
				uploadStatus: 'Upload successful',
				zipUrl: uploadResult.zipUrl,
				metadataUrl: uploadResult.metadataUrl,
				assetsUrl: uploadResult.assetsUrl,
				userId: uploadResult.userId,
				pluginName: uploadResult.pluginName
			}));
			setUploadProgress(prev => ({ ...prev, step: 5, totalSteps: 5 }));

		} catch (error) {
			console.error('Upload error:', error);
			setState(prevState => ({
				...prevState,
				uploadStatus: `Upload failed: ${error.message}`
			}));
		}
	}, [state.userId, state.subDirectory, state.pluginName, state.zipFilePath,
	state.jsonFilePath, state.assetsPath, state.authorInfoPath,
	data.site.path, apiKey, apiUrl, bucketUrl, forceUpload]);

	return (
		<div style={{ flex: '1', overflowY: 'auto', padding: '20px', maxWidth: '90%', margin: '0 auto' }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
				<Title size="xl">Plugin Publisher</Title>
				<Button onClick={toggleScaffoldModal}>Scaffold Plugin</Button>
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
				<div>
					<BasicInput
						label='Sub Directory'
						placeholder='e.g., plugins, themes, some-org'
						value={state.subDirectory}
						onChange={(e) => handleInputChange(e, 'subDirectory')}
					/>
					<p size="xs" style={{ gap: '3px', textAlign: 'center', color: '#878787' }}>
						Subdirectory for plugin upload (e.g., api/your-org/ or api/plugins/)
					</p>
				</div>
				<div>
					<BasicInput
						label="Plugin Name"
						placeholder='e.g., my-awesome-plugin'
						value={state.pluginName}
						onChange={(e) => handleInputChange(e, 'pluginName')}
					/>
					<p size="xs" style={{ gap: '3px', textAlign: 'center', color: '#878787' }}>
						Match WordPress plugins directory folder name you wish to publish
					</p>
				</div>
				<div>
					<BasicInput
						label="Zip File Path"
						placeholder='e.g., plugin-build/zip/my-plugin.zip'
						value={state.zipFilePath}
						onChange={(e) => handleInputChange(e, 'zipFilePath')}
					/>
					<p size="xs" style={{ gap: '3px', textAlign: 'center', color: '#878787' }}>
						Suggested in plugin-build/zip directory
					</p>
				</div>
				<div>
					<BasicInput
						label="JSON File Path"
						placeholder='e.g., plugin-build/json/my-plugin.json'
						value={state.jsonFilePath}
						onChange={(e) => handleInputChange(e, 'jsonFilePath')}
					/>
					<p size="xs" style={{ gap: '3px', textAlign: 'center', color: '#878787' }}>
						Suggested in plugin-build/json directory
					</p>
				</div>
				<div>
					<BasicInput
						label="Assets Path"
						placeholder='e.g., plugin-build/assets'
						value={state.assetsPath}
						onChange={(e) => handleInputChange(e, 'assetsPath')}
					/>
					<p size="s" style={{ gap: '3px', textAlign: 'center', color: '#878787' }}>
						The Publisher will look inside this folder for icon-256x256.jpg and banner-1500x620.jpg
					</p>
				</div>
				<div>
					<BasicInput
						label="Author Info File Path"
						placeholder='e.g., plugin-build/json/author_info.json'
						value={state.authorInfoPath}
						onChange={(e) => handleInputChange(e, 'authorInfoPath')}
					/>
					<p size="s" style={{ gap: '3px', textAlign: 'center', color: '#878787' }}>
						JSON file with author information
					</p>
				</div>
			</div>

			<Divider marginSize='m' />

			<div style={{ display: 'flex', justifyContent: 'flex-start', gap: '10px', marginTop: '20px' }}>
				<Button onClick={() => setShowJsonEditorModal(true)}>Edit JSON</Button>
				<Button onClick={validateJson}>Validate JSON</Button>
				{state.isJsonValid && (
					<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
						<Button onClick={handleUpload}>Upload Plugin</Button>
						<div style={{
							display: 'flex',
							alignItems: 'center',
							padding: '0 10px',
							backgroundColor: '#2a1515',
							borderRadius: '4px',
							marginLeft: '10px'
						}}>
							<Checkbox
								checked={forceUpload}
								onChange={() => setForceUpload(!forceUpload)}
								id="force-upload"
							/>
							<label
								htmlFor="force-upload"
								style={{
									color: '#ff6b6b',
									fontSize: '14px',
									cursor: 'pointer',
									marginLeft: '5px'
								}}
							>
								Force Upload
							</label>
						</div>
					</div>
				)}
			</div>

			<Divider marginSize='m' />

			<div style={{ marginTop: '20px' }}>
				<Title size="m" style={{ marginBottom: '15px' }}>Status</Title>
				<div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px', alignItems: 'center' }}>
					<Text size="s" style={{ fontWeight: 'bold' }}>JSON Valid:</Text>
					<Text size="s">{state.isJsonValid ? 'Yes' : 'No'}</Text>

					<Text size="s" style={{ fontWeight: 'bold' }}>Upload Status:</Text>
					<Text size="s">{state.uploadStatus || 'Pending'}</Text>

					<Text size="s" style={{ fontWeight: 'bold' }}>Upload Progress:</Text>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
						<ProgressBar
							progress={(uploadProgress.step / uploadProgress.totalSteps) * 100}
							showNumber={true}
						/>
						<Text size="s">
							{state.uploadStatus === 'Upload successful' ? 'Complete' : `Step ${uploadProgress.step} of ${uploadProgress.totalSteps}`}
						</Text>
					</div>

					{state.zipUrl && (
						<>
							<Text size="s" style={{ fontWeight: 'bold' }}>Zip URL:</Text>
							<CopyInput
								value={`${process.env.BUCKET_URL}/${state.zipUrl}`}
								aria-label="Zip URL"
								style={{ width: '100%' }}
							/>
						</>
					)}

					{state.metadataUrl && (
						<>
							<Text size="s" style={{ fontWeight: 'bold' }}>Metadata URL:</Text>
							<CopyInput
								value={`${process.env.BUCKET_URL}/${state.metadataUrl}`}
								aria-label="Metadata URL"
								style={{ width: '100%' }}
							/>
							<Text size="s" style={{ fontWeight: 'bold' }}>Plugin Page URL:</Text>
							<CopyInput
								value={`${process.env.PLUGIN_API_URL}/directory/${state.userId}/${state.pluginName}`}
								aria-label="Metadata URL"
								style={{ width: '100%' }}
							/>
							<Text size="s" style={{ fontWeight: 'bold' }}>Author Page URL:</Text>
							<CopyInput
								value={`${process.env.PLUGIN_API_URL}/author/${state.userId}`}
								aria-label="Metadata URL"
								style={{ width: '100%' }}
							/>
						</>
					)}
				</div>
			</div>
			<ScaffoldModal
				isOpen={showScaffoldModal}
				onRequestClose={() => setShowScaffoldModal(false)}
				onSuccess={handleScaffoldSuccess}
				site={data.site}
			/>
			<JSONEditorModal
				isOpen={showJsonEditorModal}
				onRequestClose={() => setShowJsonEditorModal(false)}
				pluginName={state.pluginName}
				sitePath={data.site.path}
				onJsonUpdated={() => {
					setState(prevState => ({
						...prevState,
						isJsonValid: false
					}));
				}}
			/>
		</div>
	);
};

export default RepoPluginUploader;
