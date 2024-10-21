# Plugin Publishing System

## Overview

The Plugin Publishing System is a streamlined solution for managing and distributing plugins using Cloudflare Workers and R2 storage. This system allows you to easily upload, version, and distribute plugins for your platform.

## Prerequisites

Before you begin, ensure you have the following:

- A Cloudflare account with Workers and R2 enabled
- [Node.js](https://nodejs.org/) (version 12 or later) and npm installed
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/get-started/) installed and authenticated with your Cloudflare account

## Quick Start

1. Run the setup script:
   ```
   ./setup.sh
   ```

2. Follow the prompts to complete the setup process.

3. The API key given at the end of setup is used to publish. This key should be in the root of your project directory as `API_KEY=<yourkey>` (and omit the `.env` file from version control) One workflow tip I would recommend is rolling the key on every publish so your stored credentials at .env are constantly out of sync after deploy. 

## Detailed Setup Instructions

1. Ensure you're logged in to your Cloudflare account via Wrangler:
   ```
   npx wrangler login
   ```

2. Run the `setup.sh` script and provide a name for your project when prompted.

3. The script will:
   - Generate or update the `wrangler.toml` configuration file
   - Create an R2 bucket for storing plugin files
   - Prompt you to select the appropriate Cloudflare account (if you have multiple)
   - Deploy the existing worker code from `src/index.js`
   - Generate and set an API secret

4. After the script completes, you'll receive:
   - The R2 Bucket URL
   - An API Secret (save this securely)

5. Your worker is now deployed with the implementation from `src/index.js`.

## Configuration

The `wrangler.toml` file in your project directory contains the configuration for your worker and R2 bucket. Key configurations include:

- `name`: The name of your worker
- `main`: The entry point of your worker code
- `compatibility_date`: The compatibility date for the worker
- `PLUGIN_BUCKET_URL`: The URL of your R2 bucket (automatically set during setup)
- `bucket_name`: The name of your R2 bucket

## Usage

The Plugin Publishing System provides the following endpoints:

- `GET /plugin-data`: Retrieve plugin data (cached)
- `GET /author-data`: Retrieve author data (cached)
- `GET /authors-list`: Get a list of all authors (cached)
- `GET /directory/{author}/{slug}`: Get the HTML page for a specific plugin (cached)
- `GET /author/{author}`: Get the HTML page for a specific author (cached)
- `GET /version-check` : Compares new version against author/slug/slug.json.
- `POST /upload-chunk`: Upload a chunk of a plugin file
- `POST /upload-json`: Upload JSON metadata for a plugin
- `POST /finalize-upload`: Finalize a plugin upload
- `POST /update-author-info`: Update author information
- `POST /upload-asset`: Upload plugin assets (e.g., icons, banners)
- `POST /backup-plugin` : Takes author/slug/version to create a backup of the currently live files.

To use the `POST` endpoints, you'll need to include your API Secret in the `Authorization` header of your requests as a Bearer token.

## Caching

The API implements caching for all GET requests, improving performance and reducing load on the backend. Cached responses are automatically invalidated when relevant data is updated (e.g., when a new plugin is published or author information is updated, or when a `GET` request against plugin-data contains a secret).

## Version Control and Backup

The Plugin Publishing System includes a robust version checking and backup mechanism to ensure data integrity and prevent accidental overwrites.

### Version Checking

The system uses semantic versioning to manage plugin versions. Before any upload, a version check is performed:

- Endpoint: `GET /version-check`
- Query parameters: 
  - `author`: The plugin author's identifier
  - `pluginName`: The name of the plugin
  - `newVersion`: The version being uploaded
- Response: 
  ```json
  {
    "isNew": boolean,
    "canUpload": boolean,
    "currentVersion": string
  }
  ```

This endpoint determines if the new version can be uploaded based on the existing version in the system. It prevents uploading of older or identical versions.

### Backup Creation

Before updating an existing plugin, the system creates a backup of the current version:

- Endpoint: `POST /backup-plugin`
- Request body:
  ```json
  {
    "author": string,
    "slug": string,
    "version": string
  }
  ```
