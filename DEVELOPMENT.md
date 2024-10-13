# XR Publisher Plugin Updater

This Local by Flywheel add-on allows you to publish and update 3D plugins for WordPress that extend the "XR Publisher" plugin. It integrates with the app.xr.foundation platform for plugin distribution.

## Installation

### Clone

Clone the repository into the following directory depending on your platform:

- macOS: ~/Library/Application Support/Local/addons
- Windows: C:\Users\username\AppData\Roaming\Local\addons
- Debian Linux: ~/.config/Local/addons

*You can replace 'Local' with 'Local Beta' if you want to create the add-on for Local Beta.*

### Install Add-on Dependencies

`yarn install`

### Add Add-on to Local

1. Clone repo directly into the add-ons folder (paths described above)
2. `yarn` (install dependencies)
3. `yarn build`
4. Open Local and enable add-on

## Usage

### Input Fields

1. **Plugin Name**: The name of your plugin's directory in the WordPress plugins folder.
2. **Zip File Path**: Relative path to your plugin's zip file within the plugin directory.
3. **JSON File Path**: Relative path to your plugin's metadata JSON file within the plugin directory.

### File Access

The addon looks for your files in the Local by Flywheel site structure:

~/Local Sites/[Plugin Name]/app/public/wp-content/plugins/[Plugin Name]/

### Publishing Process

1. Enter your plugin name and file paths in the input fields.
2. Click "Validate JSON" to ensure your metadata file is correct.
3. If validation is successful, click "Upload Plugin" to start the publishing process.
4. The addon will provide you with URLs for the uploaded zip file and metadata.

## Development

### External Libraries

- @getflywheel/local provides type definitions for Local's Add-on API.
- @getflywheel/local-components provides reusable React components for your Local add-on.

### Folder Structure

All files in /src will be transpiled to /lib using TypeScript. Anything in /lib will be overwritten.

### Development Workflow

Consult the [Local add-on API](https://getflywheel.github.io/local-addon-api) for a wide range of values and functions for developing your add-on.

## Using the XR_Publisher_Updater Class

To enable automatic updates for your plugin:

1. Copy the XR_Publisher_Updater class into your plugin's directory.
2. In your plugin's main file, include and initialize the updater:

require_once plugin_dir_path(__FILE__) . 'XR_Publisher_Updater.php';

$updater = new xrPublisher\XR_Publisher_Updater(
    'your-plugin-slug',
    plugin_basename(__FILE__),
    '1.0.0', // Your plugin's current version
    'https://example.com/your-plugin-metadata.json', // Metadata URL
    'https://example.com/your-plugin.zip' // Zip file URL
);

Replace the placeholder values with your plugin's actual information and the URLs provided by the Plugin Publisher addon after uploading your plugin.

## License

MIT
```