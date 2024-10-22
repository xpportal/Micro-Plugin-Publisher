import React, { useState, useEffect, useCallback } from 'react';
import { FlyModal, Button, Text, Title, Container } from '@getflywheel/local-components';
import { ipcAsync } from '@getflywheel/local/renderer';
import { IPC_EVENTS } from './constants';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import 'native-json-editor';
import path from 'path';

// Add schema imports
const pluginSchema = require('./utils/schema/plugin.schema.json');
const bannersSchema = require('./utils/schema/plugin.banners.schema.json');
const contributorsSchema = require('./utils/schema/plugin.contributors.schema.json');
const sectionsSchema = require('./utils/schema/plugin.sections.schema.json');
const sourceSchema = require('./utils/schema/plugin.source.schema.json');

// Initialize validator
const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strict: false,
  validateFormats: true
});
addFormats(ajv);

// Add schemas
ajv.addSchema(bannersSchema);
ajv.addSchema(contributorsSchema);
ajv.addSchema(sectionsSchema);
ajv.addSchema(sourceSchema);
const validate = ajv.compile(pluginSchema);

// Add custom styles for the JSON editor
const jsonEditorStyles = `
  json-editor::part(braces)        { color: #00ffff }
  json-editor::part(brackets)      { color: #ff69b4 }
  json-editor::part(colon)         { color: #00ff3d; padding-left: 5px; padding-right: 5px; }
  json-editor::part(comma)         { color: #ffffff }
  json-editor::part(string)        { color: #b3ff00 }
  json-editor::part(string_quotes) { color: #00ff3d }
  json-editor::part(key)           { color: #d400ff }
  json-editor::part(key_quotes)    { color: #ffffff }
  json-editor::part(value)         { color: #ffffff }
  json-editor::part(number)        { color: #da70d6 }
  json-editor::part(null)          { color: #ff4500 }
  json-editor::part(true)          { color: #32cd32 }
  json-editor::part(false)         { color: #dc143c }
`;

