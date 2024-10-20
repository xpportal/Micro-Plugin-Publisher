// Import necessary dependencies
import { Buffer } from 'buffer';

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

      const jsonKey = `${author}/${slug}/${slug}.json`;
      const jsonObject = await env.PLUGIN_BUCKET.get(jsonKey);

      if (!jsonObject) {
        return new Response(JSON.stringify({ error: 'Plugin not found' }), {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const jsonData = await jsonObject.text();
      return new Response(jsonData, {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
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

      const authorData = await this.fetchAuthorData(author, env);

      if (!authorData) {
        return new Response(JSON.stringify({ error: 'Author not found' }), {
          status: 404,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const plugins = await this.fetchAuthorPlugins(author, env);

      const response = {
        ...authorData,
        plugins,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
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

      return new Response(JSON.stringify(authors), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
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

      console.log(`Received author info for plugin: ${pluginName}`);

      const authorInfoKey = `${userId}/author_info.json`;

      await env.PLUGIN_BUCKET.put(authorInfoKey, JSON.stringify(authorData), {
        httpMetadata: {
          contentType: 'application/json',
        },
      });

      console.log('Successfully stored author info');

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
    
    try {
      const authorInfoObject = await env.PLUGIN_BUCKET.get(authorInfoKey);
      
      if (!authorInfoObject) {
        console.error(`Author info not found for ${author}`);
        return null;
      }

      const authorData = JSON.parse(await authorInfoObject.text());
      authorData.authorId = author;
      return authorData;
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
      if (item.key.endsWith('.json') && !item.key.endsWith('author_info.json')) {
        const jsonData = await env.PLUGIN_BUCKET.get(item.key);
        const pluginData = JSON.parse(await jsonData.text());

        console.log(`Plugin data for ${item.key}:`, pluginData);
        
        plugins.push({
          slug: item.key.split('/')[1].replace('.json', ''),
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
  async fetch(request, env) {
	const url = new URL(request.url);
	const path = url.pathname;

	// Handle preflight requests
	if (request.method === 'OPTIONS') {
	  return handleOptions(request);
	}

	// Authenticate the request
	if (!this.authenticateRequest(request, env)) {
	  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
		status: 401,
		headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
	  });
	}

	// Route the request
	switch (request.method) {
	  case 'GET':
		if (path === '/plugin-data') {
		  return this.handleGetPluginData(request, env);
		} else if (path === '/author-data') {
		  return this.handleGetAuthorData(request, env);
		} else if (path === '/authors-list') {
		  return this.handleGetAuthorsList(env);
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