export class UserAuthDO {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.sql = state.storage.sql;

		// Only verify USER_KEY_SALT is present as it's needed for all key operations
		if (!env.USER_KEY_SALT || !env.INVITE_CODE) {
			throw new Error('Missing required secret: USER_KEY_SALT');
		}

		this.initializeSchema();
	}

	async initializeSchema() {
		try {
			await this.sql.exec(`
		  CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			key_id TEXT NOT NULL UNIQUE,      -- Public identifier for the key
			key_hash TEXT NOT NULL,           -- HMAC of the key_id
			invite_code_used TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			last_key_rotation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		  );
  
		  CREATE INDEX IF NOT EXISTS idx_users_key_id 
		  ON users(key_id);
		`);
		} catch (error) {
			console.error("Error initializing user auth schema:", error);
			throw error;
		}
	}
	// Generate a secure random key ID
	generateKeyId() {
		const buffer = new Uint8Array(16); // 128-bit random value
		crypto.getRandomValues(buffer);
		return Array.from(buffer)
			.map(byte => byte.toString(16).padStart(2, '0'))
			.join('');
	}

	// Generate API key by combining key ID with master salt
	async generateApiKey(keyId) {
		// Create a TextEncoder to convert strings to Uint8Array
		const encoder = new TextEncoder();

		// Convert master salt and key ID to Uint8Array
		const masterSalt = encoder.encode(this.env.USER_KEY_SALT);
		const keyIdBytes = encoder.encode(keyId);

		// Import master salt as HMAC key
		const key = await crypto.subtle.importKey(
			'raw',
			masterSalt,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);

		// Generate HMAC
		const signature = await crypto.subtle.sign(
			'HMAC',
			key,
			keyIdBytes
		);

		// Convert signature to hex string
		return Array.from(new Uint8Array(signature))
			.map(byte => byte.toString(16).padStart(2, '0'))
			.join('');
	}

	// Create a new user account
	async createUser(username, inviteCode) {
		try {
			// Check if user already exists
			const result = await this.sql.exec(
				"SELECT username FROM users WHERE username = ?",
				username
			);
			
			const existingUser = result && result.length > 0 ? result[0] : null;
			
			if (existingUser) {
				throw new Error('Username already taken');
			}
			
			// Verify INVITE_CODE only during user creation
			if (!this.env.INVITE_CODE || inviteCode !== this.env.INVITE_CODE) {
				throw new Error('Invalid invite code');
			}
	
			// Generate a new key ID
			const keyId = this.generateKeyId();
			const keyHash = await this.generateApiKey(keyId);
	
			// Create initial author info structure (just for convenience)
			const authorInfo = {
				username: username,
				email: "",
				avatar_url: "https://assets.pluginpublisher.com/default_pfp.jpg",
				bio: "",
				member_since: new Date().toISOString(),
				website: "",
				twitter: "",
				github: "",
			};
	
			// Insert new user into the database
			await this.sql.exec(
				"INSERT INTO users (username, key_id, key_hash, invite_code_used) VALUES (?, ?, ?, ?)",
				username, keyId, keyHash, inviteCode
			);
	
			return { username, keyId, keyHash, apiKey: `${username}.${keyId}` };
		} catch (error) {
			// Handle error
			console.error(error);
			throw error;
		}
	}
	
	async deleteUser(username) {
		try {
			const result = await this.sql.exec(
				"DELETE FROM users WHERE username = ?",
				username
			);
			return result.changes > 0;
		} catch (error) {
			console.error("Error deleting user:", error);
			throw error;
		}
	}
	
	
	// Verify API key
	async verifyApiKey(apiKey) {
		try {
			const [username, keyId] = apiKey.split('.');
			if (!username || !keyId) {
				return false;
			}

			const expectedHash = await this.generateApiKey(keyId);
			const user = await this.sql.exec(
				"SELECT username FROM users WHERE username = ? AND key_id = ? AND key_hash = ?",
				username, keyId, expectedHash
			).one();

			return !!user;
		} catch (error) {
			console.error("Error verifying API key:", error);
			return false;
		}
	}

	// Rotate API key for a user
	async rotateApiKey(username, currentApiKey) {
		try {
			// Verify current API key
			if (!await this.verifyApiKey(currentApiKey)) {
				throw new Error('Invalid credentials');
			}

			// Generate new key ID and hash
			const newKeyId = this.generateKeyId();
			const newKeyHash = await this.generateApiKey(newKeyId);

			// Update user record
			await this.sql.exec(`
        UPDATE users 
        SET key_id = ?, key_hash = ?, last_key_rotation = CURRENT_TIMESTAMP
        WHERE username = ?
      `, newKeyId, newKeyHash, username);

			return {
				success: true,
				message: 'Store this API key securely - it cannot be recovered if lost',
				apiKey: `${username}.${newKeyId}`
			};
		} catch (error) {
			console.error("Error rotating API key:", error);
			throw error;
		}
	}

	// Handle incoming requests
	async fetch(request) {
		const url = new URL(request.url);

		if (request.method === "POST") {
			const body = await request.json();

			switch (url.pathname) {
				case '/create-user': {
					const { username, inviteCode } = body;
					if (!username || !inviteCode) {
						return new Response(JSON.stringify({
							error: 'Missing required fields'
						}), { status: 400 });
					}

					try {
						const result = await this.createUser(username, inviteCode);
						return new Response(JSON.stringify(result));
					} catch (error) {
						return new Response(JSON.stringify({
							error: error.message
						}), { status: 400 });
					}
				}
				case '/delete-user': {
					const { username } = body;
					if (!username) {
						return new Response(JSON.stringify({
							error: 'Missing username'
						}), { status: 400 });
					}
				
					try {
						await this.deleteUser(username);
						return new Response(JSON.stringify({ success: true }));
					} catch (error) {
						return new Response(JSON.stringify({
							error: error.message
						}), { status: 500 });
					}
				}
					
				case '/verify-key': {
					const { apiKey } = body;
					const isValid = await this.verifyApiKey(apiKey);
					return new Response(JSON.stringify({ valid: isValid }));
				}

				case '/rotate-key': {
					const { username, currentApiKey } = body;
					try {
						const result = await this.rotateApiKey(username, currentApiKey);
						return new Response(JSON.stringify(result));
					} catch (error) {
						return new Response(JSON.stringify({
							error: error.message
						}), { status: 400 });
					}
				}

				default:
					return new Response('Not found', { status: 404 });
			}
		}

		return new Response('Method not allowed', { status: 405 });
	}
}
