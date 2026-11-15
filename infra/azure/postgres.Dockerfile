# Postgres con el esquema migrado y el catálogo sembrado: el volcado se carga en el primer arranque
# (la demo en Azure no tiene volumen, así que cada arranque en frío vuelve a este estado).
FROM postgres:16.15-alpine
COPY build/demo.sql /docker-entrypoint-initdb.d/10-demo.sql
