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

### GET Endpoints
- `/plugin-data`: Retrieve plugin data (cached)
- `/author-data`: Retrieve author data (cached)
- `/authors-list`: Get a list of all authors (cached)
- `/directory/{author}/{slug}`: Get the HTML page for a specific plugin (cached)
- `/author/{author}`: Get the HTML page for a specific author (cached)
- `/version-check`: Compare new version against author/slug/slug.json
- `/download`: Download a plugin file
- `/download-count`: Get download count for a plugin
- `/search`: Search plugins with optional tag filtering
- `/directory/search`: Get HTML search results page

### POST Endpoints
- `/migrate-data`: Migrate existing data to SQLite database
- `/record-download`: Record a plugin download
- `/upload-chunk`: Upload a chunk of a plugin file
- `/upload-json`: Upload JSON metadata for a plugin
- `/finalize-upload`: Finalize a plugin upload
- `/update-author-info`: Update author information
- `/upload-asset`: Upload plugin assets (icons, banners)
- `/backup-plugin`: Create backup of currently live files
- `/clear-cache`: Clear cached responses

To use `POST` endpoints, include your API Secret in the Authorization header:

```bash
curl -X POST https://your-worker.dev/clear-cache \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -H "Content-Type: application/json"
```

## Caching

The API implements caching for all GET requests. Features include:
- CDN edge caching with 1-hour TTL
- Version-based cache keys
- Automatic cache invalidation on content updates 
- Auth-based cache bypassing when using API secret

Cached responses are automatically invalidated when:
- A new plugin is published
- Author information is updated
- A GET request contains a valid API secret

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

## Search and SQLite Database

This system uses a SQLite database within a Durable Object to provide search functionality and efficient plugin management. The database automatically syncs with the R2 storage system when plugins are uploaded or updated.

### Search Endpoints

The system provides a search endpoint:

```bash
# Basic search
curl 'https://your-worker.workers.dev/search?q=pluginname'

# Search by tag
curl 'https://your-worker.workers.dev/search?tag=xr'

# Combined search with pagination
curl 'https://your-worker.workers.dev/search?q=pluginname&tag=xr&limit=20&offset=0'
```

Search parameters:
- `q`: Text to search for (searches across name, description, and author)
- `tag`: Filter by tag (can be specified multiple times)
- `limit`: Maximum number of results (default: 20)
- `offset`: Pagination offset (default: 0)

HTML Interface:
The system also provides a browser-friendly search interface at /directory/search with:

- Real-time search results
- Tag filtering
- Grid view of plugins with:
	- Banner images
	- Plugin icons
	- Version info
	- Last update date
	- Author attribution
	- Pagination controls
	- Direct links to plugin detail pages


![Micro Plugin Publisher Search](../docs/assets/micro-plugin-publisher-search-page.jpg)


### Database Schema

The SQLite database contains three main tables:

```sql
-- Plugin metadata table
CREATE TABLE plugins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  short_description TEXT,
  version TEXT NOT NULL,
  download_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(author, slug)
);

-- Plugin tags for search
CREATE TABLE plugin_tags (
  plugin_id INTEGER,
  tag TEXT NOT NULL,
  FOREIGN KEY(plugin_id) REFERENCES plugins(id),
  PRIMARY KEY(plugin_id, tag)
);

-- Download tracking queue
CREATE TABLE download_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id INTEGER,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed BOOLEAN DEFAULT FALSE,
  FOREIGN KEY(plugin_id) REFERENCES plugins(id)
);
```

### Initial Database Setup

After deploying, you'll need to migrate your existing plugins to the SQLite database:

```bash
# Migrate existing data from R2 to SQLite
curl -X POST https://your-worker.workers.dev/migrate-data \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Download Tracking

Downloads are tracked in a queue system to ensure accurate counting under high load:
1. Records each download in the queue
2. Processes downloads in batches
3. Updates plugin download counts safely through Durable Objects
4. Maintains consistency under concurrent access

The queue system prevents:
- Race conditions during updates
- Lost download counts under high load
- Data inconsistency across zones

### Configuration

To enable the SQLite functionality, your `wrangler.toml` needs:

```toml
[[durable_objects.bindings]]
name = "PLUGIN_REGISTRY"
class_name = "PluginRegistryDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["PluginRegistryDO"]
```

This binds the Durable Object to your worker and enables SQLite for the database.

### Implementation Details

- Backups are stored in the same R2 bucket as the main plugin files, organized by version.
- The system uses a `compareVersions` function to ensure proper version ordering.
- Version checking and backup creation are integral steps in the plugin upload process.

These features ensure:
- Data integrity by preventing accidental overwrites.
- Version history maintenance for each plugin.
- The ability to rollback to previous versions if needed.

Rate Limiting:
- IP-based rate limiting using Cloudflare KV
- 5 downloads per hour per IP/plugin combination

Chunked Uploads:
Large plugin files are handled through chunked uploads. The system:
- Splits files into manageable chunks
- Handles upload interruption/resume
- Validates chunk integrity
- Cleans up incomplete uploads
- Processes chunks using format `{folderName}/chunks_{pluginName}/{pluginName}_chunk_{number}_{total}`


When using the API to upload or update plugins, always include the version information and follow the workflow of checking versions and creating backups before finalizing uploads.

## Customizing Author Plugin and Search Pages

Pages can be customized by modifying the `generate<type>HTML` function in each worker template file. To customize your author page:

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

### Content Security
- CSP headers with nonce-based script execution
- HTML sanitization for user-provided content
- URL and resource validation
- Tag and attribute whitelisting

### API Security 
- Rate limiting on sensitive endpoints
- Required auth for all POST operations
- Secure session handling

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