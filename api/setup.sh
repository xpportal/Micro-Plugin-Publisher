#!/bin/bash

# Function to generate a random string
generate_random_string() {
    chars="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    length=$1
    result=""
    for i in $(seq 1 $length); do
        random_char=${chars:$RANDOM % ${#chars}:1}
        result+=$random_char
    done
    echo $result
}

# Function to roll API key and redeploy
roll_api_key_and_redeploy() {
    echo "Rolling API key and redeploying..."
    
    # Generate new API secret
    new_api_secret=$(generate_random_string 32)
    echo "Generated new API secret: $new_api_secret"
    
    # Set new API secret
    echo "Setting new API secret..."
    echo "$new_api_secret" | npx wrangler secret put API_SECRET > /dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo "Error setting new API secret."
        exit 1
    fi
    echo "New API secret set successfully."
    
    # Update env file with new API key
    update_env_file "$new_api_secret"
    
    # Redeploy worker
    echo "Redeploying worker..."
    output=$(npx wrangler deploy 2>&1)
    if [[ $output == *"Error"* ]]; then
        echo "Error redeploying worker: $output"
        exit 1
    fi
    echo "Worker redeployed successfully with new API key."
    echo "New API Secret: $new_api_secret"
}

# Function to update environment file
update_env_file() {
    local api_key=$1
    local worker_url=${2:-""}  # Make worker_url optional with empty default
    local env_file="${HOME}/.plugin-publisher"
    
    echo "Creating environment file at: $env_file"
    
    # Create or update the environment file
    cat > "$env_file" << EOL
# Plugin Publisher Configuration
# Generated on $(date)

# API Key for authentication
API_KEY=$api_key

# Worker API URL
PLUGIN_API_URL=$worker_url

# R2 Bucket URL (needs to be manually configured)
# Please set this URL after making your R2 bucket public
# Format should be: https://pub-{hash}.r2.dev
BUCKET_URL=

# Note: Make your R2 bucket public through the Cloudflare dashboard
# and update the BUCKET_URL accordingly
EOL

    if [ -f "$env_file" ]; then
        echo "Environment file created successfully at: $env_file"
        chmod 600 "$env_file"  # Set restrictive permissions
    else
        echo "Error: Failed to create environment file"
    fi
}

# Function to get worker URL
get_worker_url() {
    local project_name=$1
    # Get the deployment information
    deploy_info=$(npx wrangler deploy --dry-run 2>&1)
    
    # Try to extract the URL from the deployment info
    if [[ $deploy_info =~ https://$project_name\..*\.workers\.dev ]]; then
        echo "${BASH_REMATCH[0]}"
    else
        echo ""
    fi
}

# Check if the script is being run to roll API key and redeploy
if [ "$1" == "--roll-api-key" ]; then
    roll_api_key_and_redeploy
    exit 0
fi

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null
then
    echo "Wrangler is not installed. Please install it first."
    echo "You can install it using: npm install -g wrangler"
    exit 1
fi

echo "Welcome to the Plugin Publishing System Setup!"
echo "This script will set up the necessary resources and configure your environment."

# Get project name
read -p "Enter a name for your project: " project_name

# Get account ID
echo "Fetching your account information..."
account_info=$(wrangler whoami 2>&1)

# Extract account information
account_names=()
account_ids=()
while IFS= read -r line; do
    if [[ $line =~ \|[[:space:]]+(.*)[[:space:]]+\|[[:space:]]+(.*)[[:space:]]+\| ]]; then
        name="${BASH_REMATCH[1]}"
        id="${BASH_REMATCH[2]}"
        if [[ $name != "Account Name" ]]; then  # Skip the header line
            account_names+=("$name")
            account_ids+=("$id")
        fi
    fi
done < <(echo "$account_info")

# Check if we have multiple accounts
if [ ${#account_ids[@]} -eq 0 ]; then
    echo "No accounts found. Please make sure you're logged in to Wrangler."
    exit 1
elif [ ${#account_ids[@]} -eq 1 ]; then
    account_id="${account_ids[0]}"
    echo "Using account: ${account_names[0]} (${account_id})"
else
    echo "Multiple accounts found. Please choose the account you want to use:"
    for i in "${!account_names[@]}"; do
        echo "$((i+1)). ${account_names[$i]} (${account_ids[$i]})"
    done

    while true; do
        read -p "Enter the number of the account you want to use: " account_choice
        if [[ "$account_choice" =~ ^[0-9]+$ ]] && [ "$account_choice" -ge 1 ] && [ "$account_choice" -le "${#account_ids[@]}" ]; then
            account_id="${account_ids[$((account_choice-1))]}"
            echo "Using account: ${account_names[$((account_choice-1))]} (${account_id})"
            break
        else
            echo "Invalid choice. Please enter a number between 1 and ${#account_ids[@]}."
        fi
    done
fi

# Get current date for compatibility_date
current_date=$(date +%Y-%m-%d)

# Create KV namespaces
echo "Creating KV namespaces..."
echo "Creating DOWNLOAD_COUNTS namespace..."
download_counts_output=$(npx wrangler kv:namespace create "DOWNLOAD_COUNTS" 2>&1)
if [[ $download_counts_output == *"Error"* ]]; then
    echo "Error creating DOWNLOAD_COUNTS namespace: $download_counts_output"
    exit 1
fi
download_counts_id=$(echo "$download_counts_output" | grep -o 'id = "[^"]*"' | cut -d'"' -f2)

echo "Creating DOWNLOAD_QUEUE namespace..."
download_queue_output=$(npx wrangler kv:namespace create "DOWNLOAD_QUEUE" 2>&1)
if [[ $download_queue_output == *"Error"* ]]; then
    echo "Error creating DOWNLOAD_QUEUE namespace: $download_queue_output"
    exit 1
fi
download_queue_output_id=$(echo "$download_queue_output" | grep -o 'id = "[^"]*"' | cut -d'"' -f2)

echo "Creating DOWNLOAD_RATELIMIT namespace..."
download_ratelimit_output=$(npx wrangler kv:namespace create "DOWNLOAD_RATELIMIT" 2>&1)
if [[ $download_ratelimit_output == *"Error"* ]]; then
    echo "Error creating DOWNLOAD_RATELIMIT namespace: $download_ratelimit_output"
    exit 1
fi
download_ratelimit_id=$(echo "$download_ratelimit_output" | grep -o 'id = "[^"]*"' | cut -d'"' -f2)

# Create or update wrangler.toml
echo "Creating/Updating wrangler.toml..."
cat > wrangler.toml << EOL
name = "$project_name"
main = "src/worker.js"
compatibility_date = "$current_date"
compatibility_flags = ["nodejs_compat"]
account_id = "$account_id"

kv_namespaces = [
  { binding = "DOWNLOAD_COUNTS", id = "$download_counts_id", preview_id = "$download_counts_id" },
  { binding = "DOWNLOAD_RATELIMIT", id = "$download_ratelimit_id", preview_id = "$download_ratelimit_id" }
  { binding = "DOWNLOAD_QUEUE", id = "$download_queue_output_id", preview_id = "$download_queue_output_id" }
]

[observability]
enabled = true
head_sampling_rate = 1

[triggers]
crons = ["*/5 * * * *"]

durable_objects.bindings = [
  { name = "PLUGIN_REGISTRY", class_name = "PluginRegistryDO" },
  { name = "USER_AUTH", class_name = "UserAuthDO" } 
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["PluginRegistryDO"]

[vars]
PLUGIN_BUCKET_URL = ""

[[r2_buckets]]
binding = "PLUGIN_BUCKET"
bucket_name = "${project_name}-bucket"
preview_bucket_name = "${project_name}-bucket-preview"

[env.production]
vars = { ENVIRONMENT = "production" }
EOL

# Create R2 bucket
echo "Creating R2 bucket..."
output=$(npx wrangler r2 bucket create "${project_name}-bucket" 2>&1)
if [[ $output != *"Created bucket"* ]]; then
    echo "Error creating R2 bucket: $output"
    exit 1
fi
echo "R2 bucket created successfully."

# Set CORS rules for the R2 bucket
echo "Setting CORS rules for the R2 bucket..."
if [ -f "./cors-rules.json" ]; then
    output=$(npx wrangler r2 bucket cors put "${project_name}-bucket" --rules ./cors-rules.json 2>&1)
    if [[ $output == *"Error"* ]]; then
        echo "Error setting CORS rules: $output"
        exit 1
    fi
    echo "CORS rules set successfully."
else
    echo "Warning: cors-rules.json file not found. Skipping CORS configuration."
fi

# Create domain for R2 bucket
custom_domain="${project_name}.${account_id}.r2.cloudflarestorage.com"
echo "Your R2 bucket domain is: $custom_domain"

# Update wrangler.toml with domain
sed -i.bak "s|PLUGIN_BUCKET_URL = \"\"|PLUGIN_BUCKET_URL = \"https://$custom_domain\"|" wrangler.toml
rm wrangler.toml.bak

# Generate API secret
api_secret=$(generate_random_string 32)
echo "Generated API secret: $api_secret"
echo "Make sure to save this secret securely."

# Deploy worker
echo "Deploying worker..."
output=$(npx wrangler deploy 2>&1)
if [[ $output == *"Error"* ]]; then
    echo "Error deploying worker: $output"
    exit 1
fi
echo "Worker deployed successfully."

# Set API secret
echo "Setting API secret..."
echo "$api_secret" | npx wrangler secret put API_SECRET > /dev/null 2>&1
if [ $? -ne 0 ]; then
	echo "Error setting API secret."
	exit 1
fi
echo "API secret set successfully."

# Generate a secure random master salt (64 hex characters)
user_key_salt=$(openssl rand -hex 32)
echo "Generated master salt: $user_key_salt"

# Set the secrets
echo "$user_key_salt" | npx wrangler secret put USER_KEY_SALT > /dev/null 2>&1
if [ $? -ne 0 ]; then
	echo "Error setting USER_KEY_SALT."
	exit 1
fi
echo "USER_KEY_SALT set successfully."

# Prompt user to set a default invite code
read -p "Enter a default invite code: " invite_code

echo "Generated invite code: $invite_code"

echo "$invite_code" | npx wrangler secret put INVITE_CODE > /dev/null 2>&1
if [ $? -ne 0 ]; then
	echo "Error setting INVITE_CODE."
	exit 1
fi
echo "INVITE_CODE set successfully."

# Deploy worker again to ensure latest changes
echo "Redeploying worker to ensure latest changes..."
output=$(npx wrangler deploy 2>&1)
if [[ $output == *"Error"* ]]; then
    echo "Error redeploying worker: $output"
    exit 1
fi
echo "Worker redeployed successfully."

worker_url=$(get_worker_url "$project_name")
# Always call update_env_file, even if worker_url is empty
update_env_file "$api_secret" "$worker_url"
if [ -z "$worker_url" ]; then
    echo "Warning: Could not determine worker URL automatically."
    echo "Please manually update the PLUGIN_API_URL in ~/.plugin-publisher"
fi

echo "Setup complete! Your plugin publishing system is now deployed."
echo "R2 Bucket URL: https://$custom_domain"
echo "API Secret: $api_secret"
echo ""
echo "Next steps:"
echo "1. Your worker code in src/worker.js has been deployed."
echo "2. Environment configuration has been created at ~/.plugin-publisher"
echo "3. IMPORTANT: Make your R2 bucket public through the Cloudflare dashboard"
echo "4. Update the BUCKET_URL in ~/.plugin-publisher with your public R2 URL"
echo "5. If you need to make changes, edit src/worker.js and run 'npx wrangler deploy' to update."
echo "6. To roll the API key and redeploy, run this script with the --roll-api-key argument."
echo "7. Start using your plugin publishing system!"
