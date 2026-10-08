#!/bin/sh

echo "Backup started at $(date '+%Y-%m-%d %H:%M:%S') v1"

BACKUP_DIR=$(mktemp -d)
cleanup() {
    rm -rf "${BACKUP_DIR}"
}
trap cleanup EXIT

for DB_NAME in $DATABASES
do
    SQL_FILE="backup_${DB_NAME}_hetzner.sql"
    S3_PATH=s3://${S3_BUCKET}/${SQL_FILE}.gz

    echo "Dumping database ${DB_NAME} to ${SQL_FILE} and uploading to ${S3_PATH}..."
    mariadb-dump -h ${DB_HOST} -P ${DB_PORT} -u ${DB_USER} -p${DB_PASSWORD} --skip-ssl ${DB_NAME} > ${BACKUP_DIR}/${SQL_FILE}
    gzip ${BACKUP_DIR}/${SQL_FILE}
    AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY} AWS_SECRET_ACCESS_KEY=${AWS_SECRET_KEY} aws s3 cp ${BACKUP_DIR}/${SQL_FILE}.gz ${S3_PATH} --region ${AWS_REGION} --storage-class ${S3_STORAGE_CLASS}
done

echo "Backup done at $(date '+%Y-%m-%d %H:%M:%S')"