// Import necessary dependencies
import { Buffer } from 'buffer';
import generatePluginHTML from './pluginTemplate';
import generateAuthorHTML from './authorTemplate';

// Define CORS headers
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Main worker class
export default {
	handleOptions(request) {
		return new Response(null, {
			status: 204,
			headers: {
				...CORS_HEADERS,
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			},
		});
	},

	// Authenticate the request using the stored secret
	authenticateRequest(request, env) {
		const authHeader = request.headers.get('Authorization');
		if (!authHeader) {
			return false;
		}
		const [authType, authToken] = authHeader.split(' ');
		if (authType !== 'Bearer' || authToken !== env.API_SECRET) {
			return false;
		}
		return true;
	},

	// Handle GET /plugin-data
	// Handle GET /plugin-data
	async handleGetPluginData(request, env) {
		try {
			const url = new URL(request.url);
			const author = url.searchParams.get('author');
			const slug = url.searchParams.get('slug');

			if (!author || !slug) {
				return new Response(JSON.stringify({ error: 'Missing author or slug parameter' }), {
					status: 400,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			//if api key is valid bust the cache
			if (this.authenticateRequest(request, env)) {
				const cache = caches.default;
				await cache.delete(request);
			}

			// Check cache first
			const cacheKey = `plugin-data:${author}:${slug}`;
			const cache = caches.default;
			let response = await cache.match(request);

			if (!response) {
				const jsonKey = `${author}/${slug}/${slug}.json`;
				const jsonObject = await env.PLUGIN_BUCKET.get(jsonKey);

				if (!jsonObject) {
					return new Response(JSON.stringify({ error: 'Plugin not found' }), {
						status: 404,
						headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
					});
				}

				const jsonData = await jsonObject.text();
				response = new Response(jsonData, {
					status: 200,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});

				// Cache the response
				response.headers.set('Cache-Control', 'public, max-age=3600');
				await cache.put(request, response.clone());
			}

			return response;
		} catch (error) {
			console.error('Get plugin data error:', error);
			return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Handle GET /author-data
	async handleGetAuthorData(request, env) {
		try {
			const url = new URL(request.url);
			const author = url.searchParams.get('author');

			if (!author) {
				return new Response(JSON.stringify({ error: 'Missing author parameter' }), {
					status: 400,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			// Check cache first
			const cacheKey = `author-data:${author}`;
			const cache = caches.default;
			let response = await cache.match(request);

			if (!response) {
				const authorData = await this.fetchAuthorData(author, env);

				if (!authorData) {
					return new Response(JSON.stringify({ error: 'Author not found' }), {
						status: 404,
						headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
					});
				}

				const plugins = await this.fetchAuthorPlugins(author, env);

				const responseData = {
					...authorData,
					plugins,
				};

				response = new Response(JSON.stringify(responseData), {
					status: 200,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});

				// Cache the response
				response.headers.set('Cache-Control', 'public, max-age=3600');
				await cache.put(request, response.clone());
			}

			return response;
		} catch (error) {
			console.error('Get author data error:', error);
			return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Handle GET /authors-list
	async handleGetAuthorsList(env) {
		try {
			// Check cache first
			const cacheKey = 'authors-list';
			const cache = caches.default;
			let response = await cache.match(cacheKey);

			if (!response) {
				const list = await env.PLUGIN_BUCKET.list();
				const authors = [];

				for (const item of list.objects) {
					const parts = item.key.split('/');
					if (parts.length > 1 && parts[1] === 'author_info.json') {
						const authorInfoKey = item.key;
						const authorInfoObject = await env.PLUGIN_BUCKET.get(authorInfoKey);

						if (authorInfoObject) {
							const authorData = JSON.parse(await authorInfoObject.text());
							authorData.authorId = parts[0];

							const authorPrefix = `${parts[0]}/`;
							const pluginsList = await env.PLUGIN_BUCKET.list({ prefix: authorPrefix });
							const pluginCount = pluginsList.objects.filter(obj => obj.key.endsWith('.json') && !obj.key.endsWith('author_info.json')).length;

							authors.push({
								...authorData,
								plugin_count: pluginCount
							});
						}
					}
				}

				response = new Response(JSON.stringify(authors), {
					status: 200,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});

				// Cache the response
				response.headers.set('Cache-Control', 'public, max-age=3600');
				await cache.put(cacheKey, response.clone());
			}

			return response;
		} catch (error) {
			console.error('Get authors list error:', error);
			return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Handle POST /upload-chunk
	async handlePluginUploadChunk(request, env) {
		try {
			const { userId, pluginName, fileData, chunkNumber, totalChunks } = await request.json();

			console.log(`Received chunk ${chunkNumber} of ${totalChunks} for plugin ${pluginName}`);

			const sanitizedPluginName = pluginName.replace(/\s/g, '-');
			const folderName = `${userId}`;
			const chunkKey = `${folderName}/chunks_${sanitizedPluginName}/${sanitizedPluginName}_chunk_${chunkNumber}_${totalChunks}`;

			const chunkBuffer = Buffer.from(fileData, 'base64');
			await env.PLUGIN_BUCKET.put(chunkKey, chunkBuffer, {
				httpMetadata: {
					contentType: 'application/octet-stream',
				},
			});

			console.log(`Successfully stored chunk ${chunkNumber}`);

			return new Response(JSON.stringify({ success: true, message: 'Chunk uploaded successfully' }), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Chunk upload error:', error);
			return new Response(JSON.stringify({ success: false, error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Handle POST /upload-json
	async handleUploadJson(request, env) {
		try {
			const { userId, pluginName, jsonData } = await request.json();

			console.log(`Received JSON data for plugin: ${pluginName}`);

			const sanitizedPluginName = pluginName.replace(/\s/g, '-');
			const folderName = `${userId}`;
			const jsonKey = `${folderName}/${sanitizedPluginName}/${sanitizedPluginName}.json`;

			// Ensure jsonData is the correct structure
			let processedJsonData = jsonData;
			if (typeof jsonData === 'string') {
				processedJsonData = JSON.parse(jsonData);
			}

			// If it's not an array or it has a "0" key, correct the structure
			if (!Array.isArray(processedJsonData) || processedJsonData[0] && '0' in processedJsonData[0]) {
				processedJsonData = [processedJsonData['0'] || processedJsonData];
			}

			// Remove any unwanted outer properties
			if (processedJsonData[0].pluginName) delete processedJsonData[0].pluginName;
			if (processedJsonData[0].authorInfo) delete processedJsonData[0].authorInfo;

			await env.PLUGIN_BUCKET.put(jsonKey, JSON.stringify(processedJsonData), {
				httpMetadata: {
					contentType: 'application/json',
				},
			});

			console.log('Successfully stored JSON data');

			return new Response(JSON.stringify({ success: true, message: 'JSON uploaded successfully' }), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('JSON upload error:', error);
			return new Response(JSON.stringify({ success: false, error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Handle POST /finalize-upload
	async handleFinalizeUpload(request, env) {
		try {
			const { userId, pluginName, metadata } = await request.json();
			const cache = caches.default;

			console.log(`Finalizing upload for plugin: ${pluginName}`);

			const sanitizedPluginName = pluginName.replace(/\s/g, '-');
			const folderName = `${userId}`;
			const objectKey = `${folderName}/${sanitizedPluginName}/${sanitizedPluginName}.zip`;

			const firstChunkKey = `${folderName}/chunks_${sanitizedPluginName}/${sanitizedPluginName}_chunk_1_`;
			const firstChunkList = await env.PLUGIN_BUCKET.list({ prefix: firstChunkKey });
			if (firstChunkList.objects.length === 0) {
				throw new Error('No chunks found');
			}
			const firstChunkObject = firstChunkList.objects[0];
			const totalChunks = parseInt(firstChunkObject.key.split('_').pop());

			console.log(`Combining ${totalChunks} chunks`);

			const chunks = [];
			let totalSize = 0;

			for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
				const chunkKey = `${folderName}/chunks_${sanitizedPluginName}/${sanitizedPluginName}_chunk_${chunkNumber}_${totalChunks}`;
				const chunkObject = await env.PLUGIN_BUCKET.get(chunkKey);

				if (!chunkObject) {
					throw new Error(`Chunk ${chunkNumber} not found`);
				}

				const chunkData = await chunkObject.arrayBuffer();
				console.log(`Processing chunk ${chunkNumber} of size ${chunkData.byteLength}`);
				chunks.push(new Uint8Array(chunkData));
				totalSize += chunkData.byteLength;

				await env.PLUGIN_BUCKET.delete(chunkKey);
			}

			console.log(`Total size of all chunks: ${totalSize}`);

			const fileBuffer = new Uint8Array(totalSize);
			let offset = 0;
			for (const chunk of chunks) {
				fileBuffer.set(chunk, offset);
				offset += chunk.length;
			}

			await env.PLUGIN_BUCKET.put(objectKey, fileBuffer, {
				httpMetadata: {
					contentType: 'application/zip',
				},
			});

			console.log('Successfully combined chunks and stored ZIP file');

			// Fetch author info
			const authorInfoKey = `${userId}/author_info.json`;
			const authorInfoObject = await env.PLUGIN_BUCKET.get(authorInfoKey);
			let authorInfo = {};
			if (authorInfoObject) {
				authorInfo = JSON.parse(await authorInfoObject.text());
			}

			// Ensure metadata is in the correct format
			let finalMetadata = metadata;
			if (!Array.isArray(finalMetadata)) {
				finalMetadata = [finalMetadata];
			}
			if (finalMetadata[0] && '0' in finalMetadata[0]) {
				finalMetadata = [finalMetadata[0]['0']];
			}

			// Update the contributors field with author info
			if (finalMetadata[0] && finalMetadata[0].contributors) {
				const authorUsername = Object.keys(finalMetadata[0].contributors)[0];
				finalMetadata[0].contributors[authorUsername] = {
					profile: authorInfo.website || `https://app.xr.foundation/plugins/${userId}`,
					avatar: authorInfo.avatar_url || '',
					display_name: authorInfo.username || authorUsername
				};
			}

			const metadataKey = `${userId}/${pluginName}/${pluginName}.json`;
			await env.PLUGIN_BUCKET.put(metadataKey, JSON.stringify(finalMetadata), {
				httpMetadata: {
					contentType: 'application/json',
				},
			});


			const zipUrl = `${objectKey}`;
			const metadataUrl = `${metadataKey}`;

			// Bust plugin directory cache
			await cache.delete(`https://${request.headers.get('host')}/directory/${userId}/${sanitizedPluginName}`);

			// Bust plugin data cache
			await cache.delete(`https://${request.headers.get('host')}/plugin-data?author=${userId}&slug=${sanitizedPluginName}`);

			// Bust author directory cache
			await cache.delete(`https://${request.headers.get('host')}/author/${userId}`);

			// Bust author data cache
			await cache.delete(`https://${request.headers.get('host')}/author-data?author=${userId}`);

			// Bust authors list cache
			await cache.delete(`https://${request.headers.get('host')}/authors-list`);

			console.log(`Cache busted for plugin ${pluginName} and author ${userId}`);


			return new Response(JSON.stringify({
				success: true,
				message: 'Plugin uploaded successfully',
				zipUrl,
				metadataUrl
			}), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Finalize upload error:', error);
			return new Response(JSON.stringify({ success: false, error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Handle POST /update-author-info
	async handleUpdateAuthorInfo(request, env) {
		try {
			const { userId, pluginName, authorData } = await request.json();

			if (!userId || !pluginName || !authorData) {
				return new Response(JSON.stringify({ error: `Missing userId, pluginName, or authorData received ${userId}, ${pluginName}, ${authorData}` }), {
					status: 400,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			// Convert authorData from serialized JSON to object if necessary
			let parsedAuthorData = authorData;
			if (typeof authorData === 'string') {
				parsedAuthorData = JSON.parse(authorData);
			}

			console.log(`Received author info for plugin: ${pluginName}`);

			const authorInfoKey = `${userId}/author_info.json`;

			await env.PLUGIN_BUCKET.put(authorInfoKey, JSON.stringify(parsedAuthorData, null, 2), {
				httpMetadata: {
					contentType: 'application/json',
				},
			});

			console.log('Successfully stored author info');

			const cache = caches.default;

			// Bust author directory cache
			await cache.delete(`https://${request.headers.get('host')}/author/${userId}`);

			// Bust author data cache
			await cache.delete(`https://${request.headers.get('host')}/author-data?author=${userId}`);

			// Bust authors list cache
			await cache.delete(`https://${request.headers.get('host')}/authors-list`);

			console.log(`Cache busted for author ${userId}`);


			return new Response(JSON.stringify({ success: true, message: 'Author info uploaded successfully' }), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Author info upload error:', error);
			return new Response(JSON.stringify({ success: false, error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Handle POST /upload-asset
	async handleUploadAsset(request, env) {
		try {
			const { userId, pluginName, fileName, fileData, assetType } = await request.json();

			console.log(`Received ${assetType} for plugin: ${pluginName}`);

			const sanitizedPluginName = pluginName.replace(/\s/g, '-');
			const folderName = `${userId}`;
			const assetKey = `${folderName}/${sanitizedPluginName}/${fileName}`;

			const assetBuffer = Buffer.from(fileData, 'base64');
			await env.PLUGIN_BUCKET.put(assetKey, assetBuffer, {
				httpMetadata: {
					contentType: 'image/jpeg',
				},
			});

			console.log(`Successfully stored ${assetType}`);

			const assetUrl = `${assetKey}`;

			return new Response(JSON.stringify({
				success: true,
				message: `${assetType} uploaded successfully`,
				assetUrl
			}), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error(`Asset upload error:`, error);
			return new Response(JSON.stringify({ success: false, error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Helper function to fetch author data
	async fetchAuthorData(author, env) {
		const authorInfoKey = `${author}/author_info.json`;
		console.log(`Fetching author data for ${author} ${authorInfoKey}`);
		try {
			const authorInfoObject = await env.PLUGIN_BUCKET.get(authorInfoKey);
			if (!authorInfoObject) {
				console.error(`Author info not found for ${author}`);
				return null;
			}
			const authorInfoText = await authorInfoObject.text();
			return JSON.parse(authorInfoText);
		} catch (error) {
			console.error(`Error fetching author data for ${author}:`, error);
			return null;
		}
	},

	// Helper function to fetch author plugins
	async fetchAuthorPlugins(author, env) {
		const prefix = `${author}/`;
		const list = await env.PLUGIN_BUCKET.list({ prefix });

		const plugins = [];

		for (const item of list.objects) {
			const parts = item.key.split('/');
			if (parts.length === 3 && parts[2] === `${parts[1]}.json`) {
				const jsonData = await env.PLUGIN_BUCKET.get(item.key);
				const pluginData = JSON.parse(await jsonData.text());

				console.log(`Plugin data for ${item.key}:`, pluginData);

				plugins.push({
					slug: pluginData[0].slug,
					name: pluginData[0].name,
					short_description: pluginData[0].short_description,
					icons: pluginData[0].icons,
					banner: pluginData[0].banner,
					tags: pluginData[0].tags,
					version: pluginData[0].version,
					rating: pluginData[0].rating || 0,
					active_installs: pluginData[0].active_installs || 0,
				});
			}
		}

		return plugins;
	},

	async handleGetPluginDirectory(request, env) {
		const url = new URL(request.url);
		const pathParts = url.pathname.split('/').filter(part => part !== '');
	  
		if (pathParts.length !== 3 || pathParts[0] !== 'directory') {
		  return new Response('Invalid URL format', { status: 400 });
		}
	  
		const author = pathParts[1];
		const slug = pathParts[2];
	  
		// Check cache first
		const cacheKey = `plugin:${author}:${slug}`;
		const cache = caches.default;
		let response = await cache.match(request);
	  
		if (!response) {
		  try {
			const pluginData = await this.fetchPluginData(author, slug, env);
			const authorData = await this.fetchAuthorData(author, env);
			
			if (!pluginData) {
			  return new Response('Plugin not found', { status: 404 });
			}
	  
			pluginData.authorData = authorData;
			response = await generatePluginHTML(pluginData);
	  
			// Cache the response
			response.headers.set('Cache-Control', 'public, max-age=3600');
			await cache.put(request, response.clone());
		  } catch (error) {
			console.error('Error generating plugin page:', error);
			return new Response('Internal Server Error', { status: 500 });
		  }
		}
	  
		return response;
	  },
	  
	  async handleGetAuthorDirectory(request, env) {
		const url = new URL(request.url);
		const pathParts = url.pathname.split('/').filter(part => part !== '');
	  
		if (pathParts.length !== 2 || pathParts[0] !== 'author') {
		  return new Response('Invalid URL format', { status: 400 });
		}
	  
		const author = pathParts[1];
	  
		// Check cache first
		const cacheKey = `author:${author}`;
		const cache = caches.default;
		let response = await cache.match(request);
	  
		if (!response) {
		  try {
			console.log('Author data:', author);
			const authorData = await this.fetchAuthorPageData(author, env);
			if (!authorData) {
			  return new Response('Author not found', { status: 404 });
			}
			console.log(JSON.stringify(authorData));
			response = await generateAuthorHTML(authorData);
	  
			// Cache the response
			response.headers.set('Cache-Control', 'public, max-age=3600');
			await cache.put(request, response.clone());
		  } catch (error) {
			console.error('Error generating author page:', error);
			return new Response('Internal Server Error', { status: 500 });
		  }
		}
	  
		return response;
	  },
	  
	async fetchPluginData(author, slug, env) {
		const jsonKey = `${author}/${slug}/${slug}.json`;
		const jsonObject = await env.PLUGIN_BUCKET.get(jsonKey);

		if (!jsonObject) {
			console.error(`Plugin data not found for ${jsonKey}`);
			return null;
		}

		try {
			const text = await jsonObject.text();
			const parsed = JSON.parse(text);
			return Array.isArray(parsed) ? parsed[0] : parsed;
		} catch (error) {
			console.error(`Error parsing JSON for ${jsonKey}:`, error);
			return null;
		}
	},


	async fetchAuthorPageData(author, env) {
		const authorInfoKey = `${author}/author_info.json`;
		const authorInfoObject = await env.PLUGIN_BUCKET.get(authorInfoKey);
		// stringify and log the authorInfoObject
		if (!authorInfoObject) {
			console.error(`Author info not found for ${author}`);
			return null;
		}

		try {
			const authorInfoText = await authorInfoObject.text();

			const authorData = JSON.parse(authorInfoText);

			// Fetch and combine plugin data
			const pluginPrefix = `${author}/`;
			const pluginList = await env.PLUGIN_BUCKET.list({ prefix: pluginPrefix });

			const plugins = [];

			for (const item of pluginList.objects) {
				// log 
				const parts = item.key.split('/');
				if (parts.length === 3 && parts[2] === `${parts[1]}.json`) {
					const jsonData = await env.PLUGIN_BUCKET.get(item.key);
					const pluginData = JSON.parse(await jsonData.text());
					console.log(`Plugin data for ${item.key}:`, pluginData);
					// Preserve the original structure of the plugin data
					plugins.push({
						...pluginData[0],
					});
				}
			}

			// Replace the plugins array in authorData
			authorData.plugins = plugins;

			return authorData;
		} catch (error) {
			console.error(`Error processing data for ${authorInfoKey}:`, error);
			return null;
		}
	},

	// Add this new function to your worker class
	async handleVersionCheck(request, env) {
		try {
			const url = new URL(request.url);
			const author = url.searchParams.get('author');
			const pluginName = url.searchParams.get('pluginName');
			const newVersion = url.searchParams.get('newVersion');

			if (!author || !pluginName || !newVersion) {
				return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
					status: 400,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			const sanitizedPluginName = pluginName.replace(/\s/g, '-');
			const jsonKey = `${author}/${sanitizedPluginName}/${sanitizedPluginName}.json`;
			const jsonObject = await env.PLUGIN_BUCKET.get(jsonKey);

			if (!jsonObject) {
				return new Response(JSON.stringify({ isNew: true, canUpload: true }), {
					status: 200,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			const jsonData = JSON.parse(await jsonObject.text());
			const currentVersion = jsonData[0].version;

			const isHigherVersion = this.compareVersions(newVersion, currentVersion);

			return new Response(JSON.stringify({
				isNew: false,
				canUpload: isHigherVersion,
				currentVersion: currentVersion
			}), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Version check error:', error);
			return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Helper function to compare version strings
	compareVersions(v1, v2) {
		const parts1 = v1.split('.').map(Number);
		const parts2 = v2.split('.').map(Number);

		for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
			const part1 = parts1[i] || 0;
			const part2 = parts2[i] || 0;

			if (part1 > part2) return true;
			if (part1 < part2) return false;
		}

		return false; // versions are equal
	},

	async handleBackupPlugin(request, env) {
		try {
			if (!this.authenticateRequest(request, env)) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			const { author, slug, version } = await request.json();

			if (!author || !slug || !version) {
				return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
					status: 400,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			const pluginFolder = `${author}/${slug}`;
			const backupFolder = `${pluginFolder}/${version}`;

			// Check if backup already exists
			const existingBackup = await env.PLUGIN_BUCKET.list({ prefix: backupFolder });
			if (existingBackup.objects.length > 0) {
				return new Response(JSON.stringify({
					success: false,
					message: `Backup for version ${version} already exists`,
				}), {
					status: 200,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			// Files to backup
			const filesToBackup = [
				`${slug}.json`,
				`${slug}.zip`,
				'banner-1500x620.jpg',
				'icon-256x256.jpg'
			];

			for (const file of filesToBackup) {
				const sourceKey = `${pluginFolder}/${file}`;
				const sourceObject = await env.PLUGIN_BUCKET.get(sourceKey);

				if (sourceObject) {
					const destinationKey = `${backupFolder}/${file}`;
					await env.PLUGIN_BUCKET.put(destinationKey, sourceObject.body, sourceObject.httpMetadata);
					console.log(`Backed up ${file} to ${destinationKey}`);
				} else {
					console.log(`File ${file} not found, skipping backup`);
				}
			}

			// Update the main plugin metadata to reflect the current version
			const metadataKey = `${pluginFolder}/${slug}.json`;
			const metadataObject = await env.PLUGIN_BUCKET.get(metadataKey);
			if (metadataObject) {
				const metadata = JSON.parse(await metadataObject.text());
				metadata[0].version = version;
				await env.PLUGIN_BUCKET.put(metadataKey, JSON.stringify(metadata), {
					httpMetadata: { contentType: 'application/json' },
				});
			}

			return new Response(JSON.stringify({
				success: true,
				message: `Backup created for ${author}/${slug} version ${version}`,
			}), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});

		} catch (error) {
			console.error('Backup creation error:', error);
			return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},


	async fetch(request, env) {
		const url = new URL(request.url);
		const path = url.pathname;

		// Handle preflight requests
		if (request.method === 'OPTIONS') {
			return handleOptions(request);
		}

		// Authenticate the request
		if (request.method !== 'GET') {
			if (!this.authenticateRequest(request, env)) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}
		}

		// Route the request
		switch (request.method) {
			case 'GET':
				if (path.startsWith('/directory/') && path.split('/').length === 4) {
					return this.handleGetPluginDirectory(request, env);
				} else if (path.startsWith('/author/') && path.split('/').length === 3) {
					return this.handleGetAuthorDirectory(request, env);
				} else if (path === '/plugin-data') {
					return this.handleGetPluginData(request, env);
				} else if (path === '/author-data') {
					return this.handleGetAuthorData(request, env);
				} else if (path === '/authors-list') {
					return this.handleGetAuthorsList(env);
				} else if (path === '/version-check') {
					return this.handleVersionCheck(request, env);
				}
				break;
			case 'POST':
				switch (path) {
					case '/upload-plugin':
						return this.handlePluginUpload(request, env);
					case '/plugin-upload-chunk':
						return this.handlePluginUploadChunk(request, env);
					case '/plugin-upload-json':
						return this.handleUploadJson(request, env);
					case '/plugin-upload-assets':
						return this.handleUploadAsset(request, env);
					case '/plugin-upload-complete':
						return this.handleFinalizeUpload(request, env);
					case '/update-author-info':
						return this.handleUpdateAuthorInfo(request, env);
					case '/backup-plugin':
						return this.handleBackupPlugin(request, env);
					default:
						break;
				}
				break;
			default:
				return new Response(JSON.stringify({ error: 'Method not allowed' }), {
					status: 405,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
		}

		return new Response(JSON.stringify({ error: 'Not found' }), {
			status: 404,
			headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
		});
	},
};