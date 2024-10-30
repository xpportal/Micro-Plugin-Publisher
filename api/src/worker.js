// Import necessary dependencies
import { Buffer } from 'buffer';
import generatePluginHTML from './pluginTemplate';
import generateAuthorHTML from './authorTemplate';
import generateSearchHTML from './searchTemplate';
import generateHomeHTML from './homeTemplate';
import generateRegisterHTML from './registrationTemplate';
import generateRequestKeyRollHTML from './rollKeyTemplate';
import { UserAuthDO } from './userAuthDO';
import { PluginRegistryDO } from './PluginRegistryDO';
import { sign } from '@noble/ed25519';
import { FEDERATION_ENDPOINTS } from './federation';

import { removeAuthor, removePlugin } from './management';

export { UserAuthDO, PluginRegistryDO };

// Define CORS
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const FEDERATION_SECURITY = {
	// Rate limiting for federation requests
	MAX_REQUESTS_PER_MINUTE: 60,

	// Maximum age for challenges
	MAX_CHALLENGE_AGE: 5 * 60 * 1000, // 5 minutes

	// Required headers for federation requests
	REQUIRED_HEADERS: [
		'X-Federation-Node-Id',
		'X-Federation-Timestamp'
	]
};


// Main worker class
export default {
	async verifyApiKey(apiKey, env) {
		try {
			const id = env.USER_AUTH.idFromName("global");
			const auth = env.USER_AUTH.get(id);

			const response = await auth.fetch(new Request('http://internal/verify-key', {
				method: 'POST',
				body: JSON.stringify({ apiKey })
			}));

			const result = await response.json();
			return result.valid;
		} catch (error) {
			console.error('API key verification error:', error);
			return false;
		}
	},

	async verifyApiKeyAndUsername(apiKey, username, env) {
		try {
			// First check if it's the admin API_SECRET (admins can publish anywhere)
			if (apiKey === env.API_SECRET) {
				return true;
			}

			// For other users, verify their key and check username match
			const id = env.USER_AUTH.idFromName("global");
			const auth = env.USER_AUTH.get(id);

			// API keys are in format username.keyId
			const [keyUsername] = apiKey.split('.');
			if (keyUsername !== username) {
				console.error(`Username mismatch: key=${keyUsername}, requested=${username}`);
				return false;
			}

			const response = await auth.fetch(new Request('http://internal/verify-key', {
				method: 'POST',
				body: JSON.stringify({ apiKey })
			}));

			const result = await response.json();
			return result.valid;
		} catch (error) {
			console.error('API key and username verification error:', error);
			return false;
		}
	},

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
	async authenticateRequest(request, env) {
		const authHeader = request.headers.get('Authorization');
		if (!authHeader) {
			return false;
		}
		const [authType, authToken] = authHeader.split(' ');
		if (authType !== 'Bearer') {
			return false;
		}

		// Check if it's the admin API_SECRET
		if (authToken === env.API_SECRET) {
			return true;
		}

		// If not admin key, verify against user API keys
		return await this.verifyApiKey(authToken, env);
	},

	// Handle Create User
	async handleCreateUser(request, env) {
		const id = env.USER_AUTH.idFromName("global");
		const auth = env.USER_AUTH.get(id);
		return await auth.fetch(request);
	},

	// Handle Rotate API Key
	async handleRotateApiKey(request, env) {
		const id = env.USER_AUTH.idFromName("global");
		const auth = env.USER_AUTH.get(id);
		return await auth.fetch(request);
	},

	// The sheduled function to process download and activation queues.
	async scheduled(controller, env, ctx) {
		try {
			// First handle existing download/activation processing
			if (!env.DOWNLOAD_COUNTS || !env.PLUGIN_REGISTRY) {
				console.error('Missing required KV namespaces');
				return;
			}

			let updates = new Map();
			let activations = new Map();
			let cursor = undefined;

			// Process queues from KV storage
			do {
				const result = await env.DOWNLOAD_COUNTS.list({
					cursor,
					prefix: 'queue:'
				});

				if (!result) break;
				cursor = result.cursor;

				for (const key of result.keys || []) {
					if (!key?.name) continue;

					const parts = key.name.split(':');
					if (parts.length < 4) continue;

					const queueType = parts[1]; // 'activation' or other
					const author = parts[2];
					const slug = parts[3];
					const pluginKey = `${author}:${slug}`;

					// Process based on queue type
					if (queueType === 'activation') {
						activations.set(
							pluginKey,
							(activations.get(pluginKey) || 0) + 1
						);
					} else {
						updates.set(
							pluginKey,
							(updates.get(pluginKey) || 0) + 1
						);
					}

					// Delete the processed key
					await env.DOWNLOAD_COUNTS.delete(key.name)
						.catch(err => console.error(`Error deleting key ${key.name}:`, err));
				}
			} while (cursor);

			// Update registry if we have changes
			if (updates.size > 0 || activations.size > 0) {
				const registryId = env.PLUGIN_REGISTRY.idFromName("global");
				const registry = env.PLUGIN_REGISTRY.get(registryId);

				await registry.fetch(new Request('http://internal/update-counts', {
					method: 'POST',
					body: JSON.stringify({
						updates: Array.from(updates),
						activations: Array.from(activations)
					})
				}));

				console.log(`Processed ${updates.size} downloads and ${activations.size} activations`);
			}

		} catch (error) {
			console.error('Scheduled task error:', error);
			console.error('Environment state:', {
				hasDownloadCounts: !!env?.DOWNLOAD_COUNTS,
				hasPluginRegistry: !!env?.PLUGIN_REGISTRY,
				hasFederation: !!env?.FEDERATION
			});
		}
	},

	async handleDownload(request, env) {
		try {
			const url = new URL(request.url);
			const author = url.searchParams.get('author');
			const slug = url.searchParams.get('slug');
			const track = url.searchParams.get('track') !== 'false';

			if (!author || !slug) {
				return new Response(JSON.stringify({
					error: 'Missing author or slug parameter'
				}), {
					status: 400,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}

			if (track) {
				// Rate limiting logic stays the same
				const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Client-IP');
				const rateLimitKey = `ratelimit:${clientIP}:${author}:${slug}`;
				const currentTime = Date.now();

				const rateLimitData = await env.DOWNLOAD_RATELIMIT.get(rateLimitKey);
				if (rateLimitData) {
					const { timestamp, count } = JSON.parse(rateLimitData);
					if (currentTime - timestamp < 3600000 && count >= 5) {
						return new Response(JSON.stringify({
							error: 'Rate limit exceeded. Please try again later.'
						}), {
							status: 429,
							headers: {
								...CORS_HEADERS,
								'Content-Type': 'application/json',
								'Retry-After': '3600'
							}
						});
					}

					if (currentTime - timestamp < 3600000) {
						await env.DOWNLOAD_RATELIMIT.put(rateLimitKey, JSON.stringify({
							timestamp,
							count: count + 1
						}), { expirationTtl: 3600 });
					} else {
						await env.DOWNLOAD_RATELIMIT.put(rateLimitKey, JSON.stringify({
							timestamp: currentTime,
							count: 1
						}), { expirationTtl: 3600 });
					}
				} else {
					await env.DOWNLOAD_RATELIMIT.put(rateLimitKey, JSON.stringify({
						timestamp: currentTime,
						count: 1
					}), { expirationTtl: 3600 });
				}

				// Record download in KV store
				const downloadKey = `downloads:${author}:${slug}`;
				const queueKey = `download_queue:${author}:${slug}:${Date.now()}`;

				// Add to download queue with 1 hour expiration
				await env.DOWNLOAD_QUEUE.put(queueKey, '1', {
					expirationTtl: 3600
				});

				// Update running total in KV...maybe remove this soon.
				const currentCount = parseInt(await env.DOWNLOAD_COUNTS.get(downloadKey)) || 0;
				await env.DOWNLOAD_COUNTS.put(downloadKey, (currentCount + 1).toString());
			}

			// Get and return the zip file
			const zipKey = `${author}/${slug}/${slug}.zip`;
			const zipObject = await env.PLUGIN_BUCKET.get(zipKey);

			if (!zipObject) {
				return new Response(JSON.stringify({ error: 'Plugin not found' }), {
					status: 404,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}

			return new Response(zipObject.body, {
				status: 200,
				headers: {
					...CORS_HEADERS,
					'Content-Type': 'application/zip',
					'Content-Disposition': `attachment; filename="${slug}.zip"`
				}
			});
		} catch (error) {
			console.error('Download error:', error);
			return new Response(JSON.stringify({
				error: 'Internal server error',
				details: error.message
			}), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
			});
		}
	},
	async getDownloadCount(request, env) {
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

			const downloadKey = `downloads:${author}:${slug}`;
			const count = parseInt(await env.DOWNLOAD_COUNTS.get(downloadKey)) || 0;

			return new Response(JSON.stringify({ downloads: count }), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Get download count error:', error);
			return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

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

			// Get API key from Authorization header
			const authHeader = request.headers.get('Authorization');
			if (!authHeader) {
				return new Response(JSON.stringify({
					error: 'Missing Authorization header'
				}), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}
			const [, apiKey] = authHeader.split(' ');

			// Verify API key and username match
			const isValid = await this.verifyApiKeyAndUsername(apiKey, userId, env);
			if (!isValid) {
				return new Response(JSON.stringify({
					error: 'Unauthorized: Invalid API key or username mismatch'
				}), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}
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
			return new Response(JSON.stringify({
				error: 'Internal server error',
				details: error.message
			}), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
			});
		}
	},

	// Handle POST /upload-json
	async handleUploadJson(request, env) {
		try {
			const { userId, pluginName, jsonData } = await request.json();
			// Get API key from Authorization header
			const authHeader = request.headers.get('Authorization');
			if (!authHeader) {
				return new Response(JSON.stringify({
					error: 'Missing Authorization header'
				}), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}
			const [, apiKey] = authHeader.split(' ');

			// Verify API key and username match
			const isValid = await this.verifyApiKeyAndUsername(apiKey, userId, env);
			if (!isValid) {
				return new Response(JSON.stringify({
					error: 'Unauthorized: Invalid API key or username mismatch'
				}), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}

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

			return new Response(JSON.stringify({ success: true, message: 'JSON uploaded successfully' }), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('JSON upload error:', error);
			return new Response(JSON.stringify({
				error: 'Internal server error',
				details: error.message
			}), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
			});
		}
	},

	// Handle POST /finalize-upload
	async handleFinalizeUpload(request, env) {
		try {
			const { userId, pluginName, metadata } = await request.json();

			// Get API key from Authorization header
			const authHeader = request.headers.get('Authorization');
			if (!authHeader) {
				return new Response(JSON.stringify({
					error: 'Missing Authorization header'
				}), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}
			const [, apiKey] = authHeader.split(' ');

			// Verify API key and username match
			const isValid = await this.verifyApiKeyAndUsername(apiKey, userId, env);
			if (!isValid) {
				return new Response(JSON.stringify({
					error: 'Unauthorized: Invalid API key or username mismatch'
				}), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}
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

			if (authorInfo) {
				// Get DO instance
				const id = env.PLUGIN_REGISTRY.idFromName("global");
				const registry = env.PLUGIN_REGISTRY.get(id);

				// Sync author data
				await registry.fetch(new Request('http://internal/sync-author', {
					method: 'POST',
					body: JSON.stringify(authorInfo)
				}));
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

			// After successfully storing metadata in R2
			const metadataKey = `${userId}/${pluginName}/${pluginName}.json`;
			await env.PLUGIN_BUCKET.put(metadataKey, JSON.stringify(finalMetadata), {
				httpMetadata: {
					contentType: 'application/json',
				},
			});

			// Update SQLite database
			const pluginInfo = finalMetadata[0];

			// Get DO instance to update SQLite
			const id = env.PLUGIN_REGISTRY.idFromName("global");
			const registry = env.PLUGIN_REGISTRY.get(id);

			const updateRequest = new Request('http://internal/migrate-data', {
				method: 'POST',
				body: JSON.stringify({
					author: userId,
					slug: sanitizedPluginName,
					jsonKey: metadataKey
				})
			});

			const updateResponse = await registry.fetch(updateRequest);
			if (!updateResponse.ok) {
				console.error('Failed to update SQLite database:', await updateResponse.text());
			}

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
			return new Response(JSON.stringify({
				error: 'Internal server error',
				details: error.message
			}), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
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

			const authorInfoKey = `${userId}/author_info.json`;

			await env.PLUGIN_BUCKET.put(authorInfoKey, JSON.stringify(parsedAuthorData, null, 2), {
				httpMetadata: {
					contentType: 'application/json',
				},
			});

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

			// Get API key from Authorization header
			const authHeader = request.headers.get('Authorization');
			if (!authHeader) {
				return new Response(JSON.stringify({
					error: 'Missing Authorization header'
				}), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}
			const [, apiKey] = authHeader.split(' ');

			// Verify API key and username match
			const isValid = await this.verifyApiKeyAndUsername(apiKey, userId, env);
			if (!isValid) {
				return new Response(JSON.stringify({
					error: 'Unauthorized: Invalid API key or username mismatch'
				}), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}

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
			console.error('Asset upload error:', error);
			return new Response(JSON.stringify({
				error: 'Internal server error',
				details: error.message
			}), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
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
				response = await generatePluginHTML(pluginData, env);

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
				const authorData = await this.fetchAuthorPageData(author, env);
				if (!authorData) {
					return new Response('Author not found', { status: 404 });
				}
				response = await generateAuthorHTML(authorData, env, request);

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

	async handleSearchResultsPage(request, env) {
		const url = new URL(request.url);
		const query = url.searchParams.get('q') || '';
		const tags = url.searchParams.getAll('tag');
		const limit = parseInt(url.searchParams.get('limit') || '20');
		const offset = parseInt(url.searchParams.get('offset') || '0');

		// Get DO instance
		const id = env.PLUGIN_REGISTRY.idFromName("global");
		const registry = env.PLUGIN_REGISTRY.get(id);

		// Create internal search request
		const searchRequest = new Request('http://internal/search', {
			method: 'POST',
			body: JSON.stringify({
				query,
				tags,
				limit,
				offset
			})
		});

		try {
			// Fetch results from Durable Object
			const searchResponse = await registry.fetch(searchRequest);
			if (!searchResponse.ok) {
				throw new Error(`Search request failed: ${searchResponse.status}`);
			}

			const results = await searchResponse.json();

			// Generate the HTML page with the results
			return generateSearchHTML(results, query, tags, offset, limit, env);
		} catch (error) {
			console.error('Search error:', error);
			return new Response('Internal Server Error', { status: 500 });
		}
	},

	async handleActivation(request, env) {
		try {
			const url = new URL(request.url);
			const author = url.searchParams.get('author');
			const slug = url.searchParams.get('slug');

			if (!author || !slug) {
				return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
					status: 400,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			const queueKey = `queue:activation:${author}:${slug}:${Date.now()}`;

			// Add to queue with 1 hour expiration
			await env.DOWNLOAD_COUNTS.put(queueKey, '1', {
				expirationTtl: 3600
			});

			return new Response(JSON.stringify({
				success: true,
				message: 'Activation message queued. Thanks for using the plugin! This ping helps us anonymously track the number of activated installs.'
			}), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});

		} catch (error) {
			console.error('Activation tracking error:', error);
			return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	async getActivationCount(request, env) {
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

			const activationKey = `activations:${author}:${slug}`;
			const count = parseInt(await env.DOWNLOAD_COUNTS.get(activationKey)) || 0;

			return new Response(JSON.stringify({ activations: count }), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Get activation count error:', error);
			return new Response(JSON.stringify({ error: 'Internal server error', details: error.message }), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	async handleHomepage(request, env) {
		try {
			// Check cache first
			const cache = caches.default;
			let response = await cache.match(request);

			if (!response) {
				// Get DO instance
				const id = env.PLUGIN_REGISTRY.idFromName("global");
				const registry = env.PLUGIN_REGISTRY.get(id);

				// Fetch authors from database
				const authorsRequest = new Request('http://internal/list-authors', {
					method: 'POST'
				});

				const authorsResponse = await registry.fetch(authorsRequest);
				if (!authorsResponse.ok) {
					throw new Error('Failed to fetch authors');
				}

				const authors = await authorsResponse.json();
				response = await generateHomeHTML(authors, env, request);

				// Cache the response
				response.headers.set('Cache-Control', 'public, max-age=3600');
				await cache.put(request, response.clone());
			}

			return response;
		} catch (error) {
			console.error('Homepage error:', error);
			return new Response('Internal Server Error', { status: 500 });
		}
	},

	// This is gross, refactor later...
	async handleClearCache(request, env) {
		try {
			if (!this.authenticateRequest(request, env)) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
				});
			}

			const cache = caches.default;
			const url = new URL(request.url);

			// List of all domains to clear cache for
			const domains = [
				request.headers.get('host'),
				'pluginpublisher.com' // Replace with your configured domain.
				// Add any other domains here
			];

			// List of URL patterns to clear
			const urlPatterns = [
				`/`,
				`/directory/*`,
				`/plugin-data*`,
				`/author/*`,
				`/author-data*`,
				`/authors-list`,
				`/directory/search*`
			];

			const clearedKeys = [];

			// Get list of all authors to ensure we clear their specific caches
			const authorsList = await env.PLUGIN_BUCKET.list();
			const authors = new Set();
			for (const item of authorsList.objects) {
				const parts = item.key.split('/');
				if (parts.length > 1) {
					authors.add(parts[0]);
				}
			}

			// Clear cache for each domain and pattern combination
			for (const domain of domains) {
				for (const pattern of urlPatterns) {
					if (pattern.includes('*')) {
						// For wildcard patterns, we need to specifically clear author-related caches
						for (const author of authors) {
							const specificUrl = pattern
								.replace('*', `${author}`)
								.replace('//', '/');

							// Clear both HTTP and HTTPS versions
							const httpsKey = `https://${domain}${specificUrl}`;
							const httpKey = `http://${domain}${specificUrl}`;

							await cache.delete(httpsKey);
							await cache.delete(httpKey);
							clearedKeys.push(httpsKey, httpKey);

							// If it's a directory pattern, also clear plugin-specific caches
							if (pattern.startsWith('/directory/')) {
								const pluginsList = await env.PLUGIN_BUCKET.list({ prefix: `${author}/` });
								for (const plugin of pluginsList.objects) {
									const pluginParts = plugin.key.split('/');
									if (pluginParts.length === 3 && pluginParts[2].endsWith('.json')) {
										const pluginSlug = pluginParts[1];
										const httpsPluginUrl = `https://${domain}/directory/${author}/${pluginSlug}`;
										const httpPluginUrl = `http://${domain}/directory/${author}/${pluginSlug}`;

										await cache.delete(httpsPluginUrl);
										await cache.delete(httpPluginUrl);
										clearedKeys.push(httpsPluginUrl, httpPluginUrl);
									}
								}
							}
						}
					} else {
						// For non-wildcard patterns, clear both HTTP and HTTPS versions
						const httpsKey = `https://${domain}${pattern}`;
						const httpKey = `http://${domain}${pattern}`;

						await cache.delete(httpsKey);
						await cache.delete(httpKey);
						clearedKeys.push(httpsKey, httpKey);
					}
				}
			}

			return new Response(JSON.stringify({
				success: true,
				message: 'Cache cleared successfully',
				clearedKeys
			}), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Cache clear error:', error);
			return new Response(JSON.stringify({
				success: false,
				error: 'Internal server error',
				details: error.message
			}), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	// Separate get handler that can be controled on public facing cache clears. @todo remove this later. Needed until I have a better way to control cache clears.
	async handleClearCacheGet(request, env) {
		try {
			const cache = caches.default;
			const url = new URL(request.url);

			// List of all domains to clear cache for
			const domains = [
				request.headers.get('host'),
				'pluginpublisher.com'
				// Add any other domains here
			];

			// List of URL patterns to clear
			const urlPatterns = [
				`/`,
				`/directory/*`,
				`/plugin-data*`,
				`/author/*`,
				`/author-data*`,
				`/authors-list`,
				`/directory/search*`
			];

			const clearedKeys = [];

			// Get list of all authors to ensure we clear their specific caches
			const authorsList = await env.PLUGIN_BUCKET.list();
			const authors = new Set();
			for (const item of authorsList.objects) {
				const parts = item.key.split('/');
				if (parts.length > 1) {
					authors.add(parts[0]);
				}
			}

			// Clear cache for each domain and pattern combination
			for (const domain of domains) {
				for (const pattern of urlPatterns) {
					if (pattern.includes('*')) {
						// For wildcard patterns, we need to specifically clear author-related caches
						for (const author of authors) {
							const specificUrl = pattern
								.replace('*', `${author}`)
								.replace('//', '/');

							// Clear both HTTP and HTTPS versions
							const httpsKey = `https://${domain}${specificUrl}`;
							const httpKey = `http://${domain}${specificUrl}`;

							await cache.delete(httpsKey);
							await cache.delete(httpKey);
							clearedKeys.push(httpsKey, httpKey);

							// If it's a directory pattern, also clear plugin-specific caches
							if (pattern.startsWith('/directory/')) {
								const pluginsList = await env.PLUGIN_BUCKET.list({ prefix: `${author}/` });
								for (const plugin of pluginsList.objects) {
									const pluginParts = plugin.key.split('/');
									if (pluginParts.length === 3 && pluginParts[2].endsWith('.json')) {
										const pluginSlug = pluginParts[1];
										const httpsPluginUrl = `https://${domain}/directory/${author}/${pluginSlug}`;
										const httpPluginUrl = `http://${domain}/directory/${author}/${pluginSlug}`;

										await cache.delete(httpsPluginUrl);
										await cache.delete(httpPluginUrl);
										clearedKeys.push(httpsPluginUrl, httpPluginUrl);
									}
								}
							}
						}
					} else {
						// For non-wildcard patterns, clear both HTTP and HTTPS versions
						const httpsKey = `https://${domain}${pattern}`;
						const httpKey = `http://${domain}${pattern}`;
						// remote the root key as it is not needed.
						await cache.delete(`https://${request.headers.get('host')}/`);
						await cache.delete(httpsKey);
						await cache.delete(httpKey);
						clearedKeys.push(httpsKey, httpKey);
					}
				}
			}

			return new Response(JSON.stringify({
				success: true,
				message: 'Cache cleared successfully'
			}), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		} catch (error) {
			console.error('Cache clear error:', error);
			return new Response(JSON.stringify({
				success: false,
				error: 'Internal server error'
			}), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		}
	},

	async handleDeleteUser(request, env) {
		try {
			// This endpoint requires admin API_SECRET
			const authHeader = request.headers.get('Authorization');
			if (!authHeader || authHeader !== `Bearer ${env.API_SECRET}`) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}

			const data = await request.json();
			const { username } = data;

			if (!username) {
				return new Response(JSON.stringify({ error: 'Missing username' }), {
					status: 400,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}

			// Delete user data in parallel for better performance
			const [authResult, registryResult, bucketResult] = await Promise.allSettled([
				// 1. Delete from UserAuthDO
				(async () => {
					const authId = env.USER_AUTH.idFromName("global");
					const auth = env.USER_AUTH.get(authId);
					const response = await auth.fetch(new Request('http://internal/delete-user', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ username })
					}));

					if (!response.ok) {
						const error = await response.text();
						throw new Error(`Auth deletion failed: ${error}`);
					}
					return await response.json();
				})(),

				// 2. Delete from PluginRegistryDO
				(async () => {
					const registryId = env.PLUGIN_REGISTRY.idFromName("global");
					const registry = env.PLUGIN_REGISTRY.get(registryId);
					const response = await registry.fetch(new Request('http://internal/delete-author', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ authorName: username })
					}));

					if (!response.ok) {
						const error = await response.text();
						throw new Error(`Registry deletion failed: ${error}`);
					}
					return await response.json();
				})(),

				// 3. Delete files from bucket
				(async () => {
					const prefix = `${username}/`;
					const files = await env.PLUGIN_BUCKET.list({ prefix });
					const deletionResults = await Promise.all(
						files.objects.map(file => env.PLUGIN_BUCKET.delete(file.key))
					);
					return { deletedFiles: files.objects.length };
				})()
			]);

			// Process results and build response
			const response = {
				success: true,
				details: {
					auth: authResult.status === 'fulfilled' ? authResult.value : { error: authResult.reason?.message },
					registry: registryResult.status === 'fulfilled' ? registryResult.value : { error: registryResult.reason?.message },
					storage: bucketResult.status === 'fulfilled' ? bucketResult.value : { error: bucketResult.reason?.message }
				}
			};

			// If any operation failed, mark overall success as false but continue with others
			if (authResult.status === 'rejected' || registryResult.status === 'rejected' || bucketResult.status === 'rejected') {
				response.success = false;
				response.message = 'Some deletion operations failed. Check details for more information.';
				return new Response(JSON.stringify(response), {
					status: 207, // 207 Multi-Status
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}

			response.message = `User ${username} and all associated data have been deleted`;
			return new Response(JSON.stringify(response), {
				status: 200,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
			});

		} catch (error) {
			console.error('Error deleting user:', error);
			return new Response(JSON.stringify({
				success: false,
				error: 'Internal server error',
				details: error.message
			}), {
				status: 500,
				headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
			});
		}
	},	  
	  

	async fetch(request, env) {
		const url = new URL(request.url);
		const path = url.pathname;

		// Get DO instance (one global instance for the registry)
		const id = env.PLUGIN_REGISTRY.idFromName("global");
		const registry = env.PLUGIN_REGISTRY.get(id);

		// Special case for user creation - doesn't require API key auth
		if (path === '/create-user' && request.method === "POST") {
			return await this.handleCreateUser(request, env);
		}

		if (path === '/request-key-roll' && request.method === "POST") {

			const { username, email } = await request.json();
			console.log(`Requesting API key roll for ${username} (${email})`);

			const id = env.USER_AUTH.idFromName("global");
			const auth = env.USER_AUTH.get(id);

			// Create a new request with the parsed body data
			const internalRequest = new Request('http://internal/request-key-roll', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ username, email })
			});

			return await auth.fetch(internalRequest);
		}

		// Handle preflight requests
		if (request.method === 'OPTIONS') {
			return this.handleOptions(request);
		}

		// Authenticate non-GET requests (except certain public endpoints)
		if (request.method !== 'GET' && 
			![
			  '/search', 
			  '/initiate-key-roll', 
			  '/verify-key-roll', 
			  // Federation endpoints should be public
			  '/federation-info',
			  '/federated/plugin-data', 
			  '/verify-ownership',
			  '/federated/download'
			].includes(path)) {
		  if (!await this.authenticateRequest(request, env)) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			  status: 401,
			  headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
			});
		  }
		}
		
		
		// Main request routing
		switch (request.method) {
			case 'GET': {
				switch (path) {
					case '/': {
						return this.handleHomepage(request, env);
					}
					case '/federation-info': {
						return await FEDERATION_ENDPOINTS.handleFederationInfo(request, env);
					}
		
					case '/federated/plugin-data': {
						return await FEDERATION_ENDPOINTS.handlePluginData(request, env);
					}
					case '/federated/download': {
						return await FEDERATION_ENDPOINTS.handlePluginDownload(request, env);
					}		
					case '/download': {
						return this.handleDownload(request, env);
					}
					case '/clear-cache': {
						return this.handleClearCacheGet(request, env);
					}
					case '/download-count': {
						return this.getDownloadCount(request, env);
					}
					case '/plugin-data': {
						return this.handleGetPluginData(request, env);
					}
					case '/author-data': {
						return this.handleGetAuthorData(request, env);
					}
					case '/authors-list': {
						return this.handleGetAuthorsList(env);
					}
					case '/version-check': {
						return this.handleVersionCheck(request, env);
					}
					case '/activate': {
						return this.handleActivation(request, env);
					}
					case '/activation-count': {
						return this.getActivationCount(request, env);
					}
					case '/register': {
						return generateRegisterHTML();
					}
					case '/roll-api-key': {
						if (url.searchParams.has('token')) {
							return generateRollKeyHTML();
						}
						return generateRequestKeyRollHTML();
					}
					case '/roll-key-with-token': {
						const { token } = await request.json();
						const id = env.USER_AUTH.idFromName("global");
						const auth = env.USER_AUTH.get(id);
						return await auth.fetch(request);
					}
					case '/search': {
						const searchQuery = url.searchParams.get('q') || '';
						const searchTags = url.searchParams.getAll('tag');
						const limit = parseInt(url.searchParams.get('limit') || '20');
						const offset = parseInt(url.searchParams.get('offset') || '0');

						const searchRequest = new Request('http://internal/search', {
							method: 'POST',
							body: JSON.stringify({
								query: searchQuery,
								tags: searchTags,
								limit,
								offset
							})
						});

						const results = await registry.fetch(searchRequest);
						return new Response(await results.text(), {
							headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
						});
					}
					case '/directory/search': {
						return this.handleSearchResultsPage(request, env);
					}
					default: {
						// Handle directory and author paths that need path parameter extraction
						if (path.startsWith('/directory/') && path.split('/').length === 4) {
							return this.handleGetPluginDirectory(request, env);
						}
						if (path.startsWith('/author/') && path.split('/').length === 3) {
							return this.handleGetAuthorDirectory(request, env);
						}
						break;
					}
				}
				break;
			}

			case 'POST': {
				switch (path) {
					case '/migrate-data': {
						try {
							const migrateRequest = new Request('http://internal/migrate-data', {
								method: 'POST',
								body: JSON.stringify({})
							});
							const response = await registry.fetch(migrateRequest);

							// Even if there's a JSON parse error, check if columns were added
							const text = await response.text();
							let result;
							try {
								result = JSON.parse(text);
							} catch (e) {
								// If JSON parsing fails but we see success indicators in the text
								if (text.includes('Updated table schema') ||
									text.includes('activation_count')) {
									result = {
										success: true,
										message: 'Schema update completed with warnings',
										warning: 'Migration completed but encountered non-fatal errors'
									};
								} else {
									throw e; // Re-throw if it's a real error
								}
							}

							return new Response(JSON.stringify(result), {
								status: 200,
								headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
							});
						} catch (error) {
							return new Response(JSON.stringify({
								success: false,
								error: 'Migration error',
								details: error.message,
								status: 'partial',
								message: 'Schema may have been updated despite errors'
							}), {
								status: 200, // Using 200 since it might be partially successful
								headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
							});
						}
					}
					case '/delete-plugin': {
						try {
							const { authorName, pluginName } = await request.json();
							const response = await removePlugin(authorName, pluginName, env);
							return new Response(JSON.stringify(response), {
								status: response.success ? 200 : 400,
								headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
							});
						} catch (error) {
							return new Response(JSON.stringify({
								success: false,
								message: 'Failed to delete plugin'
							}), {
								status: 500,
								headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
							});
						}
					}
					case '/initiate-key-roll': {
						const { username, email } = await request.json();
						if (!username || !email) {
							return new Response(JSON.stringify({
								error: 'Missing required fields'
							}), {
								status: 400,
								headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
							});
						}

						const id = env.USER_AUTH.idFromName("global");
						const auth = env.USER_AUTH.get(id);

						const internalRequest = new Request('http://internal/initiate-key-roll', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json'
							},
							body: JSON.stringify({ username, email })
						});

						return await auth.fetch(internalRequest);
					}
					case '/verify-ownership': {
						return await FEDERATION_ENDPOINTS.handleVerifyOwnership(request, env);
					  }					
					case '/verify-key-roll': {
						const { gistUrl, verificationToken } = await request.json();
						if (!gistUrl || !verificationToken) {
							return new Response(JSON.stringify({
								error: 'Missing required fields'
							}), {
								status: 400,
								headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
							});
						}

						const id = env.USER_AUTH.idFromName("global");
						const auth = env.USER_AUTH.get(id);

						const internalRequest = new Request('http://internal/verify-key-roll', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json'
							},
							body: JSON.stringify({ gistUrl, verificationToken })
						});

						return await auth.fetch(internalRequest);
					}

					case '/delete-author': {
						try {
							const { authorName } = await request.json();
							const response = await removeAuthor(authorName, env);
							return new Response(JSON.stringify(response), {
								status: response.success ? 200 : 400,
								headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
							});
						} catch (error) {
							return new Response(JSON.stringify({
								success: false,
								message: 'Failed to delete author'
							}), {
								status: 500,
								headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
							});
						}
					}
					case '/migrate-authors': {
						const id = env.PLUGIN_REGISTRY.idFromName("global");
						const registry = env.PLUGIN_REGISTRY.get(id);

						const migrateRequest = new Request('http://internal/migrate-authors', {
							method: 'POST'
						});
						const response = await registry.fetch(migrateRequest);

						return new Response(await response.text(), {
							status: response.status,
							headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
						});
					}
					case '/record-download': {
						const author = url.searchParams.get('author');
						const slug = url.searchParams.get('slug');

						if (!author || !slug) {
							return new Response(JSON.stringify({ error: 'Missing author or slug parameter' }), {
								status: 400,
								headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
							});
						}

						const downloadRequest = new Request(url, {
							method: 'POST',
							body: JSON.stringify({ author, slug })
						});
						return await registry.fetch(downloadRequest);
					}
					case '/upload-plugin': {
						return this.handlePluginUpload(request, env);
					}
					case '/plugin-upload-chunk': {
						return this.handlePluginUploadChunk(request, env);
					}
					case '/plugin-upload-json': {
						return this.handleUploadJson(request, env);
					}
					case '/plugin-upload-assets': {
						return this.handleUploadAsset(request, env);
					}
					case '/plugin-upload-complete': {
						return this.handleFinalizeUpload(request, env);
					}
					case '/update-author-info': {
						return this.handleUpdateAuthorInfo(request, env);
					}
					case '/backup-plugin': {
						return this.handleBackupPlugin(request, env);
					}
					case '/clear-cache': {
						return this.handleClearCache(request, env);
					}
					case '/create-user': {
						return await this.handleCreateUser(request, env);
					}
					case '/delete-user': {
						return this.handleDeleteUser(request, env);
					}
					case '/rotate-key': {
						return await this.handleRotateApiKey(request, env);
					}
					case '/admin-update-user': {
						const id = env.USER_AUTH.idFromName("global");
						const auth = env.USER_AUTH.get(id);

						// Verify API key at the worker level
						const authHeader = request.headers.get('Authorization');
						if (!authHeader || authHeader !== `Bearer ${env.API_SECRET}`) {
							return new Response(JSON.stringify({
								error: 'Unauthorized'
							}), { status: 401 });
						}

						// Create internal request with admin flag @todo maybe this can be different in the future.
						const internalRequest = new Request('http://internal/admin-update-user', {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								'X-Admin-Secret': env.API_SECRET
							},
							body: JSON.stringify(await request.json())
						});

						return await auth.fetch(internalRequest);
					}
					default: {
						return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
							status: 404,
							headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
						});
					}
				}
				break;
			}

			default: {
				return new Response(JSON.stringify({ error: 'Method not allowed' }), {
					status: 405,
					headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
				});
			}
		}

		return new Response(JSON.stringify({ error: 'Not found' }), {
			status: 404,
			headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
		});
	}
};
