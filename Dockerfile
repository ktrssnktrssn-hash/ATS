FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
# No production npm dependencies. Only the server and its explicit public assets.
COPY --chown=node:node server ./server
COPY --chown=node:node index.html list.html detail.html ./
COPY --chown=node:node lib ./lib
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/app.cjs"]
