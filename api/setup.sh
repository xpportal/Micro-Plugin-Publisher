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

# Create or update wrangler.toml
echo "Creating/Updating wrangler.toml..."
cat > wrangler.toml << EOL
name = "$project_name"
main = "src/worker.js"
compatibility_date = "2023-05-18"
account_id = "$account_id"
node_compat = true

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

# Deploy worker again to ensure latest changes
echo "Redeploying worker to ensure latest changes..."
output=$(npx wrangler deploy 2>&1)
if [[ $output == *"Error"* ]]; then
    echo "Error redeploying worker: $output"
    exit 1
fi
echo "Worker redeployed successfully."

echo "Setup complete! Your plugin publishing system is now deployed."
echo "R2 Bucket URL: https://$custom_domain"
echo "API Secret: $api_secret"
echo ""
echo "Next steps:"
echo "1. Your worker code in src/worker.js has been deployed."
echo "2. If you need to make changes, edit src/worker.js and run 'npx wrangler deploy' to update."
echo "3. To roll the API key and redeploy, run this script with the --roll-api-key argument."
echo "4. Start using your plugin publishing system!"