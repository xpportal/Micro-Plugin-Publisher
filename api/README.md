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

- `GET /plugin-data`: Retrieve plugin data
- `GET /author-data`: Retrieve author data
- `GET /authors-list`: Get a list of all authors
- `POST /upload-chunk`: Upload a chunk of a plugin file
- `POST /upload-json`: Upload JSON metadata for a plugin
- `POST /finalize-upload`: Finalize a plugin upload
- `POST /update-author-info`: Update author information
- `POST /upload-asset`: Upload plugin assets (e.g., icons, banners)

To use the `POST` endpoints, you'll need to include your API Secret in the `Authorization` header of your requests as a Bearer token.

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

This project uses Cloudflare Workers and R2, powerful tools for building and deploying serverless applications and object storage.