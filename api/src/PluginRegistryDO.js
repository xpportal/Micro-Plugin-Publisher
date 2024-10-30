export class PluginRegistryDO {
	constructor(state, env) {
		this.state = state;
		this.env = env;

		// Initialize SQLite storage
		this.sql = state.storage.sql;

		// Initialize the database schema
		this.initializeSchema();
	}

	async handleStats(request) {
		try {
			// Get basic stats
			const baseStats = await this.sql.exec(`
			SELECT 
			  COUNT(DISTINCT p.id) as plugin_count,
			  COUNT(DISTINCT p.author) as author_count,
			  MAX(p.updated_at) as last_update,
			  SUM(p.download_count) as total_downloads,
			  SUM(p.activation_count) as total_activations,
			  (
				SELECT COUNT(DISTINCT tag) 
				FROM plugin_tags
			  ) as total_tags
			FROM plugins p
		  `).one();

			// Get recent activity
			const recentActivity = await this.sql.exec(`
			SELECT 
			  p.author,
			  p.name,
			  p.version,
			  p.updated_at
			FROM plugins p
			ORDER BY p.updated_at DESC
			LIMIT 5
		  `).toArray();

			// Format the response
			const stats = {
				plugins: {
					total: baseStats.plugin_count,
					downloads: baseStats.total_downloads,
					activations: baseStats.total_activations
				},
				authors: {
					total: baseStats.author_count
				},
				tags: {
					total: baseStats.total_tags
				},
				lastUpdate: baseStats.last_update,
				recentActivity: recentActivity
			};

			return new Response(JSON.stringify(stats), {
				headers: { 'Content-Type': 'application/json' }
			});
		} catch (error) {
			console.error('Error getting stats:', error);
			return new Response(JSON.stringify({
				error: 'Internal server error',
				details: error.message
			}), {
				status: 500,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	}


	async addMissingColumns() {
		try {
			const columns = this.sql.exec(`PRAGMA table_info(plugins)`).toArray();

			const columnNames = columns.map(col => col.name);

			const columnsToAdd = [
				{ name: 'icons_1x', type: 'TEXT' },
				{ name: 'icons_2x', type: 'TEXT' },
				{ name: 'banners_high', type: 'TEXT' },
				{ name: 'banners_low', type: 'TEXT' },
				{ name: 'activation_count', type: 'INTEGER DEFAULT 0' }
			];

			for (const column of columnsToAdd) {
				if (!columnNames.includes(column.name)) {
					console.log(`Adding column ${column.name}`);
					await this.sql.exec(`
						ALTER TABLE plugins 
						ADD COLUMN ${column.name} ${column.type}
					`);
				}
			}

			// Verify columns were added
			const updatedColumns = this.sql.exec(`PRAGMA table_info(plugins)`).toArray();
			console.log('Updated table schema:', updatedColumns);

		} catch (error) {
			console.error("Error adding missing columns:", error);
			throw error; // Re-throw to handle in the caller
		}
	}

	async syncAuthorData(authorData) {
		try {
			if (typeof authorData !== 'object' || authorData === null) {
				throw new Error(`Invalid author data type: ${typeof authorData}`);
			}

			const result = await this.sql.exec(`
				INSERT INTO authors (
					username, email, avatar_url, bio, 
					member_since, website, twitter, github
				) 
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(username) DO UPDATE SET
					email = EXCLUDED.email,
					avatar_url = EXCLUDED.avatar_url,
					bio = EXCLUDED.bio,
					member_since = EXCLUDED.member_since,
					website = EXCLUDED.website,
					twitter = EXCLUDED.twitter,
					github = EXCLUDED.github,
					updated_at = CURRENT_TIMESTAMP
				RETURNING id
			`,
				authorData.username,
				authorData.email,
				authorData.avatar_url,
				authorData.bio,
				authorData.member_since,
				authorData.website,
				authorData.twitter,
				authorData.github
			).one();

			console.log(`Successfully synced author ${authorData.username}, id: ${result?.id}`);
			return result.id;
		} catch (error) {
			console.error("Error syncing author data:", error);
			throw error;
		}
	}

	async initializeSchema() {
		try {
			// Create tables if they don't exist
			this.sql.exec(`
				-- Plugin metadata table
				CREATE TABLE IF NOT EXISTS plugins (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					author TEXT NOT NULL,
					slug TEXT NOT NULL,
					name TEXT NOT NULL,
					short_description TEXT,
					version TEXT NOT NULL,
					download_count INTEGER DEFAULT 0,
					activation_count INTEGER DEFAULT 0,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					UNIQUE(author, slug)
				);
							
				-- Plugin tags for search
				CREATE TABLE IF NOT EXISTS plugin_tags (
					plugin_id INTEGER,
					tag TEXT NOT NULL,
					FOREIGN KEY(plugin_id) REFERENCES plugins(id),
					PRIMARY KEY(plugin_id, tag)
				);
				
				-- Create indexes for search performance
				CREATE INDEX IF NOT EXISTS idx_plugins_search 
				ON plugins(name, short_description);
				
				CREATE INDEX IF NOT EXISTS idx_plugins_downloads
				ON plugins(download_count DESC);
			`);

			// Add authors table
			this.sql.exec(`
				CREATE TABLE IF NOT EXISTS authors (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					username TEXT NOT NULL UNIQUE,
					email TEXT,
					avatar_url TEXT,
					bio TEXT,
					member_since TIMESTAMP,
					website TEXT,
					twitter TEXT,
					github TEXT,
					created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				);
	
				-- Index for quick lookups
				CREATE INDEX IF NOT EXISTS idx_authors_username 
				ON authors(username);
			`);


			// add any missing columns
			// await this.addMissingColumns();

			// Drop the unnecessary queue tables if they exist
			this.sql.exec(`
				DROP TABLE IF EXISTS download_queue;
				DROP TABLE IF EXISTS activation_queue;
			`);

		} catch (error) {
			console.error("Error initializing schema:", error);
			throw error;
		}
	}

	async recordActivation(author, slug) {
		// Just verify the plugin exists
		const plugin = this.sql.exec(
			"SELECT id FROM plugins WHERE author = ? AND slug = ?",
			author, slug
		).one();

		if (!plugin) return false;
		return true;
	}

	async migrateExistingData() {
		try {
			console.log("Starting data migration...");

			// Track migration progress
			const migrationState = {
				schemaUpdated: false,
				processedItems: 0,
				errors: []
			};

			// Add missing columns first
			await this.addMissingColumns();
			migrationState.schemaUpdated = true;

			// Get list of all objects in bucket
			const list = await this.env.PLUGIN_BUCKET.list();
			const authors = new Set();
			const pluginsToMigrate = [];

			// First pass: collect all authors and plugin metadata files
			for (const item of list.objects) {
				const parts = item.key.split('/').filter(part => part.length > 0); // Remove empty parts
				if (parts.length > 1) {
					authors.add(parts[0]); // Add author
					if (parts.length === 3 && parts[2].endsWith('.json') && !parts[2].includes('author_info')) {
						pluginsToMigrate.push({
							author: parts[0],
							slug: parts[1],
							jsonKey: item.key
						});
					}
				}
			}

			console.log(`Found ${pluginsToMigrate.length} plugins to migrate`);

			// Use proper transaction API
			await this.state.storage.transaction(async (txn) => {
				// Process each plugin
				for (const plugin of pluginsToMigrate) {
					try {
						console.log(`Processing plugin: ${plugin.author}/${plugin.slug}`);
						const jsonObject = await this.env.PLUGIN_BUCKET.get(plugin.jsonKey);
						if (!jsonObject) {
							console.log(`No JSON data found for ${plugin.jsonKey}`);
							continue;
						}

						const pluginData = JSON.parse(await jsonObject.text());
						const pluginInfo = Array.isArray(pluginData) ? pluginData[0] : pluginData;

						// Insert plugin metadata
						const result = await this.sql.exec(`
							INSERT OR REPLACE INTO plugins (
								author,
								slug,
								name,
								short_description,
								icons_1x,
								icons_2x,
								banners_high,
								banners_low,
								version,
								download_count,
								activation_count,
								created_at,
								updated_at
							) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
							RETURNING id
						`,
							plugin.author,
							plugin.slug,
							pluginInfo.name || plugin.slug,
							pluginInfo.short_description || '',
							pluginInfo.icons?.['1x'] || '',
							pluginInfo.icons?.['2x'] || '',
							pluginInfo.banners?.high || '',
							pluginInfo.banners?.low || '',
							pluginInfo.version || '1.0.0',
							0, // Initial download count
							0  // Initial activation count
						).one();

						// If plugin has tags, insert them
						if (pluginInfo.tags && Array.isArray(pluginInfo.tags)) {
							for (const tag of pluginInfo.tags) {
								await this.sql.exec(
									"INSERT OR IGNORE INTO plugin_tags (plugin_id, tag) VALUES (?, ?)",
									result.id,
									tag
								);
							}
						}

						migrationState.processedItems++;
						console.log(`Successfully migrated plugin: ${plugin.author}/${plugin.slug}`);
					} catch (pluginError) {
						console.error(`Error migrating plugin ${plugin.author}/${plugin.slug}:`, pluginError);
						migrationState.errors.push({
							plugin: `${plugin.author}/${plugin.slug}`,
							error: pluginError.message
						});
					}
				}
			});

			return {
				success: true,
				schemaUpdated: migrationState.schemaUpdated,
				processedItems: migrationState.processedItems,
				errors: migrationState.errors,
				message: migrationState.errors.length > 0
					? 'Migration completed with some warnings'
					: 'Migration completed successfully'
			};
		} catch (error) {
			console.error("Migration error:", error);
			return {
				success: false,
				error: error.message,
				schemaUpdated: true,
				message: 'Migration failed but schema may have been updated'
			};
		}
	}

	// Handle search requests
	async handleSearch(query = '', tags = [], limit = 20, offset = 0) {
		try {
			// Handle empty query case
			const whereClause = query ?
				`WHERE (name LIKE ? OR short_description LIKE ? OR author LIKE ?)` :
				'WHERE 1=1';

			const tagFilters = tags.length > 0 ?
				`AND id IN (
					SELECT plugin_id FROM plugin_tags 
					WHERE tag IN (${tags.map(() => '?').join(',')})
					GROUP BY plugin_id 
					HAVING COUNT(DISTINCT tag) = ${tags.length}
				)` : '';

			const params = query ?
				[...query.split(' ').flatMap(term => [`%${term}%`, `%${term}%`, `%${term}%`]), ...tags, limit, offset] :
				[...tags, limit, offset];

			// // Log the query and params for debugging
			// console.log('Search Query:', `
			// 	SELECT DISTINCT p.*, 
			// 		(
			// 			SELECT GROUP_CONCAT(tag) 
			// 			FROM plugin_tags 
			// 			WHERE plugin_id = p.id
			// 		) as tags
			// 	FROM plugins p
			// 	${whereClause}
			// 	${tagFilters}
			// 	ORDER BY download_count DESC, updated_at DESC
			// 	LIMIT ? OFFSET ?
			// `);
			// console.log('Search Params:', params);

			const results = this.sql.exec(`
				SELECT DISTINCT p.*, 
					(
						SELECT GROUP_CONCAT(tag) 
						FROM plugin_tags 
						WHERE plugin_id = p.id
					) as tags
				FROM plugins p
				${whereClause}
				${tagFilters}
				ORDER BY download_count DESC, updated_at DESC
				LIMIT ? OFFSET ?
			`, ...params).toArray();

			// Return empty array if no results
			return results || [];

		} catch (error) {
			console.error('Search error:', error);
			// Return empty array on error instead of throwing
			return [];
		}
	}


	// Record a download
	async recordDownload(author, slug) {
		const plugin = this.sql.exec(
			"SELECT id FROM plugins WHERE author = ? AND slug = ?",
			author, slug
		).one();

		if (!plugin) return false;

		// Add to download queue
		this.sql.exec(
			"INSERT INTO download_queue (plugin_id) VALUES (?)",
			plugin.id
		);

		return true;
	}

	async updateDownloadCount(author, slug, count) {
		await this.sql.exec(`
            UPDATE plugins 
            SET 
                download_count = download_count + ?,
                updated_at = CURRENT_TIMESTAMP 
            WHERE author = ? AND slug = ?
        `, count, author, slug);
	}

	async updateCounts(updates, activations) {
		await this.state.storage.transaction(async (txn) => {
			// Process download updates
			for (const [key, count] of updates) {
				const [author, slug] = key.split(':');
				await this.sql.exec(`
					UPDATE plugins 
					SET download_count = download_count + ?,
						updated_at = CURRENT_TIMESTAMP 
					WHERE author = ? AND slug = ?
				`, count, author, slug);
			}

			// Process activation updates
			for (const [key, count] of activations) {
				const [author, slug] = key.split(':');
				await this.sql.exec(`
					UPDATE plugins 
					SET activation_count = activation_count + ?,
						updated_at = CURRENT_TIMESTAMP 
					WHERE author = ? AND slug = ?
				`, count, author, slug);
			}
		});

		// Log the updates for debugging
		console.log('Updated download counts:', updates);
		console.log('Updated activation counts:', activations);
	}

	async migrateExistingAuthors() {
		try {
			console.log("Starting author migration...");

			const migrationState = {
				processedItems: 0,
				errors: [],
				successes: []
			};

			// First, get all users from the users table
			const users = await this.sql.exec(`
			SELECT username FROM users
		  `).toArray();

			// Create a set of existing users
			const existingUsers = new Set(users.map(u => u.username));

			// List all directories in the bucket
			const list = await this.env.PLUGIN_BUCKET.list();
			const authorDirectories = new Set();

			for (const item of list.objects) {
				const parts = item.key.split('/');
				if (parts.length > 0) {
					authorDirectories.add(parts[0]);
				}
			}

			console.log(`Found ${authorDirectories.size} potential authors to migrate`);

			// Process each author directory
			for (const author of authorDirectories) {
				try {
					const authorInfoKey = `${author}/author_info.json`;
					const authorInfoObject = await this.env.PLUGIN_BUCKET.get(authorInfoKey);

					// If no author_info.json exists and this is a valid user, create it
					if (!authorInfoObject && existingUsers.has(author)) {
						const authorInfo = {
							username: author,
							email: "",
							avatar_url: "https://assets.pluginpublisher.com/default_pfp.jpg",
							bio: "",
							member_since: new Date().toISOString(),
							website: "",
							twitter: "",
							github: "",
							plugins: []
						};

						// Store new author_info.json
						await this.env.PLUGIN_BUCKET.put(authorInfoKey, JSON.stringify(authorInfo, null, 2), {
							httpMetadata: {
								contentType: 'application/json',
							},
						});

						// Add to authors table if not exists
						await this.sql.exec(`
				  INSERT OR IGNORE INTO authors (
					username,
					email,
					avatar_url,
					bio,
					member_since,
					website,
					twitter,
					github
				  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`, author, "", authorInfo.avatar_url, "", authorInfo.member_since, "", "", "");

						migrationState.processedItems++;
						migrationState.successes.push(author);
						console.log(`Created new author_info.json for user: ${author}`);
						continue;
					}

					// Handle existing author_info.json files
					if (authorInfoObject) {
						const authorInfoText = await authorInfoObject.text();
						let authorData = typeof authorInfoText === 'string' ? JSON.parse(authorInfoText) : authorInfoText;

						if (typeof authorData === 'string') {
							authorData = JSON.parse(authorData);
						}

						if (typeof authorData === 'object' && authorData !== null) {
							authorData.username = author;
							await this.syncAuthorData(authorData);
							migrationState.processedItems++;
							migrationState.successes.push(author);
							console.log(`Successfully migrated author: ${author}`);
						} else {
							throw new Error(`Invalid author data format: ${typeof authorData}`);
						}
					}
				} catch (authorError) {
					console.error(`Error migrating author ${author}:`, authorError);
					if (!migrationState.successes.includes(author)) {
						migrationState.errors.push({
							author,
							error: authorError.message
						});
					}
				}
			}

			const successMessage = migrationState.successes.length > 0
				? `Successfully migrated authors: ${migrationState.successes.join(', ')}`
				: 'No authors were successfully migrated';

			const errorMessage = migrationState.errors.length > 0
				? `Warnings for authors: ${migrationState.errors.map(e => e.author).join(', ')}`
				: 'No errors encountered';

			return {
				success: migrationState.processedItems > 0,
				processedItems: migrationState.processedItems,
				successfulAuthors: migrationState.successes,
				errors: migrationState.errors,
				message: `${successMessage}. ${errorMessage}`
			};

		} catch (error) {
			console.error("Author migration error:", error);
			return {
				success: false,
				error: error.message,
				message: 'Author migration failed'
			};
		}
	}

	async fetch(request) {
		if (request.method === "GET") {
			return new Response("Method not allowed", { status: 405 });
		}

		const url = new URL(request.url);

		switch (url.pathname) {
			case '/stats':
				return await this.handleStats(request);
			case '/update-counts': {
				const body = await request.json();
				const updates = new Map(body.updates);
				const activations = new Map(body.activations);
				await this.updateCounts(updates, activations);
				return new Response(JSON.stringify({ success: true }), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			case '/search': {
				const body = await request.json();
				const query = body.query || '';
				const tags = body.tags || [];
				const limit = parseInt(body.limit || 20);
				const offset = parseInt(body.offset || 0);

				const results = await this.handleSearch(query, tags, limit, offset);
				return new Response(JSON.stringify(results), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			case '/delete-plugin': {
				const { authorName, pluginName } = await request.json();
				const pluginData = this.sql.exec(
					'SELECT slug FROM plugins WHERE author = ? AND name = ?',
					authorName, pluginName
				).first();

				if (!pluginData) {
					return new Response(JSON.stringify({
						success: false,
						message: 'Plugin not found'
					}), {
						status: 404,
						headers: { 'Content-Type': 'application/json' }
					});
				}

				this.sql.exec(
					'DELETE FROM plugins WHERE author = ? AND name = ?',
					authorName, pluginName
				);

				return new Response(JSON.stringify({
					success: true,
					slug: pluginData.slug
				}), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			case '/delete-author': {
				const { authorName } = await request.json();

				this.sql.exec(
					'DELETE FROM plugins WHERE author = ?',
					authorName
				);

				this.sql.exec(
					'DELETE FROM authors WHERE username = ?',
					authorName
				);

				return new Response(JSON.stringify({ success: true }), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			case '/record-activation': {
				const { author, slug } = await request.json();
				const success = await this.recordActivation(author, slug);
				return new Response(JSON.stringify({ success }), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			case '/sync-author': {
				const authorData = await request.json();
				await this.syncAuthorData(authorData);
				return new Response(JSON.stringify({ success: true }), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			case '/migrate-authors': {
				const migrationResult = await this.migrateExistingAuthors();
				return new Response(JSON.stringify(migrationResult), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			case '/list-authors': {
				try {
					const authors = await this.sql.exec(`
						SELECT 
							a.*,
							COUNT(DISTINCT p.id) as plugin_count,
							SUM(p.download_count) as total_downloads,
							SUM(p.activation_count) as total_activations
						FROM authors a
						LEFT JOIN plugins p ON p.author = a.username
						GROUP BY a.id
						ORDER BY total_downloads DESC, a.updated_at DESC
					`).toArray();

					return new Response(JSON.stringify(authors), {
						headers: { 'Content-Type': 'application/json' }
					});
				} catch (error) {
					console.error('Error listing authors:', error);
					return new Response(JSON.stringify({ error: 'Internal server error' }), {
						status: 500,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			}

			case '/migrate-data': {
				const migrationResult = await this.migrateExistingData();
				return new Response(JSON.stringify(migrationResult), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			case '/record-download': {
				const { author, slug } = await request.json();
				const success = await this.recordDownload(author, slug);
				return new Response(JSON.stringify({ success }), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			case '/update-download-count': {
				const { author, slug, count } = await request.json();
				await this.updateDownloadCount(author, slug, count);
				return new Response(JSON.stringify({ success: true }), {
					headers: { 'Content-Type': 'application/json' }
				});
			}

			default:
				return new Response("Not found", { status: 404 });
		}
	}

}