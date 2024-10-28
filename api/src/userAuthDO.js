export class UserAuthDO {
	constructor(state, env) {
		this.state = state;
		this.env = env;
		this.sql = state.storage.sql;

		if (!env.USER_KEY_SALT) {
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
					email TEXT NOT NULL,
					github_username TEXT,
					key_id TEXT NOT NULL UNIQUE,
					key_hash TEXT NOT NULL,
					invite_code_used TEXT NOT NULL,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					last_key_rotation TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				);
	
				CREATE INDEX IF NOT EXISTS idx_users_key_id 
				ON users(key_id);
	
				CREATE TABLE IF NOT EXISTS key_roll_verifications (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					username TEXT NOT NULL,
					verification_token TEXT NOT NULL UNIQUE,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					expires_at TIMESTAMP NOT NULL,
					used BOOLEAN DEFAULT 0,
					FOREIGN KEY(username) REFERENCES users(username)
				);
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
	async createUser(username, github_username, email, inviteCode) {
		try {
			const existingUser = await this.sql.exec(
				"SELECT * FROM users WHERE username = ? OR github_username = ? OR email = ?",
				username, github_username, email
			).one();

			console.log("Existing user:", existingUser);

			if (existingUser) {
				throw new Error('Username, GitHub username, or email already taken');
			}

			if (!this.env.INVITE_CODE || inviteCode !== this.env.INVITE_CODE) {
				throw new Error('Invalid invite code');
			}

			const keyId = this.generateKeyId();
			const keyHash = await this.generateApiKey(keyId);

			await this.sql.exec(`
				INSERT INTO users (
					username,
					github_username,
					email,
					key_id,
					key_hash,
					invite_code_used,
					created_at
				) VALUES (
					?,
					?,
					?,
					?,
					?,
					?,
					CURRENT_TIMESTAMP
				)`,
				username,
				github_username,
				email,
				keyId,
				keyHash,
				inviteCode
			);

			return { username, keyId, keyHash, apiKey: `${username}.${keyId}` };
		} catch (error) {
			console.error(error);
			throw error;
		}
	}

	async updateUserAsAdmin(username, updates) {
		try {
			// Check if github_username column exists, add it if it doesn't
			const columns = await this.sql.exec(`PRAGMA table_info(users)`).toArray();
			if (!columns.some(col => col.name === 'github_username')) {
				console.log("Adding github_username column to users table...");
				await this.sql.exec(`ALTER TABLE users ADD COLUMN github_username TEXT`);
			}

			const user = await this.sql.exec(
				"SELECT * FROM users WHERE username = ?",
				username
			).one();

			if (!user) {
				throw new Error('User not found');
			}

			// Start building update query
			let updateFields = [];
			let updateValues = [];

			if (updates.email) {
				updateFields.push('email = ?');
				updateValues.push(updates.email);
			}

			if (updates.github_username) {
				updateFields.push('github_username = ?');
				updateValues.push(updates.github_username);
			}

			if (updates.newUsername) {
				// Check if new username is available
				const existing = await this.sql.exec(
					"SELECT username FROM users WHERE username = ?",
					updates.newUsername
				).one();

				if (existing) {
					throw new Error('New username already taken');
				}

				updateFields.push('username = ?');
				updateValues.push(updates.newUsername);
			}

			// If a new API key is requested, generate one
			if (updates.generateNewKey) {
				const newKeyId = this.generateKeyId();
				const newKeyHash = await this.generateApiKey(newKeyId);

				updateFields.push('key_id = ?');
				updateValues.push(newKeyId);

				updateFields.push('key_hash = ?');
				updateValues.push(newKeyHash);

				updateFields.push('last_key_rotation = CURRENT_TIMESTAMP');

				// Store the new API key to return to admin
				updates.newApiKey = `${updates.newUsername || username}.${newKeyId}`;
			}

			if (updateFields.length === 0) {
				throw new Error('No valid updates provided');
			}

			// Build and execute update query
			const query = `
				UPDATE users 
				SET ${updateFields.join(', ')}
				WHERE username = ?
			`;

			await this.sql.exec(query, ...updateValues, username);

			return {
				success: true,
				message: 'User updated successfully',
				username: updates.newUsername || username,
				email: updates.email,
				github_username: updates.github_username,
				newApiKey: updates.newApiKey
			};
		} catch (error) {
			console.error("Admin update error:", error);
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

	async initiateKeyRoll(username, email) {
		// Verify username and email match
		const user = await this.sql.exec(
			"SELECT * FROM users WHERE username = ? AND email = ?",
			username, email
		).one();

		if (!user) {
			throw new Error('Invalid username or email');
		}

		if (!user.github_username) {
			throw new Error('GitHub username not set for this account. Please contact support to update your GitHub username.');
		}

		// Generate verification token and content
		const buffer = new Uint8Array(32);
		crypto.getRandomValues(buffer);
		const verificationToken = Array.from(buffer)
			.map(byte => byte.toString(16).padStart(2, '0'))
			.join('');

		// Store verification info with expiration
		await this.sql.exec(`
			INSERT INTO key_roll_verifications (
				username,
				verification_token,
				created_at,
				expires_at
			) VALUES (?, ?, CURRENT_TIMESTAMP, datetime('now', '+1 hour'))
		`, username, verificationToken);

		return {
			verificationToken,
			verificationFilename: `plugin-publisher-verify-${username}.txt`,
			verificationContent: `Verifying plugin-publisher key roll request for ${username}\nToken: ${verificationToken}\nTimestamp: ${new Date().toISOString()}`
		};
	}

	async verifyGistAndRollKey(gistUrl, verificationToken) {
		try {
			console.log("Starting gist verification for token:", verificationToken);

			// Verify the token is valid and not expired
			const verification = await this.sql.exec(`
					SELECT username FROM key_roll_verifications
					WHERE verification_token = ?
					AND expires_at > CURRENT_TIMESTAMP
					AND used = 0
				`, verificationToken).one();

			if (!verification) {
				throw new Error('Invalid or expired verification token');
			}

			console.log("Found valid verification for username:", verification.username);

			// Extract gist ID from URL
			const gistId = gistUrl.split('/').pop();
			console.log("Extracted gist ID:", gistId);

			// Fetch gist content from GitHub API
			const response = await fetch(`https://api.github.com/gists/${gistId}`, {
				headers: {
					'User-Agent': 'antpb-plugin-publisher'
				}
			});
			console.log("GitHub API response status:", response.status);

			if (!response.ok) {
				const errorText = await response.text();
				console.error("GitHub API error response:", errorText);
				throw new Error(`Could not verify gist: ${response.status} ${errorText}`);
			}

			const gistData = await response.json();
			console.log("Gist data received:", {
				owner: gistData.owner?.login,
				files: Object.keys(gistData.files || {})
			});

			const expectedFilename = `plugin-publisher-verify-${verification.username}.txt`;
			console.log("Looking for file:", expectedFilename);

			// Verify gist content
			const file = gistData.files[expectedFilename];
			if (!file) {
				console.error("File not found in gist. Available files:", Object.keys(gistData.files));
				throw new Error(`Verification file "${expectedFilename}" not found in gist`);
			}

			if (!file.content.includes(verificationToken)) {
				console.error("Token not found in file content. Content:", file.content);
				throw new Error('Verification token not found in gist content');
			}

			// Verify gist owner matches GitHub username in our records
			const user = await this.sql.exec(`
					SELECT github_username FROM users
					WHERE username = ?
				`, verification.username).one();

			console.log("User record:", {
				queried_username: verification.username,
				found_github_username: user?.github_username,
				gist_owner: gistData.owner?.login
			});

			if (!user || user.github_username !== gistData.owner.login) {
				throw new Error(`GitHub username mismatch. Expected: ${user?.github_username}, Found: ${gistData.owner.login}`);
			}

			// Mark verification as used
			await this.sql.exec(`
				UPDATE key_roll_verifications
				SET used = 1
				WHERE verification_token = ?
			`, verificationToken);

			// Generate and set new API key
			const newKeyId = this.generateKeyId();
			const newKeyHash = await this.generateApiKey(newKeyId);

			await this.sql.exec(`
				UPDATE users 
				SET key_id = ?, 
					key_hash = ?,
					last_key_rotation = CURRENT_TIMESTAMP
				WHERE username = ?
			`, newKeyId, newKeyHash, verification.username);

			return {
				success: true,
				message: 'API key successfully rolled. Store this key securely - it cannot be recovered if lost.',
				apiKey: `${verification.username}.${newKeyId}`
			};
		} catch (error) {
			console.error("Error verifying gist and rolling key:", error);
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

				case '/initiate-key-roll': {
					const { username, email } = body;
					try {
						const result = await this.initiateKeyRoll(username, email);
						return new Response(JSON.stringify(result), {
							headers: { 'Content-Type': 'application/json' }
						});
					} catch (error) {
						return new Response(JSON.stringify({
							error: error.message
						}), {
							status: 400,
							headers: { 'Content-Type': 'application/json' }
						});
					}
				}

				case '/verify-key-roll': {
					const { gistUrl, verificationToken } = body;
					try {
						const result = await this.verifyGistAndRollKey(gistUrl, verificationToken);
						return new Response(JSON.stringify(result), {
							headers: { 'Content-Type': 'application/json' }
						});
					} catch (error) {
						return new Response(JSON.stringify({
							error: error.message
						}), {
							status: 400,
							headers: { 'Content-Type': 'application/json' }
						});
					}
				}

				case '/admin-update-user': {
					const { username, ...updates } = body;
					if (!username) {
						return new Response(JSON.stringify({
							error: 'Username is required'
						}), { status: 400 });
					}

					try {
						const result = await this.updateUserAsAdmin(username, updates);
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
