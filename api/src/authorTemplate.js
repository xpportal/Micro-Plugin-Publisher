import { createSecureHtmlService } from './secureHtmlService';
import { createHeaderSearchBar } from './headerSearchBar';

export default function generateAuthorHTML(authorData) {
	const secureHtmlService = createSecureHtmlService();
	const safeAuthor = secureHtmlService.sanitizeAuthorData(authorData);

	//stringify and log authordata
	console.log("datertots", JSON.stringify(authorData));

	if (!safeAuthor) {
		return new Response('Invalid author data', { status: 400 });
	}

	const html = `
	<!DOCTYPE html>
	<html lang="en">
	<head>
	<title>${safeAuthor.username} - Author Profile</title>
	<link 
		href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" 
		rel="stylesheet"
		crossorigin="anonymous"
	>
	<script
		src="https://cdn.jsdelivr.net/npm/feather-icons/dist/feather.min.js"
		crossorigin="anonymous"
	></script>
	<style>
		body { background-color: #191919; color: white; }
		.asset-card-container-home { background: linear-gradient(to bottom right, #212020c9, #2c2c2cb5); }
		.asset-card-author { margin-left: 20px; margin-right: 20px; background: linear-gradient(to bottom right, #131313e8, #181818b5); }
		.hero-card-container { background: linear-gradient(to top left, #8e34d7c4, #30d3669b); min-height: 270px; }
		.hero-card-container-outer { min-height: 270px; }
		.plugins-list-container { margin-top: 30px; position: relative; z-index: 1; padding: 0; background: linear-gradient(to bottom right, #131313e8, #181818b5); }
		.plugin-grid-container { min-height: 500px; }
		[data-tooltip] {
		position: relative;
		}
		[data-tooltip]:before {
		content: attr(data-tooltip);
		position: absolute;
		bottom: 100%;
		left: 50%;
		transform: translateX(-50%);
		padding: 4px 8px;
		background-color: #2d3748;
		color: white;
		border-radius: 4px;
		font-size: 14px;
		white-space: nowrap;
		opacity: 0;
		visibility: hidden;
		transition: all 0.2s ease;
		}
		[data-tooltip]:hover:before {
		opacity: 1;
		visibility: visible;
		bottom: calc(100% - 75px);
		}
	</style>
	</head>
	<body>
	<div class="min-h-screen bg-[#191919] text-white">
		  		  			${createHeaderSearchBar()}
		<div class="bg-gradient-to-r from-purple-500 to-blue-400 pb-0 pt-0 hero-card-container-outer mx-0 px-0">
		<div class="container mx-auto px-0 pb-2">
			<div class="asset-card-author rounded-b-3xl p-8 mb-8 shadow-2xl transform min-h-[200px]">
			<div class="flex flex-col md:flex-row items-center md:items-start">
				<img
				src="${safeAuthor.avatar_url || '/images/default-avatar.jpg'}"
				alt="${safeAuthor.username}"
				class="w-32 h-32 rounded-full mb-4 md:mb-0 md:mr-8"
				/>
				<div>
				<h1 class="text-3xl font-bold mb-2">${safeAuthor.username}</h1>
				${safeAuthor.website ? `
					<a 
					href="${safeAuthor.website}" 
					target="_blank" 
					rel="noopener noreferrer" 
					data-tooltip="${safeAuthor.website}"
					class="inline-flex items-center px-4 py-2 bg-gradient-to-br from-purple-600 to-blue-500 hover:bg-gradient-to-bl text-white text-sm font-medium rounded-lg transition-colors duration-200 mb-4"
					>
					Visit Website
					</a>
				` : ''}
				<p class="text-lg mb-4">${safeAuthor.bio}</p>
				<div class="flex space-x-4">
					${safeAuthor.twitter ? `
					<a href="https://twitter.com/${safeAuthor.twitter}" target="_blank" rel="noopener noreferrer" class="text-green-400 hover:text-green-500">
						<i data-feather="twitter"></i>
					</a>
					` : ''}
					${safeAuthor.github ? `
					<a href="https://github.com/${safeAuthor.github}" target="_blank" rel="noopener noreferrer" class="text-green-400 hover:text-green-500">
						<i data-feather="github"></i>
					</a>
					` : ''}
				</div>
				</div>
			</div>
			</div>
		</div>
		</div>
		<div class="container mx-auto px-4">
		<div class="container mx-auto px-4 plugins-list-container rounded-t-3xl shadow-3xl">
			<h2 class="rounded-t-3xl text-2xl font-bold text-white mb-8 p-4 pl-10 bg-gradient-to-br from-purple-600 to-blue-500 plugin-list-container-title-highlight">Plugins by ${safeAuthor.username}</h2>
			<div class="px-8 py-0 plugin-grid-container mx-4">
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
				${safeAuthor.plugins.map(plugin => `
				<div class="bg-gradient-to-br asset-card-container-home rounded-xl shadow-2xl transform flex flex-col h-full">
					<div class="p-6 flex flex-col h-full">
					<div class="flex items-center mb-0">
						<img src="${plugin.icons?.['1x'] || '/images/default-icon.jpg'}" alt="${plugin.name}" class="w-16 h-16 mb-4 rounded-lg" />
						<a href="/directory/${safeAuthor.username}/${plugin.slug}" class="">
						<h3 class="text-xl font-bold mb-2 ml-4">${plugin.name}</h3>
						</a>
					</div>
					<p class="text-gray-200 mb-4 flex-grow">${plugin.short_description || 'No description available.'}</p>
					<div class="flex justify-between items-center mb-4">
						<div class="flex items-center">
						<div class="flex justify-between items-center">
							<span class="text-gray-200">v${plugin.version || 'N/A'}</span>
						</div>
						</div>
						<div class="flex items-center">
						<i data-feather="download" class="mr-1 text-green-400"></i>
						<span>${plugin.active_installs || 0}+ active installs</span>
						</div>
					</div>
					<div class="mt-auto">
						<a href="/directory/${safeAuthor.username}/${plugin.slug}" class="w-full text-white bg-gradient-to-br from-purple-600 to-blue-500 hover:bg-gradient-to-bl focus:ring-4 focus:outline-none focus:ring-blue-300 dark:focus:ring-blue-800 font-medium rounded-lg text-sm px-5 py-2.5 text-center me-2 mb-2 block">
						View Details
						</a>
					</div>
					</div>
				</div>
				`).join('')}
			</div>
			</div>
		</div>
		<div class="bg-black py-8 rounded-b-3xl">
			<div class="container mx-auto px-4 text-center text-gray-200">
			<p>&copy; ${new Date().getFullYear()} ${new Date().toLocaleTimeString()} Your Footer Text.</p>
			<p>
				<a href="/terms" class="text-purple-400 hover:underline">Terms of Service</a> | 
				<a href="/privacy" class="text-purple-400 hover:underline">Privacy Policy</a>
			</p>
			</div>
		</div>
		</div>
	</div>
	<script>
		feather.replace();
	</script>
	</body>
	</html>
  `;

	return secureHtmlService.transformHTML(html);
}