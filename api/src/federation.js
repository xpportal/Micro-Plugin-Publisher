// federationIntegration.js
import { sign, etc } from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

etc.sha512Sync = (...m) => sha512(etc.concatBytes(...m));

function parsePrivateKey(privateKey) {
	try {
	  // Clean up the key - handle both single-line and multi-line formats
	  const cleanKey = privateKey
		.replace('-----BEGIN PRIVATE KEY-----', '')
		.replace('-----END PRIVATE KEY-----', '')
		.replace(/\s+/g, ''); // Remove all whitespace
	  
	  // For debugging
	  console.log("Cleaned key length:", cleanKey.length);
	  
	  // Attempt to decode the base64
	  try {
		const keyBytes = Buffer.from(cleanKey, 'base64');
		console.log("Decoded key length:", keyBytes.length);
		
		// Ed25519 private keys should be 32 bytes
		// The key might be in PKCS8 format which adds a wrapper
		// If it's in PKCS8, we need to extract just the key portion
		if (keyBytes.length > 32) {
		  // PKCS8 format - extract the actual key
		  // The key is typically located after a specific offset
		  return new Uint8Array(keyBytes.slice(-32));
		}
		
		return new Uint8Array(keyBytes);
	  } catch (decodeError) {
		console.error("Base64 decode error:", decodeError);
		throw new Error("Failed to decode private key from base64");
	  }
	} catch (error) {
	  console.error("Key parsing error:", error);
	  throw new Error(`Failed to parse private key: ${error.message}`);
	}
  }
  

  // Helper to validate the environment variables
function validateEnvironment(env) {
	const required = {
	  'FEDERATION_PRIVATE_KEY': env.FEDERATION_PRIVATE_KEY,
	  'FEDERATION_PUBLIC_KEY': env.FEDERATION_PUBLIC_KEY,
	  'NODE_ID': env.NODE_ID
	};
  
	const missing = Object.entries(required)
	  .filter(([key, value]) => !value)
	  .map(([key]) => key);
  
	if (missing.length > 0) {
	  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
	}
  }
  
  
  async function getNodeStats(env) {
	const registry = env.PLUGIN_REGISTRY.get(env.PLUGIN_REGISTRY.idFromName("global"));
	const response = await registry.fetch(new Request('http://internal/stats', {
	  method: 'POST',  // Changed from GET to POST
	  headers: {
		'Content-Type': 'application/json'
	  },
	  body: JSON.stringify({}) // Empty body but required for POST
	}));
  
	if (!response.ok) {
	  throw new Error(`Failed to fetch stats: ${await response.text()}`);
	}
  
	return await response.json();
  }
  
  
export const FEDERATION_ENDPOINTS = {
  // Provides information about this node to federation layer
  async handleFederationInfo(request, env) {
    try {
      // Validate environment first
      validateEnvironment(env);
      
      const stats = await getNodeStats(env);
      const nodeUrl = new URL(request.url).origin;

      // Sign the timestamp to prove we control the private key
      const timestamp = Date.now();
      const message = new TextEncoder().encode(timestamp.toString());
      
      console.log("Attempting to parse private key...");
      const privateKeyBytes = parsePrivateKey(env.FEDERATION_PRIVATE_KEY);
      console.log("Successfully parsed private key, length:", privateKeyBytes.length);
      
      const signature = await sign(message, privateKeyBytes);
      console.log("Successfully created signature");

      return new Response(JSON.stringify({
        // Basic node information
        version: '1.0.0',
        nodeId: env.NODE_ID,
        nodeUrl: nodeUrl,
        
        // Federation capabilities
        features: [
          'plugin-sync',
          'key-verification',
          'signature-verification',
          'plugin-mirroring'
        ],
        
        // Authentication info
        publicKey: env.FEDERATION_PUBLIC_KEY,
        
        // Node stats and health
        stats: {
          plugins: {
            total: stats.plugins.total || 0,
            downloads: stats.plugins.downloads || 0,
            activations: stats.plugins.activations || 0
          },
          authors: {
            total: stats.authors.total || 0
          },
          tags: {
            total: stats.tags.total || 0
          },
          storage: {
            totalPlugins: stats.plugins.total || 0,
            lastUpdate: stats.lastUpdate || null
          },
          activity: {
            recent: stats.recentActivity || [],
            lastUpdate: stats.lastUpdate || null
          }
        },
		// Health and verification
		health: {
		  status: 'healthy',
		  lastCheck: timestamp,
		  uptime: process.uptime(),
		  signature: Buffer.from(signature).toString('base64')
		},

		// Asset domain and naming scheme
		// This provides information about where to find production files
		assetInfo: {
		  domain: 'https://assets.pluginpublisher.com',
		  namingScheme: 'author/slug/slug.zip'
		},        
        timestamp
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'X-Node-Id': env.NODE_ID,
          'X-Federation-Version': '1.0.0',
          'X-Federation-Timestamp': timestamp.toString(),
          'X-Federation-Signature': Buffer.from(signature).toString('base64')
        }
      });
    } catch (error) {
      console.error('Federation info error:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        details: error.message
      }), {
        status: 500,
        headers: { 
          'Content-Type': 'application/json',
          'X-Node-Id': env.NODE_ID
        }
      });
    }
  },


  // Responds to federation layer challenge to verify node identity
