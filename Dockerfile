FROM node:22-alpine

ENV NODE_ENV=production \
    FRACTAL_WEB_PORT=8080 \
    FRACTAL_DATA_DIR=/data

WORKDIR /app

COPY --chown=node:node status-monitor-web ./status-monitor-web
COPY --chown=node:node dashboard ./dashboard

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["node", "status-monitor-web/server.js"]
