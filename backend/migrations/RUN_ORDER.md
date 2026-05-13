# Database Migration Run Order

Run these scripts in the specified order to properly initialize the database.

## Order

1. **create_extensions.sql** — Creates required PostgreSQL extensions
2. **create_core_tables_manual.sql** — Creates core tables
3. **create_test_versions.sql** — Creates test version tracking tables
4. **create_indexes.sql** — Creates performance indexes

## How to Run

```bash
# Navigate to the backend directory
cd backend

# Run each migration in order
psql -U postgres -d ai_testing_platform -f migrations/create_extensions.sql
psql -U postgres -d ai_testing_platform -f migrations/create_core_tables_manual.sql
psql -U postgres -d ai_testing_platform -f migrations/create_test_versions.sql
psql -U postgres -d ai_testing_platform -f migrations/create_indexes.sql
```

## Verify

After running all migrations, verify with:
```sql
-- Check extensions
SELECT extname, extversion FROM pg_extension;

-- Check tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Check indexes
SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%' ORDER BY tablename;