async handleVerifyOwnership(request, env) {
try {
	const { username, challenge } = await request.json();
	console.log('Got federation verify request:', { username, challenge });

	// Skip user verification for federation requests
	// Just verify we have the keys configured
	if (!env.FEDERATION_PRIVATE_KEY) {
	console.error('Missing federation private key');
	return new Response(JSON.stringify({ error: 'Node not configured for federation' }), {
		status: 500,
		headers: { 'Content-Type': 'application/json' }
	});
	}

	// Sign the challenge with our node's private key
	const message = new TextEncoder().encode(challenge);
	console.log("Attempting to parse private key...");
	const privateKeyBytes = parsePrivateKey(env.FEDERATION_PRIVATE_KEY);
	console.log("Successfully parsed private key, length:", privateKeyBytes.length);
	const signature = await sign(message, privateKeyBytes);
	console.log('Challenge signed successfully');

	return new Response(JSON.stringify({
	signature: Buffer.from(signature).toString('base64'),
	timestamp: Date.now()
	}), {
	headers: { 
		'Content-Type': 'application/json',
		'X-Node-Id': env.NODE_ID
	}
	});
} catch (error) {
	console.error('Error in verify ownership:', error);
	return new Response(JSON.stringify({ 
	error: error.message,
	stack: error.stack 
	}), {
	status: 500,
	headers: { 'Content-Type': 'application/json' }
	});
}
},
	
  // In the federation node's recordVerificationAttempt
  async recordVerificationAttempt(sourceId, health, keyVerification) {
	try {
	  console.log('Recording verification attempt:', {
		sourceId,
		healthStatus: health.isUp,
		keyVerification
	  });
  
	  const verificationResult = health.isUp && keyVerification ? 'success' : 'failure';
	  const verificationDetails = JSON.stringify({ health, keyVerification });
  
	  // Log the query and params we're about to execute
	  const query = `
		INSERT INTO source_verifications (
		  source_id, verifier, verification_type,
		  result, details
		) VALUES (?, ?, ?, ?, ?)
	  `;
	  const params = [
		sourceId,
		'system',
		'initial',
		verificationResult,
		verificationDetails
	  ];
	  console.log('Executing verification record query:', { query, params });
  
	  await this.sql.exec(query, params);
	  console.log('Verification record created successfully');
	} catch (error) {
	  console.error('Error recording verification:', error);
	  console.error('Stack:', error.stack);
	  throw error;
	}
  },
  // Provides signed plugin data to federation layer
  async handlePluginData(request, env) {
    try {
      const url = new URL(request.url);
      const author = url.searchParams.get('author');
      const slug = url.searchParams.get('slug');

      if (!author || !slug) {
        return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const jsonKey = `${author}/${slug}/${slug}.json`;
      const jsonObject = await env.PLUGIN_BUCKET.get(jsonKey);

      if (!jsonObject) {
        return new Response(JSON.stringify({ error: 'Plugin not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const pluginData = JSON.parse(await jsonObject.text());
      
      // Sign the plugin data
      const message = new TextEncoder().encode(JSON.stringify(pluginData));
      const privateKeyBytes = parsePrivateKey(env.FEDERATION_PRIVATE_KEY);
      const signature = await sign(message, privateKeyBytes);

      return new Response(JSON.stringify({
        data: pluginData,
        signature: Buffer.from(signature).toString('base64'),
        nodeId: env.NODE_ID,
        timestamp: Date.now()
      }), {
        headers: {
          'Content-Type': 'application/json',
          'X-Node-Id': env.NODE_ID,
          'X-Node-Signature': Buffer.from(signature).toString('base64')
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  // Provides signed plugin zip file to federation layer
  async handlePluginDownload(request, env) {
    try {
      const url = new URL(request.url);
      const author = url.searchParams.get('author');
      const slug = url.searchParams.get('slug');
      const version = url.searchParams.get('version');

      if (!author || !slug || !version) {
        return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const zipKey = `${author}/${slug}/${slug}.zip`;
      const zipObject = await env.PLUGIN_BUCKET.get(zipKey);

      if (!zipObject) {
        return new Response(JSON.stringify({ error: 'Plugin not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Sign download data
      const message = new TextEncoder().encode(JSON.stringify({
        author,
        slug,
        version,
        timestamp: Date.now()
      }));

      const privateKeyBytes = parsePrivateKey(env.FEDERATION_PRIVATE_KEY);
      const signature = await sign(message, privateKeyBytes);

      return new Response(zipObject.body, {
        headers: {
          'Content-Type': 'application/zip',
          'X-Node-Id': env.NODE_ID,
          'X-Node-Signature': Buffer.from(signature).toString('base64')
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};