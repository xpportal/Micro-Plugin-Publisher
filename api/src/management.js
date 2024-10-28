/**
 * Removes an author and all their associated data
 * @param {string} authorName - The name of the author to remove
 * @param {Object} env - Environment containing storage connections
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function removeAuthor(authorName, env) {
	if (!authorName) {
		return {
			success: false,
			message: 'Invalid author name provided'
		};
	}

	try {
		// Get DO instance
		const id = env.PLUGIN_REGISTRY.idFromName("global");
		const registry = env.PLUGIN_REGISTRY.get(id);

		// Create internal request to delete author
		const deleteRequest = new Request('http://internal/delete-author', {
			method: 'POST',
			body: JSON.stringify({ authorName })
		});

		const response = await registry.fetch(deleteRequest);
		if (!response.ok) {
			throw new Error(`Failed to delete author: ${response.status}`);
		}

		// Delete from bucket
		const prefix = `${authorName}/`;
		const files = await env.PLUGIN_BUCKET.list({ prefix });
		for (const file of files.objects) {
			await env.PLUGIN_BUCKET.delete(file.key);
		}

		// Delete all download counts
		const countPrefix = `downloads:${authorName}:`;
		const counts = await env.DOWNLOAD_COUNTS.list({ prefix: countPrefix });
		for (const key of counts.keys) {
			await env.DOWNLOAD_COUNTS.delete(key.name);
		}

		return {
			success: true,
			message: `Successfully removed author ${authorName} and all associated data`
		};

	} catch (error) {
		console.error('Error removing author:', error);
		return {
			success: false,
			message: 'Failed to remove author. Please try again later.'
		};
	}
}

/**
 * Removes a specific plugin
 * @param {string} authorName - The plugin's author name
 * @param {string} pluginName - The name of the plugin to remove
 * @param {Object} env - Environment containing storage connections
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function removePlugin(authorName, pluginName, env) {
	if (!authorName || !pluginName) {
		return {
			success: false,
			message: 'Invalid author or plugin name provided'
		};
	}

	try {
		// Get DO instance
		const id = env.PLUGIN_REGISTRY.idFromName("global");
		const registry = env.PLUGIN_REGISTRY.get(id);

		// Create internal request to delete plugin
		const deleteRequest = new Request('http://internal/delete-plugin', {
			method: 'POST',
			body: JSON.stringify({ authorName, pluginName })
		});

		const response = await registry.fetch(deleteRequest);
		if (!response.ok) {
			throw new Error(`Failed to delete plugin: ${response.status}`);
		}

		// Get plugin slug from response
		const { slug } = await response.json();

		// Delete from bucket
		const prefix = `${authorName}/${slug}/`;
		const files = await env.PLUGIN_BUCKET.list({ prefix });
		for (const file of files.objects) {
			await env.PLUGIN_BUCKET.delete(file.key);
		}

		// Delete download count
		const downloadKey = `downloads:${authorName}:${slug}`;
		await env.DOWNLOAD_COUNTS.delete(downloadKey);

		return {
			success: true,
			message: `Successfully removed plugin ${pluginName}`
		};

	} catch (error) {
		console.error('Error removing plugin:', error);
		return {
			success: false,
			message: error.message === 'Plugin not found' ?
				'Plugin not found' :
				'Failed to remove plugin. Please try again later.'
		};
	}
}