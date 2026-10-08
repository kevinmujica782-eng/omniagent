#!/bin/sh
# Programador de tareas para Docker (servicio "scheduler" de docker-compose.yml).
# Llama a las rutas /api/cron/* de la app con "Authorization: Bearer $CRON_SECRET", igual que Vercel Cron:
#   compras  (/api/cron/concierge)  cada hora, minuto 5   → Pro revisa precios cada hora; Gratis, una vez al día
#   trámites (/api/cron/procedures) cada hora, minuto 35  → Pro revisa el correo cada 3 h; Gratis, una vez al día
#   finanzas (/api/cron/finance)    cada día, 11:00 UTC   → sincroniza bancos e informe mensual (Pro)
#   devoluciones (/api/cron/returns) cada hora, minuto 45 → retrasos, seguimientos, respuestas y reembolsos
#   motor (/api/cron/engine)        cada minuto           → trabajos en segundo plano en cola, reintentos y a medias
# La app decide en cada corrida qué toca según el plan de cada persona: llamar de más no duplica trabajo.
set -eu

: "${CRON_SECRET:?Falta CRON_SECRET}"
case "$CRON_SECRET" in
  *[!A-Za-z0-9_-]*)
    echo "CRON_SECRET solo puede tener letras, números, - y _ (genera uno con: openssl rand -hex 32)" >&2
    exit 1
    ;;
esac
APP="${APP_INTERNAL_URL:-http://web:3000}"

# Cada corrida deja en los logs del contenedor la respuesta de la app (conteos, nunca datos personales).
job() {
  echo "$1 wget -q -O - -T 90 --header 'Authorization: Bearer ${CRON_SECRET}' ${APP}/api/cron/$2 >/proc/1/fd/1 2>/proc/1/fd/2; echo >/proc/1/fd/1"
}

{
  job "5 * * * *" concierge
  job "35 * * * *" procedures
  job "0 11 * * *" finance
  job "45 * * * *" returns
  job "* * * * *" engine
} > /etc/crontabs/root

echo "Programador listo: el motor cada minuto, compras, trámites y devoluciones cada hora, finanzas cada día a las 11:00 UTC (${APP})."
exec crond -f -d 8 -c /etc/crontabs
