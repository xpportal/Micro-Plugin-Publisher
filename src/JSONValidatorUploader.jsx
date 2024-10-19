import React, { useState, useCallback, useEffect } from 'react';
import * as Local from '@getflywheel/local';
import { ipcAsync } from '@getflywheel/local/renderer';
import { Button, Title, Text, BasicInput, Divider, CopyInput, ProgressBar } from '@getflywheel/local-components';
import { IPC_EVENTS } from './constants';
import path from 'path';
import fs from 'fs-extra';

const { ipcRenderer } = window.require('electron');

const RepoPluginUploader = ({ site = {}, context }) => {
  const [uploadProgress, setUploadProgress] = useState({ step: 0, totalSteps: 5, chunkNumber: 0, totalChunks: 0 });
  const [pluginPageUrl, setPluginPageUrl] = useState('');
  const [authorPageUrl, setAuthorPageUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('');

  const getDefaultPaths = useCallback((siteName) => {
    console.log('siteName:', siteName);
    const pluginName = siteName || 'xr-chess-block';
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
      userId: '', // New field for userId/organization
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
      const envPath = path.join(site.path, 'Local Sites', state.pluginName, 'app', 'public', 'wp-content', 'plugins', state.pluginName, '.env');
      if (fs.existsSync(envPath)) {
        const envContent = await fs.readFile(envPath, 'utf8');
        const envVars = dotenv.parse(envContent);
        setApiKey(envVars.API_KEY);
        setApiUrl(envVars.PLUGIN_API_URL);
      }
    };

    loadEnvironmentVariables();
  }, [site.path, state.pluginName]);

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

  const handleUpload = useCallback(async () => {
    try {
      setState(prevState => ({ ...prevState, uploadStatus: 'Preparing files...' }));
      setUploadProgress({ step: 0, totalSteps: 5, chunkNumber: 0, totalChunks: 0 });

      let basePath = site.path;
      if (!basePath) {
        console.warn('site.path is undefined, using a fallback path');
        basePath = process.env.HOME || process.env.USERPROFILE || '/';
      }

      const pluginPath = path.join(basePath, 'Local Sites', state.pluginName, 'app', 'public', 'wp-content', 'plugins', state.pluginName);

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
      console.log('Environment variables:', process.env);
      const { PLUGIN_API_URL, API_KEY } = process.env;

      if (!PLUGIN_API_URL || !API_KEY) {
        throw new Error('PLUGIN_API_URL or API_KEY is not set in the environment variables');
      }

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
      console.log("key and url", API_KEY, PLUGIN_API_URL);
      const uploadResult = await ipcAsync(IPC_EVENTS.UPLOAD_PLUGIN, {
        userId: state.userId, // Include the new userId field
        pluginName: state.pluginName,
        zipFile: zipFileResult.content,
        jsonFile: jsonFileResult.content,
        metadata: metadata,
        assetsPath: fullAssetsPath,
        authorData: authorData,
        apiKey: API_KEY,
        apiUrl: PLUGIN_API_URL
      });

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'Failed to upload plugin');
      }

      // Extract userId from assetsUrl
      let userId = state.userId; // Use the new userId field
      console.log('Using userId:', userId);

      const publishedPluginPageUrl = userId ? `https://app.xr.foundation/plugins/${userId}/${state.pluginName}` : '';
      const publishedAuthorPageUrl = userId ? `https://app.xr.foundation/plugins/${userId}` : '';
      setPluginPageUrl(publishedPluginPageUrl);
      setAuthorPageUrl(publishedAuthorPageUrl);
      setState(prevState => ({ 
        ...prevState, 
        uploadStatus: 'Upload successful',
        zipUrl: uploadResult.zipUrl,
        metadataUrl: uploadResult.metadataUrl,
        assetsUrl: uploadResult.assetsUrl,
      }));
      setUploadProgress(prev => ({ ...prev, step: 5, totalSteps: 5 }));

    } catch (error) {
      console.error('Upload error:', error);
      setState(prevState => ({ ...prevState, uploadStatus: `Upload failed: ${error.message}` }));
    }
  }, [state.userId, state.pluginName, state.zipFilePath, state.jsonFilePath, state.assetsPath, state.authorInfoPath, site.path, apiKey, apiUrl]);
  return (
    <div style={{ flex: '1', overflowY: 'auto', margin: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <Title size="xl">Plugin Publisher</Title>
      </div>

      <div style={{ padding: '15px', borderRadius: '5px', marginTop: '20px' }}>
        <BasicInput
          label="User ID (Organization)"
          placeholder='User ID'
          value={state.userId}
          onChange={(e) => handleInputChange(e, 'userId')}
          aria-label="User ID input"
        />
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
          {state.isJsonValid && <Button onClick={handleUpload}>Upload Plugin</Button>}
        </div>
      </div>

      <Divider marginSize='m'/>
      
      <div style={{ padding: '15px', borderRadius: '5px', marginTop: '20px' }}>
        <Title size="m">Status</Title>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px', alignItems: 'center' }}>
          <Text size="s" style={{ fontWeight: 'bold' }}>JSON Valid:</Text>
          <Text size="s">{state.isJsonValid ? 'Yes' : 'No'}</Text>
          
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

export default RepoPluginUploader;