- Response: Success or failure message

The backup process:
1. Creates a new folder named with the current version number.
2. Copies the current plugin files (JSON metadata, ZIP file, and assets) into this backup folder.
3. Updates the main plugin metadata to reflect the current version.

If a backup already exists for the given version, the endpoint returns a message indicating so without creating a duplicate backup.

### Implementation Details

- Backups are stored in the same R2 bucket as the main plugin files, organized by version.
- The system uses a `compareVersions` function to ensure proper version ordering.
- Version checking and backup creation are integral steps in the plugin upload process.

These features ensure:
- Data integrity by preventing accidental overwrites.
- Version history maintenance for each plugin.
- The ability to rollback to previous versions if needed.

When using the API to upload or update plugins, always include the version information and follow the workflow of checking versions and creating backups before finalizing uploads.

## Customizing Author Pages

Author pages can be customized by modifying the `generateAuthorHTML` function in the worker code. To customize your author page:

1. Edit the `src/authorTemplate.js` file (or create it if it doesn't exist).
2. Implement your custom HTML generation logic. For example:

   ```javascript
   export default function generateAuthorHTML(authorData) {
     return `
       <!DOCTYPE html>
       <html lang="en">
       <head>
         <meta charset="UTF-8">
         <meta name="viewport" content="width=device-width, initial-scale=1.0">
         <title>${authorData.username}'s Plugins</title>
         <style>
           /* Add your custom CSS here */
         </style>
       </head>
       <body>
         <header>
           <h1>${authorData.username}</h1>
           <img src="${authorData.avatar_url}" alt="${authorData.username}'s avatar">
         </header>
         <main>
           <h2>About</h2>
           <p>${authorData.bio || 'No bio provided.'}</p>
           <h2>Plugins</h2>
           <ul>
             ${authorData.plugins.map(plugin => `
               <li>
                 <h3>${plugin.name}</h3>
                 <p>${plugin.short_description}</p>
                 <a href="/directory/${authorData.username}/${plugin.slug}">View Plugin</a>
               </li>
             `).join('')}
           </ul>
         </main>
       </body>
       </html>
     `;
   }
   ```

3. Deploy your changes using:
   ```
   npx wrangler deploy
   ```

Remember to clear the cache for your author page after making changes to see the updates immediately. You can bust the cache by hitting the upload plugin button in the Local Addon. In theory this directory should never be out of sync with the latest.

## Customization

To modify the worker's functionality:

1. Edit the `src/index.js` file.
2. Deploy your changes using:
   ```
   npx wrangler deploy
   ```

## Security Considerations

- Keep your API Secret secure. It's used to authenticate requests to your Plugin Publishing System.
- Regularly rotate your API Secret to maintain security.
- Ensure your Cloudflare account has appropriate security measures in place, such as two-factor authentication.

## Troubleshooting

1. **Wrangler not found**: Ensure Wrangler is installed globally: `npm install -g wrangler`
2. **Deployment fails**: Verify you're logged in to your Cloudflare account: `npx wrangler login`
3. **R2 bucket creation fails**: Confirm R2 is enabled for your Cloudflare account
4. **API requests fail**: Double-check you're using the correct API Secret in your requests

## Limitations

- The setup script assumes you have the necessary permissions to create resources and deploy workers in your Cloudflare account.
- The script does not provide options for cleaning up resources if the setup fails midway.
- Existing resources with the same names may be overwritten without warning.
- Caching is set to a fixed duration (1 hour). Adjust the `max-age` value in the code if you need different caching behavior.

## Contributing

Contributions to improve the Plugin Publishing System are welcome. Please submit issues and pull requests on the project's GitHub repository.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Support

If you encounter issues or need assistance:

1. Check the Troubleshooting section in this README.
2. Review the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/).
3. Open an issue on the GitHub repository for this project.
4. For Cloudflare-specific problems, contact Cloudflare support.

## Acknowledgments

This project uses Cloudflare Workers and R2, powerful tools for building and deploying serverless applications and object storage. It also leverages Cloudflare's caching capabilities to improve performance and reduce load on the backend.