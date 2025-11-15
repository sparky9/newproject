#!/bin/bash
# Test Database Connection

echo "🔍 Testing Database Connection..."
echo ""

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL not set in environment"
  echo "Please run: export DATABASE_URL='your-connection-string'"
  exit 1
fi

# Test connection
psql "$DATABASE_URL" -c "SELECT version();" 2>&1 | head -5

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Database connection successful!"
else
  echo ""
  echo "❌ Database connection failed"
  echo "Check your DATABASE_URL"
fi
