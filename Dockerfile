FROM node:20-alpine
ENV NODE_ENV="production"
ENV PORT=8079
EXPOSE 8079
RUN addgroup mygroup && adduser -D -G mygroup myuser && mkdir -p /usr/src/app && chown -R myuser /usr/src/app

# Prepare app directory
WORKDIR /usr/src/app
COPY package.json package-lock.json /usr/src/app/
RUN chown myuser /usr/src/app/package-lock.json

USER myuser
RUN npm ci

# Copy app files as root, then change ownership
USER root
COPY . /usr/src/app
# make sure everything is readable by runtime user
RUN chown -R myuser:mygroup /usr/src/app \
 && chmod -R a+rX /usr/src/app

# Switch back to myuser for running the app
USER myuser

# Start the app
CMD ["/usr/local/bin/npm", "start"]

#seabook1111/front-end:inject-1-4-v10