# Micro Plugin Publisher

Micro Plugin Publisher is a Local WP add-on that streamlines the process of publishing, updating, and scaffolding WordPress plugins. It provides a user-friendly interface within Local WP and includes API tooling for self-hosted plugin distribution.

![Micro Plugin Publisher Preview](docs/assets/micro-plugin-publisher-preview-update.jpg)

## Features

- Scaffold new WordPress plugins
- Validate plugin metadata
- Update plugin JSON files
- Upload plugin files to your own storage solution
- Generate distribution URLs for your plugins
- Enable automatic updates for end-users
- Self-hosted API for plugin distribution

## Installation

1. Clone this repository into your Local WP add-ons directory:
   ```
   git clone git@github.com:xpportal/Micro-Plugin-Publisher.git
   ```
   ### Clone Locations

   - macOS: ~/Library/Application Support/Local/addons
   - Windows: C:\Users\username\AppData\Roaming\Local\addons
   - Debian Linux: ~/.config/Local/addons

   *You can replace 'Local' with 'Local Beta' if you want to create the add-on for Local Beta.*

2. Install dependencies:
   ```
   cd micro-plugin-publisher
   yarn install
   ```

3. Build the add-on:
   ```
   yarn build
   ```

4. Restart Local WP and enable the Micro Plugin Publisher add-on in preferences.

## Usage

1. In the add-on interface, you can:
   - Scaffold a new plugin
   - Enter details for an existing plugin:
     - Sub Directory
     - Plugin Name
     - Zip File Path
     - JSON File Path
     - Assets Path
     - Author Info File Path

2. Use the "Scaffold Plugin" button to create a new plugin structure.

![Scaffold Plugin Interface](docs/assets/scaffold-plugin.jpg)


3. For existing plugins:
   - Click "Update JSON" to update the JSON file with the anticipated file paths.
   - Click "Validate JSON" to check the JSON file's validity.
   - If validation is successful, click "Upload Plugin" to start the publishing process.
   - If you are adapting an existing plugin ensure that there is a `.env` and `plugin-build` directory. Reference the examples directory to see an example expected directory structure. `plugin-build` must contain an `assets`, `zip`, and `json`, directory unless otherwise stated in your input field paths in the addon.

### File Access

The addon looks for your files in the Local by Flywheel site structure:

~/Local Sites/[Plugin Name]/app/public/wp-content/plugins/[Plugin Name]/

### Publishing Process

1. Enter plugin information into the input fields.
2. Update the JSON file using the "Update JSON" button.
3. Validate the JSON file.
4. If validation is successful, upload the plugin.
5. The addon will provide you with URLs for the uploaded zip file and metadata.

## API Setup: [`Setup Instructions Here`](api/README.md)

To set up your own plugin distribution API:

1. Navigate to the `api` directory.
2. Follow the instructions in [`api/README.md`](api/README.md) to deploy the worker and R2 bucket using Cloudflare.

## Enabling Automatic Updates

To enable automatic updates for your plugin, implement the update mechanism in your plugin's PHP code:

1. Include the `Micro_Plugin_Publisher_Updater` class in your plugin:

   ```php
   require_once plugin_dir_path(__FILE__) . 'class-example-upgrader.php';
   ```

2. Initialize the updater in your plugin's main file:

   ```php
	// Example usage of upgrader class
	require_once dirname(__FILE__) . 'class-example-upgrader.php';
	
	function initialize_Micro_Plugin_Publisher_Updater() {
		$plugin_slug = 'xr-publisher-three-icosa';
		$plugin_name = plugin_basename(__FILE__);
		$version = '0.1';
		$metadata_url = 'https://pub-2ef6bc2ae372488daf94a858e2b752ac.r2.dev/plugins/xr-publisher-three-icosa/xr-publisher-three-icosa.json';
		$zip_url = 'https://pub-2ef6bc2ae372488daf94a858e2b752ac.r2.dev/plugins/xr-publisher-three-icosa/xr-publisher-three-icosa.zip';
		new MicroUpgrader\Micro_Plugin_Publisher_Updater($plugin_slug, $plugin_name, $version, $metadata_url, $zip_url);
	}
	add_action('plugins_loaded', 'initialize_Micro_Plugin_Publisher_Updater');
   ```

3. Replace the placeholder values with your actual plugin information and URLs provided by the Micro Plugin Publisher add-on after uploading.

## Environment Variables

The addon uses environment variables for API configuration. Ensure you have a `.env` file in your plugin directory with the following variables:

- `API_KEY`: Your API key for authentication
- `PLUGIN_API_URL`: The URL of your plugin API
- `BUCKET_URL`: The URL of your storage bucket

## Customization

- Modify the add-on's UI in `src/JSONValidatorUploader.jsx`
- Adjust the main process logic in `src/main.ts`
- Customize API functionality in `api/src/worker.js`
- Adapt the `Micro_Plugin_Publisher_Updater` class to fit your specific needs

## Contributing

Contributions are welcome! Please submit issues and pull requests on the GitHub repository.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Support

For issues or assistance:

1. Check the Troubleshooting section in api/README.md
2. Open an issue on the GitHub repository
3. Consult the Local WP documentation for add-on related queries