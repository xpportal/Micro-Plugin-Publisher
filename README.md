# XR Publisher Plugin Updater

This Local by Flywheel add-on enables developers to publish and update 3D plugins for WordPress that extend the "XR Publisher" plugin. It integrates with the app.xr.foundation platform for seamless plugin distribution and updates.

## What This Tool Does

The XR Publisher Plugin Updater simplifies the process of deploying and maintaining WordPress plugins specifically designed for XR (Extended Reality) applications. It provides a user-friendly interface within Local by Flywheel to:

1. Validate your plugin's metadata
2. Upload your plugin files to the SXP Digital platform
3. Generate distribution URLs for your plugin
4. Enable automatic updates for end-users

This tool bridges the gap between local development and cloud distribution, ensuring that your XR plugins can be easily shared and kept up-to-date.

![XR Publisher Preview](docs/assets/xr-publisher-preview.jpg)

## How to Use

### Input Fields

1. Plugin Name: 
   - Enter the name of your plugin's directory in the WordPress plugins folder.
   - Example: For a plugin located at `wp-content/plugins/my-xr-plugin`, enter `my-xr-plugin`.

2. Zip File Path: 
   - Provide the relative path to your plugin's zip file within the plugin directory.
   - Example: If the zip is at `my-xr-plugin/dist/my-xr-plugin.zip`, enter `dist/my-xr-plugin.zip`.

3. JSON File Path: 
   - Specify the relative path to your plugin's metadata JSON file.
   - Example: For a file at `my-xr-plugin/dist/metadata.json`, enter `dist/metadata.json`.

### Custom Paths

While the add-on provides default paths, you can override these to accommodate custom build structures:

- Default Zip Path: `plugin-build/zip/[Plugin Name].zip`
- Default JSON Path: `plugin-build/json/[Plugin Name].json`

To use custom paths, simply enter your preferred paths in the respective input fields.

### Publishing Process

1. Fill in the input fields with your plugin details.
2. Click "Validate JSON" to verify your metadata file.
3. If validation succeeds, the "Upload Plugin" button will activate.
4. Click "Upload Plugin" to initiate the publishing process.
5. Upon completion, you'll receive URLs for your uploaded zip file and metadata.

## Enabling Automatic Updates

To allow users to update your plugin directly from their WordPress dashboard:

1. Include the `XR_Publisher_Updater` class in your plugin's main file.
2. Initialize the updater with your plugin's information:

Example:

```
require_once plugin_dir_path(__FILE__) . 'XR_Publisher_Updater.php';

$updater = new xrPublisher\XR_Publisher_Updater(
    'your-plugin-slug',
    plugin_basename(__FILE__),
    '1.0.0', // Your plugin's current version
    'https://example.com/your-plugin-metadata.json', // Metadata URL from the add-on
    'https://example.com/your-plugin.zip' // Zip URL from the add-on
);
```

Replace the placeholder values with your actual plugin information and the URLs provided by the Plugin Publisher add-on after uploading.

## Installation

This add-on is distributed through GitHub releases. To install:

1. Visit the GitHub repository and download the latest release.
2. Extract the downloaded file.
3. Place the extracted folder in your Local by Flywheel add-ons directory:
   - macOS: `~/Library/Application Support/Local/addons`
   - Windows: `C:\Users\username\AppData\Roaming\Local\addons`
   - Linux: `~/.config/Local/addons`
4. Restart Local by Flywheel.
5. Enable the XR Publisher Plugin Updater add-on in Local's preferences.

For developers looking to contribute or customize the add-on, please refer to the DEVELOPMENT.md file in the repository.