#!/bin/sh
# Arranca SeaweedFS como S3 con las credenciales del entorno (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY).
# Todo vive en /seed: en la imagen de la demo ya trae el catálogo sembrado.
set -eu
printf '{"identities":[{"name":"interiores","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' \
  "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" > /tmp/s3.json
mkdir -p /seed && cd /seed
# El índice del filer iría a /data/filerldb2 (lo fija /etc/seaweedfs/filer.toml); un filer.toml en el
# directorio de trabajo tiene prioridad y lo deja junto a los datos.
printf '[leveldb2]\nenabled = true\ndir = "/seed/filerldb2"\n' > filer.toml
exec weed server -dir=/seed -ip=127.0.0.1 -ip.bind=0.0.0.0 -s3 -s3.port=8333 -s3.config=/tmp/s3.json \
  -master.volumeSizeLimitMB=1024
