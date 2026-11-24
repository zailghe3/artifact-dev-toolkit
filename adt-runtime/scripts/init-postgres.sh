#!/bin/sh
set -eu

ADT_APP_PASSWORD=$(cat /run/secrets/adt_postgres_app_password)
export ADT_APP_PASSWORD
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
\getenv app_password ADT_APP_PASSWORD
CREATE ROLE adt_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
REVOKE ALL ON DATABASE adt FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE adt TO adt_runtime;
SQL
unset ADT_APP_PASSWORD
