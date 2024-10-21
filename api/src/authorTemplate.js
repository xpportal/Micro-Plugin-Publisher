export default function generateAuthorHTML(authorData) {
	return `
	  <!DOCTYPE html>
	  <html lang="en">
	  <head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>${authorData.username} - Author Profile</title>
		<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
		<script src="https://cdn.jsdelivr.net/npm/feather-icons/dist/feather.min.js"></script>
		<style>
		  body { background-color: #191919; color: white; }
		  .asset-card-container-home { background: linear-gradient(to bottom right, #131313, #181818); }
		</style>
	  </head>
	  <body>
		<div class="min-h-screen bg-[#191919] text-white">
		  <div class="bg-gradient-to-r from-green-500 to-purple-600 py-16">
			<div class="container mx-auto px-2">
			  <div class="bg-gray-800 rounded-3xl p-8 mb-8 shadow-xl shadow-inner shadow-darkdark-900">
				<div class="flex flex-col md:flex-row items-center md:items-start">
				  <img
					src="${authorData.avatar_url || '/images/default-avatar.jpg'}"
					alt="${authorData.username}"
					class="w-32 h-32 rounded-full mb-4 md:mb-0 md:mr-8"
				  />
				  <div>
					<h1 class="text-3xl font-bold mb-2">${authorData.username}</h1>
										  ${authorData.website ? `
					<a href="${authorData.website}" target="_blank" rel="noopener noreferrer" class="text-xl text-green-400 hover:text-green-500 flex items-center mb-4">
						<i class="mr-2" data-feather="globe"></i>
						<p class="text-xl text-gray-200">${authorData.website}</p>
						</a>
					` : ''}
					<p class="text-lg mb-4">${authorData.bio}</p>
					<div class="flex space-x-4">
					  ${authorData.twitter ? `
						<a href="https://twitter.com/${authorData.twitter}" target="_blank" rel="noopener noreferrer" class="text-green-400 hover:text-green-500">
						  <i data-feather="twitter"></i>
						</a>
					  ` : ''}
					  ${authorData.github ? `
						<a href="https://github.com/${authorData.github}" target="_blank" rel="noopener noreferrer" class="text-green-400 hover:text-green-500">
						  <i data-feather="github"></i>
						</a>
					  ` : ''}
					</div>
				  </div>
				</div>
			  </div>
			</div>
		  </div>
		  <div class="container mx-auto px-4 py-16">
			<h2 class="text-2xl font-bold text-white mb-6">Plugins by ${authorData.username}</h2>
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
			${authorData.plugins.map(plugin => `
				<div class="bg-gradient-to-br asset-card-container-home rounded-xl shadow-2xl transform min-h-[200px]">
				  <div class="p-6">
					<div class="flex items-center mb-0">
					  <img src="${plugin.icons['1x'] || '/images/default-icon.jpg'}" alt="${plugin.name}" class="w-16 h-16 mb-4 rounded-lg" />
					  <a href="/directory/${authorData.username}/${plugin.slug}" class="">
						<h3 class="text-xl font-bold mb-2 ml-4">${plugin.name}</h3>
					  </a>
					</div>
					<p class="text-gray-200 mb-4">${plugin.short_description || 'No description available.'}</p>
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

					<div class="flex justify-between items-center">
						<a href="/directory/${authorData.username}/${plugin.slug}" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-3xl mb-4 flex items-center justify-center">
								View Details
						</a>
					</div>
				  </div>
				</div>
			  `).join('')}
			</div>
		  </div>
		  <div class="bg-black py-8">
			<div class="container mx-auto px-4 text-center text-gray-200">
			  <p>&copy; ${new Date().getFullYear()} Your Footer Text. All rights reserved.</p>
			  <p>
				<a href="/terms" class="text-green-400 hover:underline">Terms of Service</a> | 
				<a href="/privacy" class="text-green-400 hover:underline">Privacy Policy</a>
			  </p>
			</div>
		  </div>
		</div>
		<script>
		  feather.replace();
		</script>
	  </body>
	  </html>
	`;
  }