// searchBar.js
export function createSearchBar(currentQuery = '', tags = []) {
	const safeQuery = currentQuery.replace(/[&<>"']/g, (match) => {
		const escape = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;'
		};
		return escape[match];
	});

	return `
	  <div class="w-full mx-auto px-4 py-2">
		  <div class="w-full max-w-3xl mx-auto px-2 py-4">
			<form action="/directory/search" method="GET" class="relative" autocomplete="off">
			<input 
				type="search" 
				name="q" 
				value="${safeQuery}"
				placeholder="Search plugins..."
				class="w-full px-4 py-2 rounded-lg bg-gray-800 text-md text-white border border-gray-700 focus:outline-none focus:border-purple-500"
			>
			<button 
				type="submit"
				class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
			</button>
			</form>
			</div>
	  </div>
	`;
}