import React, { useState, useEffect, useCallback } from 'react';
import * as Local from '@getflywheel/local';
import { ipcAsync } from '@getflywheel/local/renderer';
import { Button, FlyModal, Title, Text, InputPasswordToggle, BasicInput, Divider, CopyInput, ProgressBar } from '@getflywheel/local-components';
import { IPC_EVENTS } from './constants';
import path from 'path';
import fs from 'fs-extra';

const { ipcRenderer } = window.require('electron');

const JSONValidatorUploader = ({ site = {}, context }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [uploadProgress, setUploadProgress] = useState({ step: 0, totalSteps: 5, chunkNumber: 0, totalChunks: 0 });
  const [pluginPageUrl, setPluginPageUrl] = useState('');
  const [authorPageUrl, setAuthorPageUrl] = useState('');
  const [authorInfoPath, setAuthorInfoPath] = useState('');
  const [authorInfoUploadStatus, setAuthorInfoUploadStatus] = useState('');

  const getDefaultPaths = useCallback((siteName) => {
    console.log('siteName:', siteName);
    const pluginName = siteName || 'xr-publisher';
    return {
      pluginName,
      zipPath: `plugin-build/zip/${pluginName}.zip`,
      jsonPath: `plugin-build/json/${pluginName}.json`,
      assetsPath: 'plugin-build/assets',
	  authorInfoPath: `plugin-build/json/author_info.json`,
    };
  }, []);

  const [state, setState] = useState(() => {
    console.log(site);
    const defaults = getDefaultPaths(site.name);
    return {
      siteId: site.id || '',
      sitePath: site.path || '',
      pluginName: defaults.pluginName,
      zipFilePath: defaults.zipPath,
      jsonFilePath: defaults.jsonPath,
	  authorInfoPath: defaults.authorInfoPath,
      assetsPath: defaults.assetsPath,
      isJsonValid: false,
      jsonData: {},
      isLoggedIn: false,
      showLoginModal: false,
      uploadStatus: '',
      loginError: '',
      zipUrl: '',
      metadataUrl: '',
      assetsUrl: '',
    };
  });

  const validateJson = useCallback(async () => {
    if (!state.jsonFilePath || !state.pluginName) {
      console.error('[RENDERER] JSON file path or plugin name is not set');
      return false;
    }
    try {
      const result = await ipcAsync(IPC_EVENTS.VALIDATE_JSON, {
        pluginName: state.pluginName,
        jsonPath: state.jsonFilePath
      });
      console.log('[RENDERER] Validation result:', result);
      setState(prevState => ({ 
        ...prevState, 
        isJsonValid: result.success, 
        jsonData: result.success ? JSON.parse(result.content) : {}
      }));
      return result.success;
    } catch (error) {
      console.error('[RENDERER] Error validating JSON:', error);
      return false;
    }
  }, [state.jsonFilePath, state.pluginName]);

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

  const handleLogin = useCallback(async () => {
    console.log('[RENDERER] Login button clicked');
    try {
      const response = await ipcAsync(IPC_EVENTS.LOGIN, { email, password });
      if (response.success) {
        setState(prevState => ({ 
          ...prevState,
          isLoggedIn: true,
          showLoginModal: false,
          loginError: '',
        }));
        console.log('[RENDERER] Login successful');
      } else {
        setState(prevState => ({ ...prevState, loginError: 'Login failed. Please try again.' }));
        console.log('[RENDERER] Login failed');
      }
    } catch (error) {
      console.error('[RENDERER] Login error:', error);
      setState(prevState => ({ ...prevState, loginError: 'An error occurred during login. Please try again.' }));
    }
  }, [email, password]);

  const handleLogout = useCallback(async () => {
    console.log('[RENDERER] Logout button clicked');
    try {
      await ipcAsync(IPC_EVENTS.LOGOUT);
      setState(prevState => ({ ...prevState, isLoggedIn: false }));
      console.log('[RENDERER] Logout successful');
    } catch (error) {
      console.error('[RENDERER] Logout error:', error);
    }
  }, []);

  useEffect(() => {
	const handleProgressUpdate = (event, progress) => {
	  setUploadProgress(progress);
	  let newStatus = '';
	  if (progress.step === 1) {
		newStatus = `Uploading ZIP file... (${progress.chunkNumber}/${progress.totalChunks})`;
	  } else if (progress.step === 2) {
		newStatus = 'Uploading JSON file...';
	  } else if (progress.step === 3) {
		newStatus = `Uploading assets... (${progress.chunkNumber}/${progress.totalChunks})`;
	  } else if (progress.step === 4) {
		newStatus = 'Finalizing upload...';
	  }
	  setState(prevState => ({ ...prevState, uploadStatus: newStatus }));
	};
  
	ipcRenderer.on('upload-progress', handleProgressUpdate);
  
	return () => {
	  ipcRenderer.removeListener('upload-progress', handleProgressUpdate);
	};
  }, []);
  
  const handleUpload = useCallback(async () => {
    if (!state.isLoggedIn) {
      setState(prevState => ({ ...prevState, showLoginModal: true }));
      return;
    }

    try {
      setState(prevState => ({ ...prevState, uploadStatus: 'Preparing files...' }));
      setUploadProgress({ step: 0, totalSteps: 5, chunkNumber: 0, totalChunks: 0 });

      let basePath = site.path;
      if (!basePath) {
        console.warn('site.path is undefined, using a fallback path');
        basePath = process.env.HOME || process.env.USERPROFILE || '/';
      }

      const pluginPath = path.join(basePath, 'Local Sites', state.pluginName, 'app', 'public', 'wp-content', 'plugins', state.pluginName);
      const fullZipPath = path.join(pluginPath, state.zipFilePath);
      const fullJsonPath = path.join(pluginPath, state.jsonFilePath);
      const fullAssetsPath = path.join(pluginPath, state.assetsPath);
      const fullAuthorInfoPath = path.join(pluginPath, state.authorInfoPath);

      console.log('ZIP file path:', fullZipPath);
      console.log('JSON file path:', fullJsonPath);
      console.log('Assets path:', fullAssetsPath);
      console.log('Author Info file path:', fullAuthorInfoPath);

      if (!state.zipFilePath || !state.jsonFilePath || !state.assetsPath || !state.authorInfoPath) {
        throw new Error('ZIP, JSON, assets, or author info file path is missing');
      }

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

      // Upload plugin (ZIP, JSON, and author info)
      setState(prevState => ({ ...prevState, uploadStatus: 'Uploading plugin...' }));
      const uploadResult = await ipcAsync(IPC_EVENTS.UPLOAD_PLUGIN, {
        pluginName: state.pluginName,
        zipFile: zipFileResult.content,
        jsonFile: jsonFileResult.content,
        metadata: metadata,
        assetsPath: fullAssetsPath,
        authorData: authorData
      });

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'Failed to upload plugin');
      }
  
	  // Explicitly upload assets
	  setState(prevState => ({ ...prevState, uploadStatus: 'Uploading assets...' }));
	  console.log('Attempting to upload assets with:', {
		pluginName: state.pluginName,
		assetsPath: fullAssetsPath
	  });
	  const assetsResult = await ipcAsync(IPC_EVENTS.UPLOAD_PLUGIN_ASSETS, {
		pluginName: state.pluginName,
		assetsPath: fullAssetsPath
	  });
  
	  console.log('Assets upload result:', assetsResult);
  
	  if (!assetsResult.success) {
		throw new Error(assetsResult.error || 'Failed to upload assets');
	  }
  
	  // Extract userId from assetsUrl
	  let userId = '';
	  if (Array.isArray(assetsResult.assetsUrl) && assetsResult.assetsUrl.length > 0) {
		const assetUrlParts = assetsResult.assetsUrl[0].split('/');
		userId = assetUrlParts[3]; // Assuming the userId is always the 4th part of the URL
		console.log('Extracted userId:', userId);
	  } else {
		console.error('assetsResult.assetsUrl is not a valid array:', assetsResult.assetsUrl);
	  }
  
	  const publishedPluginPageUrl = userId ? `https://app.xr.foundation/plugins/${userId}/${state.pluginName}` : '';
	  const publishedAuthorPageUrl = userId ? `https://app.xr.foundation/plugins/${userId}` : '';
	  setPluginPageUrl(publishedPluginPageUrl);
	  setAuthorPageUrl(publishedAuthorPageUrl);
	  setState(prevState => ({ 
		...prevState, 
		uploadStatus: 'Upload successful',
		zipUrl: uploadResult.zipUrl,
		metadataUrl: uploadResult.metadataUrl,
		assetsUrl: assetsResult.assetsUrl,
	  }));
	  setUploadProgress(prev => ({ ...prev, step: 5, totalSteps: 5 }));
  
	} catch (error) {
	  console.error('Upload error:', error);
	  setState(prevState => ({ ...prevState, uploadStatus: `Upload failed: ${error.message}` }));
	}
}, [state.isLoggedIn, state.pluginName, state.zipFilePath, state.jsonFilePath, state.assetsPath, state.authorInfoPath, site.path]);

  useEffect(() => {
	const handleProgressUpdate = (event, progress) => {
	  setUploadProgress(progress);
	  setState(prevState => {
		let newStatus = prevState.uploadStatus;
		switch(progress.step) {
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
  
  const toggleLoginModal = useCallback(() => {
    console.log('[RENDERER] Toggling login modal');
    setState(prevState => ({ 
      ...prevState,
      showLoginModal: !prevState.showLoginModal,
      loginError: '',
    }));
  }, []);

  useEffect(() => {
    const initializeState = async () => {
      console.log('[RENDERER] Initializing state...');
      try {
        const authStatus = await ipcAsync(IPC_EVENTS.GET_AUTH_STATUS);
        console.log('[RENDERER] Auth status:', authStatus);
        setState(prevState => ({ ...prevState, isLoggedIn: authStatus.isLoggedIn }));
      } catch (error) {
        console.error('[RENDERER] Error getting auth status:', error);
      }
    };

    initializeState();
  }, []);


  return (
		<div style={{ flex: '1', overflowY: 'auto', margin: '10px' }}>
		<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
			<Title size="xl">Plugin Publisher</Title>
			{state.isLoggedIn ? (
			<Button onClick={handleLogout}>Logout</Button>
			) : (
			<Button onClick={toggleLoginModal}>Login</Button>
			)}
		</div>
	
		<FlyModal
			isOpen={state.showLoginModal}
			onRequestClose={toggleLoginModal}
			contentLabel="Login Modal"
			ariaHideApp={false}
		>
			<Title size="l">Login</Title>
			<div style={{ padding: '20px' }}>
			<BasicInput
				label="Email"
				placeholder="Email"
				value={email}
				onChange={(e) => setEmail(e.target.value)}
				aria-label="Email input"
			/>
			<InputPasswordToggle
				label="Password"
				placeholder="Password"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				aria-label="Password input"
			/>
			{state.loginError && <Text size="s" style={{ color: 'red' }}>{state.loginError}</Text>}
			<Button onClick={handleLogin}>Login</Button>
			</div>
		</FlyModal>
		<div style={{ padding: '15px', borderRadius: '5px', marginTop: '20px' }}>
			<BasicInput
			label="Plugin Name"
			placeholder='Plugin Name'
			value={state.pluginName}
			onChange={(e) => handleInputChange(e, 'pluginName')}
			aria-label="Plugin Name input"
			/>
			<BasicInput
			label="Zip File Path"
			placeholder='Zip File Path'
			value={state.zipFilePath}
			onChange={(e) => handleInputChange(e, 'zipFilePath')}
			aria-label="Zip File Path input"
			/>
			<BasicInput
			label="JSON File Path"
			value={state.jsonFilePath}
			placeholder='JSON File Path'
			onChange={(e) => handleInputChange(e, 'jsonFilePath')}
			aria-label="JSON File Path input"
			/>
			<BasicInput
			label="Assets Path"
			value={state.assetsPath}
			placeholder='Assets Path'
			onChange={(e) => handleInputChange(e, 'assetsPath')}
			aria-label="Assets Path input"
			/>
			<BasicInput
			label="Author Info File Path"
			value={state.authorInfoPath}
			placeholder='Author Info File Path'
			onChange={(e) => handleInputChange(e, 'authorInfoPath')}
			aria-label="Author Info File Path input"
			/>
			<div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
			<Button onClick={validateJson}>Validate JSON</Button>
			{/* {state.isLoggedIn && <Button onClick={handleAuthorInfoUpload}>Upload Author Info</Button>} */}
			{state.isLoggedIn && state.isJsonValid && <Button onClick={handleUpload}>Upload Plugin</Button>}
			</div>
		</div>
	
		<Divider marginSize='m'/>
		
		<div style={{ padding: '15px', borderRadius: '5px', marginTop: '20px' }}>
		<Title size="m">Status</Title>
			<div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px', alignItems: 'center' }}>
				<Text size="s" style={{ fontWeight: 'bold' }}>JSON Valid:</Text>
				<Text size="s">{state.isJsonValid ? 'Yes' : 'No'}</Text>
				
				<Text size="s" style={{ fontWeight: 'bold' }}>Login Status:</Text>
				<Text size="s">{state.isLoggedIn ? 'Logged In' : 'Not Logged In'}</Text>
				
				<Text size="s" style={{ fontWeight: 'bold' }}>Upload Status:</Text>
				<Text size="s">{state.uploadStatus || 'pending'}</Text>
				
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
					value={state.zipUrl}
					aria-label="Zip URL"
					style={{ width: '100%' }}
					/>
				</>
				)}
				
				{state.metadataUrl && (
				<>
					<Text size="s" style={{ fontWeight: 'bold' }}>Metadata URL:</Text>
					<CopyInput
					value={state.metadataUrl}
					aria-label="Metadata URL"
					style={{ width: '100%' }}
					/>
				</>
				)}
	
				{state.assetsUrl && (
				<>
					<Text size="s" style={{ fontWeight: 'bold' }}>Assets URL:</Text>
					<CopyInput
					value={state.assetsUrl}
					aria-label="Assets URL"
					style={{ width: '100%' }}
					/>
				</>
				)}
				{pluginPageUrl && (
				<>
					<Text size="s" style={{ fontWeight: 'bold' }}>Plugin Page URL:</Text>
					<CopyInput
					value={pluginPageUrl}
					aria-label="Plugin Page URL"
					style={{ width: '100%' }}
					/>
				</>
				)}
				{authorPageUrl && (
				<>
					<Text size="s" style={{ fontWeight: 'bold' }}>Author Page:</Text>
					<CopyInput
					value={authorPageUrl}
					aria-label="Author Page"
					style={{ width: '100%' }}
					/>
				</>
				)}
			</div>
		</div>
		</div>
	);
  };

export default JSONValidatorUploader;
