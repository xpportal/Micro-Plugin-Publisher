export const IPC_EVENTS = {
	VALIDATE_JSON: 'repo-plugin-uploader:validate-json',
	LOGIN: 'repo-plugin-uploader:login',
	LOGOUT: 'repo-plugin-uploader:logout',
	REFRESH_TOKEN: 'repo-plugin-uploader:refresh-token',
	GET_AUTH_STATUS: 'repo-plugin-uploader:get-auth-status',
	UPLOAD_CHUNK: 'repo-plugin-uploader:upload-chunk',
	COMBINE_CHUNKS: 'repo-plugin-uploader:combine-chunks',
	READ_ZIP_FILE: 'repo-plugin-uploader:read-zip-file',
	READ_JSON_FILE: 'repo-plugin-uploader:read-json-file',
	UPLOAD_PLUGIN: 'repo-plugin-uploader:upload-plugin',
	UPLOAD_PLUGIN_ASSETS: 'repo-plugin-uploader:upload-plugin-assets',
	UPDATE_JSON_FILE: 'repo-plugin-uploader:update-json-file',
	SCAFFOLD_PLUGIN: 'repo-plugin-uploader:scaffold-plugin',
	GET_SITE_NAME: 'repo-plugin-uploader:get-site-name',
	LOAD_PLUGIN_JSON: 'repo-plugin-uploader:load-plugin-json',
	WRITE_PLUGIN_JSON: 'repo-plugin-uploader:write-plugin-json',
};

export const STORE_KEYS = {
	API_KEY: 'apiKey',
	TOKEN: 'token',
	USER_ID: 'userID',
	ACCESS_TOKEN: 'access_token',
	REFRESH_TOKEN: 'refresh_token',
	TOKEN_EXPIRY_TIME: 'tokenExpiryTime',
};
