class SecureHtmlService {
	generateNonce() {
		const array = new Uint8Array(16);
		crypto.getRandomValues(array);
		return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
	}

	getSecurityHeaders(nonce) {
		return {
			'Content-Security-Policy': [
				// Allow resources from same origin and CDN
				"default-src 'self' https://cdn.jsdelivr.net",
				// Allow scripts from CDN and inline scripts with nonce
				`script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
				// Allow styles from CDN and inline styles
				"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
				// Allow images from any HTTPS source
				"img-src 'self' https: data:",
				// Allow fonts from CDN
				"font-src 'self' https://cdn.jsdelivr.net",
				// Basic security headers that don't impact functionality
				"frame-ancestors 'none'",
				"base-uri 'self'"
			].join('; '),
			'X-Content-Type-Options': 'nosniff',
			'X-Frame-Options': 'DENY',
			'Referrer-Policy': 'strict-origin-when-cross-origin'
		};
	}

	sanitizeText(text) {
		if (!text) return '';
		return String(text)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#x27;');
	}

	sanitizeUrl(url) {
		if (!url) return '';
		try {
			const parsed = new URL(url);
			return ['http:', 'https:'].includes(parsed.protocol) ? url : '';
		} catch {
			return url.startsWith('/') && !url.includes('..') ? url : '';
		}
	}

	createMetaTransformer(nonce) {
		return {
			element: (element) => {
				if (element.tagName === 'head') {
					element.append(`
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
			  `, { html: true });
				}
			}
		};
	}

	createScriptTransformer(nonce) {
		return {
			element: (element) => {
				if (element.tagName === 'script') {
					// Allow scripts from allowed domains
					const src = element.getAttribute('src');
					if (src && (
						src.includes('cdn.jsdelivr.net') ||
						src.includes('playground.wordpress.net')
					)) {
						element.setAttribute('nonce', nonce);
						return;
					}

					// Allow our playground initialization script
					if (element.hasAttribute('data-playground-init')) {
						element.setAttribute('nonce', nonce);
						return;
					}

					// Remove other scripts
					element.remove();
				}
			}
		};
	}

	createLinkTransformer() {
		return {
			element: (element) => {
				if (element.tagName === 'a') {
					const href = element.getAttribute('href');
					if (href) {
						const sanitizedHref = this.sanitizeUrl(href);
						if (!sanitizedHref) {
							element.remove();
							return;
						}
						element.setAttribute('href', sanitizedHref);
						if (sanitizedHref.startsWith('http')) {
							element.setAttribute('rel', 'noopener noreferrer');
							element.setAttribute('target', '_blank');
						}
					}
				}
			}
		};
	}

	async transformHTML(rawHtml) {
		const nonce = this.generateNonce();
		const response = new Response(rawHtml, {
			headers: {
				'Content-Type': 'text/html',
				...this.getSecurityHeaders(nonce)
			}
		});

		return new HTMLRewriter()
			.on('head', this.createMetaTransformer(nonce))
			.on('script', this.createScriptTransformer(nonce))
			.on('a', this.createLinkTransformer())
			.transform(response);
	}

	sanitizePluginData(plugin) {
		if (!plugin) return null;
		console.log(JSON.stringify(plugin));
		return {
			name: this.sanitizeText(plugin.name),
			slug: this.sanitizeText(plugin.slug),
			short_description: this.sanitizeText(plugin.short_description),
			version: this.sanitizeText(plugin.version),
			download_link: this.sanitizeUrl(plugin.download_link),
			support_url: this.sanitizeUrl(plugin.support_url),
			requires: this.sanitizeText(plugin.requires),
			tested: this.sanitizeText(plugin.tested),
			requires_php: this.sanitizeText(plugin.requires_php),
			rating: parseFloat(plugin.rating) || 0,
			active_installs: parseInt(plugin.active_installs) || 0,
			last_updated: this.sanitizeText(plugin.last_updated),
			author: this.sanitizeText(plugin.author),
			banners: {
				"high": this.sanitizeUrl(plugin.banners?.high || '/images/default-banner.jpg'),
				"low": this.sanitizeUrl(plugin.banners?.low || '/images/default-banner.jpg')
			},
			icons: {
				'1x': this.sanitizeUrl(plugin.icons?.['1x'] || '/images/default-icon.jpg'),
				'2x': this.sanitizeUrl(plugin.icons?.['2x'] || '/images/default-icon.jpg')
			},
			sections: plugin.sections ? {
				installation: this.sanitizeText(plugin.sections.installation),
				faq: this.sanitizeHtml(plugin.sections.faq),
				description: this.sanitizeHtml(plugin.sections.description)
			} : {},
			authorData: plugin.authorData ? this.sanitizeAuthorData(plugin.authorData) : null
		};
	}

	sanitizeAuthorData(author) {
		if (!author) return null;

		return {
			username: this.sanitizeText(author.username),
			bio: this.sanitizeText(author.bio),
			website: this.sanitizeUrl(author.website),
			avatar_url: this.sanitizeUrl(author.avatar_url || '/images/default-avatar.jpg'),
			twitter: this.sanitizeText(author.twitter),
			github: this.sanitizeText(author.github),
			plugins: Array.isArray(author.plugins) ?
				author.plugins.map(plugin => this.sanitizePluginData(plugin)) : []
		};
	}
	// Add this new method to handle HTML content
	sanitizeHtml(html) {
		if (!html) return '';

		// First decode any HTML entities in the input
		const decoded = html.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#x27;/g, "'")
			.replace(/&#x2F;/g, "/");

		// Define allowed tags and their allowed attributes
		const allowedTags = {
			'p': [],
			'h1': [],
			'h2': [],
			'h3': [],
			'h4': [],
			'h5': [],
			'h6': [],
			'br': [],
			'strong': [],
			'em': [],
			'ul': [],
			'ol': [],
			'li': [],
			'a': ['href', 'title', 'target'],
			'code': [],
			'pre': []
		};

		// Simple HTML parser/sanitizer
		return decoded.replace(/<[^>]*>/g, (tag) => {
			// Parse tag name and attributes
			const matches = tag.match(/<\/?([a-z0-9]+)(.*?)\/?\s*>/i);
			if (!matches) return '';

			const tagName = matches[1].toLowerCase();
			const attrs = matches[2];

			// Check if tag is allowed
			if (!allowedTags[tagName]) {
				return '';
			}

			// For closing tags, just return them if the tag is allowed
			if (tag.startsWith('</')) {
				return `</${tagName}>`;
			}

			// Parse and sanitize attributes
			let sanitizedAttrs = '';
			if (attrs) {
				const allowedAttrs = allowedTags[tagName];
				const attrMatches = attrs.match(/([a-z0-9\-]+)="([^"]*?)"/gi);
				if (attrMatches) {
					attrMatches.forEach(attr => {
						const [name, value] = attr.split('=');
						const cleanName = name.toLowerCase();
						if (allowedAttrs.includes(cleanName)) {
							// For hrefs, ensure they're safe URLs
							if (cleanName === 'href') {
								const sanitizedUrl = this.sanitizeUrl(value.slice(1, -1));
								if (sanitizedUrl) {
									sanitizedAttrs += ` href="${sanitizedUrl}"`;
								}
							} else {
								sanitizedAttrs += ` ${cleanName}=${value}`;
							}
						}
					});
				}
			}

			return `<${tagName}${sanitizedAttrs}>`;
		});
	}

}



// Export a factory function instead of an instance
export function createSecureHtmlService() {
	return new SecureHtmlService();
}