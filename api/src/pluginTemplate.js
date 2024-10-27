import { createSecureHtmlService } from './secureHtmlService';
// In generatePluginHTML.js
import { createHeaderSearchBar } from './headerSearchBar';

export default async function generatePluginHTML(pluginData, env) {
	const secureHtmlService = createSecureHtmlService();
	// Sanitize the input data
	const safePlugin = secureHtmlService.sanitizePluginData(pluginData); // Remove env parameter here
	console.log("datertots", JSON.stringify(pluginData));
	if (!safePlugin) {
		return new Response('Invalid plugin data', { status: 400 });
	}

	// Fetch the current download count
	const downloadKey = `downloads:${safePlugin.author}:${safePlugin.slug}`;
	const downloadCount = parseInt(await env.DOWNLOAD_COUNTS.get(downloadKey)) || 0;
	const activeInstalls = safePlugin.active_installs;
	const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>${safePlugin.name} - Plugin Details</title>
      <link 
        href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" 
        rel="stylesheet"
        crossorigin="anonymous"
      >
      <style>
        body { background-color: #191919; color: white; }
        .asset-card-container-home { background: linear-gradient(to bottom right, #131313, #181818); }
      </style>
    </head>
    <body>
      <div class="min-h-screen bg-[#191919] text-white">
	  		  			${createHeaderSearchBar()}
        <div class="bg-gradient-to-r from-green-500 to-purple-600 pt-16">
          <div class="container mx-auto px-2 max-h-[620px]">
            <div class="relative max-w-[1300px] mx-auto shadow-lg rounded-t-2xl overflow-hidden">
              <img src="${safePlugin.banners.high}" alt="${safePlugin.name} banner" class="h-auto max-h-[620px] justify-center object-cover w-full">
            </div>
          </div>
        </div>
        <div class="container mx-auto px-4 py-16">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div class="md:col-span-2 bg-gradient-to-br rounded-3xl asset-card-container-home shadow-2xl p-8 transform min-h-[200px]">
              <div class='px-4 py-6 bg-[#191919] rounded-3xl mb-2 flex items-center'>
                <img src="${safePlugin.icons['1x']}" alt="${safePlugin.name}" class="w-24 h-24 mr-4 rounded-lg">
                <div>
                  <h1 class="text-2xl font-bold mb-1">${safePlugin.name}</h1>
                  <p class="text-md w-90">${safePlugin.short_description}</p>
                </div>
              </div>
              <div class="bg-[#191919] rounded-3xl p-2 mb-2">
                <div class="text-md leading-8">${safePlugin.sections?.description}</div>
              </div>
              ${safePlugin.sections?.installation ? `
                <h3 class="text-2xl font-bold mb-4">Installation</h3>
                <div class="bg-gray-800 rounded-lg p-6 mb-8">
                  ${safePlugin.sections.installation}
                </div>
              ` : ''}
              ${safePlugin.sections?.faq ? `
                <h3 class="text-2xl font-bold mb-4">FAQ</h3>
                <div class="bg-gray-800 rounded-lg p-6 mb-8">
                  ${safePlugin.sections.faq}
                </div>
              ` : ''}
            </div>
            <div>
              <div class="bg-gradient-to-br rounded-3xl asset-card-container-home shadow-2xl rounded-lg p-6 mb-8">
                <div class="flex items-center mb-4">
                  <img src="${safePlugin.icons['2x']}" alt="${safePlugin.name}" class="w-16 h-16 mr-4 rounded-full">
                  <div>
                    <h3 class="text-xl font-bold">${safePlugin.name}</h3>
                    <p class="text-gray-200 text-md">by ${safePlugin.author}</p>
                  </div>
                </div>
                <div class="flex items-center justify-between mb-4">
                  <div class="flex items-center">
                  ${safePlugin.rating && safePlugin.rating > 0 ? `
                    <span class="text-yellow-400 mr-1">★</span>
                    <span>${safePlugin.rating}/5</span>
                  ` : ''}
                  </div>
					<div class="flex items-center">
					<span class="mr-2 text-purple-600">↓</span>
					<span class="text-s" id="download-count">${downloadCount.toLocaleString()}+ downloads</span>
					</div>
					<div class="flex items-center">
					<span class="mr-2 text-purple-600">🔌</span>
						<span class="text-s" id="active-installs">${activeInstalls.toLocaleString()}+ activations</span>
					</div>
                </div>
				<a href="/download?author=${encodeURIComponent(safePlugin.author)}&slug=${encodeURIComponent(safePlugin.slug)}" 
				class="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-3xl mb-4 flex items-center justify-center">
				Download v${safePlugin.version}
				</a>
                <div class="text-sm text-gray-200">
                  <p>Last updated: ${safePlugin.last_updated}</p>
                  <p>Version: ${safePlugin.version}</p>
                  <p>Requires WordPress: ${safePlugin.requires}</p>
                  <p>Tested up to: ${safePlugin.tested}</p>
                  <p>Requires PHP: ${safePlugin.requires_php}</p>
                </div>
              </div>
              ${safePlugin.authorData ? `
                <div class="bg-gradient-to-br rounded-3xl asset-card-container-home shadow-2xl p-6">
                  <h3 class="text-xl font-bold mb-4">Author</h3>
                  <div class="flex items-center mb-4">
                    <img src="${safePlugin.authorData.avatar_url}" alt="${safePlugin.author}" class="w-16 h-16 mr-4 rounded-full">
                    <div>
                      <p class="font-bold">${safePlugin.author}</p>
                      <a href="/author/${safePlugin.author}" class="text-purple-400 hover:underline">View Profile</a>
                    </div>
                  </div>
                  <a href="${safePlugin.support_url}" class="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-3xl block text-center">
                    Get Support
                  </a>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
        <div class="bg-black py-8">
			<div class="container mx-auto px-4 text-center text-gray-200">
				<p>&copy; ${new Date().getFullYear()} ${new Date().toLocaleTimeString()} Your Footer Text.</p>
				<a href="/terms" class="text-purple-400 hover:underline">Terms of Service</a> | 
				<a href="/privacy" class="text-purple-400 hover:underline">Privacy Policy</a> |
				<a href="https://github.com/xpportal/Micro-Plugin-Publisher" class="text-purple-400 hover:underline">
					Source Code
				</a>
			</div>
        </div>
      </div>
    </body>
    </html>
  `;

	return secureHtmlService.transformHTML(html);
}
