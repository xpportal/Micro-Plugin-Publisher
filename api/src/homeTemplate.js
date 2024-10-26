import { createHeaderSearchBar } from './headerSearchBar';

export default async function generateHomeHTML(authors, env) {
	const mainLogo = 'https://pub-2ef6bc2ae372488daf94a858e2b752ac.r2.dev/main-logo.png';

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <title>Plugin Publisher - Discover Amazing Plugins</title>
        <link 
            href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" 
            rel="stylesheet"
            crossorigin="anonymous"
        >
        <style>
            body { background-color: #191919; color: white; }
            .asset-card-container-home { background: linear-gradient(to bottom right, #212020c9, #2c2c2cb5); }
            .hero-card-container { background: linear-gradient(to top left, #8e34d7c4, #30d3669b); }
            .authors-list-container { background: linear-gradient(to bottom right, #131313e8, #181818b5); }
        </style>
    </head>
    <body>
        <div class="min-h-screen bg-[#191919] text-white">
			${createHeaderSearchBar()}
            <!-- Hero section with search -->
            <div class="bg-gradient-to-r from-purple-500 to-blue-400 py-32">
                <div class="container mx-auto px-4 text-center">
					<a href="/" class="mr-4 justify-center flex items-center">
					<img src="${mainLogo}" alt="Logo" style="height: 150px; margin-bottom: 20px;">
					</a>
                    <p class="text-xl mb-8">Find the perfect plugin for your needs from a curated collection of wonderful contributors.</p>
                    <div class="max-w-3xl mx-auto">
                        <form action="/directory/search" method="GET" class="flex gap-2">
                            <input 
                                type="text" 
                                name="q" 
                                placeholder="Search plugins..." 
                                class="flex-1 px-6 py-3 rounded-lg bg-white bg-opacity-20 text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-white"
                            >
                            <button 
                                type="submit"
                                class="block text-center bg-purple-600 text-white font-medium rounded-lg px-5 py-2.5"
                            >
                                Search
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            <!-- Featured Authors Section -->
            <div class="container mx-auto px-4 py-16">
                <div class="authors-list-container rounded-3xl shadow-3xl p-8">
                    <h2 class="text-2xl font-bold mb-8">Featured Authors</h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        ${authors.map(author => `
                            <div class="bg-gradient-to-br asset-card-container-home rounded-xl shadow-2xl p-6">
                                <div class="flex items-center mb-6">
                                    <img 
                                        src="${author.avatar_url || '/images/default-avatar.jpg'}" 
                                        alt="${author.username}" 
                                        class="w-28 h-28 rounded-full"
                                    >
                                    <div class="ml-4">
                                        <h3 class="text-xl font-bold">${author.username}</h3>
                                        <p class="text-sm text-gray-300">Member since ${new Date(author.member_since).toLocaleDateString()}</p>
                                    </div>
                                </div>
                                <p class="text-gray-300 mb-4">${author.bio || ''}</p>
                                <div class="flex gap-4 mb-4">
                                    ${author.github ? `
                                        <a href="https://github.com/${author.github}" target="_blank" rel="noopener" class="text-purple-400 hover:text-purple-300">
                                            GitHub
                                        </a>
                                    ` : ''}
                                    ${author.twitter ? `
                                        <a href="https://twitter.com/${author.twitter}" target="_blank" rel="noopener" class="text-purple-400 hover:text-purple-300">
                                            Twitter
                                        </a>
                                    ` : ''}
                                    ${author.website ? `
                                        <a href="${author.website}" target="_blank" rel="noopener" class="text-purple-400 hover:text-purple-300">
                                            Website
                                        </a>
                                    ` : ''}
                                </div>
                                <div class="text-sm text-gray-400">
                                    ${author.plugin_count || 0} plugins published
                                </div>
                                <a href="/author/${author.username}" class="mt-4 block text-center bg-gradient-to-br from-purple-600 to-blue-500 hover:bg-gradient-to-bl text-white font-medium rounded-lg px-5 py-2.5">
                                    View Profile
                                </a>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;

    return new Response(html, {
        headers: {
            'Content-Type': 'text/html',
        },
    });
}