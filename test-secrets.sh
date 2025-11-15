#!/bin/bash
# Test All Secrets

echo "================================"
echo "🔐 SECRETS VERIFICATION TEST"
echo "================================"
echo ""

# Load .env file
if [ -f .env ]; then
  echo "📄 Loading .env file..."
  export $(grep -v '^#' .env | xargs)
  echo "✅ .env loaded"
  echo ""
else
  echo "❌ .env file not found!"
  echo "Please copy .env.example to .env and fill in your secrets"
  exit 1
fi

# Test 1: Database
echo "================================"
echo "1️⃣  DATABASE CONNECTION"
echo "================================"
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL not set"
  DB_OK=false
else
  echo "🔍 Testing connection..."
  if psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ Database connection successful!"
    DB_OK=true
  else
    echo "❌ Database connection failed"
    echo "   Check your DATABASE_URL in .env"
    DB_OK=false
  fi
fi
echo ""

# Test 2: Clerk
echo "================================"
echo "2️⃣  CLERK AUTHENTICATION"
echo "================================"
if [ -z "$CLERK_PUBLISHABLE_KEY" ] || [ -z "$CLERK_SECRET_KEY" ]; then
  echo "❌ Clerk keys not set"
  CLERK_OK=false
else
  if [[ $CLERK_PUBLISHABLE_KEY == pk_* ]] && [[ $CLERK_SECRET_KEY == sk_* ]]; then
    echo "✅ Clerk keys format looks correct"
    echo "   (Will verify when app starts)"
    CLERK_OK=true
  else
    echo "❌ Clerk keys format incorrect"
    echo "   CLERK_PUBLISHABLE_KEY should start with 'pk_'"
    echo "   CLERK_SECRET_KEY should start with 'sk_'"
    CLERK_OK=false
  fi
fi
echo ""

# Test 3: Fireworks AI
echo "================================"
echo "3️⃣  FIREWORKS AI"
echo "================================"
if [ -z "$FIREWORKS_API_KEY" ]; then
  echo "❌ FIREWORKS_API_KEY not set"
  FIREWORKS_OK=false
else
  echo "🔍 Testing API key..."
  response=$(curl -s -w "\n%{http_code}" -X POST https://api.fireworks.ai/inference/v1/chat/completions \
    -H "Authorization: Bearer $FIREWORKS_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"accounts/fireworks/models/qwen2p5-7b-instruct","messages":[{"role":"user","content":"test"}],"max_tokens":5}')

  http_code=$(echo "$response" | tail -n1)

  if [ "$http_code" = "200" ]; then
    echo "✅ Fireworks AI API key is valid!"
    FIREWORKS_OK=true
  else
    echo "❌ Fireworks AI API key invalid (HTTP $http_code)"
    FIREWORKS_OK=false
  fi
fi
echo ""

# Summary
echo "================================"
echo "📊 SUMMARY"
echo "================================"
echo ""

if [ "$DB_OK" = true ] && [ "$CLERK_OK" = true ] && [ "$FIREWORKS_OK" = true ]; then
  echo "🎉 ALL SECRETS VERIFIED!"
  echo ""
  echo "You're ready to run:"
  echo "  pnpm install"
  echo "  cd packages/db && pnpm migrate:dev && cd ../.."
  echo "  pnpm build"
  echo "  pnpm dev"
  echo ""
  exit 0
else
  echo "❌ Some secrets need attention:"
  [ "$DB_OK" = false ] && echo "   - Database connection"
  [ "$CLERK_OK" = false ] && echo "   - Clerk keys"
  [ "$FIREWORKS_OK" = false ] && echo "   - Fireworks AI key"
  echo ""
  echo "Fix these in your .env file and run this test again"
  exit 1
fi
