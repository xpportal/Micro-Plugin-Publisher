export default function generatePluginHTML(plugin, authorData) {
	const pluginData = plugin;
	return `
	  <!DOCTYPE html>
	  <html lang="en">
	  <head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>${pluginData.name} - Plugin Details</title>
		<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
		<style>
		  body { background-color: #191919; color: white; }
		  .asset-card-container-home { background: linear-gradient(to bottom right, #131313, #181818); }
		</style>
	  </head>
	  <body>
		<div class="min-h-screen bg-[#191919] text-white">
		  <div class="bg-gradient-to-r from-green-500 to-purple-600 pt-16">
			<div class="container mx-auto px-2 max-h-[620px]">
			  <div class="relative max-w-[1300px] mx-auto shadow-lg rounded-t-2xl overflow-hidden">
				<img src="${pluginData.banner || '/images/default-banner.jpg'}" alt="${pluginData.name} banner" class="h-auto max-h-[620px] justify-center object-cover w-full">
			  </div>
			</div>
		  </div>
		  <div class="container mx-auto px-4 py-16">
			<div class="grid grid-cols-1 md:grid-cols-3 gap-12">
			  <div class="md:col-span-2 bg-gradient-to-br rounded-3xl asset-card-container-home shadow-2xl p-8 transform min-h-[200px]">
				<div class='px-4 py-6 bg-[#191919] rounded-3xl mb-2 flex items-center'>
				  <img src="${pluginData.icons['1x']}" alt="${pluginData.name}" class="w-24 h-24 mr-4 rounded-lg">
				  <div>
					<h1 class="text-2xl font-bold mb-1">${pluginData.name}</h1>
					<p class="text-md w-90">${pluginData.short_description}</p>
				  </div>
				</div>
				<div class="bg-[#191919] rounded-3xl p-2 mb-2">
				  <div class="text-md leading-8">${pluginData.description}</div>
				</div>
				${pluginData.sections && pluginData.sections.installation ? `
				  <h3 class="text-2xl font-bold mb-4">Installation</h3>
				  <div class="bg-gray-800 rounded-lg p-6 mb-8">
					${pluginData.sections.installation}
				  </div>
				` : ''}
				${pluginData.sections && pluginData.sections.faq ? `
				  <h3 class="text-2xl font-bold mb-4">FAQ</h3>
				  <div class="bg-gray-800 rounded-lg p-6 mb-8">
					${pluginData.sections.faq}
				  </div>
				` : ''}
			  </div>
			  <div>
				<div class="bg-gradient-to-br rounded-3xl asset-card-container-home shadow-2xl rounded-lg p-6 mb-8">
				  <div class="flex items-center mb-4">
					<img src="${pluginData.icons['2x']}" alt="${pluginData.name}" class="w-16 h-16 mr-4 rounded-full">
					<div>
					  <h3 class="text-xl font-bold">${pluginData.name}</h3>
					  <p class="text-gray-200 text-md">by ${pluginData.author}</p>
					</div>
				  </div>
				  <div class="flex items-center justify-between mb-4">
					<div class="flex items-center">
					${pluginData.rating && pluginData.rating > 0 ? `
					<span class="text-yellow-400 mr-1">★</span>
					  <span>${pluginData.rating}/5</span>
					` : ''}
					</div>
					<div class="flex items-center">
					  <span class="mr-2 text-green-400">↓</span>
					  <span class="text-s">${pluginData.active_installs} + downloads</span>
					</div>
				  </div>
				  <a href="${pluginData.download_link}" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-3xl mb-4 flex items-center justify-center">
					Download v${pluginData.version}
				  </a>
				  <div class="text-sm text-gray-200">
					<p>Last updated: ${pluginData.last_updated}</p>
					<p>Version: ${pluginData.version}</p>
					<p>Requires WordPress: ${pluginData.requires}</p>
					<p>Tested up to: ${pluginData.tested}</p>
					<p>Requires PHP: ${pluginData.requires_php}</p>
				  </div>
				</div>
				<div class="bg-gradient-to-br rounded-3xl asset-card-container-home shadow-2xl p-6">
				  <h3 class="text-xl font-bold mb-4">Author</h3>
				  <div class="flex items-center mb-4">
				  <img src="${pluginData.authorData.avatar_url}" alt="${pluginData.author}" class="w-16 h-16 mr-4 rounded-full">
					<div>
					  <p class="font-bold">${pluginData.author}</p>
					  <a href="/author/${pluginData.author}" class="text-green-400 hover:underline">View Profile</a>
					</div>
				  </div>
				  <a href="${pluginData.support_url}" class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-3xl block text-center">
					Get Support
				  </a>
				</div>
			  </div>
			</div>
		  </div>
		  <div class="bg-black py-8">
			<div class="container mx-auto px-4 text-center text-gray-200">
			  <p>&copy; ${new Date().getFullYear()} ${new Date().toLocaleTimeString()} Your Footer Text.</p>
			  <p>
				<a href="/terms" class="text-green-400 hover:underline">Terms of Service</a> | 
				<a href="/privacy" class="text-green-400 hover:underline">Privacy Policy</a>
			  </p>
			</div>
		  </div>
		</div>
	  </body>
	  </html>
	`;
}
