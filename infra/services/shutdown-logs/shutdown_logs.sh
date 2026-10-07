#!/bin/bash

echo "Checking shutdown logs $(date '+%Y-%m-%d %H:%M:%S') v1"

PROJECT="nl-cod2-zom"
STATE_DIR="/var/run/shutdown-logs"
STATE_FILE="$STATE_DIR/shutdown-logs.state"
TEMP_LOG_FILE="/tmp/shutdown_logs_$$.txt"  # Unique temp file with PID
LOG_LINES=500

# Ensure state directory exists
mkdir -p "$STATE_DIR"

# Ensure state file exists
[ ! -f "$STATE_FILE" ] && touch "$STATE_FILE"

# Cleanup temp file on exit
cleanup() {
    rm -f "$TEMP_LOG_FILE"
}
trap cleanup EXIT

task_id=$(docker service ps -f "desired-state=shutdown" "${PROJECT}_${PROJECT}" --format "{{.ID}}" -q | head -n 1)
if [ -z "$task_id" ]; then
    echo "No shutdown instances found"
    exit 0
fi

container_id=$(docker inspect --format '{{.Status.ContainerStatus.ContainerID}}' "$task_id" 2>/dev/null)
if [ -z "$container_id" ]; then
    echo "Could not get container ID for task $task_id"
    exit 0
fi

if grep -Fxq "$container_id" "$STATE_FILE"; then
    echo "Container $container_id already processed"
    exit 0
fi

docker logs --tail "$LOG_LINES" "$container_id" > "$TEMP_LOG_FILE" 2>&1
if [ $? -ne 0 ]; then
    echo "Failed to get logs for container $container_id"
    exit 0
fi

# Define error patterns
error_regex="\*\*\*\*\*\*\* script runtime error \*\*\*\*\*\*\*|\*\*\*\*\*\*\* script compile error \*\*\*\*\*\*\*"
if grep -q -E "$error_regex" "$TEMP_LOG_FILE"; then
    # Find the first occurrence of an error pattern
    first_error_line=$(grep -n -E "$error_regex" "$TEMP_LOG_FILE" | head -n 1 | cut -d: -f1)
    
    # Calculate the starting line (10 lines before, but not less than 1)
    if [ "$first_error_line" -gt 10 ]; then
        start_line=$((first_error_line - 10))
    else
        start_line=1
    fi

    # Get the total number of lines in the log file
    total_lines=$(wc -l < "$TEMP_LOG_FILE")

    # Extract logs from start_line to the end of the file
    error_logs=$(sed -n "${start_line},${total_lines}p" "$TEMP_LOG_FILE" | head -n 50)

    # Use jq to create a properly escaped JSON payload
    json_content="Error detected in $PROJECT (Container: $container_id)"
    json_description="$error_logs"
    
    BODY=$(jq -n \
          --arg content "$json_content" \
          --arg description "$json_description" \
          '{
            "content": $content,
            "embeds": [
              {
                "title": "Script Error",
                "description": "```\n\($description)\n```",
                "color": 16711680
              }
            ]
          }')

    # Send to Discord
    curl -H "Content-Type: application/json" -d "$BODY" "$SHUTDOWN_LOGS_DISCORD_WEBHOOK"
    curl_status=$?

    if [ $curl_status -eq 0 ]; then
        echo "$container_id" >> "$STATE_FILE"
        echo "Error logs sent to Discord for container $container_id"
    else
        echo "Failed to send logs to Discord (curl exit code: $curl_status)"
        exit 1
    fi
else
    echo "No error patterns found in logs"
    echo "$container_id" >> "$STATE_FILE"  # Still mark as processed
    exit 0
fi

exit 0