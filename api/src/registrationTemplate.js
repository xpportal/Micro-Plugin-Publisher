export default async function generateRegisterHTML() {
	const mainLogo = 'https://assets.pluginpublisher.com/main-logo.png';

	const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <title>Register as Author - Plugin Publisher</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link 
            href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" 
            rel="stylesheet"
            crossorigin="anonymous"
        >
        <style>
            body { color: white; }
            .registration-card { background: linear-gradient(to bottom right, #212020c9, #2c2c2cb5); }
			.lime-button { background: linear-gradient(to right, #a2ff00, #b3ef4a); color: black }
        </style>
        <script>
            async function handleSubmit(event) {
                event.preventDefault();
                
                const form = event.target;
                const submitButton = form.querySelector('button[type="submit"]');
                const errorDiv = document.getElementById('error-message');
                const successDiv = document.getElementById('success-message');
                
                submitButton.disabled = true;
                errorDiv.textContent = '';
                successDiv.textContent = '';
                
                try {
                    const response = await fetch('/create-user', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
						body: JSON.stringify({
							username: form.username.value,
							github_username: form.github_username.value,
							inviteCode: form.inviteCode.value
						})
                    });
                    
                    const data = await response.json();

					if (!response.ok) {
                        throw new Error(data.error || 'Registration failed');
                    }
                    
                    // Create config content
                    const configContent = \`API_KEY=\${data.apiKey}
PLUGIN_API_URL=https://pluginpublisher.com
BUCKET_URL=https://assets.pluginpublisher.com\`;
                    
                    // Create and download file
                    const blob = new Blob([configContent], { type: 'text/plain' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'plugin-publisher-config.txt';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                    
                    // Show success message
                    successDiv.textContent = 'Registration successful! Your configuration file has been downloaded.';
                    form.reset();
                    
                } catch (error) {
                    errorDiv.textContent = error.message;
                } finally {
                    submitButton.disabled = false;
                }
            }
        </script>
    </head>
    <body>
        <div class="min-h-screen bg-gradient-to-r from-purple-500 to-purple-900 py-32 text-white">
            <div class="container mx-auto px-4">
                <div class="max-w-md mx-auto">
                    <!-- Logo -->
                    <div class="text-center mb-8">
                        <a href="/" class="inline-block">
                            <img src="${mainLogo}" alt="Logo" class="max-h-32 w-auto">
                        </a>
                    </div>
                    
                    <!-- Registration Card -->
                    <div class="registration-card rounded-lg shadow-xl p-8">
                        <h1 class="text-2xl font-bold mb-6 text-center">Register as an Author</h1>
                        
                        <form onsubmit="handleSubmit(event)" class="space-y-6">
                            <div>
                                <label for="username" class="block text-sm font-medium mb-2">Username</label>
                                <input
                                    type="text"
                                    id="username"
                                    name="username"
                                    required
                                    class="w-full px-4 py-2 rounded bg-gray-800 border border-gray-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition"
                                    placeholder="Choose a username"
                                >
                            </div>
                            
                            <div>
                                <label for="inviteCode" class="block text-sm font-medium mb-2">Invite Code</label>
                                <input
                                    type="text"
                                    id="inviteCode"
                                    name="inviteCode"
                                    required
                                    class="w-full px-4 py-2 rounded bg-gray-800 border border-gray-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition"
                                    placeholder="Enter your invite code"
                                >
                            </div>
                            <div>
								<label for="email" class="block text-sm font-medium mb-2">Email Address</label>
								<input
									type="email"
									id="email"
									name="email"
									required
									class="w-full px-4 py-2 rounded bg-gray-800 border border-gray-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition"
									placeholder="Your email address"
								>
							</div>

							<div>
								<label for="github_username" class="block text-sm font-medium mb-2">GitHub Username</label>
								<input
									type="text"
									id="github_username"
									name="github_username"
									required
									class="w-full px-4 py-2 rounded bg-gray-800 border border-gray-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition"
									placeholder="Your GitHub username"
								>
							</div>

                            <div id="error-message" class="text-red-500 text-sm min-h-[20px]"></div>
                            <div id="success-message" class="text-green-500 text-sm min-h-[20px]"></div>
                            
                            <button
                                type="submit"
                                class="w-full lime-button font-medium py-2 px-4 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                            >
                                Register
                            </button>
                        </form>
                    </div>
                    
                    <!-- Back to Home -->
                    <div class="text-center mt-6">
                        <a href="/" class="text-purple-400 hover:text-purple-300">Back to Home</a>
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