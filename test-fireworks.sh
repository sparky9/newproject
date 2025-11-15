#!/bin/bash
# Test Fireworks AI API Key

echo "🔍 Testing Fireworks AI API Key..."
echo ""

if [ -z "$FIREWORKS_API_KEY" ]; then
  echo "❌ FIREWORKS_API_KEY not set in environment"
  echo "Please run: export FIREWORKS_API_KEY='your-api-key'"
  exit 1
fi

# Test API call
response=$(curl -s -X POST https://api.fireworks.ai/inference/v1/chat/completions \
  -H "Authorization: Bearer $FIREWORKS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "accounts/fireworks/models/qwen2p5-7b-instruct",
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 10
  }' 2>&1)

if echo "$response" | grep -q "choices"; then
  echo "✅ Fireworks AI API key is valid!"
  echo ""
  echo "Response preview:"
  echo "$response" | head -10
elif echo "$response" | grep -q "401"; then
  echo "❌ Invalid API key (401 Unauthorized)"
elif echo "$response" | grep -q "error"; then
  echo "❌ API error:"
  echo "$response" | head -5
else
  echo "❌ Unexpected response:"
  echo "$response" | head -5
fi
