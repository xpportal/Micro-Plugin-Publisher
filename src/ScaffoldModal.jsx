import React, { useState, useCallback } from 'react';
import { ipcAsync } from '@getflywheel/local/renderer';
import { Button, Title, Text, BasicInput, Spinner, FlyModal } from '@getflywheel/local-components';
import { IPC_EVENTS } from './constants';

const ScaffoldModal = ({ isOpen, onRequestClose, onSuccess, site }) => {
	console.log("scaffold site", site);
  const [scaffoldData, setScaffoldData] = useState({
    pluginName: site.name,
    pluginSlug: site?.name?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
    pluginDescription: '',
    pluginVersion: '0.1',
    pluginUri: '',
    requiresWp: '5.7',
    requiresPhp: '7.1.0',
    authorName: '',
    authorUri: '',
    license: 'GPL v2 or later',
    licenseUri: 'https://www.gnu.org/licenses/gpl-2.0.html',
    textDomain: '',
    domainPath: '/languages',
  });
  const [scaffoldError, setScaffoldError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scaffoldSuccess, setScaffoldSuccess] = useState(false);

  const handleScaffoldInputChange = useCallback((e, key) => {
    const value = e.target.value;
    setScaffoldData(prevState => ({
      ...prevState,
      [key]: value,
    }));
    
    // Auto-generate slug and text domain from plugin name
    if (key === 'pluginName') {
      const slug = value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      setScaffoldData(prevState => ({
        ...prevState,
        pluginSlug: slug,
        textDomain: slug,
      }));
    }
  }, []);

  const handleScaffoldPlugin = useCallback(async () => {
    try {
      setIsLoading(true);
      setScaffoldError('');
      const result = await ipcAsync(IPC_EVENTS.SCAFFOLD_PLUGIN, scaffoldData);
      if (result.success) {
        setScaffoldSuccess(true);
        setTimeout(() => {
          onSuccess(scaffoldData);
          onRequestClose();
          setScaffoldSuccess(false);
        }, 2000);
      } else {
        setScaffoldError(result.error || 'Failed to scaffold plugin');
      }
    } catch (error) {
      console.error('Error scaffolding plugin:', error);
      setScaffoldError('An error occurred while scaffolding the plugin');
    } finally {
      setIsLoading(false);
    }
  }, [scaffoldData, onSuccess, onRequestClose]);

  return (
    <FlyModal
      isOpen={isOpen}
      onRequestClose={onRequestClose}
      contentLabel="Scaffold Plugin Modal"
      ariaHideApp={false}
    >
      <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto' }}>
        <Title size="l">Scaffold New Plugin</Title>
        <div style={{ marginBottom: '20px', maxHeight: '400px', overflowY: 'auto' }}>
          <BasicInput
            label="Plugin Name"
            placeholder="Enter plugin name"
            value={scaffoldData.pluginName}
            onChange={(e) => handleScaffoldInputChange(e, 'pluginName')}
            aria-label="Plugin Name input"
          />
          <BasicInput
            label="Plugin Slug"
            placeholder="Enter plugin slug"
            value={scaffoldData.pluginSlug}
            onChange={(e) => handleScaffoldInputChange(e, 'pluginSlug')}
            aria-label="Plugin Slug input"
          />
          <BasicInput
            label="Plugin Description"
            placeholder="Enter plugin description"
            value={scaffoldData.pluginDescription}
            onChange={(e) => handleScaffoldInputChange(e, 'pluginDescription')}
            aria-label="Plugin Description input"
          />
          <BasicInput
            label="Plugin Version"
            placeholder="Enter plugin version"
            value={scaffoldData.pluginVersion}
            onChange={(e) => handleScaffoldInputChange(e, 'pluginVersion')}
            aria-label="Plugin Version input"
          />
          <BasicInput
            label="Plugin URI"
            placeholder="Enter plugin URI"
            value={scaffoldData.pluginUri}
            onChange={(e) => handleScaffoldInputChange(e, 'pluginUri')}
            aria-label="Plugin URI input"
          />
          <BasicInput
            label="Requires WordPress Version"
            placeholder="Enter required WordPress version"
            value={scaffoldData.requiresWp}
            onChange={(e) => handleScaffoldInputChange(e, 'requiresWp')}
            aria-label="Required WordPress Version input"
          />
          <BasicInput
            label="Requires PHP Version"
            placeholder="Enter required PHP version"
            value={scaffoldData.requiresPhp}
            onChange={(e) => handleScaffoldInputChange(e, 'requiresPhp')}
            aria-label="Required PHP Version input"
          />
          <BasicInput
            label="Author Name"
            placeholder="Enter author name"
            value={scaffoldData.authorName}
            onChange={(e) => handleScaffoldInputChange(e, 'authorName')}
            aria-label="Author Name input"
          />
          <BasicInput
            label="Author URI"
            placeholder="Enter author URI"
            value={scaffoldData.authorUri}
            onChange={(e) => handleScaffoldInputChange(e, 'authorUri')}
            aria-label="Author URI input"
          />
          <BasicInput
            label="License"
            placeholder="Enter license type"
            value={scaffoldData.license}
            onChange={(e) => handleScaffoldInputChange(e, 'license')}
            aria-label="License input"
          />
          <BasicInput
            label="License URI"
            placeholder="Enter license URI"
            value={scaffoldData.licenseUri}
            onChange={(e) => handleScaffoldInputChange(e, 'licenseUri')}
            aria-label="License URI input"
          />
          <BasicInput
            label="Text Domain"
            placeholder="Enter text domain"
            value={scaffoldData.textDomain}
            onChange={(e) => handleScaffoldInputChange(e, 'textDomain')}
            aria-label="Text Domain input"
          />
          <BasicInput
            label="Domain Path"
            placeholder="Enter domain path"
            value={scaffoldData.domainPath}
            onChange={(e) => handleScaffoldInputChange(e, 'domainPath')}
            aria-label="Domain Path input"
          />
        </div>
        {scaffoldError && <Text size="s" style={{ color: 'red', marginBottom: '10px' }}>{scaffoldError}</Text>}
        {scaffoldSuccess && <Text size="s" style={{ color: 'green', marginBottom: '10px' }}>Plugin scaffolded successfully!</Text>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button onClick={onRequestClose}>Cancel</Button>
          <Button onClick={handleScaffoldPlugin} disabled={isLoading}>
            {isLoading ? <Spinner size="s" /> : 'Create Plugin'}
          </Button>
        </div>
      </div>
    </FlyModal>
  );
};

export default ScaffoldModal;