const JsonEditorModal = ({ isOpen, onRequestClose, pluginName, sitePath, onJsonUpdated }) => {
	const [jsonContent, setJsonContent] = useState('');
	const [updateStatus, setUpdateStatus] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [isNewFromTemplate, setIsNewFromTemplate] = useState(false);
	const [validationStatus, setValidationStatus] = useState(null);
	const [isValid, setIsValid] = useState(false);
  
  
  // Add the styles to the document
  useEffect(() => {
    const styleSheet = document.createElement('style');
    styleSheet.textContent = jsonEditorStyles;
    document.head.appendChild(styleSheet);
    return () => document.head.removeChild(styleSheet);
  }, []);

  // Load the JSON content when modal opens
  useEffect(() => {
    if (isOpen) {
      loadJsonContent();
    }
  }, [isOpen]);

  const loadJsonContent = async () => {
    try {
      setIsLoading(true);
      setError('');
      const result = await ipcAsync(IPC_EVENTS.LOAD_PLUGIN_JSON, {
        pluginName: pluginName,
        sitePath: sitePath
      });

      if (result.success) {
        setJsonContent(result.content);
        setIsNewFromTemplate(result.isNewFromTemplate);
      } else {
        setError(result.error || 'Failed to load JSON content');
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const validateJson = useCallback(() => {
    try {
      const editor = document.querySelector('json-editor');
      const jsonValue = JSON.parse(editor.value);
      const valid = validate(jsonValue);

      if (valid) {
        setValidationStatus({
          type: 'success',
          message: 'JSON is valid according to the schema'
        });
        setIsValid(true);
      } else {
        const errors = validate.errors.map(error => ({
          path: error.instancePath,
          message: error.message,
          params: error.params
        }));
        setValidationStatus({
          type: 'error',
          message: 'JSON validation failed:',
          errors: errors
        });
        setIsValid(false);
      }

      return valid;
    } catch (error) {
      setValidationStatus({
        type: 'error',
        message: `JSON parsing error: ${error.message}`
      });
      setIsValid(false);
      return false;
    }
  }, []);

  const handleUpdateJson = async () => {
    try {
      if (!isValid && !validateJson()) {
        return;
      }

      setIsLoading(true);
      setUpdateStatus('');
      setError('');

      const editor = document.querySelector('json-editor');
      const jsonValue = JSON.parse(editor.value);

      const result = await ipcAsync(IPC_EVENTS.WRITE_PLUGIN_JSON, {
        pluginName: pluginName,
        sitePath: sitePath,
        jsonContent: jsonValue
      });

      if (result.success) {
        setUpdateStatus('JSON updated successfully');
        onJsonUpdated();
        setTimeout(() => {
          onRequestClose();
        }, 1500);
      } else {
        throw new Error(result.error || 'Failed to update JSON');
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <FlyModal
      isOpen={isOpen}
      onRequestClose={onRequestClose}
      contentLabel={`Edit ${pluginName} Info JSON`}
      ariaHideApp={false}
      style={{ textAlign: 'left !important' }}
    >
      <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
        <Title size="l">{`Editing ${pluginName} Info JSON`}</Title>        
        <div style={{ 
          marginTop: '20px',
          marginBottom: '20px',
          height: '500px',
          backgroundColor: '#1e1e1e',
          border: '1px solid #333',
          borderRadius: '4px',
          overflow: 'hidden',
        }}>
          {!isLoading && (
            <json-editor
              value={jsonContent}
              class="leftJSON"
              spellcheck="false"
              indent="2"
              style={{ 
                width: '100%', 
                height: '100%',
                padding: '5px',
                fontFamily: 'monospace',
                textAlign: 'left !important'
              }}
            />
          )}
          {isLoading && (
            <div style={{ 
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%'
            }}>
              <Text>Loading JSON content...</Text>
            </div>
          )}
        </div>

        {validationStatus && (
          <div style={{ 
            marginTop: '10px',
            marginBottom: '15px',
            padding: '12px',
            backgroundColor: validationStatus.type === 'success' ? '#152a15' : '#2a1515',
            border: `1px solid ${validationStatus.type === 'success' ? '#226622' : '#662222'}`,
            borderRadius: '4px'
          }}>
            <Text style={{ color: validationStatus.type === 'success' ? '#98fb98' : '#ff6b6b' }}>
              {validationStatus.message}
            </Text>
            {validationStatus.errors && (
              <ul style={{ marginTop: '8px', color: '#ff6b6b' }}>
                {validationStatus.errors.map((error, index) => (
                  <li key={index}>
                    {error.path}: {error.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isNewFromTemplate && (
          <div style={{ 
            marginTop: '10px',
            marginBottom: '15px',
            padding: '12px',
            backgroundColor: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: '4px'
          }}>
            <Text style={{ color: '#98fb98' }}>
              Starting with example template. Please update with your plugin's information.
            </Text>
          </div>
        )}

        {error && (
          <div style={{ 
            marginBottom: '15px',
            padding: '10px',
            backgroundColor: '#2a1515',
            border: '1px solid #662222',
            borderRadius: '4px'
          }}>
            <Text style={{ color: '#ff6b6b' }}>{error}</Text>
          </div>
        )}
        
        {updateStatus && (
          <div style={{ 
            marginBottom: '15px',
            padding: '10px',
            backgroundColor: '#152a15',
            border: '1px solid #226622',
            borderRadius: '4px'
          }}>
            <Text style={{ color: '#98fb98' }}>{updateStatus}</Text>
          </div>
        )}

        <div style={{ 
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '20px'
        }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button onClick={onRequestClose}>Cancel</Button>
            <Button onClick={validateJson}>Validate JSON</Button>
          </div>
          <Button 
            onClick={handleUpdateJson} 
            disabled={isLoading || !isValid}
            style={{
              cursor: (isLoading || !isValid) ? 'not-allowed' : 'pointer',
              opacity: !isValid ? 0.6 : 1
            }}
          >
            {isLoading ? 'Updating...' : 'Save JSON Changes to Build Directory'}
          </Button>
        </div>
      </div>
    </FlyModal>
  );
};

export default JsonEditorModal;